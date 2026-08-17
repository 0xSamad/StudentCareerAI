/**
 * Fill leftover application questions from attested profile facts.
 * Uses batched AI only as a grounded fallback — never invents missing facts.
 */
import { batchFieldAnswers } from "./field-ai.mjs";

const SKIP =
  /human check|captcha|recaptcha|i am not a robot|\b(pass ?word|passwd|passcode)\b|i agree|i consent|i accept|privacy notice|terms of|gdpr|sponsor|authori[sz]|visa|race|ethnic|veteran|citizen|criminal|felony|salary|gender|disab/;

function leftoverFields(fields, answers) {
  return (fields || []).filter((f) => {
    if (!f?.id || answers[f.id]) return false;
    if (f.type === "file") return false;
    const blob = [f.label, f.nativeName, f.nativeId, f.id, f.nearbyText, f.ariaLabel]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return !SKIP.test(blob);
  });
}

export async function completeFormAnswers(fields, answers, profile, extras = {}) {
  const leftover = leftoverFields(fields, answers);
  if (!leftover.length) return answers;
  try {
    const batch = await batchFieldAnswers({
      fields: leftover,
      profile,
      cvText: extras.cvText,
      extras,
      generateFn: extras.generateFn || null,
    });
    return { ...answers, ...(batch.answers || {}) };
  } catch {
    return answers;
  }
}
