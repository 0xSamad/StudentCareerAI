/**
 * github-enricher.mjs — Public / token-authorized GitHub REST API only.
 * Does not scrape github.com, does not access private repos, does not bypass 401/403/429.
 */

import { extractSkills } from "../../../skill-extract.mjs";
import { EVIDENCE_STATUS, FACT_SOURCES, VERIFICATION_STATUS } from "./document-types.mjs";
import { authorizedGet } from "./authorized-fetch.mjs";
import { shapeCandidateFact, nowIso } from "./fact-shape.mjs";

const API_HOSTS = ["api.github.com"];
const MAX_REPOS = 20;
const README_CAP = 8;

const USER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export function parseGitHubUsername(input = "") {
  const raw = String(input || "").trim();
  if (!raw) return null;
  let candidate = raw.replace(/^@/, "");
  if (!/^https?:\/\//i.test(candidate) && /(?:^|\.)github\.com\//i.test(candidate)) {
    candidate = `https://${candidate.replace(/^\/\//, "")}`;
  }
  try {
    if (/^https?:\/\//i.test(candidate)) {
      const u = new URL(candidate);
      if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
      const reserved = new Set([
        "settings",
        "login",
        "orgs",
        "features",
        "topics",
        "marketplace",
        "explore",
        "issues",
        "notifications",
        "new",
        "organizations",
        "account",
        "about",
        "pricing",
        "codespaces",
        "pulls",
        "stars",
        "trending",
        "collections",
        "sponsors",
      ]);
      const part = u.pathname.split("/").filter(Boolean)[0];
      if (!part || reserved.has(part.toLowerCase())) return null;
      return USER_RE.test(part) ? part : null;
    }
  } catch {
    return null;
  }
  return USER_RE.test(candidate) ? candidate : null;
}

function githubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "StudentCareer-AI-CandidateKnowledge/1.0",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubGet(path, { token, fetchFn }) {
  return authorizedGet(`https://api.github.com${path}`, {
    fetchFn,
    headers: githubHeaders(token),
    allowHosts: API_HOSTS,
    denyHosts: [],
  });
}

