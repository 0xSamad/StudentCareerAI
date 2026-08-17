"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileStack, Upload, Search, AlertCircle, CheckCircle2 } from "lucide-react";

const DOC_TYPES = [
  "CV",
  "CV_VERSION",
  "TRANSCRIPT",
  "CERTIFICATE",
  "PROJECT_DOC",
  "PORTFOLIO",
  "GITHUB",
  "LINKEDIN",
  "PERSONAL_STATEMENT",
  "COVER_LETTER",
  "WORK_EXPERIENCE",
  "INTERNSHIP_EXPERIENCE",
  "PROJECT_DESCRIPTION",
  "SKILLS",
  "ACHIEVEMENT",
  "PUBLICATION",
  "AWARD",
  "COURSEWORK",
  "EXTRACURRICULAR",
];

const FILE_ACCEPT = ".pdf,.docx,.doc,.md,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";

const SOURCE_LABELS: Record<string, string> = {
  user_document: "CV",
  "profile-seed": "Profile",
  "github:public-api": "GitHub",
  "github:readme": "GitHub README",
  "github:public-events": "GitHub",
  "linkedin:user-provided": "LinkedIn",
  "linkedin:url-only": "LinkedIn URL",
  "portfolio:user-authorized": "Portfolio",
  "website:user-authorized": "Website",
};

