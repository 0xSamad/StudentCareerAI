/**
 * listing-url.mjs — Only persist and display URLs that are real job postings
 * or application forms. Career hubs ("find roles", Samsung careers home,
 * Workday tenant boards) are never apply URLs.
 */

import { isSearchOrCategoryUrl } from './listing-quality.mjs';

const ATS_HOST =
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|workable\.com|icims\.com|taleo\.net|bamboohr\.com|recruitee\.com|personio\.(com|de)|rippling\.com|breezy\.hr|jobvite\.com|applytojob\.com|teamtailor\.com|pinpointhq\.com|eightfold\.ai|successfactors\.com|oraclecloud\.com|recruitee\.com|jobvite\.com)$/i;

const JUNK_HOST =
  /(^|\.)(crazygames\.com|miniclip\.com|addictinggames\.com|newgrounds\.com|pogo\.com|kongregate\.com|steamcommunity\.com|steampowered\.com|epicgames\.com|itch\.io|roblox\.com|twitch\.tv|ign\.com|gamespot\.com|youtube\.com|youtu\.be|facebook\.com|instagram\.com|tiktok\.com|pinterest\.com|twitter\.com|x\.com|bing\.com|google\.com|googleadservices\.com|doubleclick\.net|duckduckgo\.com|wikipedia\.org|reddit\.com|netflix\.com|spotify\.com)$/i;

