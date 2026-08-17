/**
 * lexical-embedder.mjs — Local lexical vectors (no external embedding API).
 * Deterministic hashed bag-of-tokens. Used for chunk retrieval only.
 */

const DIM = 256;

export function tokenize(text = "") {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z0-9+#.]{2,}/g) || [];
}

function hashToken(token) {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function embedText(text = "") {
  const vec = new Array(DIM).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vec;
  for (const token of tokens) {
    vec[hashToken(token) % DIM] += 1;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a = [], b = []) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += (a[i] || 0) * (b[i] || 0);
  return dot;
}
