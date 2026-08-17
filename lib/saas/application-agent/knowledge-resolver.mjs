/**
 * knowledge-resolver.mjs — Resolve a classified field from Candidate Knowledge.
 * UNKNOWN evidence → REQUIRES_USER_INPUT. Never guess work authorization.
 */

import { deriveFromProfile, nameAnswerForField } from "../../application-generator.mjs";
import { validateAgainstSourceFacts } from "../../cv-tailor.mjs";
import { FIELD_INTENT, isSensitiveIntent } from "./field-classifier.mjs";

function unknown(classification, rationale) {
  return {
    answer: "",
    confidence: 0,
    requires_user_input: true,
    sensitive: classification.isSensitive || isSensitiveIntent(classification.intent),
    category: classification.category,
    intent: classification.intent,
    evidenceStatus: "UNKNOWN",
    rationale,
  };
}

function ok(classification, answer, extra = {}) {
  return {
    answer,
    confidence: extra.confidence ?? 0.9,
    requires_user_input: false,
    sensitive: false,
    category: classification.category,
    intent: classification.intent,
    evidenceStatus: extra.evidenceStatus || "GROUNDED",
    rationale: extra.rationale || "Retrieved from attested candidate record",
    sourceEvidence: extra.sourceEvidence || [],
  };
}

function matchQuestion(questionText, items = []) {
  const target = String(questionText || "").toLowerCase().trim();
  if (!target) return null;
  return (items || []).find((a) => {
    const q = String(a.question || "").toLowerCase();
    return q && (q.includes(target) || target.includes(q));
  });
}

function rejectedProposed(questionText, proposed, items = []) {
  if (!proposed) return false;
  const target = String(questionText || "").toLowerCase().trim();
  const p = String(proposed || "").toLowerCase().replace(/\s+/g, " ").trim();
  return (items || []).some((a) => {
    const q = String(a.question || "").toLowerCase();
    const av = String(a.proposed || a.answer || "").toLowerCase().replace(/\s+/g, " ").trim();
    return q && (q.includes(target) || target.includes(q)) && av && av === p;
  });
}

function coverLetterBody(applicationRecord) {
  const cl = applicationRecord?.cover_letter;
  if (cl?.skipped) return "";
  return cl?.body || cl?.coverLetter || "";
}

/**
 * @returns {Promise<object>} mapping compatible with mapFieldToAnswer
 */
