/**
 * candidate-context-builder.mjs — Opportunity-specific candidate context.
 *
 * Input: Opportunity. Output: minimal relevant packet for Eligibility, Matching,
 * CV, Cover Letter, Application Agent, and Interview prep.
 *
 * Never concatenates the user's private document collection into a prompt.
 */

import { AccessGuard } from "../auth/access-guard.mjs";
import { EVIDENCE_STATUS } from "./document-types.mjs";
import { AUTHORITY, isAuthoritativeItem, valuesOf } from "./authority.mjs";
import { overlayIntelligenceOnProfile } from "./intelligence-profile.mjs";

export const CONTEXT_PURPOSE = Object.freeze({
  ELIGIBILITY: "eligibility",
  MATCHING: "matching",
  CV: "cv",
  COVER_LETTER: "cover_letter",
  APPLICATION_AGENT: "application_agent",
  INTERVIEW: "interview",
});

const MAX_APPROVED = 6;
const MAX_REJECTED = 8;
const MAX_INTERVIEW = 3;
const MAX_PREV_APPS = 5;
const MAX_PREV_DOCS = 6;

function requireContext(context = {}) {
  if (!context.tenantId || !context.userId) {
    throw new Error("tenantId and userId are required");
  }
  return context;
}

function blobOf(opportunity = {}) {
  return `${opportunity.title || opportunity.role || ""} ${opportunity.company || ""} ${
    opportunity.description || opportunity.raw_text || ""
  } ${opportunity.location || ""}`.toLowerCase();
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function relevantText(itemText, haystack) {
  const n = norm(itemText);
  if (!n) return false;
  if (haystack.includes(n)) return true;
  const tokens = n.split(" ").filter((t) => t.length > 3);
  if (!tokens.length) return haystack.includes(n);
  let hits = 0;
  for (const t of tokens) if (haystack.includes(t)) hits += 1;
  return hits >= Math.min(2, tokens.length);
}

function pickRelevant(items, haystack, extra = () => false) {
  return (items || []).filter((item) => {
    const value = item?.value || item?.question || item?.answer || item?.notes || item?.company || item?.title || "";
    return extra(item) || relevantText(value, haystack);
  });
}

function identityForPurpose(identity = {}, purpose) {
  const out = {};
  if (identity.name && isAuthoritativeItem(identity.name)) out.name = identity.name;
  if (identity.city && isAuthoritativeItem(identity.city)) out.city = identity.city;
  if (identity.country && isAuthoritativeItem(identity.country)) out.country = identity.country;
  if (purpose === CONTEXT_PURPOSE.APPLICATION_AGENT) {
    if (identity.email && isAuthoritativeItem(identity.email)) out.email = identity.email;
    if (identity.phone && isAuthoritativeItem(identity.phone)) out.phone = identity.phone;
    if (identity.linkedin && isAuthoritativeItem(identity.linkedin)) out.linkedin = identity.linkedin;
  }
  return out;
}

function companyOf(opportunity = {}) {
  return String(opportunity.company || "").toLowerCase().trim();
}

export class CandidateContextBuilder {
  /**
   * @param {{ knowledgeService: object, intelligenceService: object }} options
   */
  constructor({ knowledgeService, intelligenceService } = {}) {
    this.knowledgeService = knowledgeService || null;
    this.intelligenceService = intelligenceService || null;
  }

  /**
   * @param {object} opportunity
   * @param {object} context { tenantId, userId }
   * @param {{ purpose?: string }} [options]
   */
  async build(opportunity = {}, context = {}, { purpose = CONTEXT_PURPOSE.MATCHING } = {}) {
    requireContext(context);
    AccessGuard.assertAccess(context, { userId: context.userId, tenantId: context.tenantId }, "CandidateContext");

    const evidence = this.knowledgeService?.buildEvidenceContext
      ? await this.knowledgeService.buildEvidenceContext(opportunity, context)
      : {
          fullCorpusIncluded: false,
          evidencePackets: [],
          matchingSkills: [],
          matchingProjects: [],
          matchingExperience: [],
          missingInformation: [],
          documentCount: 0,
          retrievedChunkCount: 0,
          status: EVIDENCE_STATUS.UNKNOWN,
        };

    const intel = this.intelligenceService
      ? await this.intelligenceService.getIntelligenceProfile(context)
      : null;

    const haystack = blobOf(opportunity);
    const company = companyOf(opportunity);

    const preferredRoles = intel?.preferredRoles || [];
    const preferredIndustries = intel?.preferredIndustries || [];
    const locations = intel?.locations || [];
    const careerInterests = intel?.careerInterests || [];

    const relevantApproved = pickRelevant(intel?.userApprovedAnswers || [], haystack).slice(0, MAX_APPROVED);
    const relevantRejected = pickRelevant(intel?.userRejectedAnswers || [], haystack).slice(0, MAX_REJECTED);
    const relevantCorrections = (intel?.userCorrections || [])
      .filter((c) => {
        const field = String(c.field || "");
        if (field.startsWith("preferred") || field.includes("role") || field.includes("industry") || field.includes("location")) {
          return true;
        }
        return relevantText(`${c.previousValue || ""} ${c.newValue || ""}`, haystack);
      })
      .slice(0, 8);

    const interviewNotes = (intel?.interviewInformation || [])
      .filter((n) => n.authority === AUTHORITY.USER_SUPPLIED)
      .filter((n) => (company && String(n.company || "").toLowerCase() === company) || relevantText(n.notes, haystack))
      .slice(0, MAX_INTERVIEW);

    const previousApplications = (intel?.previousApplications || [])
      .filter((a) => company && String(a.company || "").toLowerCase() === company)
      .slice(0, MAX_PREV_APPS);

    const previousCvs = (intel?.previousCvs || []).slice(0, MAX_PREV_DOCS);
    const previousCoverLetters = (intel?.previousCoverLetters || [])
      .filter((c) => {
        if (purpose !== CONTEXT_PURPOSE.COVER_LETTER && purpose !== CONTEXT_PURPOSE.APPLICATION_AGENT) return false;
        return !c.jobId || c.jobId === (opportunity.id || opportunity.opportunity_id);
      })
      .slice(0, 4);

    const packet = {
      fullCorpusIncluded: false,
      purpose,
      documentCount: evidence.documentCount || 0,
      retrievedChunkCount: evidence.retrievedChunkCount || (evidence.evidencePackets || []).length,
      matchingSkills: evidence.matchingSkills || [],
      uncertainSkills: evidence.uncertainSkills || [],
      missingSkills: evidence.missingSkills || [],
      matchingProjects: evidence.matchingProjects || [],
      matchingExperience: evidence.matchingExperience || [],
      technologiesUsed: evidence.technologiesUsed || [],
      education: evidence.education || intel?.education || { satisfied: [], unknown: [], facts: [] },
      evidencePackets: evidence.evidencePackets || [],
      missingInformation: [...(evidence.missingInformation || [])],
      status: evidence.status || EVIDENCE_STATUS.UNKNOWN,
      identity: identityForPurpose(intel?.identity || {}, purpose),
      skills: (intel?.skills || []).filter(isAuthoritativeItem).slice(0, 24),
      experience: (intel?.experience || []).filter((item) => isAuthoritativeItem(item) && relevantText(item.value, haystack)).slice(0, 8),
      projects: (intel?.projects || []).filter((item) => isAuthoritativeItem(item) && relevantText(item.value, haystack)).slice(0, 8),
      preferences: {
        preferredRoles,
        preferredIndustries,
        locations,
        careerInterests,
        workPreferences: intel?.workPreferences || {},
        applicationPreferences: intel?.applicationPreferences || {},
      },
      userApprovedAnswers: relevantApproved,
      userRejectedAnswers: relevantRejected,
      userCorrections: relevantCorrections,
      interviewInformation: interviewNotes,
      previousApplications,
      previousCvs,
      previousCoverLetters,
      privacy: {
        tenantIsolated: true,
        fullCorpusIncluded: false,
        generatedTreatedAsFact: false,
        piiMinimized: purpose !== CONTEXT_PURPOSE.APPLICATION_AGENT,
        purpose,
      },
    };

    if (!preferredRoles.filter(isAuthoritativeItem).length) {
      packet.missingInformation.push({ field: "preferred_roles", status: EVIDENCE_STATUS.UNKNOWN });
    }

    return packet;
  }
}

export { overlayIntelligenceOnProfile };
export function preferredRoleValues(knowledgeContext) {
  return valuesOf(knowledgeContext?.preferences?.preferredRoles || [], { authoritativeOnly: true });
}
