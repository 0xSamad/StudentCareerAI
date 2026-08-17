/**
 * document-types.mjs — Allowed candidate knowledge document classes.
 */

export const DOCUMENT_TYPES = Object.freeze([
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
  "OTHER",
]);

export const FACT_TYPES = Object.freeze([
  "skill",
  "technology",
  "project",
  "company",
  "role",
  "education",
  "degree",
  "major",
  "coursework",
  "award",
  "publication",
  "certificate",
  "achievement",
  "url",
  "handle",
  "metric",
  "repository",
  "language",
  "contribution",
]);

export const EVIDENCE_STATUS = Object.freeze({
  GROUNDED: "GROUNDED",
  UNKNOWN: "UNKNOWN",
  REJECTED: "REJECTED",
  UNCERTAIN: "UNCERTAIN",
});

export const VERIFICATION_STATUS = Object.freeze({
  VERIFIED: "VERIFIED",
  UNCERTAIN: "UNCERTAIN",
  UNKNOWN: "UNKNOWN",
});

export const FACT_SOURCES = Object.freeze({
  USER_DOCUMENT: "user_document",
  GITHUB_PUBLIC_API: "github:public-api",
  GITHUB_README: "github:readme",
  GITHUB_EVENTS: "github:public-events",
  LINKEDIN_USER_PROVIDED: "linkedin:user-provided",
  LINKEDIN_URL_ONLY: "linkedin:url-only",
  PORTFOLIO_AUTHORIZED: "portfolio:user-authorized",
  WEBSITE_AUTHORIZED: "website:user-authorized",
  PROFILE_SEED: "profile-seed",
});

export function isDocumentType(value) {
  return DOCUMENT_TYPES.includes(String(value || "").toUpperCase());
}
