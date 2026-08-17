/**
 * chunker.mjs — Split documents into retrieval chunks.
 * Never concatenates the whole corpus into one prompt.
 */

const TARGET = 500;
const OVERLAP = 80;

export function chunkText(text = "", { documentId = null, docType = "OTHER" } = {}) {
  const clean = String(text || "").replace(/\r/g, "").trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces = [];
  let buf = "";

  const flush = () => {
    if (!buf.trim()) return;
    pieces.push(buf.trim());
    buf = "";
  };

  for (const para of paragraphs) {
    if ((buf + "\n\n" + para).length > TARGET && buf) {
      flush();
      const tail = pieces[pieces.length - 1] || "";
      buf = tail.slice(Math.max(0, tail.length - OVERLAP));
    }
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  flush();

  return pieces.map((chunk, i) => ({
    ordinal: i,
    text: chunk,
    documentId,
    docType,
    metadata: {
      charCount: chunk.length,
      heading: chunk.split("\n")[0].slice(0, 120),
    },
  }));
}
