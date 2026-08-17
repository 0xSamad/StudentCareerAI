import { pathToFileURL } from "node:url";
import { join } from "node:path";

const mod = await import(pathToFileURL(join(process.cwd(), "lib/saas/adzuna-discovery.mjs")).href);
const cfg = mod.adzunaConfig(process.cwd());
if (!cfg.enabled) {
  console.log(JSON.stringify({ ok: false, enabled: false, reason: cfg.reason }));
  process.exit(1);
}
const params = new URLSearchParams({
  app_id: cfg.appId,
  app_key: cfg.appKey,
  results_per_page: "10",
  what: "software intern",
  "content-type": "application/json",
});
const res = await fetch(`https://api.adzuna.com/v1/api/jobs/gb/search/1?${params}`);
const json = await res.json().catch(() => ({}));
const results = Array.isArray(json.results) ? json.results : [];
const companies = new Set(results.map((r) => r.company?.display_name).filter(Boolean));
console.log(
  JSON.stringify({
    ok: res.ok,
    status: res.status,
    resultCount: results.length,
    companyCount: companies.size,
  })
);
