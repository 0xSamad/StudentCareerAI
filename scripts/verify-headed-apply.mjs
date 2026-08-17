/**
 * One-shot headed verification: open a real Greenhouse job, click Apply,
 * fill identity fields, do NOT submit. Writes screenshots + session JSON.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchApplyPage } from "../lib/saas/application-workflow-core.mjs";
import { runApplicationAgent } from "../lib/application-agent.mjs";

const URL =
  process.argv[2] ||
  "https://boards.greenhouse.io/careem/jobs/8620289002?gh_jid=8620289002";
const OUT = join(process.cwd(), "data", "verify-apply");
mkdirSync(OUT, { recursive: true });

const opportunity = {
  id: "verify-careem",
  url: URL,
  company: "Careem",
  title: "Senior Data Scientist II - Personalization",
};

const applicationRecord = {
  opportunity_id: opportunity.id,
  tailored_cv: { tailored_html: "<html><body>Verify Student</body></html>" },
  cover_letter: { skipped: true, requirement: "NOT_NEEDED" },
  application_answers: [],
};

const profile = {
  identity: {
    name: "Verify Student",
    email: "verify.student@example.com",
    phone: "+92 300 0000000",
    city: "Karachi",
    country: "Pakistan",
  },
};

console.log("Opening headed browser:", URL);
const { browser, applyPage } = await launchApplyPage(URL);
await applyPage.screenshot({ path: join(OUT, "01-opened.png"), fullPage: true }).catch(() => {});

const session = await runApplicationAgent({
  opportunity,
  applicationRecord,
  page: applyPage,
  profile,
  liveSubmit: false,
});

const firstName = await applyPage.inputValue("#first_name").catch(() => "");
const lastName = await applyPage.inputValue("#last_name").catch(() => "");
const email = await applyPage.inputValue("#email").catch(() => "");

await applyPage.screenshot({ path: join(OUT, "02-after-fill.png"), fullPage: true }).catch(() => {});
writeFileSync(
  join(OUT, "session.json"),
  JSON.stringify(
    {
      status: session.status,
      status_reason: session.status_reason,
      pause_reason: session.pause_reason,
      fields: (session.fields || []).map((f) => ({ label: f.label, name: f.name, type: f.type })),
      fill_log: session.fill_log,
      action_log: session.action_log,
      liveValues: { firstName, lastName, email },
      url: applyPage.url(),
    },
    null,
    2
  )
);

const filled = (session.fill_log || []).filter((f) => /fill/i.test(f.action || ""));
console.log(
  JSON.stringify(
    {
      status: session.status,
      reason: session.status_reason,
      pause_reason: session.pause_reason,
      fieldCount: (session.fields || []).length,
      fillActions: filled.length,
      liveValues: { firstName, lastName, email },
      url: applyPage.url(),
    },
    null,
    2
  )
);

await applyPage.waitForTimeout(12_000).catch(() => {});
await browser.close().catch(() => {});

if (!firstName && !email && filled.length === 0) {
  process.exit(2);
}
