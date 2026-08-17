import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { cleanExtractedText, heuristicExtract, normalizeParsedProfile } from "../../../../../../lib/profile-parser.mjs";
import { extractDocxText, extractPdfText } from "../../../../../../lib/saas/knowledge/text-extractor.mjs";
import { callAI, resolveProvider, MatchProviderError } from "../../../../../../lib/ai-provider.mjs";
import { requireUserSession } from "@/lib/user-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStudentProfilePath() {
  return path.join(studentCareerRoot(), "config", "student-profile.yml");
}

function getCvPath() {
  return path.join(studentCareerRoot(), "cv.md");
}

const PARSE_SYSTEM_PROMPT = `You are an expert resume parsing and structuring engine.
Given the candidate's resume/CV document, extract EVERY stated fact into the JSON schema below, and generate a clean Markdown version of the CV.

RULES:
1. Return ONLY valid JSON (no markdown formatting, no code fences).
2. Never invent or hallucinate information. If a field is missing, set it to null or an empty array.
3. Extract city and country from the contact/header line (e.g. "Peshawar, Pakistan").
4. Copy every item from Technical Skills / Skills, including security tools, into the matching skill arrays. Pentest tools, vulnerabilities, OSINT, and Linux belong in "tools". Programming languages go in programming_languages. Flask/Django/React go in frameworks. MySQL/PostgreSQL go in databases.
5. Extract coursework from phrases like "coursework includes X, Y, and Z" as well as a Coursework section.
6. Extract ALL education rows (university, college, diploma, intermediate/HSSC, matric), not only the latest degree. Strip CGPA from the university name; put GPA in gpa.
7. Extract work experience even when it is self-directed, remote, freelance, or bug bounty. Use the role and organization as written.
8. Extract every certification (name, issuer, date) and every achievement bullet.
9. Graduation dates: use YYYY-MM only when a month is stated. If the CV says "Present", a year range, or a semester, set graduation_date to null. Never guess a month.
10. GPA must be a float (e.g. 3.85). Treat CGPA like GPA.
11. Target roles from the headline and "seeking a ... internship/role" line (e.g. Cybersecurity Intern).
12. The "cv_markdown" field MUST contain the full resume formatted as clean Markdown.

SCHEMA:
{
  "cv_markdown": "# Full Name\\nemail@example.com | ...\\n\\n## Summary\\n...\\n\\n## Education\\n...\\n\\n## Experience\\n...\\n\\n## Projects\\n...\\n\\n## Skills\\n...\\n\\n## Certifications\\n...",
  "identity": {
    "name": "Full Name",
    "email": "email@example.com",
    "phone": "+1234567890",
    "city": "City",
    "country": "Country",
    "linkedin": "url or null",
    "github": "url or null",
    "portfolio": "url or null"
  },
  "education": [
    {
      "university": "University Name",
      "degree": "Bachelor of Science in Software Engineering",
      "major": "Software Engineering",
      "graduation_date": "2026-06 or null",
      "gpa": 3.85,
      "gpa_scale": 4.0,
      "coursework": ["Cybersecurity", "Databases"]
    }
  ],
  "skills": {
    "programming_languages": ["Python", "C++"],
    "frameworks": ["Flask"],
    "ai_ml": [],
    "databases": ["MySQL"],
    "cloud": [],
    "tools": ["Burp Suite", "Nmap", "Git"]
  },
  "experience": {
    "internships": [
      {
        "company": "Company",
        "role": "Role",
        "start_date": "2024-01 or null",
        "end_date": null,
        "description": "Responsibilities",
        "achievements": ["Achievement"]
      }
    ]
  },
  "projects": [
    {
      "name": "Project Name",
      "description": "Project summary",
      "technologies": ["Python"],
      "achievements": ["Impact metric"]
    }
  ],
  "certifications": [
    { "name": "eJPT – Junior Penetration Tester", "issuer": "INE Security", "date": "Apr 2025" }
  ],
  "achievements": ["Award or distinction as written"],
  "languages": ["English (Fluent)"],
  "target_roles": ["Cybersecurity Intern"]
}`;

function loadExistingMatchingConfig() {
  const profilePath = getStudentProfilePath();
  if (!fs.existsSync(profilePath)) return {};
  try {
    const parsed = yaml.load(fs.readFileSync(profilePath, "utf-8")) as any;
    return parsed?.matching && typeof parsed.matching === "object" ? parsed.matching : {};
  } catch {
    return {};
  }
}