function titleFromReadme(readme = "") {
  const h1 = String(readme).match(/^\s*#\s+(.+)$/m);
  return h1 ? h1[1].trim().slice(0, 120) : null;
}

function languageList(languages = {}) {
  return Object.keys(languages || {}).filter(Boolean);
}

/**
 * @param {{ url?: string, username?: string, token?: string, fetchFn?: Function }} input
 */
export async function fetchGitHubEvidence(input = {}) {
  const username = parseGitHubUsername(input.username || input.url || input.login || "");
  if (!username) {
    return {
      ok: false,
      status: EVIDENCE_STATUS.UNKNOWN,
      reason: "UNKNOWN: no valid GitHub username. Use a public github.com/user URL.",
      facts: [],
      text: "",
      warnings: [],
    };
  }

  const fetchFn = input.fetchFn || fetch;
  const token = typeof input.token === "string" && input.token.trim() ? input.token.trim() : null;
  const observedAt = nowIso();
  const warnings = [];

  const userRes = await githubGet(`/users/${encodeURIComponent(username)}`, { token, fetchFn });
  if (!userRes.ok) {
    return {
      ok: false,
      status: EVIDENCE_STATUS.UNKNOWN,
      reason: userRes.reason || "UNKNOWN: GitHub user is private, missing, or blocked.",
      protection: userRes.protection,
      facts: [],
      text: "",
      warnings,
    };
  }

  let profile;
  try {
    profile = JSON.parse(userRes.body);
  } catch {
    return { ok: false, status: EVIDENCE_STATUS.UNKNOWN, reason: "UNKNOWN: GitHub returned unreadable JSON.", facts: [], text: "", warnings };
  }

  const reposRes = await githubGet(
    `/users/${encodeURIComponent(username)}/repos?per_page=${MAX_REPOS}&sort=updated&type=owner`,
    { token, fetchFn }
  );
  if (!reposRes.ok) {
    return {
      ok: false,
      status: EVIDENCE_STATUS.UNKNOWN,
      reason: reposRes.reason || "UNKNOWN: could not list public repositories.",
      protection: reposRes.protection,
      facts: [],
      text: "",
      warnings,
    };
  }

  let repos = [];
  try {
    repos = JSON.parse(reposRes.body);
  } catch {
    repos = [];
  }
  if (!Array.isArray(repos)) repos = [];
  repos = repos.filter((r) => r && r.private !== true).slice(0, MAX_REPOS);

  const facts = [];
  const sections = [`# GitHub @${username}`, profile.bio ? `Bio: ${profile.bio}` : "", profile.html_url ? `Profile: ${profile.html_url}` : ""].filter(Boolean);

  const apiSource = { kind: FACT_SOURCES.GITHUB_PUBLIC_API, label: "GitHub public API", url: profile.html_url || `https://github.com/${username}` };

  if (profile.bio) {
    facts.push(shapeCandidateFact({
      factType: "achievement",
      value: profile.bio.slice(0, 200),
      evidence: profile.bio,
      source: apiSource,
      confidence: 0.7,
      verificationStatus: VERIFICATION_STATUS.UNCERTAIN,
      timestamp: observedAt,
    }));
  }

  let readmeBudget = README_CAP;
  for (const repo of repos) {
    const repoUrl = repo.html_url || `https://github.com/${username}/${repo.name}`;
    const langsRes = await githubGet(`/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo.name)}/languages`, { token, fetchFn });
    let languages = [];
    if (langsRes.ok) {
      try {
        languages = languageList(JSON.parse(langsRes.body));
      } catch {
        languages = [];
      }
    } else if (langsRes.protection === "rate_limited") {
      warnings.push("GitHub rate limit hit while reading languages; remaining language lists are UNKNOWN.");
      break;
    }

    let readme = "";
    if (readmeBudget > 0) {
      const readmeRes = await githubGet(`/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo.name)}/readme`, {
        token,
        fetchFn: async (url, init) =>
          fetchFn(url, { ...init, headers: { ...githubHeaders(token), Accept: "application/vnd.github.raw" } }),
      });
      if (readmeRes.ok) {
        readme = String(readmeRes.body || "").slice(0, 6000);
        readmeBudget -= 1;
      } else if (readmeRes.protection === "rate_limited") {
        warnings.push("GitHub rate limit hit while reading READMEs; remaining READMEs are UNKNOWN.");
        readmeBudget = 0;
      }
    }

    const readmeTitle = titleFromReadme(readme);
    const projectName = readmeTitle || repo.name;
    const description = String(repo.description || readme.split("\n").find((l) => l.trim() && !l.trim().startsWith("#")) || "").slice(0, 400);

    const projectEvidence = [
      `GitHub repository: ${repo.name}`,
      `Project: ${projectName}`,
      languages.length ? `Technologies: ${languages.join(", ")}` : null,
      description ? `Description: ${description}` : null,
      `Repository URL: ${repoUrl}`,
    ].filter(Boolean).join("\n");

    facts.push(shapeCandidateFact({
      factType: "project",
      value: projectName,
      evidence: projectEvidence,
      source: { ...apiSource, url: repoUrl },
      confidence: 0.95,
      verificationStatus: VERIFICATION_STATUS.VERIFIED,
      timestamp: observedAt,
    }));
    facts.push(shapeCandidateFact({
      factType: "url",
      value: repoUrl,
      evidence: projectEvidence,
      source: { ...apiSource, url: repoUrl },
      confidence: 1,
      verificationStatus: VERIFICATION_STATUS.VERIFIED,
      timestamp: observedAt,
    }));

    for (const lang of languages) {
      facts.push(shapeCandidateFact({
        factType: "technology",
        value: lang,
        evidence: `${repo.name} languages (GitHub API): ${languages.join(", ")}`,
        source: { ...apiSource, url: repoUrl },
        confidence: 0.95,
        verificationStatus: VERIFICATION_STATUS.VERIFIED,
        timestamp: observedAt,
      }));
      facts.push(shapeCandidateFact({
        factType: "skill",
        value: lang,
        evidence: `${repo.name} languages (GitHub API): ${languages.join(", ")}`,
        source: { ...apiSource, url: repoUrl },
        confidence: 0.9,
        verificationStatus: VERIFICATION_STATUS.VERIFIED,
        timestamp: observedAt,
      }));
    }

    if (readme) {
      for (const skill of extractSkills(readme)) {
        const already = languages.some((l) => l.toLowerCase() === skill.toLowerCase());
        if (already) continue;
        facts.push(shapeCandidateFact({
          factType: "skill",
          value: skill,
          evidence: `Mentioned in ${repo.name} README (not a GitHub language field).`,
          source: { kind: FACT_SOURCES.GITHUB_README, label: "GitHub README", url: repoUrl },
          confidence: 0.6,
          verificationStatus: VERIFICATION_STATUS.UNCERTAIN,
          timestamp: observedAt,
        }));
      }
    }

    sections.push(projectEvidence);
    if (readme) sections.push(`README (${repo.name}):\n${readme.slice(0, 1500)}`);
  }

  const eventsRes = await githubGet(`/users/${encodeURIComponent(username)}/events/public?per_page=30`, { token, fetchFn });
  if (eventsRes.ok) {
    try {
      const events = JSON.parse(eventsRes.body);
      const count = Array.isArray(events) ? events.length : 0;
      facts.push(shapeCandidateFact({
        factType: "contribution",
        value: `${count} public events on the current GitHub events page`,
        evidence: "Public events API is a partial sample, not the private contribution graph.",
        source: { kind: FACT_SOURCES.GITHUB_EVENTS, label: "GitHub public events", url: profile.html_url },
        confidence: 0.4,
        verificationStatus: VERIFICATION_STATUS.UNCERTAIN,
        timestamp: observedAt,
      }));
    } catch {
      warnings.push("Public contribution events could not be parsed (UNKNOWN).");
    }
  } else if (eventsRes.protection === "rate_limited") {
    warnings.push("GitHub rate limit hit for public events; contribution data is UNKNOWN.");
  }

  return {
    ok: true,
    status: EVIDENCE_STATUS.GROUNDED,
    username,
    profileUrl: profile.html_url,
    facts,
    text: sections.join("\n\n"),
    warnings,
    repoCount: repos.length,
  };
}
