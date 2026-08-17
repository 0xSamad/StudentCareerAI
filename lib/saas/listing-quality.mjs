/**
 * listing-quality.mjs — Reject false-positive job listings from URL slugs and search pages.
 */

const PK_LOCATION =
  /\b(pakistan|karachi|lahore|islamabad|rawalpindi|faisalabad|peshawar|multan|quetta|sialkot|gujranwala|abbottabad)\b/i;

const FOREIGN_LOCATION =
  /\b(singapore|china|beijing|shanghai|shenzhen|hong kong|tokyo|japan|seoul|korea|mumbai|delhi|bangalore|bengaluru|hyderabad,?\s*india|\bindia\b|telangana|karnataka|maharashtra|chennai|pune|dubai|uae|united arab emirates|\bamman\b|\bjordan\b|saudi|riyadh|doha|qatar|london|united kingdom|\buk\b|united states|\busa\b|new york|san francisco|toronto|canada|sydney|australia|malaysia|kuala lumpur|indonesia|jakarta|vietnam|thailand|bangkok|germany|berlin|france|paris|netherlands|amsterdam|moldova|chisinau|romania|ukraine|kiev|kyiv|moscow|russia|bangladesh|dhaka)\b/i;

const GENERIC_TITLE =
  /^(internship jobs|internships?( & (programs?|early careers?))?|student programs?|early careers?|university recruiting|university students and graduates|students and graduates|jobs in|job search|search results|all jobs|latest jobs|find jobs|careers at|vacancies in|apply now|learn more|skip to main content|using ai|engineering jobs?|open role|untitled role|view jobs|see jobs|what it'?s like to work here|ai guidelines for candidates|a role for everyone|right to work|e-verify notice|equal opportunity|our people and culture)\b/i;

const CTA_OR_NAV =
  /\b(indeed link|glassdoor link|linkedin link|skip to main content|click here|right to work|e-verify|equal opportunity|people and culture|dividend warrants?)\b/i;

const ROLE_WORD =
  /\b(intern|internship|engineer|engineering|developer|analyst|scientist|designer|manager|consultant|architect|administrator|specialist|associate|officer|lead|programmer|data|software|backend|frontend|product|security|network|support)\b/i;

const HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const ENCODED_SLUG = /%[0-9a-f]{2}/i;

const SEARCH_OR_CATEGORY_PATH =
  /\/jobs?\/search|\/search\/|\/search\?|\/internship-jobs|\/collections\/|\/categories\/|\/quick\?|\/browse\/|\/company\/[^/]+\/jobs\/?$/i;

export function decodeHtmlEntities(text = '') {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, ent) => {
    if (ent[0] === '#') {
      const hex = ent[1] === 'x' || ent[1] === 'X';
      const code = hex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, ent.toLowerCase())
      ? HTML_ENTITIES[ent.toLowerCase()]
      : '';
  });
}