const GEMINI_PARSE_MODELS = [
  "gemini-2.5-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
];

async function callGeminiExtract(
  systemPrompt: string,
  userPromptText: string,
  base64File?: { data: string; mimeType: string },
  preferredModel?: string
): Promise<any> {
  const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
  const apiKeys = rawKeys.split(",").map((k) => k.trim()).filter(Boolean);

  if (apiKeys.length === 0) return null;

  const models = [...new Set([preferredModel, process.env.GEMINI_MODEL, ...GEMINI_PARSE_MODELS].filter(Boolean))];

  for (const model of models) {
    for (const apiKey of apiKeys) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const parts: any[] = [];
        if (userPromptText) {
          parts.push({ text: `${systemPrompt}\n\nResume Document Content:\n${userPromptText}` });
        } else {
          parts.push({ text: systemPrompt });
        }

        if (base64File && base64File.data) {
          parts.push({
            inlineData: {
              mimeType: base64File.mimeType,
              data: base64File.data,
            },
          });
        }

        const payload = {
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
          },
        };

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) continue;

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
          return JSON.parse(cleaned);
        }
      } catch (err) {
        console.warn("Gemini REST attempt failed:", err);
        continue;
      }
    }
  }
  return null;
}

async function parseWithConfiguredProvider(
  matchingConfig: Record<string, unknown>,
  cvText: string,
  base64File?: { data: string; mimeType: string }
) {
  const openaiResolved = resolveProvider({
    ai_provider: "openai",
    model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
    temperature: typeof matchingConfig.temperature === "number" ? matchingConfig.temperature : 0.2,
  });
  const textForPrompt = cvText ? cvText.slice(0, 20000) : "";

  if (textForPrompt) {
    try {
      const raw = await callAI(
        openaiResolved,
        PARSE_SYSTEM_PROMPT,
        `Resume Document Content:\n${textForPrompt}`
      );
      const cleaned = String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      return { extracted: JSON.parse(cleaned), resolved: openaiResolved };
    } catch {
      /* Gemini is the second-choice parser */
    }
  }

  const extracted = await callGeminiExtract(
    PARSE_SYSTEM_PROMPT,
    textForPrompt,
    base64File,
    process.env.GEMINI_MODEL || "gemini-2.5-flash"
  );
  if (!extracted) {
    throw new MatchProviderError("Could not parse the CV with OpenAI or Gemini.", "openai");
  }
  return {
    extracted,
    resolved: {
      provider: "gemini",
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      temperature: 0.2,
    },
  };
}

