/**
 * load-local-env.mjs — Fill missing Adzuna env vars from local files.
 * Does not overwrite values already present in process.env.
 * Never logs secret values.
 */

import fs from "node:fs";
import path from "node:path";

const ADZUNA_KEYS = new Set(["ADZUNA_APP_ID", "ADZUNA_APP_KEY", "ADZUNA_COUNTRIES"]);

function parseEnvLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  if (!ADZUNA_KEYS.has(key)) return null;
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value: value.trim() };
}

export function loadLocalAdzunaEnv(repoRoot) {
  const files = [
    path.join(repoRoot, ".env"),
    path.join(repoRoot, "web", ".env.local"),
  ];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed?.value) continue;
      if (!process.env[parsed.key]?.trim()) {
        process.env[parsed.key] = parsed.value;
      }
    }
  }
}
