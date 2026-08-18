/**
 * opportunity-ingest.mjs — Verify, eligibility-check, AI-match, and upsert opportunities.
 */

import { checkLivenessViaApi, resolveAtsApi } from '../../liveness-api.mjs';
import { classifyLiveness } from '../../liveness-core.mjs';
import { checkEligibility, parseRequirements } from '../eligibility-engine.mjs';
import { scoreOpportunity } from '../match-engine.mjs';
import { isInternshipTitle, isStudentOpportunityTitle } from './cs-field-discovery.mjs';
import { isCredibleListingUrl } from './listing-url.mjs';
import { isAllowedTargetListing } from './listing-quality.mjs';

const USER_AGENT =
  'Mozilla/5.0 (compatible; student-career-ai/1.3; +https://github.com/0xSamad/StudentCareerAI)';

function stripHtml(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchPostingDescription(url) {
  const resolved = resolveAtsApi(url);
  if (resolved) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), resolved.timeoutMs || 10_000);
    try {
      const res = await fetch(resolved.apiUrl, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        redirect: 'error',
        signal: controller.signal,
      });
      if (res.ok) {
        const json = await res.json();
        const content =
          json?.content ||
          json?.descriptionPlain ||
          json?.description ||
          json?.descriptionHtml ||
          '';
        if (content) return stripHtml(content);
        if (json?.lists?.length) {
          return json.lists.map((l) => `${l.text}: ${(l.content || '').replace(/<[^>]+>/g, ' ')}`).join('\n');
        }
      }
    } catch {
      // fall through to HTML fetch
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });
    const html = await res.text();
    return stripHtml(html).slice(0, 12_000);
  } catch {
    return '';
  }
}

/**
 * @param {string} url
 * @returns {Promise<{ verified: boolean, status: string, reason?: string }>}
 */
