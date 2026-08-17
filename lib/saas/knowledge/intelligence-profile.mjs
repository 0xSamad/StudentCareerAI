/**
 * intelligence-profile.mjs — Canonical Candidate Intelligence Profile.
 *
 * Grows as the user supplies information. AI drafts are stored as GENERATED
 * summaries (previous CVs / cover letters) and are never treated as facts.
 */

import { AUTHORITY, attributedValue, isAuthoritativeItem, uniqueAttributed, valuesOf } from "./authority.mjs";
import { nowIso } from "./fact-shape.mjs";

export const INTELLIGENCE_SECTIONS = Object.freeze([
  "identity",
  "education",
  "skills",
  "experience",
  "projects",
  "careerInterests",
  "preferredRoles",
  "preferredIndustries",
  "locations",
  "workPreferences",
  "applicationPreferences",
  "previousApplications",
  "previousCvs",
  "previousCoverLetters",
  "userCorrections",
  "userApprovedAnswers",
  "userRejectedAnswers",
  "interviewInformation",
]);

export function emptyIntelligenceProfile() {
  return {
    identity: {},
    education: [],
    skills: [],
    experience: [],
    projects: [],
    careerInterests: [],
    preferredRoles: [],
    preferredIndustries: [],
    locations: [],
    workPreferences: {},
    applicationPreferences: {},
    previousApplications: [],
    previousCvs: [],
    previousCoverLetters: [],
    userCorrections: [],
    userApprovedAnswers: [],
    userRejectedAnswers: [],
    interviewInformation: [],
    updatedAt: null,
  };
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  if (value == null || value === "") return [];
  return [value];
}

function attr(value, authority, sourceKind, extra = {}) {
  if (value == null || value === "") return null;
  return attributedValue(value, {
    authority,
    source: { kind: sourceKind, label: sourceKind },
    ...extra,
  });
}

function mergeIdentity(base = {}, incoming = {}) {
  const out = { ...base };
  for (const [key, item] of Object.entries(incoming || {})) {
    if (!item) continue;
    const current = out[key];
    if (!current || (isAuthoritativeItem(item) && !isAuthoritativeItem(current))) {
      out[key] = item;
    }
  }
  return out;
}

function mergePrefObject(base = {}, incoming = {}) {
  const out = { ...base };
  for (const [key, item] of Object.entries(incoming || {})) {
    if (item == null) continue;
    const current = out[key];
    if (!current || isAuthoritativeItem(item) || !isAuthoritativeItem(current)) {
      out[key] = item;
    }
  }
  return out;
}

/**
 * Merge two intelligence profiles. Authoritative values win over generated.
 */
export function mergeIntelligenceProfiles(base = emptyIntelligenceProfile(), incoming = {}) {
  const out = emptyIntelligenceProfile();
  out.identity = mergeIdentity(base.identity, incoming.identity);
  out.education = uniqueAttributed([...(base.education || []), ...(incoming.education || [])]);
  out.skills = uniqueAttributed([...(base.skills || []), ...(incoming.skills || [])]);
  out.experience = uniqueAttributed([...(base.experience || []), ...(incoming.experience || [])]);
  out.projects = uniqueAttributed([...(base.projects || []), ...(incoming.projects || [])]);
  // Incoming (feedback / snapshot) first so user corrections beat stale profile values.
  out.careerInterests = uniqueAttributed([...(incoming.careerInterests || []), ...(base.careerInterests || [])]);
  out.preferredRoles = uniqueAttributed([...(incoming.preferredRoles || []), ...(base.preferredRoles || [])]);
  out.preferredIndustries = uniqueAttributed([
    ...(incoming.preferredIndustries || []),
    ...(base.preferredIndustries || []),
  ]);
  out.locations = uniqueAttributed([...(incoming.locations || []), ...(base.locations || [])]);
  out.workPreferences = mergePrefObject(base.workPreferences, incoming.workPreferences);
  out.applicationPreferences = mergePrefObject(base.applicationPreferences, incoming.applicationPreferences);
  out.previousApplications = [...(incoming.previousApplications || base.previousApplications || [])].slice(0, 50);
  out.previousCvs = [...(incoming.previousCvs || base.previousCvs || [])].slice(0, 40);
  out.previousCoverLetters = [...(incoming.previousCoverLetters || base.previousCoverLetters || [])].slice(0, 40);
  out.userCorrections = [...(incoming.userCorrections || []), ...(base.userCorrections || [])].slice(0, 200);
  out.userApprovedAnswers = [...(incoming.userApprovedAnswers || []), ...(base.userApprovedAnswers || [])].slice(0, 200);
  out.userRejectedAnswers = [...(incoming.userRejectedAnswers || []), ...(base.userRejectedAnswers || [])].slice(0, 200);
  out.interviewInformation = [...(incoming.interviewInformation || []), ...(base.interviewInformation || [])].slice(0, 80);
  out.updatedAt = incoming.updatedAt || base.updatedAt || nowIso();
  return out;
}

