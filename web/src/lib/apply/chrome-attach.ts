/**
 * Attach Apply to Chrome. Prefer a new tab in the user's already-open window
 * (CDP). If that window is not debuggable, open a dedicated Apply Chrome
 * profile so we can still load the listing and fill the form — most jobs do
 * not need Google sign-in.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright-core";

const DEFAULT_CDP_PORTS = [9222, 9229, 9333];

export function chromeUserDataDir(): string {
  const override = String(process.env.APPLY_CHROME_USER_DATA_DIR || "").trim();
  if (override) return override;
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Google", "Chrome", "User Data");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Google", "Chrome");
  }
  return join(homedir(), ".config", "google-chrome");
}

/** Isolated profile so Apply can launch while the user's Default Chrome is open. */
export function applyChromeUserDataDir(): string {
  const override = String(process.env.APPLY_CHROME_APPLY_PROFILE || "").trim();
  if (override) return override;
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "StudentCareer", "apply-chrome");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "StudentCareer", "apply-chrome");
  }
  return join(homedir(), ".config", "studentcareer", "apply-chrome");
}

export function chromeProfileLockError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || "");
  return /ProcessSingleton|already in use|user data directory|profile.*in use|SingletonLock|Failed to create/i.test(msg);
}

export function chromeProfileInUse(): boolean {
  const dir = chromeUserDataDir();
  const names = ["lockfile", "SingletonLock", join("Default", "lockfile"), join("Default", "SingletonLock")];
  return names.some((name) => existsSync(join(dir, name)));
}

function portFromDevToolsFile(userDataDir: string): number | null {
  try {
    const raw = readFileSync(join(userDataDir, "DevToolsActivePort"), "utf8");
    const n = Number(String(raw).split(/\r?\n/)[0]?.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function applyCdpEndpoints(): string[] {
  const urls: string[] = [];
  const extra = String(process.env.APPLY_CHROME_CDP || "").trim();
  if (extra) urls.push(extra.replace(/\/$/, ""));
  const live = portFromDevToolsFile(chromeUserDataDir());
  if (live) urls.push(`http://127.0.0.1:${live}`);
  for (const port of DEFAULT_CDP_PORTS) urls.push(`http://127.0.0.1:${port}`);
  return [...new Set(urls)];
}

export async function connectUserChromeCdp(): Promise<{ browser: Browser; context: BrowserContext } | null> {
  for (const endpoint of applyCdpEndpoints()) {
    try {
      const browser = await chromium.connectOverCDP(endpoint, { timeout: 2500 });
      const context = browser.contexts()[0];
      if (!context) continue;
      context.setDefaultTimeout(8000);
      return { browser, context };
    } catch {
      /* try next port */
    }
  }
  return null;
}

export async function launchDedicatedApplyChrome(): Promise<BrowserContext> {
  const userData = applyChromeUserDataDir();
  mkdirSync(userData, { recursive: true });
  const opts = {
    headless: false,
    viewport: null as null,
    args: ["--no-first-run", "--no-default-browser-check"],
  };
  try {
    return await chromium.launchPersistentContext(userData, { ...opts, channel: "chrome" });
  } catch (err) {
    if (chromeProfileLockError(err)) throw err;
    try {
      return await chromium.launchPersistentContext(userData, opts);
    } catch (inner) {
      throw inner instanceof Error ? inner : err instanceof Error ? err : new Error("Could not open Chrome.");
    }
  }
}

export function chromeOpenFailedMessage(err?: unknown): string {
  const detail = err instanceof Error ? err.message : err ? String(err) : "";
  return (
    "Could not open Chrome to load this job. Leave Chrome running and click Apply again." +
    (detail ? `\n${detail}` : "")
  );
}

export function chromeUserDataExists(): boolean {
  return existsSync(chromeUserDataDir());
}
