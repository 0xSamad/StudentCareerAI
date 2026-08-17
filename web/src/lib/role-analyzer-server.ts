import path from "node:path";
import { pathToFileURL } from "node:url";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { emptyProfileShape, withPreferredAiMatching } from "@/lib/user-session";

export async function loadRoleAnalyzer() {
  const root = studentCareerRoot();
  const moduleUrl = pathToFileURL(path.join(root, "lib", "saas", "role-analyzer", "index.mjs")).href;
  return import(/* webpackIgnore: true */ moduleUrl);
}

export function shapeStudentProfile(stored: Record<string, unknown> | null | undefined) {
  const defaults = emptyProfileShape();
  if (!stored) return defaults;
  const matching = withPreferredAiMatching(
    (stored.matching as Record<string, unknown> | undefined) || defaults.matching
  ) as typeof defaults.matching;
  return {
    identity: (stored.identity as typeof defaults.identity) || defaults.identity,
    education: Array.isArray(stored.education) ? stored.education : [],
    skills: (stored.skills as typeof defaults.skills) || defaults.skills,
    experience: (stored.experience as typeof defaults.experience) || defaults.experience,
    projects: Array.isArray(stored.projects) ? stored.projects : [],
    preferences: (stored.preferences as typeof defaults.preferences) || defaults.preferences,
    matching,
  };
}

export function loadCvText(stored: Record<string, unknown> | null | undefined) {
  return typeof stored?.cvText === "string" ? stored.cvText : "";
}

export function parseMarketScope(raw: unknown) {
  const s = String(raw || "ALL").trim().toUpperCase();
  if (s === "PAKISTAN" || s === "NATIONAL") return "PAKISTAN";
  if (s === "INTERNATIONAL") return "INTERNATIONAL";
  return "ALL";
}