/**
 * Build attributed fields from a user-saved student profile (trusted).
 */
export function profileFromTrustedStudentRecord(profile = {}, { authority = AUTHORITY.USER_SUPPLIED } = {}) {
  const sourceKind = authority === AUTHORITY.TRUSTED_DOCUMENT ? "trusted_document" : "user_supplied";
  const prefs = profile.preferences || {};
  const identity = {};
  for (const key of ["name", "email", "phone", "city", "country", "linkedin", "github", "portfolio"]) {
    const v = profile.identity?.[key];
    if (v) identity[key] = attr(v, authority, sourceKind);
  }

  const education = asList(profile.education).map((e) =>
    attributedValue(
      [e.degree, e.major, e.university || e.school].filter(Boolean).join(" — ") || JSON.stringify(e),
      { authority, source: { kind: sourceKind }, evidence: e.university || e.school || null }
    )
  );

  const skillValues = [
    ...(profile.skills?.programming_languages || []),
    ...(profile.skills?.frameworks || []),
    ...(profile.skills?.ai_ml || []),
    ...(profile.skills?.databases || []),
    ...(profile.skills?.tools || []),
    ...(profile.skills?.cloud || []),
    ...(Array.isArray(profile.skills) ? profile.skills : []),
  ];

  const experience = [
    ...(Array.isArray(profile.experience) ? profile.experience : []),
    ...(profile.experience?.internships || []),
    ...(profile.experience?.jobs || []),
  ].map((e) =>
    attributedValue([e.role, e.company].filter(Boolean).join(" at ") || e.description, {
      authority,
      source: { kind: sourceKind },
      evidence: e.company || null,
    })
  );

  const projects = asList(profile.projects).map((p) =>
    attributedValue(p.name || p.title, { authority, source: { kind: sourceKind }, evidence: p.description || null })
  );

  const workPreferences = {};
  if (prefs.locations?.remote != null) {
    workPreferences.remote = attributedValue(Boolean(prefs.locations.remote), { authority, source: { kind: sourceKind } });
  }
  if (prefs.locations?.hybrid != null) {
    workPreferences.hybrid = attributedValue(Boolean(prefs.locations.hybrid), { authority, source: { kind: sourceKind } });
  }
  if (prefs.locations?.on_site != null) {
    workPreferences.onSite = attributedValue(Boolean(prefs.locations.on_site), { authority, source: { kind: sourceKind } });
  }
  if (prefs.search_mode) {
    workPreferences.searchMode = attributedValue(prefs.search_mode, { authority, source: { kind: sourceKind } });
  }

  const applicationPreferences = {};
  if (prefs.automation?.auto_submit != null) {
    applicationPreferences.autoSubmit = attributedValue(Boolean(prefs.automation.auto_submit), {
      authority,
      source: { kind: sourceKind },
    });
  }
  if (prefs.automation?.min_match_score != null) {
    applicationPreferences.minMatchScore = attributedValue(prefs.automation.min_match_score, {
      authority,
      source: { kind: sourceKind },
    });
  }

  return mergeIntelligenceProfiles(emptyIntelligenceProfile(), {
    identity,
    education,
    skills: skillValues.map((s) => attr(s, authority, sourceKind)).filter(Boolean),
    experience,
    projects,
    careerInterests: asList(prefs.goals || prefs.career_goal).map((g) => attr(g, authority, sourceKind)).filter(Boolean),
    preferredRoles: asList(prefs.target_roles).map((r) => attr(r, authority, sourceKind)).filter(Boolean),
    preferredIndustries: asList(prefs.target_industries).map((r) => attr(r, authority, sourceKind)).filter(Boolean),
    locations: asList(prefs.locations?.preferred || prefs.preferred_locations)
      .map((l) => attr(l, authority, sourceKind))
      .filter(Boolean),
    workPreferences,
    applicationPreferences,
    updatedAt: nowIso(),
  });
}