/** Collapse scrape junk so titles are one readable line. */
export function cleanListingText(text = '', max = 2000) {
  return decodeHtmlEntities(String(text || ''))
    .replace(/\\[nrt]/gi, ' ')
    .replace(/[\u00a0\r\n\t\f\v]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Human-readable job title from ATS/HTML scrape output.
 * @param {string} title
 */
export function cleanListingTitle(title = '') {
  let t = cleanListingText(title, 240);
  t = t.replace(/^(indeed|glassdoor|linkedin|rozee|mustakbil)\b[:\s-]*/gi, '');
  t = t.replace(/\b(indeed|glassdoor|linkedin)\s+links?\b/gi, '');
  t = t.replace(/^(apply now|apply)[:\s-]*/i, '');
  t = t.replace(/Posted\s+\d+\s+(hour|day|week|month)s?\s+ago/gi, '');
  t = t.replace(/\+\s*\d+\s+more/gi, '');
  t = t.replace(/([a-z])(United States|United Kingdom|Switzerland|Germany|Canada)/g, '$1 $2');
  t = t.replace(/\s*United States\s*,.*$/i, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t.slice(0, 120);
}

/**
 * @param {string} slug
 */
export function decodeSlug(slug = '') {
  let s = String(slug).trim();
  for (let i = 0; i < 2; i += 1) {
    if (!ENCODED_SLUG.test(s)) break;
    try {
      s = decodeURIComponent(s.replace(/\+/g, ' '));
    } catch {
      break;
    }
  }
  return s;
}

/**
 * @param {string} url
 * @param {string} [fallback]
 */
export function titleFromJobUrl(url, fallback = 'Tech Role') {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    let slug = parts[parts.length - 1] || parts[parts.length - 2] || '';
    slug = decodeSlug(slug);
    if (!slug || slug.length < 3) return fallback;

    // LinkedIn search/category slugs: "internship-jobs-chisinau"
    if (/^internship-jobs-/i.test(slug) || /^jobs-in-/i.test(slug)) {
      return null;
    }

    const title = slug
      .replace(/\.(html|htm|php|aspx|jsp)$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!title || isGarbageTitle(title)) return null;

    return title
      .split(' ')
      .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(' ')
      .slice(0, 120);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} title
 */
export function isGarbageTitle(title) {
  if (!title || typeof title !== 'string') return true;
  const t = cleanListingTitle(title);
  if (!t || t.length < 4) return true;
  if (ENCODED_SLUG.test(t)) return true;
  if (GENERIC_TITLE.test(t)) return true;
  if (CTA_OR_NAV.test(t)) return true;
  if (/^viewjob$/i.test(t)) return true;
  if (/\.(xlsx|xls|csv|zip|docx?)$/i.test(t)) return true;
  if (/^internship jobs\b/i.test(t) && !PK_LOCATION.test(t)) return true;
  if (/^jobs\b/i.test(t) && t.split(/\s+/).length <= 3 && !PK_LOCATION.test(t)) return true;
  const words = t.split(/\s+/);
  if (words.length <= 2 && !ROLE_WORD.test(t)) return true;
  return false;
}

/**
 * @param {string} url
 */
export function isSearchOrCategoryUrl(url) {
  if (!url) return true;
  try {
    const u = new URL(url);
    if (SEARCH_OR_CATEGORY_PATH.test(`${u.pathname}${u.search}`)) return true;
    // Rozee search pages
    if (u.hostname.includes('rozee.pk') && !u.pathname.match(/\/(job|j|internship)\//i)) {
      if (/search|internship-jobs|category/i.test(u.pathname)) return true;
    }
    // LinkedIn: require /jobs/view/ or numeric job id
    if (u.hostname.includes('linkedin.com')) {
      if (!/\/jobs\/view\//i.test(u.pathname) && !/currentJobId=/i.test(u.search)) {
        if (/\/jobs\//i.test(u.pathname)) return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * @param {string} url
 * @param {string} [title]
 * @returns {string|null}
 */
export function inferLocationFromListing(url, title = '') {
  let combined = `${title} ${url}`;
  try {
    combined = decodeSlug(decodeURIComponent(combined));
  } catch {
    combined = decodeSlug(combined);
  }

  if (FOREIGN_LOCATION.test(combined) && !PK_LOCATION.test(combined)) return null;

  const pkMatch = combined.match(PK_LOCATION);
  if (pkMatch) {
    const loc = pkMatch[0];
    return loc.charAt(0).toUpperCase() + loc.slice(1).toLowerCase();
  }

  // pk.indeed.com or rozee.pk individual job — may still be PK but unlabeled
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'pk.indeed.com' || host.endsWith('.rozee.pk') || host === 'rozee.pk') {
      if (/\/(job|j)\//i.test(url) || /viewjob|jk=/i.test(url)) return 'Pakistan';
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * @param {string} url
 * @param {string} title
 * @param {string|null} [location]
 */
export function isPakistanListing(url, title, location = null) {
  if (isSearchOrCategoryUrl(url)) return false;
  if (isGarbageTitle(title)) return false;

  const loc = location ?? inferLocationFromListing(url, title);
  if (loc === null) {
    // LinkedIn without PK signal → reject for national feed
    if (url.includes('linkedin.com')) return false;
    return false;
  }
  if (FOREIGN_LOCATION.test(`${title} ${url} ${loc}`) && !PK_LOCATION.test(`${title} ${url} ${loc}`)) return false;
  return PK_LOCATION.test(loc) || loc === 'Pakistan';
}

/**
 * @param {string} url
 * @param {string} title
 */
export function validateDiscoveredListing(url, title) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, reason: 'invalid_url' };
  }
  if (isSearchOrCategoryUrl(url)) {
    return { ok: false, reason: 'search_or_category_page' };
  }
  const resolvedTitle = title || titleFromJobUrl(url);
  if (!resolvedTitle || isGarbageTitle(resolvedTitle)) {
    return { ok: false, reason: 'garbage_title' };
  }
  const location = inferLocationFromListing(url, resolvedTitle);
  if (!isPakistanListing(url, resolvedTitle, location)) {
    return { ok: false, reason: 'not_pakistan' };
  }
  return { ok: true, title: resolvedTitle, location };
}

export function listingTextBlob({ title = '', url = '', location = '', workplace = '', market = '', country = '', remote } = {}) {
  return `${title} ${url} ${location} ${workplace} ${market} ${country} ${remote === true ? 'remote' : ''}`;
}

export function isRemoteListing(item = {}) {
  const hay = listingTextBlob(item).toLowerCase();
  if (item.remote === true || item.is_remote === true) return true;
  const workplace = String(item.workplace || item.metadata?.workplace || '').toLowerCase();
  if (workplace === 'remote') return true;
  return /\b(remote|work from home|\bwfh\b|distributed team|work anywhere)\b/i.test(hay);
}

export function isPakistanTarget(item = {}) {
  if (String(item.market || item.metadata?.market || '').toUpperCase() === 'NATIONAL') return true;
  return PK_LOCATION.test(listingTextBlob(item));
}

/**
 * StudentCareer target geo: Pakistan roles, or remote roles that are not
 * tied to a foreign office (Singapore, China, India, …).
 */
export function isAllowedTargetListing(item = {}) {
  const title = String(item.title || item.role || '');
  const titleForeign = FOREIGN_LOCATION.test(title) && !PK_LOCATION.test(title);
  if (titleForeign) return false;

  const hay = listingTextBlob(item);
  const pakistan = isPakistanTarget(item);
  const remote = isRemoteListing(item);
  const foreign = FOREIGN_LOCATION.test(hay) && !PK_LOCATION.test(hay);
  if (pakistan) return true;
  if (remote && !foreign) return true;
  return false;
}

export function targetGeoRank(item = {}) {
  if (isPakistanTarget(item)) return 0;
  if (isRemoteListing(item)) return 1;
  return 2;
}