export async function resolveFieldFromKnowledge({
  field,
  classification,
  profile = null,
  applicationRecord = null,
  sourceFacts = null,
  opportunity = {},
  candidateKnowledgeService = null,
  authContext = null,
} = {}) {
  const intent = classification.intent;
  const questionText = classification.questionText || field.label || field.name || "";

  if (classification.isSensitive || isSensitiveIntent(intent)) {
    const label =
      intent === FIELD_INTENT.WORK_AUTHORIZATION
        ? "WORK_AUTHORIZATION"
        : `${intent} (${classification.category})`;
    return unknown(
      classification,
      `Hard gate: "${questionText}" is ${label}. UNKNOWN / REQUIRES_USER_INPUT — do not guess.`
    );
  }

  if (intent === FIELD_INTENT.CV_UPLOAD || intent === FIELD_INTENT.COVER_LETTER_UPLOAD || intent === FIELD_INTENT.FILE_UPLOAD) {
    return {
      answer: "",
      confidence: 1,
      requires_user_input: false,
      sensitive: false,
      category: classification.category,
      intent,
      evidenceStatus: "N/A",
      rationale: "File field — handled by upload step, not typed text.",
      fileIntent: intent,
    };
  }

  let candidateContext = null;
  async function loadContext() {
    if (candidateContext || !candidateKnowledgeService || !authContext) return candidateContext;
    try {
      candidateContext = await candidateKnowledgeService.getCandidateContextForOpportunity(opportunity, authContext, {
        purpose: "application_agent",
      });
    } catch {
      candidateContext = null;
    }
    return candidateContext;
  }

  const ctxEarly = await loadContext();
  const approved = matchQuestion(questionText, ctxEarly?.userApprovedAnswers);
  if (approved?.answer) {
    return ok(classification, approved.answer, {
      confidence: 1,
      rationale: "User-approved application answer.",
      evidenceStatus: "GROUNDED",
    });
  }

  const prepared = matchQuestion(questionText, applicationRecord?.application_answers);
    if (prepared) {
    if (prepared.requires_user_input) {
      return unknown(classification, prepared.rationale || "Prepared answer requires user input.");
    }
    if (rejectedProposed(questionText, prepared.answer, ctxEarly?.userRejectedAnswers)) {
      return unknown(
        classification,
        "Prepared answer matches a user-rejected draft. UNKNOWN — do not reuse it."
      );
    }
    if (sourceFacts && prepared.answer) {
      const validation = validateAgainstSourceFacts(prepared.answer, sourceFacts);
      if (validation.valid === false || validation.result === "REJECTED") {
        return unknown(classification, `Fabrication detected in generated answer: ${(validation.violations || []).join("; ")}`);
      }
    }
    const answer =
      prepared.category === "name" || classification.intent === FIELD_INTENT.NAME
        ? nameAnswerForField(prepared.answer, field)
        : prepared.answer;
    return ok(classification, answer, {
      confidence: prepared.confidence,
      rationale: "Matched a prepared application answer.",
    });
  }

  if (intent === FIELD_INTENT.MOTIVATION_QUESTION || intent === FIELD_INTENT.COVER_LETTER_TEXT) {
    const letter = coverLetterBody(applicationRecord);
    if (letter) {
      if (sourceFacts) {
        const validation = validateAgainstSourceFacts(letter, sourceFacts);
        if (validation.valid === false || validation.result === "REJECTED") {
          return unknown(classification, "Cover letter failed claim validation; not used as a form answer.");
        }
      }
      return ok(classification, letter, {
        rationale: "Used the generated cover letter as the motivation / cover-letter answer.",
        sourceEvidence: applicationRecord?.cover_letter?.sourceEvidence || [],
      });
    }
    if (candidateKnowledgeService && authContext) {
      try {
        const ctx = await loadContext();
        const packets = ctx?.evidencePackets || [];
        const projects = (ctx?.matchingProjects || []).map((p) => p.value || p.name).filter(Boolean);
        if (!packets.length && !projects.length) {
          return unknown(classification, "MOTIVATION_QUESTION has no attested evidence. UNKNOWN — do not guess.");
        }
        const bits = [
          projects.length ? `Relevant attested projects: ${projects.slice(0, 3).join(", ")}.` : "",
          packets[0]?.text ? String(packets[0].text).slice(0, 400) : "",
        ].filter(Boolean);
        const answer = bits.join(" ").trim();
        if (!answer) return unknown(classification, "MOTIVATION_QUESTION evidence was empty after retrieval.");
        return ok(classification, answer, {
          rationale: "Composed only from retrieved candidate knowledge snippets.",
          sourceEvidence: packets.slice(0, 4),
        });
      } catch {
        return unknown(classification, "Could not retrieve candidate knowledge for this motivation question.");
      }
    }
    return unknown(classification, "MOTIVATION_QUESTION has no attested cover letter or knowledge. UNKNOWN — do not guess.");
  }

  if (profile) {
    const derived = deriveFromProfile(classification.category, profile, opportunity);
    if (derived && derived.confidence >= 0.7 && derived.answer) {
      const answer =
        classification.category === "name" || classification.intent === FIELD_INTENT.NAME
          ? nameAnswerForField(derived.answer, field)
          : derived.answer;
      return ok(classification, answer, {
        confidence: derived.confidence,
        rationale: `Deterministically derived from profile (${classification.category}).`,
      });
    }
  }

  if (candidateKnowledgeService && authContext && questionText) {
    try {
      const ev = await candidateKnowledgeService.retrieveRelevantEvidence(questionText, authContext);
      if (ev.status === "GROUNDED" && (ev.facts?.length || ev.evidence?.length)) {
        const fact = ev.facts?.[0];
        const snippet = fact?.value || fact?.evidence || ev.evidence?.[0]?.text;
        if (snippet) {
          return ok(classification, String(snippet).slice(0, 500), {
            rationale: "Retrieved GROUNDED evidence from the candidate knowledge base.",
            sourceEvidence: (ev.evidence || []).slice(0, 3),
          });
        }
      }
      return unknown(
        classification,
        `UNKNOWN: no supporting evidence for "${questionText}". Do not guess.`
      );
    } catch {
      /* fall through */
    }
  }

  return unknown(classification, `Unmapped field: "${questionText}" cannot be confidently auto-filled`);
}
