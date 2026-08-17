/**
 * In-process role-analyzer jobs. Same HMR-safe globalThis pattern as scan-job-runner.
 */

import { analysisPhasesFor } from './role-families.mjs';

export const ANALYSIS_PHASES = analysisPhasesFor('jobs');

export function analysisPhases(familyOrType) {
  return analysisPhasesFor(familyOrType);
}

function publicError(err) {
  const raw = err?.message || String(err || 'Analysis failed');
  return raw
    .replace(/sk-[A-Za-z0-9_\-]+/g, '[redacted]')
    .replace(/AIza[A-Za-z0-9_\-]+/g, '[redacted]')
    .replace(/AQ\.[A-Za-z0-9_\-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=[redacted]')
    .slice(0, 280);
}

function jobs() {
  if (!globalThis.__roleAnalyzerJobs) globalThis.__roleAnalyzerJobs = new Map();
  return globalThis.__roleAnalyzerJobs;
}

function userIndex() {
  if (!globalThis.__roleAnalyzerUserRuns) globalThis.__roleAnalyzerUserRuns = new Map();
  return globalThis.__roleAnalyzerUserRuns;
}

function progressStore() {
  if (!globalThis.__roleAnalyzerProgress) globalThis.__roleAnalyzerProgress = new Map();
  return globalThis.__roleAnalyzerProgress;
}

function rememberUserRun(row) {
  if (!row?.userId || !row?.id) return;
  const list = userIndex().get(row.userId) || [];
  const next = [{ ...row, rememberedAt: new Date().toISOString() }, ...list.filter((r) => r.id !== row.id)];
  userIndex().set(row.userId, next.slice(0, 40));
}

export function newAnalysisId() {
  return `ra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getAnalysisJob(id) {
  if (!id) return null;
  return jobs().get(String(id)) || null;
}

export function publicAnalysisJob(job) {
  if (!job) return { status: 'idle', running: false };
  return {
    ok: job.status !== 'FAILED',
    running: job.status === 'RUNNING' || job.status === 'PENDING',
    status: job.status,
    id: job.id,
    message: job.message,
    phase: job.phase || null,
    progressPercent: job.progressPercent ?? null,
    error: job.error || null,
    result: job.status === 'COMPLETE' ? job.result : null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
  };
}

export function applyJobProgress(job, payload = {}) {
  if (!job) return;
  if (payload.message) job.message = payload.message;
  if (payload.phase) job.phase = payload.phase;
  if (payload.percent != null) job.progressPercent = payload.percent;
}

export function startAnalysisJob({ id, userId, run, searchType, family }) {
  const phases = analysisPhasesFor(family || searchType || 'jobs');
  const job = {
    id,
    userId,
    status: 'RUNNING',
    message: phases[0].label,
    phase: phases[0].id,
    progressPercent: phases[0].percent,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  };
  jobs().set(id, job);
  rememberUserRun(job);
  Promise.resolve()
    .then(() => run(job))
    .then((result) => {
      job.status = 'COMPLETE';
      job.result = result || null;
      job.phase = 'done';
      job.progressPercent = 100;
      job.message = result?.metadata?.sampleQuality?.message || 'Analysis complete.';
      job.finishedAt = new Date().toISOString();
      rememberUserRun(job);
    })
    .catch((err) => {
      job.status = 'FAILED';
      job.error = publicError(err);
      job.message = job.error;
      job.finishedAt = new Date().toISOString();
      rememberUserRun(job);
    });
  return job;
}

const INSERT_WITH_SAVE = `INSERT INTO role_analyzer_runs (
         id, tenant_id, user_id, canonical_role, raw_role, market_scope, status,
         force_refresh, searched_titles, result, error, cache_key, started_at, completed_at,
         saved, duration_months, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13::timestamptz, $14::timestamptz,
         $15, $16, NOW(), NOW()
       )
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         result = EXCLUDED.result,
         error = EXCLUDED.error,
         searched_titles = EXCLUDED.searched_titles,
         completed_at = EXCLUDED.completed_at,
         saved = COALESCE(EXCLUDED.saved, role_analyzer_runs.saved),
         duration_months = COALESCE(EXCLUDED.duration_months, role_analyzer_runs.duration_months),
         updated_at = NOW()`;

const INSERT_LEGACY = `INSERT INTO role_analyzer_runs (
         id, tenant_id, user_id, canonical_role, raw_role, market_scope, status,
         force_refresh, searched_titles, result, error, cache_key, started_at, completed_at,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13::timestamptz, $14::timestamptz, NOW(), NOW()
       )
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         result = EXCLUDED.result,
         error = EXCLUDED.error,
         searched_titles = EXCLUDED.searched_titles,
         completed_at = EXCLUDED.completed_at,
         updated_at = NOW()`;

export async function persistRun(postgresClient, row) {
  rememberUserRun(row);
  if (!postgresClient || postgresClient.isMock) return;
  const base = [
    row.id,
    row.tenantId || 'default',
    row.userId,
    row.canonicalRole,
    row.rawRole,
    row.marketScope,
    row.status,
    row.forceRefresh === true,
    JSON.stringify(row.searchedTitles || []),
    row.result ? JSON.stringify(row.result) : null,
    row.error || null,
    row.cacheKey || null,
    row.startedAt || null,
    row.completedAt || null,
  ];
  try {
    await postgresClient.query(INSERT_WITH_SAVE, [
      ...base,
      row.saved === true,
      row.durationMonths != null ? Number(row.durationMonths) : null,
    ]);
  } catch {
    try {
      await postgresClient.query(INSERT_LEGACY, base);
    } catch {
      /* migration may not have run yet */
    }
  }
}

export async function loadRun(postgresClient, id, userId) {
  const mem = getAnalysisJob(id);
  if (mem && (!userId || mem.userId === userId)) return mem;
  const remembered = (userIndex().get(userId) || []).find((r) => r.id === id);
  if (!postgresClient || postgresClient.isMock) return mem || remembered || null;
  try {
    const { rows } = await postgresClient.query(
      `SELECT id, user_id AS "userId", status, result, error, started_at AS "startedAt",
              completed_at AS "finishedAt", canonical_role AS "canonicalRole",
              raw_role AS "rawRole", market_scope AS "marketScope",
              saved, duration_months AS "durationMonths"
         FROM role_analyzer_runs WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    const row = rows[0];
    if (!row) return mem || remembered || null;
    return {
      id: row.id,
      userId: row.userId,
      status: row.status,
      result: row.result,
      error: row.error,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      canonicalRole: row.canonicalRole,
      rawRole: row.rawRole,
      marketScope: row.marketScope,
      saved: row.saved === true,
      durationMonths: row.durationMonths != null ? Number(row.durationMonths) : null,
      message: row.error || (row.status === 'COMPLETE' ? 'Analysis complete.' : 'Running'),
    };
  } catch {
    return mem || remembered || null;
  }
}

function summarizeRun(row) {
  const result = row.result || {};
  const analysis = result.analysis && typeof result.analysis === 'object' ? result.analysis : result;
  const readiness = analysis.readinessScore?.score ?? analysis.roadmap?.readiness?.current ?? null;
  const meta = analysis.metadata || {};
  return {
    id: row.id,
    role: analysis.role || row.canonicalRole || row.rawRole,
    rawRole: row.rawRole || analysis.rawRole || null,
    marketScope: row.marketScope || meta.marketScope || 'ALL',
    status: row.status,
    saved: row.saved === true,
    durationMonths: row.durationMonths != null ? Number(row.durationMonths) : analysis.roadmap?.durationMonths ?? null,
    readiness,
    postingCount: meta.postingCount ?? null,
    createdAt: row.startedAt || row.createdAt || null,
    completedAt: row.finishedAt || row.completedAt || null,
  };
}

export async function listRuns(postgresClient, userId, { savedOnly = false } = {}) {
  const fromMem = (userIndex().get(userId) || [])
    .filter((r) => r.status === 'COMPLETE' && r.result)
    .filter((r) => (savedOnly ? r.saved === true : true))
    .map(summarizeRun);

  if (!postgresClient || postgresClient.isMock) return fromMem;

  try {
    const { rows } = await postgresClient.query(
      `SELECT id, user_id AS "userId", status, result, error, started_at AS "startedAt",
              completed_at AS "finishedAt", created_at AS "createdAt",
              canonical_role AS "canonicalRole", raw_role AS "rawRole",
              market_scope AS "marketScope", saved, duration_months AS "durationMonths"
         FROM role_analyzer_runs
        WHERE user_id = $1 AND status = 'COMPLETE'
        ORDER BY saved DESC, completed_at DESC NULLS LAST, created_at DESC
        LIMIT 30`,
      [userId]
    );
    const fromDb = rows
      .filter((r) => (savedOnly ? r.saved === true : true))
      .map(summarizeRun);
    const seen = new Set(fromDb.map((r) => r.id));
    return [...fromDb, ...fromMem.filter((r) => !seen.has(r.id))].slice(0, 30);
  } catch {
    return fromMem;
  }
}

export async function markRunSaved(postgresClient, { id, userId, saved = true }) {
  const mem = getAnalysisJob(id);
  if (mem && mem.userId === userId) mem.saved = saved === true;
  const remembered = (userIndex().get(userId) || []).find((r) => r.id === id);
  if (remembered) remembered.saved = saved === true;

  if (!postgresClient || postgresClient.isMock) {
    return mem || remembered || null;
  }
  try {
    const { rows } = await postgresClient.query(
      `UPDATE role_analyzer_runs SET saved = $3, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id, saved, canonical_role AS "canonicalRole", result,
                  completed_at AS "finishedAt", duration_months AS "durationMonths",
                  raw_role AS "rawRole", market_scope AS "marketScope", status`,
      [id, userId, saved === true]
    );
    return rows[0] ? { ...rows[0], saved: rows[0].saved === true } : mem || remembered;
  } catch {
    return mem || remembered || null;
  }
}

function progressKey(userId, analysisId, itemKey) {
  return `${userId}::${analysisId}::${itemKey}`;
}

export async function listProgress(postgresClient, userId, analysisId) {
  const prefix = `${userId}::${analysisId}::`;
  const fromMem = [];
  for (const [key, value] of progressStore().entries()) {
    if (key.startsWith(prefix) && value?.completed) {
      fromMem.push({ itemKey: key.slice(prefix.length), completed: true });
    }
  }
  if (!postgresClient || postgresClient.isMock) return fromMem;
  try {
    const { rows } = await postgresClient.query(
      `SELECT item_key AS "itemKey", completed
         FROM role_analyzer_progress
        WHERE user_id = $1 AND analysis_id = $2 AND completed = TRUE`,
      [userId, analysisId]
    );
    const seen = new Set(rows.map((r) => r.itemKey));
    return [...rows, ...fromMem.filter((r) => !seen.has(r.itemKey))];
  } catch {
    return fromMem;
  }
}

export async function upsertProgress(postgresClient, { userId, analysisId, itemKey, completed = true }) {
  const key = progressKey(userId, analysisId, itemKey);
  if (completed) progressStore().set(key, { completed: true, updatedAt: new Date().toISOString() });
  else progressStore().delete(key);

  if (!postgresClient || postgresClient.isMock) {
    return { itemKey, completed: Boolean(completed) };
  }
  try {
    if (completed) {
      await postgresClient.query(
        `INSERT INTO role_analyzer_progress (user_id, analysis_id, item_key, completed, updated_at)
         VALUES ($1, $2, $3, TRUE, NOW())
         ON CONFLICT (user_id, analysis_id, item_key)
         DO UPDATE SET completed = TRUE, updated_at = NOW()`,
        [userId, analysisId, itemKey]
      );
    } else {
      await postgresClient.query(
        `DELETE FROM role_analyzer_progress WHERE user_id = $1 AND analysis_id = $2 AND item_key = $3`,
        [userId, analysisId, itemKey]
      );
    }
  } catch {
    /* table may not exist yet — memory store still holds the toggle */
  }
  return { itemKey, completed: Boolean(completed) };
}
