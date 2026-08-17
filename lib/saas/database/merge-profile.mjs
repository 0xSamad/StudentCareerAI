/**
 * Merge incoming profile updates onto the stored record.
 * Empty incoming fields must not wipe GitHub, CV, education, or a saved token.
 */

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function hasProfileContent(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return true;
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.values(value).some(hasProfileContent);
  return false;
}

function mergeObjects(base = {}, incoming = {}) {
  const out = { ...base };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (key === "secrets") {
      const next = { ...(out.secrets || {}) };
      const incomingSecrets = isPlainObject(value) ? value : {};
      if (hasProfileContent(incomingSecrets.githubToken)) next.githubToken = String(incomingSecrets.githubToken).trim();
      out.secrets = next;
      continue;
    }
    if (!hasProfileContent(value)) continue;
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergeObjects(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

const META = new Set(["id", "tenantId", "userId", "createdAt", "updatedAt", "cvText", "raw_cv_text", "rawCvText"]);

export function mergeProfileRecord(existing = {}, incoming = {}) {
  const prev = existing && typeof existing === "object" ? existing : {};
  const next = incoming && typeof incoming === "object" ? incoming : {};
  const { cvText: incomingCv, raw_cv_text: incomingRaw, secrets: incomingSecrets, ...incomingRest } = next;
  const { cvText: prevCv, secrets: prevSecrets, ...prevRest } = prev;

  const merged = mergeObjects(
    Object.fromEntries(Object.entries(prevRest).filter(([key]) => !META.has(key))),
    incomingRest
  );

  const secrets = mergeObjects(prevSecrets || {}, incomingSecrets || {});
  if (hasProfileContent(next.identity?.githubToken) && !hasProfileContent(secrets.githubToken)) {
    secrets.githubToken = String(next.identity.githubToken).trim();
  }
  if (hasProfileContent(secrets)) merged.secrets = secrets;

  const cvText = hasProfileContent(incomingCv)
    ? incomingCv
    : hasProfileContent(incomingRaw)
      ? incomingRaw
      : prevCv || "";

  return { ...merged, cvText };
}

export function stripProfileSecrets(record) {
  if (!record || typeof record !== "object") return record;
  const { secrets, ...rest } = record;
  const identity = { ...(rest.identity || {}) };
  delete identity.githubToken;
  return {
    ...rest,
    identity,
    credentials: {
      githubTokenSet: Boolean(secrets?.githubToken || record.identity?.githubToken),
    },
  };
}
