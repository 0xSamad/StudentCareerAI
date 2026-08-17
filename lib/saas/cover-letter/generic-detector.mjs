/**
 * generic-detector.mjs — Reject cover letters that only swap company/role names.
 */

function escapeRe(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const GENERIC_PHRASES = [
  /i am excited to apply/i,
  /i am writing to express my interest/i,
  /i am eager to apply/i,
  /i believe i would be a (great|strong|good) fit/i,
  /thank you for your (time and )?consideration/i,
  /i look forward to hearing from you/i,
  /please find (attached|enclosed) my (resume|cv)/i,
];

/**
 * @returns {{ generic: boolean, reason: string|null, attestedHits: string[], genericPhraseCount: number }}
 */
export function isGenericCoverLetter(body, { opportunity = {}, attestedTokens = [] } = {}) {
  const text = String(body || "").trim();
  if (!text) {
    return { generic: true, reason: "Cover letter body is empty.", attestedHits: [], genericPhraseCount: 0 };
  }

  const company = String(opportunity.company || "").trim();
  const title = String(opportunity.title || opportunity.role || "").trim();
  let stripped = text;
  if (company) stripped = stripped.replace(new RegExp(escapeRe(company), "gi"), " ");
  if (title) stripped = stripped.replace(new RegExp(escapeRe(title), "gi"), " ");
  stripped = stripped
    .replace(/dear\s+hiring\s+manager[,:]?/gi, " ")
    .replace(/i am (excited|eager|writing|pleased) to (apply|express my interest)[^.?!]*/gi, " ")
    .replace(/thank you for your (time and )?consideration[^.?!]*/gi, " ")
    .replace(/i look forward to hearing from you[^.?!]*/gi, " ");

  const genericPhraseCount = GENERIC_PHRASES.filter((re) => re.test(text)).length;
  const attestedHits = (attestedTokens || []).filter((t) => t && new RegExp(escapeRe(t), "i").test(text));
  const remainingWords = stripped.split(/\W+/).filter((w) => w.length > 3);

  const looksLikeTemplate =
    /^dear hiring manager[,.]?\s*i am (excited|writing|eager)/i.test(text) && attestedHits.length === 0;

  if (looksLikeTemplate || (genericPhraseCount >= 2 && attestedHits.length === 0)) {
    return {
      generic: true,
      reason: "Letter is generic (company/role swap) and cites no attested experience or projects.",
      attestedHits,
      genericPhraseCount,
    };
  }
  if (attestedHits.length === 0) {
    return {
      generic: true,
      reason: "Personalized cover letters must cite attested projects, employers, or evidence. This one did not.",
      attestedHits,
      genericPhraseCount,
    };
  }
  if (remainingWords.length < 20 && attestedHits.length === 0) {
    return {
      generic: true,
      reason: "After removing company and role names, almost no specific content remains.",
      attestedHits,
      genericPhraseCount,
    };
  }
  return { generic: false, reason: null, attestedHits, genericPhraseCount };
}
