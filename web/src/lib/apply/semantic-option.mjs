/**
 * Deterministic semantic matching of profile facts onto dropdown/radio options.
 * Used before any AI call. Never invents an option that is not in the list.
 */

const SKIP_OPTION = /^(select|choose|please select|start typing|--|\s*|n\/a|no answer|select\.\.\.)$/i;

const DEGREE_GROUPS = [
  { id: "bachelor", re: /\bbachelor|\bb\.?\s*s\.?\b|\bbsc\b|\bundergrad|\bundergraduate|\bbs\b/i },
  { id: "master", re: /\bmaster|\bm\.?\s*s\.?\b|\bmsc\b|\bmba\b|\bpostgrad/i },
  { id: "phd", re: /\bph\.?\s*d\b|\bdoctorate|\bdoctoral/i },
  { id: "associate", re: /\bassociate|\ba\.?\s*s\.?\b/i },
  { id: "highschool", re: /\bhigh school|\bsecondary|\bmatric|\bhssc|\bintermediate\b|\bdiploma/i },
];

const ORG_ALIASES = [
  ["institute of management sciences", "ims", "ims peshawar"],
  ["united states", "usa", "u.s.", "u.s.a", "us"],
  ["united kingdom", "uk", "great britain", "britain"],
  ["pakistan", "pk"],
];

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9+.# ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return norm(s)
    .split(" ")
    .filter((t) => t.length > 1 && !/^(the|and|of|in|for|a|an|at|to)$/.test(t));
}

function degreeId(text) {
  const n = String(text || "");
  for (const g of DEGREE_GROUPS) {
    if (g.re.test(n)) return g.id;
  }
  return "";
}

function orgAliasSet(text) {
  const n = norm(text);
  const out = new Set([n]);
  for (const group of ORG_ALIASES) {
    if (group.some((a) => n === a || n.includes(a) || a.includes(n))) {
      for (const a of group) out.add(a);
    }
  }
  return out;
}

export function isPlaceholderOption(text) {
  return SKIP_OPTION.test(String(text || "").trim());
}

/**
 * Pick the best option string from `options` for `value`.
 * Returns "" if nothing is a defensible match (never the first placeholder).
 */
export function matchOption(options, value, extraCandidates = []) {
  const opts = (options || []).map((o) => String(o || "").trim()).filter((o) => o && !isPlaceholderOption(o));
  if (!opts.length) return String(value || "").trim();
  const candidates = [value, ...extraCandidates].map((c) => String(c || "").trim()).filter(Boolean);
  if (!candidates.length) return "";

  for (const c of candidates) {
    const exact = opts.find((o) => norm(o) === norm(c));
    if (exact) return exact;
  }

  const wantDegree = degreeId(candidates.join(" "));
  if (wantDegree) {
    const hit = opts.find((o) => degreeId(o) === wantDegree);
    if (hit) return hit;
  }

  for (const c of candidates) {
    const aliases = orgAliasSet(c);
    const hit = opts.find((o) => {
      const oSet = orgAliasSet(o);
      for (const a of aliases) if (oSet.has(a)) return true;
      return false;
    });
    if (hit) return hit;
  }

  for (const c of candidates) {
    const cn = norm(c);
    if (cn.length < 2) continue;
    const contained = opts.find((o) => {
      const on = norm(o);
      return on.includes(cn) || cn.includes(on);
    });
    if (contained) return contained;
  }

  const yesNo = matchYesNo(opts, candidates.join(" "));
  if (yesNo) return yesNo;

  let best = { o: "", score: 0 };
  for (const o of opts) {
    const ot = tokens(o);
    let score = 0;
    for (const c of candidates) {
      const ct = tokens(c);
      if (!ct.length || !ot.length) continue;
      const overlap = ct.filter((t) => ot.includes(t)).length;
      score = Math.max(score, overlap / Math.max(ct.length, ot.length));
    }
    if (score > best.score) best = { o, score };
  }
  return best.score >= 0.5 ? best.o : "";
}

export function matchYesNo(options, value) {
  const opts = (options || []).map((o) => String(o).trim()).filter(Boolean);
  if (!opts.length) return "";
  const v = norm(value);
  const yes = /^(yes|y|true|1)$/.test(v) || /\b(yes|willing|authorized|i am)\b/.test(v);
  const no = /^(no|n|false|0)$/.test(v) || /\b(no|not willing|not authorized|i am not|decline)\b/.test(v);
  if (yes === no) return "";
  const hit = opts.find((o) => (yes ? /^yes\b/i.test(o) : /^no\b/i.test(o)));
  return hit || "";
}

export function clipToMax(value, maxLength) {
  const text = String(value || "");
  const max = Number(maxLength);
  if (!max || max < 1 || text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, "").trim();
}

export function fieldCacheKey(field = {}) {
  const opts = (field.options || []).slice(0, 12).join("|");
  return `${String(field.label || field.nativeName || field.id || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()}::${field.type || ""}::${opts}`;
}

export function logFieldDecision(row = {}) {
  const parts = [
    `FIELD: ${JSON.stringify(row.label || row.fieldId || "")}`,
    `DETECTED TYPE: ${row.widget || row.type || ""}`,
    row.source ? `SOURCE: ${row.source}` : "",
    row.value ? `DECISION: ${String(row.value).slice(0, 80)}` : "",
    row.method ? `METHOD: ${row.method}` : "",
    row.confidence != null ? `CONFIDENCE: ${row.confidence}` : "",
    row.action ? `ACTION: ${row.action}` : "",
    row.verification ? `VERIFICATION: ${row.verification}` : "",
    row.model ? `MODEL: ${row.model}` : "",
  ].filter(Boolean);
  console.log("[APPLY FIELD]", parts.join(" | "));
}