export async function POST(req: Request) {
  try {
    const { userId, tenantId, container } = await requireUserSession(req);
    const usesPg = Boolean(container.postgresClient && !container.postgresClient.isMock);

    let cvText = "";
    let base64File: { data: string; mimeType: string } | undefined = undefined;
    let cvOriginal: { storageKey: string; filename: string; mimeType: string; uploadedAt: string; byteLength?: number } | null = null;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data") || contentType.includes("multipart/")) {
      const formData = await req.formData();
      const file = (formData.get("file") || formData.get("cv") || formData.get("document")) as File | null;
      if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
        return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const filename = file.name.toLowerCase();
      const mime = file.type || "application/octet-stream";

      if (filename.endsWith(".docx") || mime.includes("wordprocessingml")) {
        cvText = extractDocxText(buffer);
      } else if (filename.endsWith(".pdf") || mime === "application/pdf") {
        cvText = extractPdfText(buffer);
        base64File = {
          data: buffer.toString("base64"),
          mimeType: "application/pdf",
        };
      } else {
        cvText = buffer.toString("utf-8");
      }

      cvText = cleanExtractedText(cvText);
      if (container.storageService) {
        try {
          const { saveOriginalCv } = await import("@/lib/apply/user-cv-store.mjs");
          cvOriginal = await saveOriginalCv({
            storage: container.storageService,
            buffer,
            filename: file.name || "cv.docx",
            mimeType: mime,
            context: { userId, tenantId },
          });
        } catch {
          cvOriginal = null;
        }
      }
    } else {
      const body = await req.json().catch(() => ({}));
      cvText = cleanExtractedText(body.cvText || body.content || "");
    }

    if (!cvText && !base64File) {
      return NextResponse.json({ ok: false, error: "Could not read text or document from upload." }, { status: 400 });
    }

    const matchingConfig = loadExistingMatchingConfig();
    let extracted: any = null;
    let resolvedProvider: any = null;
    let usedHeuristicFallback = false;
    let providerWarning: string | null = null;

    try {
      const parsed = await parseWithConfiguredProvider(matchingConfig, cvText, base64File);
      extracted = parsed.extracted;
      resolvedProvider = parsed.resolved;
    } catch (err: any) {
      providerWarning = err?.message || "AI parsing failed.";
      if (!cvText) {
        return NextResponse.json(
          {
            ok: false,
            error: providerWarning,
            details:
              "The uploaded file could not be parsed into readable text, and the selected AI provider could not process it directly.",
          },
          { status: 422 }
        );
      }
      usedHeuristicFallback = true;
      extracted = heuristicExtract(cvText);
    }

    const normalized = normalizeParsedProfile(extracted, cvText);
    const cleanName = normalized.identity?.name || "Student Candidate";
    const finalMarkdown =
      normalized.cv_markdown && typeof normalized.cv_markdown === "string" && normalized.cv_markdown.length > 30
        ? normalized.cv_markdown
        : cvText && cvText.length > 30
          ? `# ${cleanName}\n\n${cvText}`
          : `# ${cleanName}`;

    const preferredLocations = [normalized.identity?.city, normalized.identity?.country].filter(Boolean);
    const fullProfile = {
      identity: normalized.identity,
      education: normalized.education,
      skills: normalized.skills,
      experience: normalized.experience,
      projects: normalized.projects,
      certifications: normalized.certifications || [],
      achievements: normalized.achievements || [],
      languages: normalized.languages || [],
      preferences: {
        search_mode: "internships",
        target_roles: normalized.target_roles || [],
        locations: {
          preferred: preferredLocations,
        },
        work_authorization: "",
        needs_sponsorship: false,
      },
      matching: {
        ai_provider: resolvedProvider?.provider || matchingConfig.ai_provider || "openai",
        model: resolvedProvider?.model || matchingConfig.model || process.env.OPENAI_MODEL || "gpt-5.6-luna",
        temperature:
          typeof resolvedProvider?.temperature === "number"
            ? resolvedProvider.temperature
            : typeof matchingConfig.temperature === "number"
              ? matchingConfig.temperature
              : 0.2,
      },
      ...(cvOriginal ? { cvOriginal } : {}),
    };

    // Persist to PostgreSQL (SaaS) or legacy local files when DB unavailable
    if (usesPg) {
      await container.profileRepository.upsertProfile(userId, tenantId, {
        ...fullProfile,
        cvText: finalMarkdown,
      });
    } else {
      const profilePath = getStudentProfilePath();
      const cvPath = getCvPath();
      fs.mkdirSync(path.dirname(profilePath), { recursive: true });
      const yamlStr = yaml.dump(fullProfile, { indent: 2, lineWidth: -1 });
      atomicWriteWithBackup(profilePath, yamlStr);
      atomicWriteWithBackup(cvPath, finalMarkdown);
    }

    if (container.candidateKnowledgeService) {
      await container.candidateKnowledgeService
        .ingestDocument(
          {
            type: "CV",
            title: "Master CV",
            filename: "cv.md",
            text: finalMarkdown,
            profile: fullProfile,
          },
          { userId, tenantId }
        )
        .catch(() => null);
    }

    const skillsCount = Object.values(fullProfile.skills || {}).reduce(
      (acc: number, list: any) => acc + (Array.isArray(list) ? list.length : 0),
      0
    );
    const projectsCount = (fullProfile.projects || []).length;

    return NextResponse.json({
      ok: true,
      message: usedHeuristicFallback
        ? `CV imported with limited extraction. Parsed ${skillsCount} skills and ${projectsCount} projects from directly detectable content only.`
        : `Successfully parsed CV! Auto-extracted ${skillsCount} skills and ${projectsCount} projects.`,
      profile: fullProfile,
      cvText: finalMarkdown,
      provider: resolvedProvider?.provider || null,
      warnings: [
        ...(normalized.warnings || []),
        ...(providerWarning ? [providerWarning] : []),
      ],
      usedHeuristicFallback,
      stats: {
        skillsCount,
        projectsCount,
        educationCount: (fullProfile.education || []).length,
      },
    });
  } catch (err: any) {
    console.error("Upload error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Failed to process CV upload" }, { status: 500 });
  }
}
