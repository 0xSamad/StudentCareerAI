/**
 * Per-user original CV storage. Tenant + user isolated.
 * Never overwrites an original in place without archiving it first.
 * Tailored copies must use a different key.
 */

const ORIGINAL_PREFIX = "cvs/original";

export function extFromName(filename = "", mimeType = "") {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".docx") || String(mimeType).includes("wordprocessingml")) return ".docx";
  if (name.endsWith(".pdf") || mimeType === "application/pdf") return ".pdf";
  if (name.endsWith(".txt") || name.endsWith(".md")) return ".txt";
  return ".bin";
}

export function isDocxUpload(filename = "", mimeType = "", buffer) {
  if (extFromName(filename, mimeType) === ".docx") return true;
  if (!buffer || !buffer.length) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export function originalStorageKey(filename = "", mimeType = "") {
  return `${ORIGINAL_PREFIX}/master${extFromName(filename, mimeType)}`;
}

function safeName(filename = "cv") {
  const base = String(filename || "cv")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return base || "cv";
}

export async function saveOriginalCv({ storage, buffer, filename = "cv.docx", mimeType = "", context = {} } = {}) {
  if (!storage || !buffer) throw new Error("storage and buffer are required");
  const key = originalStorageKey(filename, mimeType);
  try {
    const prev = await storage.getFile(key, context);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await storage.saveFile(`${ORIGINAL_PREFIX}/archive/${stamp}-${safeName(filename)}`, prev, { archived: true }, context);
  } catch {
    /* no previous original */
  }
  await storage.saveFile(
    key,
    Buffer.from(buffer),
    { filename, mimeType, role: "original", immutable: true },
    context,
  );
  return {
    storageKey: key,
    filename: safeName(filename),
    mimeType: mimeType || "application/octet-stream",
    uploadedAt: new Date().toISOString(),
    byteLength: Buffer.from(buffer).byteLength,
  };
}

export function generatedStorageKey() {
  return "cvs/generated/master.docx";
}

export async function saveGeneratedCv({ storage, buffer, context = {} } = {}) {
  if (!storage || !buffer) return null;
  const key = generatedStorageKey();
  await storage.saveFile(key, Buffer.from(buffer), { role: "generated", immutable: false }, context);
  return { storageKey: key, filename: "master.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
}

export async function loadOriginalCv({ storage, record = {}, context = {} } = {}) {
  if (!storage) return null;
  const meta = record?.storageKey ? record : record?.cvOriginal || {};
  const key = meta.storageKey;
  if (!key) return null;
  try {
    const buf = await storage.getFile(key, context);
    return {
      buffer: buf,
      filename: meta.filename || "cv",
      mimeType: meta.mimeType || "",
      storageKey: key,
    };
  } catch {
    return null;
  }
}
