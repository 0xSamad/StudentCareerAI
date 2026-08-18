import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const repoRoot = join(webRoot, "..");
const srcRoot = join(webRoot, "src");

function firstExisting(paths) {
  return paths.find((file) => file && existsSync(file));
}

function playwrightCore() {
  return firstExisting([
    join(webRoot, "node_modules", "playwright-core", "index.js"),
    join(repoRoot, "node_modules", "playwright-core", "index.js"),
    join(repoRoot, "node_modules", "playwright", "node_modules", "playwright-core", "index.js"),
  ]);
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "playwright-core") {
    const file = playwrightCore();
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const base = join(srcRoot, rel);
    const file = firstExisting([
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mjs`,
      `${base}.js`,
      join(base, "index.ts"),
      join(base, "index.mjs"),
    ]);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