const JOB_BOARD_HOSTS = [
  { host: /(^|\.)linkedin\.com$/i, path: /\/jobs\/view\//i },
  { host: /(^|\.)indeed\.com$/i, path: /\/viewjob|jk=/i },
  { host: /(^|\.)rozee\.pk$/i, path: /\/(job|j|internship)\//i },
  { host: /(^|\.)mustakbil\.com$/i, path: /\/jobs?\//i },
  { host: /(^|\.)remotive\.com$/i, path: /\/remote-jobs\//i },
  { host: /(^|\.)jobicy\.com$/i, path: /\/job/i },
  { host: /(^|\.)amazon\.jobs$/i, path: /\/jobs?\//i },
  { host: /(^|\.)jobs\.jazz\.com\.pk$/i, path: /\/jobs?\//i },
];

const HUB_LAST_SEGMENT =
  /^(jobs?|careers?|search|search-results|search-jobs|job-search|internships?|internships?-programs?|students?|student-programs?|university|university-recruiting|campus|graduates?|early-careers?|explore|find|all|all-jobs|list|listings?|home|about|life|life-at|culture|benefits?|faq|why-us|join|join-us|openings?|opportunities|positions?|vacancies|work-with-us|work-with-[a-z0-9-]+|careers-home|jobsearch|vacant-positions?|current-openings?|applications|results)$/i;

const HUB_PATH =
  /\/(job-search|jobs\/search|careers\/search|search-results|search-jobs|find-a-role|find-roles|browse-jobs|requisitions)\/?$/i;

const POSTING_PATH =
  /\/(job|jobs|internship|internships|vacancy|vacancies|opening|openings|position|positions|requisition|posting|apply)\/.+/i;

const MULTI_TLD = new Set(['co.uk', 'com.au', 'co.nz', 'com.pk', 'edu.pk', 'org.pk', 'co.in', 'com.sg', 'co.za']);

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function registrableDomain(host) {
  const h = String(host || '')
    .replace(/^www\./i, '')
    .toLowerCase();
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  if (MULTI_TLD.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

export function sameSite(urlA, urlB) {
  const a = registrableDomain(hostnameOf(urlA));
  const b = registrableDomain(hostnameOf(urlB));
  return Boolean(a && b && a === b);
}

export function isJunkListingHost(url) {
  const host = hostnameOf(url);
  return Boolean(host && JUNK_HOST.test(host));
}

export function isAtsJobHost(url) {
  return ATS_HOST.test(hostnameOf(url));
}

export function isUnresolvedAggregatorUrl(url) {
  const host = hostnameOf(url);
  const href = String(url || '');
  if (!host) return true;
  if (/bing\.com$/i.test(host) || /googleadservices\.com$/i.test(host)) return true;
  if (/adzuna\./i.test(host)) return true;
  if (/indeed\./i.test(host) && /\/(rc\/clk|pagead\/clk|from=ad|clk\?)/i.test(href)) return true;
  return false;
}

export function isAdzunaListingUrl(url) {
  const host = hostnameOf(url);
  if (!/adzuna\./i.test(host)) return false;
  try {
    return /\/(land\/ad|details)\/\d+/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function lastPathSegment(url) {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
    const segs = path.split('/').filter(Boolean);
    return (segs[segs.length - 1] || '').replace(/\.(html?|aspx|php)$/i, '');
  } catch {
    return '';
  }
}

/**
 * Careers homepage / job search / "find roles" — not a single application.
 */
export function isCareerHubUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const segs = path.split('/').filter(Boolean);
    const host = hostnameOf(url);
    if (path === '/') return true;
    if (HUB_PATH.test(path)) return true;
    if (isSearchOrCategoryUrl(url)) return true;
    const last = (segs[segs.length - 1] || '').replace(/\.(html?|aspx|php)$/i, '');
    if (HUB_LAST_SEGMENT.test(last) && !/[0-9]{4,}/.test(last)) return true;
    if (/myworkdayjobs\.com$/i.test(host) && !/\/job\//i.test(path)) return true;
    if (/greenhouse\.io$/i.test(host) && !/\/jobs\/\d+/i.test(path) && !/gh_jid=/i.test(u.search)) return true;
    if (/lever\.co$/i.test(host) && segs.length < 2) return true;
    if (/ashbyhq\.com$/i.test(host) && segs.length < 2) return true;
    if (/workable\.com$/i.test(host) && !/\/j\/[a-z0-9]+/i.test(path) && segs.length <= 1) return true;
    if (/oraclecloud\.com$/i.test(host) && /\/requisitions\/?$/i.test(path)) return true;
    return false;
  } catch {
    return true;
  }
}

export function isAtsJobPostingUrl(url) {
  if (!isAtsJobHost(url) || isCareerHubUrl(url)) return false;
  try {
    const u = new URL(url);
    const path = u.pathname;
    const segs = path.split('/').filter(Boolean);
    const host = hostnameOf(url);
    if (/greenhouse\.io$/i.test(host)) return /\/jobs\/\d+/i.test(path) || /gh_jid=/i.test(u.search);
    if (/lever\.co$/i.test(host)) return segs.length >= 2;
    if (/ashbyhq\.com$/i.test(host)) return segs.length >= 2;
    if (/myworkdayjobs\.com$|workday\.com$/i.test(host)) return /\/job\//i.test(path);
    if (/workable\.com$/i.test(host)) return /\/j\/[a-z0-9]+/i.test(path) || /\/jobs\/.+/i.test(path);
    if (/oraclecloud\.com$/i.test(host)) return /\/job\//i.test(path) || /jobId=/i.test(u.search);
    if (/pinpointhq\.com$/i.test(host)) return /\/postings?\/|\/jobs?\//i.test(path);
    if (POSTING_PATH.test(path)) return true;
    if (/gh_jid=|job[_-]?id=|jk=/i.test(u.search)) return true;
    return segs.length >= 2 && POSTING_PATH.test(path);
  } catch {
    return false;
  }
}

export function hasJobPostingPath(url) {
  if (isCareerHubUrl(url)) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const segs = path.split('/').filter(Boolean);
    const hash = u.hash || '';
    if (POSTING_PATH.test(path)) return true;
    if (/\/jobs\/view\//i.test(path) || /\/viewjob/i.test(path)) return true;
    if (/gh_jid=|job[_-]?id=|jk=|currentJobId=/i.test(u.search)) return true;
    if (/#.+\/(job|jobs|vacancy|vacancies|posting|requisition|apply)\/.+/i.test(hash)) return true;
    if (isAtsJobPostingUrl(url)) return true;
    const last = lastPathSegment(url);
    if (/\/careers\/.+/i.test(path) && segs.length >= 3 && last && !HUB_LAST_SEGMENT.test(last)) {
      return /[0-9]{3,}/.test(last) || /[-_]/.test(last);
    }
    return false;
  } catch {
    return false;
  }
}

export function isJobBoardPostingUrl(url) {
  const host = hostnameOf(url);
  if (!host) return false;
  try {
    const u = new URL(url);
    const hay = `${u.pathname}${u.search}`;
    return JOB_BOARD_HOSTS.some((rule) => rule.host.test(host) && rule.path.test(hay));
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @param {{ careersUrl?: string }} [opts]
 * @returns {{ ok: boolean, reason: string, kind?: string }}
 */
export function classifyListingUrl(url, opts = {}) {
  const href = String(url || '').trim();
  if (!/^https?:\/\//i.test(href)) {
    return { ok: false, reason: 'invalid_url' };
  }
  if (isJunkListingHost(href)) {
    return { ok: false, reason: 'junk_host' };
  }
  try {
    if (/\.(xlsx|xls|csv|zip)(\?|$)/i.test(new URL(href).pathname)) {
      return { ok: false, reason: 'not_a_posting_url' };
    }
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (isSearchOrCategoryUrl(href)) {
    return { ok: false, reason: 'search_or_category_page' };
  }
  if (isCareerHubUrl(href)) {
    return { ok: false, reason: 'career_hub' };
  }
  if (isAdzunaListingUrl(href)) {
    return { ok: true, reason: 'job_board', kind: 'adzuna' };
  }
  if (isUnresolvedAggregatorUrl(href)) {
    return { ok: false, reason: 'unresolved_aggregator' };
  }

  if (isAtsJobPostingUrl(href)) {
    return { ok: true, reason: 'ats', kind: 'ats' };
  }
  if (isJobBoardPostingUrl(href)) {
    return { ok: true, reason: 'job_board', kind: 'job_board' };
  }
  if (!hasJobPostingPath(href)) {
    return { ok: false, reason: 'not_a_posting_url' };
  }

  const careersUrl = opts.careersUrl;
  if (careersUrl && !sameSite(href, careersUrl) && !isAtsJobHost(href) && !isJobBoardPostingUrl(href)) {
    return { ok: false, reason: 'off_site_from_careers_page' };
  }

  return { ok: true, reason: 'employer_posting', kind: 'employer' };
}

export function isCredibleListingUrl(url, opts = {}) {
  return classifyListingUrl(url, opts).ok === true;
}

/**
 * Follow aggregator tracking links once. Returns the final URL or the original on failure.
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function resolveListingUrl(url, opts = {}) {
  const href = String(url || '').trim();
  if (!href || !isUnresolvedAggregatorUrl(href)) return href;
  const timeoutMs = Number(opts.timeoutMs) || 8_000;
  try {
    const res = await fetch(href, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent':
          'Mozilla/5.0 (compatible; student-career-ai/1.3; +https://github.com/0xSamad/StudentCareerAI)',
      },
    });
    const finalUrl = String(res.url || href).trim();
    return finalUrl || href;
  } catch {
    return href;
  }
}
