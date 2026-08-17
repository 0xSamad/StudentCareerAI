/**
 * Browser-side helpers for the URL form agent.
 * Clicks are by role/label, never coordinates. Never Submit.
 */
import type { Page } from "playwright-core";
import { repeatingSectionPlan } from "./form-agent.mjs";

async function clickVisible(page: Page, name: RegExp, limit = 4) {
  let clicked = 0;
  for (let i = 0; i < limit; i++) {
    const btn = page.getByRole("button", { name }).first();
    if (!(await btn.count().catch(() => 0))) break;
    if (!(await btn.isVisible().catch(() => false))) break;
    const label = ((await btn.innerText().catch(() => "")) || "").toLowerCase();
    if (/\bsubmit\b|\bsend application\b/.test(label)) break;
    await btn.click({ timeout: 2500 }).catch(() => {});
    clicked += 1;
    await page.waitForTimeout(80);
  }
  return clicked;
}

/** Open accordions / "show more" so hidden fields become extractable. */
export async function expandFormDisclosures(page: Page) {
  const names = [
    /^(education|work experience|experience|additional information|show more|expand)$/i,
    /add (your )?education/i,
    /add (your )?experience/i,
  ];
  for (const name of names) {
    await clickVisible(page, name, 3);
  }
  for (const frame of page.frames()) {
    const summaries = frame.locator("summary, [aria-expanded='false']").filter({ hasText: /education|experience|project|reference/i });
    const n = Math.min(await summaries.count().catch(() => 0), 6);
    for (let i = 0; i < n; i++) {
      await summaries.nth(i).click({ timeout: 1500 }).catch(() => {});
    }
  }
}

/** Click "Add another" enough times for attested education/experience rows. */
export async function expandRepeatingSections(page: Page, profile: unknown) {
  const plan = repeatingSectionPlan(profile || {});
  if (plan.addEducation) {
    await clickVisible(page, /add (another )?(education|school|university|degree)/i, plan.addEducation);
    if (plan.addEducation) await clickVisible(page, /^(add another)$/i, plan.addEducation);
  }
  if (plan.addExperience) {
    await clickVisible(page, /add (another )?(experience|job|employer|position)/i, plan.addExperience);
  }
}

export async function prepareIntelligentForm(
  page: Page | undefined,
  profile: unknown,
  { repeating = true }: { repeating?: boolean } = {},
) {
  if (!page) return;
  await expandFormDisclosures(page).catch(() => {});
  if (repeating) await expandRepeatingSections(page, profile).catch(() => {});
}
