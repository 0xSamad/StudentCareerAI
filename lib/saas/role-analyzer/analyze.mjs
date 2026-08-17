/**
 * Personalized role-readiness analysis from a market snapshot + attested profile.
 */

import { resolveRoleFamily, searchedTitlesFor, searchNounFor } from './role-families.mjs';
import { normalizeRole, publicRoleContract } from './role-normalize.mjs';
import { splitDemandByMarket } from './skill-frequency.mjs';
import { collectProfileSkills } from './profile-skills.mjs';
import { buildSkillGaps } from './gap-model.mjs';
import { computeReadiness } from './readiness-score.mjs';
import { coverageAgainstDemand } from './market-coverage.mjs';
import { researchRoleMarket } from './research.mjs';
import { mergeDemandWithBaseline, sampleQuality, MIN_CONFIDENT_POSTINGS } from './role-baseline.mjs';
import { categoryFor } from './skill-taxonomy.mjs';
import {
  cacheKeyFor,
  readMarketCache,
  writeMarketCache,
  isFresh,
  dataAgeLabel,
  DEFAULT_TTL_MS,
} from './cache.mjs';

function summarizeJobs(postings) {
  return postings.map((p) => ({
    jobTitle: p.jobTitle,
    company: p.company,
    location: p.location,
    country: p.country || '',
    market: p.market,
    url: p.url,
    source: p.source,
    dateDiscovered: p.dateDiscovered || p.postingDate || p.analyzedAt || null,
  }));
}

export function buildAnalysisResult({
  family,
  rawRole,
  marketScope,
  snapshot,
  profile,
  cvText = '',
  knowledgeText = '',
  servedFromCache = false,
}) {
  const role = normalizeRole(rawRole || family?.canonical);
  const resolvedFamily = family?.canonical ? family : role.family;
  const postings = snapshot.postings || [];
  const demand = splitDemandByMarket(postings);
  const merged = mergeDemandWithBaseline(demand.all.skills, resolvedFamily, postings.length).map((row) => ({
    ...row,
    category: row.category || categoryFor(row.skill),
    total: row.total ?? postings.length,
  }));
  const collected = collectProfileSkills(profile, cvText, knowledgeText);
  const skillGaps = buildSkillGaps(merged, collected, { family: resolvedFamily, postingCount: postings.length });
  const readiness = computeReadiness({
    gaps: skillGaps,
    collected,
    family: resolvedFamily,
    postingCount: postings.length,
    marketSkills: merged,
  });
  const quality = sampleQuality(postings.length, {
    usedBaseline: true,
    researchedExtra: (snapshot.sources || []).some((s) => /gemini|remotive|adzuna|jobicy|openai/i.test(s)),
    postingsWithSkills: demand.all.postingsWithSkills,
  });
  const pakistan_postings = postings.filter((p) => p.market === 'PAKISTAN').length;
  const international_postings = postings.filter((p) => p.market === 'INTERNATIONAL').length;
  const unknown_postings = postings.filter((p) => p.market === 'UNKNOWN').length;
  const postingCount = postings.length;
  const researchedAt = snapshot.researchedAt || new Date().toISOString();
  const lastUpdated = researchedAt;
  const profileMatches = skillGaps.map((g) => ({
    skill: g.skill,
    status: g.status,
    evidence: g.evidence,
    evidenceLevel: g.evidenceLevel,
    evidenceNote: g.evidenceNote,
  }));

  const contract = publicRoleContract({ ...role, family: resolvedFamily, normalized_role: resolvedFamily.canonical, family_id: resolvedFamily.id, domain: resolvedFamily.domain || role.domain, specialization: resolvedFamily.specialization || role.specialization, seniority: resolvedFamily.seniority || role.seniority, employment_type: resolvedFamily.employmentType === 'internship' ? 'Internship' : 'Job', search_type: resolvedFamily.searchType || role.search_type });

  return {
    ...contract,
    role: resolvedFamily.canonical,
    rawRole,
    domain: contract.domain,
    seniority: contract.seniority,
    employment_type: contract.employment_type,
    search_type: contract.search_type,
    total_postings: postingCount,
    pakistan_postings,
    international_postings,
    unknown_postings,
    skills: merged.map((s) => s.skill),
    skill_frequencies: merged,
    profile_matches: profileMatches,
    skill_gaps: skillGaps,
    readiness_score: readiness.skillReadiness,
    market_match_score: readiness.marketMatch,
    job_competitiveness_score: readiness.jobCompetitiveness,
    data_quality: quality,
    sources: snapshot.sources || [],
    last_updated: lastUpdated,
    searchedTitles: snapshot.searchedTitles || searchedTitlesFor(resolvedFamily),
    analyzedJobs: summarizeJobs(postings),
    pakistan: {
      postingCount: pakistan_postings,
      skillDemand: demand.pakistan.skills.slice(0, 25),
      insufficient: pakistan_postings < 5,
    },
    international: {
      postingCount: international_postings,
      skillDemand: demand.international.skills.slice(0, 25),
      insufficient: international_postings < 5,
    },
    skillDemand: merged,
    demandByCategory: demand.all.byCategory,
    profileMatch: {
      namedSkillCount: collected.named.size,
      namedSkills: [...collected.named].sort(),
      academicSkills: [...(collected.academic || collected.coursework || [])].sort(),
      projectCount: collected.projectCount,
      experienceCount: collected.experienceCount,
      education: collected.education || null,
    },
    skillGaps,
    pakistanMatch: pakistan_postings
      ? coverageAgainstDemand(demand.pakistan.skills, skillGaps)
      : { percent: null, have: 0, total: 0, kind: 'FACT', note: 'Insufficient data' },
    internationalMatch: international_postings
      ? coverageAgainstDemand(demand.international.skills, skillGaps)
      : { percent: null, have: 0, total: 0, kind: 'FACT', note: 'Insufficient data' },
    readinessScore: readiness,
    metadata: {
      analyzedAt: new Date().toISOString(),
      researchedAt,
      lastAnalyzedLabel: researchedAt.slice(0, 10),
      dataAge: dataAgeLabel(researchedAt),
      servedFromCache,
      postingCount,
      pakistanCount: pakistan_postings,
      internationalCount: international_postings,
      unknownCount: unknown_postings,
      postingsWithSkills: demand.all.postingsWithSkills || 0,
      sources: snapshot.sources || [],
      unavailableSources: snapshot.unavailableSources || [],
      sampleQuality: quality,
      marketScope,
      targetPostings: MIN_CONFIDENT_POSTINGS,
      usedRoleBaseline: true,
      searchType: contract.search_type,
      employmentType: contract.employment_type,
      domain: contract.domain,
    },
  };
}

