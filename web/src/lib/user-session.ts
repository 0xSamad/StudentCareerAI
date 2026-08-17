/**
 * Authenticated user session helpers for Next.js API routes.
 */
import { requireSession } from "./auth-server";

export async function requireUserSession(req: Request) {
  const session = await requireSession(req);
  return {
    userId: session.userId as string,
    tenantId: session.tenantId as string,
    role: session.role as string,
    token: session.token as string,
    container: session.container,
    authContext: {
      userId: session.userId as string,
      tenantId: session.tenantId as string,
      role: session.role as string,
    },
  };
}

export function preferredAiMatching() {
  const envProvider = String(process.env.AI_PROVIDER || process.env.DEFAULT_AI_PROVIDER || "").toLowerCase().trim();
  if (envProvider === "ollama") {
    return {
      ai_provider: "ollama",
      model: process.env.OLLAMA_MODEL || "",
      temperature: 0.2,
      thresholds: { show_min: 40 },
    };
  }
  if (envProvider === "gemini" && !process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    return {
      ai_provider: "gemini",
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      temperature: 0.2,
      thresholds: { show_min: 40 },
    };
  }
  return {
    ai_provider: "openai",
    model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
    temperature: 0.2,
    thresholds: { show_min: 40 },
  };
}

export function withPreferredAiMatching(storedMatching?: Record<string, unknown> | null) {
  return { ...(storedMatching || {}), ...preferredAiMatching() };
}

export function emptyProfileShape() {
  return {
    identity: {
      name: "",
      email: "",
      phone: "",
      city: "",
      country: "",
      linkedin: "",
      github: "",
      portfolio: "",
      gender: "",
    },
    education: [],
    skills: {
      programming_languages: [],
      frameworks: [],
      ai_ml: [],
      databases: [],
      cloud: [],
      tools: [],
    },
    experience: { internships: [], jobs: [] },
    projects: [],
    certifications: [],
    achievements: [],
    languages: [],
    preferences: {
      search_mode: "internships",
      target_roles: [],
      locations: { preferred: [] },
      work_authorization: "",
      needs_sponsorship: false,
      notice_period_days: "",
      current_salary: "",
      salary_currency: "PKR",
      expected_salary_from_jd: true,
    },
    matching: preferredAiMatching(),
  };
}