export async function verifyPostingLiveness(url) {
  const apiResult = await checkLivenessViaApi(url);
  if (apiResult?.result === 'active') {
    return { verified: true, status: 'active', reason: apiResult.reason };
  }
  if (apiResult?.result === 'expired') {
    return { verified: false, status: 'expired', reason: apiResult.reason };
  }

  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });
    const body = await res.text();
    const classified = classifyLiveness({
      status: res.status,
      requestedUrl: url,
      finalUrl: res.url,
      bodyText: body.slice(0, 80_000),
    });
    if (classified.result === 'active') {
      return { verified: true, status: 'active', reason: classified.reason };
    }
    if (classified.result === 'expired') {
      return { verified: false, status: 'expired', reason: classified.reason };
    }
    return { verified: false, status: classified.result, reason: classified.reason };
  } catch (err) {
    return {
      verified: false,
      status: 'uncertain',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function heuristicMatch(profile, opportunity) {
  const skills = [
    ...(profile.skills?.programming_languages || []),
    ...(profile.skills?.frameworks || []),
    ...(profile.skills?.ai_ml || []),
    ...(profile.skills?.databases || []),
    ...(profile.skills?.tools || []),
  ].map((s) => String(s).toLowerCase());

  const haystack = `${opportunity.title || ''} ${opportunity.description || ''}`.toLowerCase();
  let hits = 0;
  for (const skill of skills) {
    if (skill && haystack.includes(skill)) hits += 1;
  }
  const score = Math.min(84, Math.max(40, 48 + hits * 7));
  const tier = score >= 80 ? 'STRONG' : score >= 70 ? 'GOOD' : 'WEAK';
  return {
    match_score: score,
    tier,
    strengths: [],
    missing_skills: [],
    relevant_experience: [],
    relevant_projects: [],
    concerns: ['Heuristic score — configure GEMINI_API_KEY or OPENAI_API_KEY for AI matching'],
    recommendation: 'Review manually; AI matching was unavailable.',
    dimension_scores: {},
    eligibility_status: 'ELIGIBLE',
    eligible_to_apply: true,
    provider_used: 'heuristic',
    model_used: 'keyword-overlap',
    scored_at: new Date().toISOString(),
  };
}

/**
 * @param {object} params
 * @returns {Promise<object>}
 */
export async function evaluateOpportunityForProfile({
  profile,
  opportunity,
  matchingConfig = {},
  minShowScore = 40,
  lenient = false,
}) {
  const description =
    opportunity.description ||
    (opportunity.url ? await fetchPostingDescription(opportunity.url) : '');

  const enriched = { ...opportunity, description };
  const requirements = parseRequirements(description);
  const eligibilityReport = checkEligibility(profile, requirements);
  const eligibility = { ...eligibilityReport, verdict: eligibilityReport.overall };

  if (!lenient && eligibilityReport.overall === 'NOT_ELIGIBLE') {
    return {
      skip: true,
      reason: 'not_eligible',
      eligibility,
      requirements,
      deadline: requirements.deadline || null,
      description,
    };
  }

  let match;
  const scoringEligibility =
    lenient && eligibilityReport.overall === 'NOT_ELIGIBLE'
      ? { ...eligibility, verdict: 'REQUIRES_REVIEW' }
      : eligibility;

  try {
    match = await scoreOpportunity({
      profile,
      opportunity: enriched,
      eligibility: scoringEligibility,
      matchingConfig: matchingConfig || profile.matching || {},
    });
  } catch {
    match = heuristicMatch(profile, enriched);
    match.eligibility_status = lenient ? 'REQUIRES_REVIEW' : eligibilityReport.overall;
    match.eligible_to_apply =
      lenient ||
      eligibilityReport.overall === 'ELIGIBLE' ||
      eligibilityReport.overall === 'REQUIRES_REVIEW';
  }

  if (lenient && typeof match.match_score === 'number' && match.match_score < minShowScore) {
    match.match_score = Math.max(minShowScore, match.match_score);
    match.tier = match.match_score >= 80 ? 'STRONG' : match.match_score >= 60 ? 'GOOD' : 'WEAK';
    match.concerns = [...(match.concerns || []), 'Shown under relaxed 40% match threshold — review before applying.'];
  }

  if (!lenient && typeof match.match_score === 'number' && match.match_score < minShowScore) {
    return {
      skip: true,
      reason: 'low_score',
      match,
      eligibility,
      requirements,
      deadline: requirements.deadline || null,
      description,
    };
  }

  if (lenient && eligibilityReport.overall === 'NOT_ELIGIBLE') {
    match.eligible_to_apply = false;
    match.eligibility_status = 'NOT_ELIGIBLE';
    match.concerns = [...(match.concerns || []), 'Eligibility uncertain or failed — review requirements before applying.'];
  }

  return {
    skip: false,
    match,
    eligibility,
    requirements,
    deadline: requirements.deadline || null,
    description,
  };
}

/**
 * @param {object} params
 * @returns {Promise<object|null>}
 */
export async function ingestVerifiedOpportunity({
  profile,
  rawOpportunity,
  opportunityRepository,
  authContext,
  matchingConfig,
  minShowScore = 40,
  trustListing = false,
  lenient = false,
}) {
  if (!rawOpportunity?.url) return null;
  if (!isCredibleListingUrl(rawOpportunity.url)) return null;
  if (!isAllowedTargetListing(rawOpportunity)) return null;

  let liveness;
  if (trustListing) {
    liveness = {
      verified: true,
      status: 'active',
      reason: 'Listed on official employer ATS feed',
    };
  } else {
    liveness = await verifyPostingLiveness(rawOpportunity.url);
    if (!liveness.verified) return null;
  }

  const evaluation = await evaluateOpportunityForProfile({
    profile,
    opportunity: rawOpportunity,
    matchingConfig,
    minShowScore,
    lenient,
  });
  if (evaluation.skip) {
    const reason = evaluation.reason || 'skipped';
    throw new Error(reason);
  }

  const isIntern = isInternshipTitle(rawOpportunity.title) || isStudentOpportunityTitle(rawOpportunity.title);

  const record = {
    company: rawOpportunity.company,
    title: rawOpportunity.title,
    opportunity_type: isIntern ? 'INTERNSHIP' : 'JOB',
    location: rawOpportunity.location || null,
    remote: /remote/i.test(rawOpportunity.location || ''),
    url: rawOpportunity.url,
    description: evaluation.description,
    requirements: evaluation.requirements,
    source_type: 'DISCOVERY',
    source_name: rawOpportunity.source_name || rawOpportunity.source || 'ATS Scan',
    source_id: rawOpportunity.source_id || null,
    discovered_at: new Date().toISOString(),
    posted_date: rawOpportunity.postedAt
      ? new Date(rawOpportunity.postedAt).toISOString().slice(0, 10)
      : null,
    deadline: evaluation.deadline,
    is_demo: false,
    is_verified: true,
    match_score: evaluation.match.match_score,
    match_tier: evaluation.match.tier,
    eligibility_status: evaluation.eligibility.overall,
    eligible_to_apply: evaluation.match.eligible_to_apply,
    state: 'DISCOVERED',
    metadata: {
      match: evaluation.match,
      eligibility_checks: evaluation.eligibility.checks,
      liveness: liveness.reason,
    },
  };

  return opportunityRepository.upsertDiscovered(record, authContext);
}

/**
 * Fast listing save — no AI scoring gate. Used when discovery mode lists all CS-field roles.
 *
 * @param {object} params
 * @returns {Promise<object>}
 */
export async function saveDiscoveredListing({
  rawOpportunity,
  opportunityRepository,
  authContext,
  profile = {},
  knownUrls = null,
}) {
  if (!rawOpportunity?.url) throw new Error('url required');
  if (!isCredibleListingUrl(rawOpportunity.url)) throw new Error('untrusted_url');
  if (!isAllowedTargetListing(rawOpportunity)) throw new Error('off_target_geo');
  if (knownUrls?.has(rawOpportunity.url)) {
    // Already persisted — record that the listing is still live upstream
    // (bumps lastSeenAt/lastCheckedAt in the global Opportunity Store).
    await opportunityRepository.noteSeen?.(rawOpportunity.url);
    return { url: rawOpportunity.url, isNew: false, changed: false };
  }

  const title = rawOpportunity.title || 'Untitled role';
  const isIntern = isInternshipTitle(title) || isStudentOpportunityTitle(title);
  const description =
    rawOpportunity.description ||
    `${title} at ${rawOpportunity.company || 'employer'}. Listed from verified employer careers feed.`;

  const record = {
    company: rawOpportunity.company,
    title,
    opportunity_type: isIntern ? 'INTERNSHIP' : 'JOB',
    location: rawOpportunity.location || null,
    remote: /remote/i.test(rawOpportunity.location || title),
    url: rawOpportunity.url,
    description,
    requirements: {},
    source_type: 'DISCOVERY',
    source_name: rawOpportunity.source_name || rawOpportunity.source || 'ATS Scan',
    source_id: rawOpportunity.source_id || null,
    discovered_at: new Date().toISOString(),
    posted_date: rawOpportunity.postedAt
      ? new Date(rawOpportunity.postedAt).toISOString().slice(0, 10)
      : null,
    deadline: null,
    is_demo: false,
    is_verified: true,
    match_score: 50,
    match_tier: 'FIELD_MATCH',
    eligibility_status: 'REQUIRES_REVIEW',
    eligible_to_apply: true,
    state: 'DISCOVERED',
    metadata: {
      discovery_mode: rawOpportunity.discovery_mode || 'cs_field',
      market: rawOpportunity.market || rawOpportunity.metadata?.market || 'INTERNATIONAL',
      sector: rawOpportunity.sector || rawOpportunity.metadata?.sector || null,
      match: {
        match_score: 50,
        tier: 'FIELD_MATCH',
        recommendation:
          rawOpportunity.market === 'NATIONAL'
            ? 'Pakistan employer listing — review fit before applying.'
            : 'CS / tech field listing — review fit before applying.',
        concerns: [],
        strengths:
          rawOpportunity.market === 'NATIONAL'
            ? [`Listed from ${rawOpportunity.company || 'employer'} official careers page`]
            : ['Matches your field of study (computer science / tech)'],
        eligible_to_apply: true,
        eligibility_status: 'REQUIRES_REVIEW',
        provider_used: rawOpportunity.source_name || 'field-discovery',
        model_used: rawOpportunity.market === 'NATIONAL' ? 'pakistan-careers' : 'cs-title-filter',
        scored_at: new Date().toISOString(),
      },
      liveness: 'Listed on official employer careers feed',
      profile_name: profile?.identity?.name || null,
      ...(rawOpportunity.metadata || {}),
    },
  };

  const saved = await opportunityRepository.upsertDiscovered(record, authContext);
  if (saved?.isNew === true) knownUrls?.add(rawOpportunity.url);
  return {
    ...saved,
    isNew: saved?.isNew === true,
    changed: saved?.changed === true,
  };
}