export function factsToIntelligenceSlice(facts = []) {
  const slice = emptyIntelligenceProfile();
  for (const fact of facts) {
    const authority =
      fact.verificationStatus === "VERIFIED" ? AUTHORITY.TRUSTED_DOCUMENT : AUTHORITY.GENERATED;
    const item = attributedValue(fact.value, {
      authority,
      source: fact.source,
      confidence: fact.confidence,
      timestamp: fact.timestamp || fact.observedAt,
      evidence: fact.evidence || fact.snippet,
      verificationStatus: fact.verificationStatus,
    });
    if (fact.factType === "skill" || fact.factType === "technology") slice.skills.push(item);
    else if (fact.factType === "project") slice.projects.push(item);
    else if (fact.factType === "company" || fact.factType === "role") slice.experience.push(item);
    else if (["education", "degree", "major", "coursework"].includes(fact.factType)) slice.education.push(item);
  }
  return slice;
}

/**
 * Overlay authoritative intelligence preferences onto a student profile copy
 * so matching / eligibility / cover-letter goals see user corrections.
 */
export function overlayIntelligenceOnProfile(profile = {}, knowledgeContext = null) {
  if (!knowledgeContext) return profile;
  const prefs = knowledgeContext.preferences || {};
  const clone = {
    ...profile,
    preferences: { ...(profile.preferences || {}) },
  };
  const roles = valuesOf(prefs.preferredRoles, { authoritativeOnly: true }).map(String);
  if (roles.length) {
    clone.preferences.target_roles = uniqueStrings([
      ...roles,
      ...(clone.preferences.target_roles || []),
    ]);
  }
  const industries = valuesOf(prefs.preferredIndustries, { authoritativeOnly: true }).map(String);
  if (industries.length) {
    clone.preferences.target_industries = uniqueStrings([
      ...industries,
      ...(clone.preferences.target_industries || []),
    ]);
  }
  const locations = valuesOf(prefs.locations, { authoritativeOnly: true }).map(String);
  if (locations.length) {
    clone.preferences.locations = {
      ...(clone.preferences.locations || {}),
      preferred: uniqueStrings([...locations, ...((clone.preferences.locations || {}).preferred || [])]),
    };
  }
  return clone;
}

function uniqueStrings(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const s = String(item || "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function applyRoleCorrection(profile, previousValue, newValue, meta = {}) {
  const next = mergeIntelligenceProfiles(profile, {});
  const prev = String(previousValue || "").trim();
  const neu = String(newValue || "").trim();
  if (prev) {
    next.preferredRoles = (next.preferredRoles || []).filter(
      (r) => String(r.value || "").toLowerCase() !== prev.toLowerCase()
    );
  }
  if (neu) {
    next.preferredRoles = uniqueAttributed([
      attributedValue(neu, {
        authority: AUTHORITY.USER_SUPPLIED,
        source: { kind: "user-correction", label: "User correction" },
        evidence: prev ? `Corrected from "${prev}"` : null,
        ...meta,
      }),
      ...next.preferredRoles,
    ]);
  }
  next.userCorrections = [
    {
      field: meta.field || "preferred_role",
      previousValue: prev || null,
      newValue: neu,
      opportunityId: meta.opportunityId || null,
      authority: AUTHORITY.USER_SUPPLIED,
      timestamp: nowIso(),
    },
    ...(next.userCorrections || []),
  ].slice(0, 200);
  next.updatedAt = nowIso();
  return next;
}
