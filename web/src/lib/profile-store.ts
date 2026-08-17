import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { studentCareerRoot } from "@/lib/student-career-ai";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { emptyProfileShape } from "@/lib/user-session";

export function studentProfilePath(): string {
  return path.join(studentCareerRoot(), "config", "student-profile.yml");
}

export function cvPath(): string {
  return path.join(studentCareerRoot(), "cv.md");
}

export function loadProfileFromDisk() {
  const profileFile = studentProfilePath();
  const cvFile = cvPath();
  let profile = emptyProfileShape();
  let cvText = "";

  if (fs.existsSync(profileFile)) {
    try {
      const parsed = yaml.load(fs.readFileSync(profileFile, "utf-8")) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        profile = {
          identity: (parsed.identity as typeof profile.identity) || profile.identity,
          education: Array.isArray(parsed.education) ? (parsed.education as typeof profile.education) : profile.education,
          skills: (parsed.skills as typeof profile.skills) || profile.skills,
          experience: (parsed.experience as typeof profile.experience) || profile.experience,
          projects: Array.isArray(parsed.projects) ? (parsed.projects as typeof profile.projects) : profile.projects,
          preferences: (parsed.preferences as typeof profile.preferences) || profile.preferences,
          matching: (parsed.matching as typeof profile.matching) || profile.matching,
        };
      }
    } catch {
      /* keep defaults */
    }
  }

  if (fs.existsSync(cvFile)) {
    try {
      cvText = fs.readFileSync(cvFile, "utf-8");
    } catch {
      cvText = "";
    }
  }

  return { profile, cvText };
}

export function saveProfileToDisk(profile: Record<string, unknown>, cvText?: string) {
  const profileFile = studentProfilePath();
  fs.mkdirSync(path.dirname(profileFile), { recursive: true });
  const yamlStr = yaml.dump(profile, { indent: 2, lineWidth: -1 });
  atomicWriteWithBackup(profileFile, yamlStr);

  if (typeof cvText === "string") {
    atomicWriteWithBackup(cvPath(), cvText);
  }

  return new Date().toISOString();
}