function notify(onProgress, payload) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(payload);
  } catch {
    /* progress is best-effort */
  }
}

export async function obtainMarketSnapshot({
  family,
  marketScope,
  opportunityStore,
  repoRoot,
  postgresClient,
  forceRefresh = false,
  allowNetwork = true,
  matchingConfig = null,
  onProgress = null,
}) {
  const noun = searchNounFor(family);
  notify(onProgress, { phase: 'search', percent: 8, message: noun === 'internships' ? 'Searching internships' : 'Searching jobs' });
  const key = cacheKeyFor(family.canonical, marketScope, { familyId: family.id, searchType: family.searchType });
  const cached = await readMarketCache(postgresClient, key);
  const wantsPakistan = marketScope === 'ALL' || marketScope === 'PAKISTAN';
  const pakistanReady =
    !wantsPakistan ||
    (cached?.pakistanCount || 0) >= 5 ||
    cached?.pakistanSearchAttempted === true;
  const cacheUsable =
    !forceRefresh &&
    isFresh(cached, DEFAULT_TTL_MS) &&
    (cached.postingCount || 0) >= MIN_CONFIDENT_POSTINGS &&
    pakistanReady;
  if (cacheUsable) {
    notify(onProgress, { phase: 'existing', percent: 28, message: 'Using a recent market sample' });
    return { snapshot: cached, servedFromCache: true, cacheKey: key };
  }

  notify(onProgress, { phase: 'existing', percent: 22, message: noun === 'internships' ? 'Reading internships we already have' : 'Reading jobs we already have' });
  const researched = await researchRoleMarket({
    family,
    marketScope,
    opportunityStore,
    repoRoot,
    fresh: Boolean(allowNetwork && (forceRefresh || !cacheUsable)),
    matchingConfig,
    onProgress,
  });

  const demand = splitDemandByMarket(researched.postings);
  const snapshot = {
    cacheKey: key,
    canonicalRole: family.canonical,
    marketScope,
    searchedTitles: researched.searchedTitles,
    postings: researched.postings,
    skillDemand: demand,
    sources: researched.sources,
    unavailableSources: researched.unavailableSources,
    pakistanCount: researched.pakistanCount,
    internationalCount: researched.internationalCount,
    unknownCount: researched.unknownCount,
    postingCount: researched.postingCount,
    researchedAt: researched.researchedAt,
    pakistanSearchAttempted: researched.pakistanSearchAttempted === true,
  };
  notify(onProgress, { phase: 'extract', percent: 62, message: 'Listing the skills they ask for' });
  await writeMarketCache(postgresClient, snapshot);
  return { snapshot, servedFromCache: false, cacheKey: key };
}

export async function analyzeRoleReadiness(params) {
  const onProgress = params.onProgress || null;
  const normalized = normalizeRole(params.role);
  const family = params.family || normalized.family;
  if (!family.canonical) {
    throw new Error('Enter a target career role.');
  }
  const marketScope = String(params.marketScope || 'ALL').toUpperCase();
  const { snapshot, servedFromCache, cacheKey } = await obtainMarketSnapshot({
    family,
    marketScope,
    opportunityStore: params.opportunityStore,
    repoRoot: params.repoRoot,
    postgresClient: params.postgresClient,
    forceRefresh: params.forceRefresh === true,
    allowNetwork: params.allowNetwork !== false,
    matchingConfig: params.matchingConfig || params.profile?.matching,
    onProgress,
  });
  notify(onProgress, { phase: 'compare', percent: 72, message: 'Comparing that with your profile' });
  const result = buildAnalysisResult({
    family,
    rawRole: params.role || family.canonical,
    marketScope,
    snapshot,
    profile: params.profile,
    cvText: params.cvText,
    knowledgeText: params.knowledgeText,
    servedFromCache,
  });
  notify(onProgress, { phase: 'gaps', percent: 82, message: 'Finding what you still need' });
  return { family, cacheKey, result, role: normalized };
}

export { resolveRoleFamily, searchedTitlesFor };