function decodeEntities(value = "") {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function formatSnippet(value = "", max = 220) {
  const s = decodeEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(" ", max - 1);
  return `${s.slice(0, cut > 80 ? cut : max).trim()}…`;
}

function humanizeDocType(value = "") {
  const map: Record<string, string> = {
    CV: "CV",
    CV_VERSION: "CV version",
    GITHUB: "GitHub",
    LINKEDIN: "LinkedIn",
    PORTFOLIO: "Portfolio",
    TRANSCRIPT: "Transcript",
    CERTIFICATE: "Certificate",
    PROJECT_DOC: "Project",
    PERSONAL_STATEMENT: "Personal statement",
    COVER_LETTER: "Cover letter",
    WORK_EXPERIENCE: "Work experience",
    INTERNSHIP_EXPERIENCE: "Internship",
    PROJECT_DESCRIPTION: "Project",
    SKILLS: "Skills",
    ACHIEVEMENT: "Achievement",
    PUBLICATION: "Publication",
    AWARD: "Award",
    COURSEWORK: "Coursework",
    EXTRACURRICULAR: "Extracurricular",
  };
  const key = String(value || "").toUpperCase();
  return map[key] || String(value || "").replaceAll("_", " ");
}

function sourceLabel(source: unknown) {
  if (!source) return "";
  if (typeof source === "string") return SOURCE_LABELS[source] || source;
  const obj = source as { kind?: string; label?: string };
  return SOURCE_LABELS[obj.kind || ""] || obj.label || obj.kind || "";
}

function prettyTitle(title = "", docType = "") {
  const t = String(title || "").trim();
  if (!t || /^enrich:/i.test(t) || /enrichment$/i.test(t)) return humanizeDocType(docType) || t;
  return t;
}

type ProfileSuggestionItem = {
  selected?: boolean;
  uncertain?: boolean;
  category?: string;
  value?: string;
  university?: string;
  degree?: string;
  period?: string;
  company?: string;
  role?: string;
  description?: string;
  name?: string;
  technologies?: string[];
};

type ProfileSuggestions = {
  empty?: boolean;
  source?: string;
  skills: ProfileSuggestionItem[];
  education: ProfileSuggestionItem[];
  experience: ProfileSuggestionItem[];
  projects: ProfileSuggestionItem[];
  counts?: { skills: number; education: number; experience: number; projects: number };
};

function sourceTitle(source = "") {
  if (source === "github") return "GitHub";
  if (source === "linkedin") return "LinkedIn";
  if (source === "portfolio" || source === "website") return "your site";
  return "this evidence";
}

export function CandidateKnowledgePanel({ onProfilePatched }: { onProfilePatched?: () => void }) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [missing, setMissing] = useState<{ field: string; status: string }[]>([]);
  const [technologies, setTechnologies] = useState<string[]>([]);
  const [docType, setDocType] = useState("CV");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [evidence, setEvidence] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [githubUrl, setGithubUrl] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [linkedinText, setLinkedinText] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubTokenSaved, setGithubTokenSaved] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [suggestions, setSuggestions] = useState<ProfileSuggestions | null>(null);
  const [applying, setApplying] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const visibleDocs = useMemo(() => {
    const seen = new Set<string>();
    const out: KnowledgeDoc[] = [];
    for (const doc of docs) {
      const key = `${prettyTitle(doc.title, doc.docType).toLowerCase()}|${doc.docType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(doc);
    }
    return out;
  }, [docs]);

  const load = async () => {
    const res = await fetch("/api/knowledge");
    if (!res.ok) return;
    const data = await res.json();
    setDocs(data.documents || []);
    setMissing(data.missingInformation || []);
    setTechnologies(data.technologies || []);
  };

  useEffect(() => {
    void load();
    void fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.profile?.identity) return;
        const id = data.profile.identity;
        if (id.github && !String(id.github).includes("@")) setGithubUrl((prev) => prev || id.github);
        if (id.linkedin) setLinkedinUrl((prev) => prev || id.linkedin);
        if (id.portfolio) setWebsiteUrl((prev) => prev || id.portfolio);
        if (data.credentials?.githubTokenSet) setGithubTokenSaved(true);
      })
      .catch(() => null);
  }, []);

  const presentSuggestions = (data: any) => {
    const next = data?.profileSuggestions;
    if (next && next.empty === false) setSuggestions(next);
    else setSuggestions(null);
  };

  const ingest = async (payload: FormData | Record<string, string>) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res =
        payload instanceof FormData
          ? await fetch("/api/knowledge", { method: "POST", body: payload })
          : await fetch("/api/knowledge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || data.reason || "Could not ingest that document.");
        return;
      }
      setMessage(`Saved ${humanizeDocType(data.docType) || "document"} with ${data.factCount ?? 0} grounded facts.`);
      setText("");
      setTitle("");
      presentSuggestions(data);
      await load();
    } catch (err: any) {
      setError(err.message || "Upload failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onFile = async (file?: File | null) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("type", docType);
    form.append("title", title || file.name);
    await ingest(form);
  };

  const enrich = async (payload: Record<string, string>) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/knowledge/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.reason || data.error || "Could not import that profile.");
        await load();
        return;
      }
      const extra = Array.isArray(data.warnings) && data.warnings.length ? ` ${data.warnings[0]}` : "";
      setMessage(
        data.reason ||
          `Imported ${data.factCount || (data.facts || []).length || 0} facts from ${payload.source}.${extra}`
      );
      presentSuggestions(data);
      if (data.tokenStored || githubToken.trim()) {
        setGithubTokenSaved(true);
        setGithubToken("");
      }
      await load();
    } catch (err: any) {
      setError(err.message || "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const lookup = async () => {
    if (!query.trim()) return;
    const res = await fetch(`/api/knowledge/evidence?q=${encodeURIComponent(query.trim())}`);
    setEvidence(await res.json());
  };

  const toggleSuggestion = (group: keyof Pick<ProfileSuggestions, "skills" | "education" | "experience" | "projects">, index: number) => {
    setSuggestions((prev) => {
      if (!prev) return prev;
      const rows = [...(prev[group] || [])];
      rows[index] = { ...rows[index], selected: !rows[index].selected };
      return { ...prev, [group]: rows };
    });
  };

  const skipSuggestions = () => setSuggestions(null);

  const applySuggestions = async () => {
    if (!suggestions) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestions }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not add those items to Profile.");
        return;
      }
      setSuggestions(null);
      setMessage(data.message || "Selected evidence was added to your Profile.");
      onProfilePatched?.();
    } catch (err: any) {
      setError(err.message || "Could not add those items to Profile.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-3xl border border-border bg-surface p-6 md:p-8 shadow-sm space-y-5">
      <div className="flex items-start gap-4">
        <div className="p-3.5 bg-brand-soft rounded-2xl text-brand shrink-0">
          <FileStack className="size-8" />
        </div>
        <div>
          <h2 className="text-xl font-display text-foreground">Candidate knowledge</h2>
          <p className="text-sm text-muted mt-1 max-w-2xl leading-relaxed">
            Add CVs, transcripts, certificates, projects, GitHub, and LinkedIn evidence.
            GitHub is imported from the public API. LinkedIn URLs are saved; paste profile text to import experience.
          </p>
        </div>
      </div>

      <div
        className={`rounded-2xl border-2 border-dashed p-4 transition-colors ${
          dragging ? "border-brand bg-brand/5" : "border-border"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void onFile(e.dataTransfer.files?.[0]);
        }}
      >
        <input
          id="knowledge-file-upload"
          ref={fileRef}
          type="file"
          accept={FILE_ACCEPT}
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onFile(file);
          }}
        />
        <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="rounded-xl border border-border bg-surface-hover px-3 py-2 text-sm"
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanizeDocType(t)}
              </option>
            ))}
          </select>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="rounded-xl border border-border bg-surface-hover px-3 py-2 text-sm"
          />
          <label
            htmlFor="knowledge-file-upload"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground cursor-pointer"
          >
            <Upload className="size-4" />
            {busy ? "Uploading…" : "Upload file"}
          </label>
        </div>
        <p className="text-xs text-muted mt-2">Drop a PDF, Word, Markdown, or text file here, or use Upload file.</p>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Or paste transcript text, a project write-up, certificates, GitHub summary…"
        className="w-full min-h-[110px] rounded-xl border border-border bg-surface-hover px-3 py-2 text-sm"
      />
      <button
        type="button"
        disabled={busy || !text.trim()}
        onClick={() => void ingest({ type: docType, title: title || docType, text })}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
      >
        Add pasted evidence
      </button>

      <form className="rounded-2xl border border-border p-4 space-y-3" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
        <input type="text" name="fake-username" autoComplete="username" tabIndex={-1} aria-hidden className="sr-only" />
        <input type="password" name="fake-password" autoComplete="current-password" tabIndex={-1} aria-hidden className="sr-only" />
        <p className="text-sm font-semibold">GitHub, LinkedIn, and portfolio</p>
        <p className="text-xs text-muted">
          GitHub uses the public API. Your token is saved on this account and reused automatically. LinkedIn is never scraped — saving a URL stores the link; paste an About/Experience export to import skills and roles.
        </p>
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && githubUrl.trim()) {
                e.preventDefault();
                void enrich({ source: "github", url: githubUrl, token: githubToken });
              }
            }}
            placeholder="octocat or https://github.com/username"
            autoComplete="off"
            name="github-profile-url"
            className="rounded-xl border border-border bg-surface-hover px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !githubUrl.trim()}
            onClick={() => void enrich({ source: "github", url: githubUrl, token: githubToken })}
            className="rounded-xl border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Import GitHub
          </button>
        </div>
        <input
          type="password"
          value={githubToken}
          onChange={(e) => setGithubToken(e.target.value)}
          placeholder={githubTokenSaved ? "GitHub token saved on your account — paste a new one only to replace it" : "GitHub token (saved to your account, used automatically)"}
          autoComplete="new-password"
          name="github-access-token"
          data-lpignore="true"
          data-1p-ignore="true"
          className="w-full rounded-xl border border-border bg-surface-hover px-3 py-2 text-sm"
        />
        {githubTokenSaved ? (
          <p className="text-xs text-muted">A GitHub token is already saved for this account. Import GitHub without pasting it again.</p>
        ) : null}
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (linkedinUrl.trim() || linkedinText.trim())) {
                e.preventDefault();
                void enrich({ source: "linkedin", url: linkedinUrl, text: linkedinText });
              }
            }}
            placeholder="linkedin.com/in/your-name"
            className="rounded-xl border border-border bg-surface-hover px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || (!linkedinText.trim() && !linkedinUrl.trim())}
            onClick={() => void enrich({ source: "linkedin", url: linkedinUrl, text: linkedinText })}
            className="rounded-xl border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Import LinkedIn
          </button>
        </div>
        <textarea
          value={linkedinText}
          onChange={(e) => setLinkedinText(e.target.value)}
          placeholder="Optional: paste LinkedIn About / Experience / Skills text to import facts (never scraped)"
          className="w-full min-h-[80px] rounded-xl border border-border bg-surface-hover px-3 py-2 text-sm"
        />
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://your-portfolio.com"
            className="rounded-xl border border-border bg-surface-hover px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !websiteUrl.trim()}
            onClick={() => void enrich({ source: "portfolio", url: websiteUrl })}
            className="rounded-xl border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Import site
          </button>
        </div>
      </form>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" /> {error}
        </p>
      )}
      {message && (
        <p className="text-sm text-foreground flex items-center gap-2">
          <CheckCircle2 className="size-4 text-brand shrink-0" /> {message}
        </p>
      )}

      {suggestions && suggestions.empty === false && (
        <div className="rounded-2xl border border-brand/40 bg-brand-soft/40 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-bold text-foreground">Add these to Profile</h3>
            <p className="text-xs text-muted mt-1">
              {sourceTitle(suggestions.source)} was saved as evidence. Check what should appear on your Profile — unchecked items stay in knowledge only.
            </p>
          </div>

          {suggestions.skills.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-faint mb-1.5">Skills</p>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {suggestions.skills.map((row, i) => (
                  <label
                    key={`skill-${i}`}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer ${
                      row.selected ? "border-brand bg-surface text-foreground" : "border-border text-muted"
                    }`}
                  >
                    <input type="checkbox" checked={Boolean(row.selected)} onChange={() => toggleSuggestion("skills", i)} />
                    {row.value}
                    {row.uncertain ? <span className="text-[10px] text-faint">uncertain</span> : null}
                  </label>
                ))}
              </div>
            </div>
          )}

          {suggestions.education.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wide text-faint">Education</p>
              {suggestions.education.map((row, i) => (
                <label key={`edu-${i}`} className="flex items-start gap-2 text-xs text-foreground">
                  <input className="mt-0.5" type="checkbox" checked={Boolean(row.selected)} onChange={() => toggleSuggestion("education", i)} />
                  <span>
                    <span className="font-semibold">{row.degree || "Credential"}</span>
                    <span className="text-muted"> · {[row.university, row.period].filter(Boolean).join(" · ")}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {suggestions.experience.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wide text-faint">Experience</p>
              {suggestions.experience.map((row, i) => (
                <label key={`exp-${i}`} className="flex items-start gap-2 text-xs text-foreground">
                  <input className="mt-0.5" type="checkbox" checked={Boolean(row.selected)} onChange={() => toggleSuggestion("experience", i)} />
                  <span>
                    <span className="font-semibold">{row.role || "Role"}</span>
                    <span className="text-muted"> · {row.company}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {suggestions.projects.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wide text-faint">Projects</p>
              {suggestions.projects.map((row, i) => (
                <label key={`proj-${i}`} className="flex items-start gap-2 text-xs text-foreground">
                  <input className="mt-0.5" type="checkbox" checked={Boolean(row.selected)} onChange={() => toggleSuggestion("projects", i)} />
                  <span className="font-semibold">{row.name}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={applying}
              onClick={() => void applySuggestions()}
              className="rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground disabled:opacity-50"
            >
              {applying ? "Adding…" : "Add selected to Profile"}
            </button>
            <button
              type="button"
              disabled={applying}
              onClick={skipSuggestions}
              className="rounded-xl border border-border px-4 py-2 text-xs font-semibold"
            >
              Keep in knowledge only
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-xl border border-border p-3">
          <p className="text-[10px] uppercase tracking-wide text-faint">Documents</p>
          <p className="font-semibold mt-0.5">{visibleDocs.length}</p>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="text-[10px] uppercase tracking-wide text-faint">Attested technologies</p>
          <p className="font-semibold mt-0.5">{technologies.length}</p>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="text-[10px] uppercase tracking-wide text-faint">Missing</p>
          <p className="font-semibold mt-0.5">{missing.length} fields unknown</p>
        </div>
      </div>

      {visibleDocs.length > 0 && (
        <ul className="text-sm divide-y divide-border rounded-xl border border-border overflow-hidden">
          {visibleDocs.map((d) => (
            <li key={d.id} className="flex justify-between gap-3 px-3 py-2.5 bg-surface">
              <span className="min-w-0">
                <span className="font-medium">{prettyTitle(d.title, d.docType)}</span>
                <span className="text-faint"> · {humanizeDocType(d.docType)}</span>
              </span>
              <span className="text-faint shrink-0">{d.factCount ?? 0} facts</span>
            </li>
          ))}
        </ul>
      )}

      {missing.length > 0 && (
        <p className="text-xs text-muted flex items-start gap-2">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
          Unknown until you add evidence: {missing.map((m) => humanizeDocType(m.field) || m.field).join(", ")}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Ask: "What evidence do we have that this student knows Python?"'
          className="flex-1 min-w-[220px] rounded-xl border border-border bg-surface-hover px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void lookup()}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold"
        >
          <Search className="size-4" /> Retrieve evidence
        </button>
      </div>

      {evidence && (
        <div className="rounded-xl border border-border bg-surface-hover p-4 space-y-3">
          <p className="text-sm font-semibold">
            Status: {evidence.status}
            {evidence.reason ? <span className="font-normal text-muted"> — {evidence.reason}</span> : null}
          </p>
          <ul className="space-y-2">
            {(evidence.facts || []).slice(0, 6).map((f: any, i: number) => (
              <li key={f.id || `${f.value}-${i}`} className="rounded-lg border border-border bg-surface px-3 py-2">
                <p className="text-sm text-foreground">
                  <span className="font-medium capitalize">{f.factType}</span>
                  {": "}
                  {f.value}
                </p>
                <p className="text-xs text-muted mt-1 leading-relaxed">{formatSnippet(f.evidence || f.snippet)}</p>
                <p className="text-[11px] text-faint mt-1">
                  {sourceLabel(f.source)}
                  {f.verificationStatus ? ` · ${f.verificationStatus}` : ""}
                </p>
              </li>
            ))}
          </ul>
          {(evidence.evidence || []).length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wide text-faint">Source excerpts</p>
              {(evidence.evidence || []).slice(0, 3).map((c: any) => (
                <p key={c.chunkId} className="text-xs text-muted leading-relaxed rounded-lg border border-border bg-surface px-3 py-2">
                  {formatSnippet(c.text, 280)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
