import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-core";
import { applyUsesHeadlessBrowser, chromiumSandboxArgs } from "@/lib/apply/chrome-attach";

/**
 * Render HTML to a print PDF. Uses a short-lived headless Chrome — Playwright
 * page.pdf() is not available on the headed apply window.
 */
export async function renderHtmlToPdf(html: string, pdfPath: string): Promise<string> {
  mkdirSync(dirname(pdfPath), { recursive: true });
  let browser;
  const args = applyUsesHeadlessBrowser() ? chromiumSandboxArgs() : [];
  try {
    if (!applyUsesHeadlessBrowser()) {
      browser = await chromium.launch({ channel: "chrome", headless: true, args });
    } else {
      browser = await chromium.launch({ headless: true, args });
    }
  } catch {
    browser = await chromium.launch({ headless: true, args });
  }
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
    await page.emulateMedia({ media: "print" }).catch(() => {});
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "0.45in", bottom: "0.45in", left: "0.5in", right: "0.5in" },
    });
    return pdfPath;
  } finally {
    await browser.close().catch(() => {});
  }
}
