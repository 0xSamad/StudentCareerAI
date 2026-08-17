// lib/application-manager.mjs — Autonomous Application Manager for CareerOS
// Manages application queue lifecycle, timezone-aware daily limits, priority ranking, and race-condition prevention.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { withPipelineLock } from '../pipeline-lock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ── Queue States Enum ─────────────────────────────────────────────────────────

export const QUEUE_STATES = {
  DISCOVERED:           'DISCOVERED',
  ELIGIBILITY_CHECK:    'ELIGIBILITY_CHECK',
  NOT_ELIGIBLE:         'NOT_ELIGIBLE',
  REQUIRES_REVIEW:      'REQUIRES_REVIEW',
  ELIGIBLE:             'ELIGIBLE',
  MATCHED:              'MATCHED',
  SELECTED:             'SELECTED',
  CV_GENERATED:         'CV_GENERATED',
  APPLICATION_READY:    'APPLICATION_READY',
  APPLYING:             'APPLYING',
  PREPARED:             'PREPARED',
  DRY_RUN:              'DRY_RUN',
  SUBMITTED:            'SUBMITTED',
  APPLIED:              'APPLIED', // legacy alias of SUBMITTED
  FAILED:               'FAILED',
  BLOCKED:              'BLOCKED',
  REQUIRES_USER_INPUT:  'REQUIRES_USER_INPUT',
};

/** States that mean a real external submission occurred. */
export const SUBMITTED_STATES = new Set([
  QUEUE_STATES.SUBMITTED,
  QUEUE_STATES.APPLIED,
]);

/** States that mean prepared only (not submitted). */
export const PREPARED_STATES = new Set([
  QUEUE_STATES.PREPARED,
  QUEUE_STATES.DRY_RUN,
  QUEUE_STATES.APPLICATION_READY,
]);

/** Coerce parsed queue JSON into a safe array (handles legacy/corrupt files). */
function normalizeQueue(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeQueueItem).filter(Boolean);
}

/** Backfill fields missing on legacy queue rows (e.g. no state_history). */
function normalizeQueueItem(item) {
  if (!item || typeof item !== 'object') return null;

  if (!Array.isArray(item.state_history)) {
    item.state_history = item.state
      ? [{
          state: item.state,
          timestamp: item.discovered_at || item.updated_at || new Date().toISOString(),
          reason: 'Migrated legacy queue item',
        }]
      : [];
  }

  if (!item.artifacts || typeof item.artifacts !== 'object') {
    item.artifacts = {};
  }

  return item;
}

export class ApplicationManagerError extends Error {
  constructor(message, code = 'MANAGER_ERROR') {
    super(message);
    this.name = 'ApplicationManagerError';
    this.code = code;
  }
}

// ── Timezone Helper ───────────────────────────────────────────────────────────

export function getTodayDateString(timezone = 'UTC') {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

// ── Priority Ranking Calculator ───────────────────────────────────────────────

export function calculatePriorityScore(item, profile = {}) {
  let score = 0;

  // 1. Eligibility (Must be ELIGIBLE or REQUIRES_REVIEW with eligible_to_apply)
  if (item.eligibility_status === 'ELIGIBLE') {
    score += 10000;
  } else if (item.eligibility_status === 'REQUIRES_REVIEW' && item.eligible_to_apply) {
    score += 8000;
  } else if (item.eligibility_status === 'NOT_ELIGIBLE') {
    return -1; // Exclude
  } else {
    score += 5000; // Default pending eligibility check
  }

  // 2. Deadline (Earlier deadline -> higher priority)
  if (item.deadline) {
    const deadlineMs = new Date(item.deadline).getTime();
    if (!isNaN(deadlineMs)) {
      const nowMs = Date.now();
      const daysUntil = (deadlineMs - nowMs) / (1000 * 60 * 60 * 24);
      if (daysUntil > 0) {
        score += Math.max(0, 1000 - daysUntil * 10);
      }
    }
  }

  // 3. Match score (0 to 100 -> 0 to 1000)
  if (typeof item.match_score === 'number') {
    score += item.match_score * 10;
  }

  // 4. Preferences match
  if (profile.preferences) {
    const targetRoles = profile.preferences.target_roles || [];
    if (targetRoles.some(r => (item.title || '').toLowerCase().includes(r.toLowerCase()))) {
      score += 300;
    }
    const preferredLocs = profile.preferences.locations?.preferred || [];
    if (preferredLocs.some(l => (item.location || '').toLowerCase().includes(l.toLowerCase()))) {
      score += 150;
    }
  }

  // 5. Freshness (newest discovered_at/posted_at date)
  if (item.discovered_at || item.posted_at) {
    const dateMs = new Date(item.discovered_at || item.posted_at).getTime();
    if (!isNaN(dateMs)) {
      const ageHours = (Date.now() - dateMs) / (1000 * 60 * 60);
      score += Math.max(0, 100 - ageHours);
    }
  }

  // 6. Source reliability (ATS API > generic web)
  const src = (item.source || '').toLowerCase();
  const isATS = ['greenhouse', 'ashby', 'lever', 'workday'].includes(src);
  if (isATS) {
    score += 50;
  }

  return score;
}

// ── ApplicationManager Class ──────────────────────────────────────────────────

export class ApplicationManager {
  constructor(options = {}) {
    this.dataDir = options.dataDir || join(REPO_ROOT, 'data');
    this.queuePath = options.queuePath || join(this.dataDir, 'application-queue.json');
    this.dailyPath = options.dailyPath || join(this.dataDir, 'daily-applications.json');
    this.timezone = options.timezone || 'Asia/Karachi';

    this.limits = {
      internship: options.internship_applications_per_day ?? 10,
      job: options.job_applications_per_day ?? 10,
    };

    mkdirSync(this.dataDir, { recursive: true });
    this.initStorage();
  }

  // ── Storage Initialization ──────────────────────────────────────────────────

  initStorage() {
    if (!existsSync(this.queuePath)) {
      writeFileSync(this.queuePath, JSON.stringify([], null, 2));
    }

    const today = getTodayDateString(this.timezone);
    if (!existsSync(this.dailyPath)) {
      const initialDaily = {
        date: today,
        timezone: this.timezone,
        counts: { internship: 0, job: 0 },
      };
      writeFileSync(this.dailyPath, JSON.stringify(initialDaily, null, 2));
    }
  }

  // ── Lock-Guarded File Operations ────────────────────────────────────────────

  async readQueue() {
    return withPipelineLock(this.queuePath, async () => {
      try {
        const raw = readFileSync(this.queuePath, 'utf-8');
        const queue = normalizeQueue(JSON.parse(raw));
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.some(item => !Array.isArray(item?.state_history))) {
          writeFileSync(this.queuePath, JSON.stringify(queue, null, 2));
        }
        return queue;
      } catch {
        return [];
      }
    });
  }

  async writeQueue(queue) {
    return withPipelineLock(this.queuePath, async () => {
      writeFileSync(this.queuePath, JSON.stringify(queue, null, 2));
    });
  }

  async readDailyStats() {
    return withPipelineLock(this.dailyPath, async () => {
      const today = getTodayDateString(this.timezone);
      let stats;
      try {
        stats = JSON.parse(readFileSync(this.dailyPath, 'utf-8'));
      } catch {
        stats = { date: today, timezone: this.timezone, counts: { internship: 0, job: 0 } };
      }

      // Check timezone daily reset
      if (stats.date !== today) {
        stats.date = today;
        stats.counts = { internship: 0, job: 0 };
        writeFileSync(this.dailyPath, JSON.stringify(stats, null, 2));
      }
      return stats;
    });
  }

  async writeDailyStats(stats) {
    return withPipelineLock(this.dailyPath, async () => {
      writeFileSync(this.dailyPath, JSON.stringify(stats, null, 2));
    });
  }

  // ── Deduplication Helper ────────────────────────────────────────────────────

  isDuplicate(opportunity, queue) {
    const targetUrl = (opportunity.url || '').trim().toLowerCase();
    const targetKey = `${(opportunity.company || '').trim().toLowerCase()}||${(opportunity.title || '').trim().toLowerCase()}`;

    return queue.some(item => {
      const itemUrl = (item.url || '').trim().toLowerCase();
      const itemKey = `${(item.company || '').trim().toLowerCase()}||${(item.title || '').trim().toLowerCase()}`;

      if (targetUrl && itemUrl && targetUrl === itemUrl) return true;
      if (targetKey !== '||' && itemKey === targetKey) return true;
      return false;
    });
  }

  // ── Add Opportunity to Queue ────────────────────────────────────────────────

  async addToQueue(opportunity) {
    return withPipelineLock(this.queuePath, async () => {
      const raw = readFileSync(this.queuePath, 'utf-8');
      const queue = normalizeQueue(JSON.parse(raw));

      if (this.isDuplicate(opportunity, queue)) {
        const existing = queue.find(item =>
          (opportunity.url && item.url === opportunity.url) ||
          (`${item.company}||${item.title}`.toLowerCase() === `${opportunity.company}||${opportunity.title}`.toLowerCase())
        );
        return { added: false, duplicate: true, item: existing };
      }

      const isInternship = (opportunity.opportunity_type || '').toUpperCase() === 'INTERNSHIP' ||
        /intern|trainee|apprentice/i.test(opportunity.title || '');

      const newItem = {
        id: randomUUID(),
        opportunity_id: opportunity.id || opportunity.url || randomUUID(),
        title: opportunity.title,
        company: opportunity.company,
        url: opportunity.url,
        type: isInternship ? 'internship' : 'job',
        opportunity_type: isInternship ? 'INTERNSHIP' : 'JOB',
        location: opportunity.location || '',
        country: opportunity.country || '',
        source: opportunity.source || 'generic',
        deadline: opportunity.deadline || null,
        discovered_at: opportunity.discovered_at || new Date().toISOString(),
        posted_at: opportunity.posted_at || null,
        eligibility_status: opportunity.eligibility_status || null,
        eligible_to_apply: opportunity.eligible_to_apply ?? true,
        match_score: opportunity.match_score ?? null,
        state: QUEUE_STATES.DISCOVERED,
        state_history: [
          { state: QUEUE_STATES.DISCOVERED, timestamp: new Date().toISOString(), reason: 'Discovered' },
        ],
        artifacts: {},
      };

      queue.push(newItem);
      writeFileSync(this.queuePath, JSON.stringify(queue, null, 2));
      return { added: true, duplicate: false, item: newItem };
    });
  }

  // ── State Transition ────────────────────────────────────────────────────────

  async updateState(itemIdOrUrl, newState, payload = {}, reason = '') {
    if (!Object.values(QUEUE_STATES).includes(newState)) {
      throw new ApplicationManagerError(`Invalid state: ${newState}`);
    }

    return withPipelineLock(this.queuePath, async () => {
      const raw = readFileSync(this.queuePath, 'utf-8');
      const queue = normalizeQueue(JSON.parse(raw));

      const item = queue.find(i => i.id === itemIdOrUrl || i.url === itemIdOrUrl);
      if (!item) {
        throw new ApplicationManagerError(`Queue item not found: ${itemIdOrUrl}`);
      }

      normalizeQueueItem(item);

      item.state = newState;
      item.state_history.push({
        state: newState,
        timestamp: new Date().toISOString(),
        reason: reason || `Transitioned to ${newState}`,
      });

      if (payload.eligibility_status) item.eligibility_status = payload.eligibility_status;
      if (typeof payload.match_score === 'number') item.match_score = payload.match_score;
      if (payload.artifacts) item.artifacts = { ...item.artifacts, ...payload.artifacts };
      if (typeof payload.dry_run === 'boolean') item.dry_run = payload.dry_run;
      if (payload.submitted_at !== undefined) item.submitted_at = payload.submitted_at;
      if (payload.match_error) item.match_error = payload.match_error;

      writeFileSync(this.queuePath, JSON.stringify(queue, null, 2));
      return item;
    });
  }

  // ── Atomic Slot Reservation (Race-condition safe) ───────────────────────────

  async reserveSlot(type) {
    const normType = type === 'INTERNSHIP' || type === 'internship' ? 'internship' : 'job';
    const limit = this.limits[normType];

    return withPipelineLock(this.dailyPath, async () => {
      const today = getTodayDateString(this.timezone);
      let stats;
      try {
        stats = JSON.parse(readFileSync(this.dailyPath, 'utf-8'));
      } catch {
        stats = { date: today, timezone: this.timezone, counts: { internship: 0, job: 0 } };
      }

      // Timezone reset check
      if (stats.date !== today) {
        stats.date = today;
        stats.counts = { internship: 0, job: 0 };
      }

      const currentCount = stats.counts[normType] || 0;
      if (currentCount >= limit) {
        return {
          allowed: false,
          current: currentCount,
          limit,
          type: normType,
          reason: `Daily limit of ${limit} reached for ${normType} applications`,
        };
      }

      // Increment count atomically
      stats.counts[normType] = currentCount + 1;
      writeFileSync(this.dailyPath, JSON.stringify(stats, null, 2));

      return {
        allowed: true,
        current: stats.counts[normType],
        limit,
        type: normType,
      };
    });
  }

  // ── Selection Priority Engine ───────────────────────────────────────────────

  async selectNextItems(profile = {}, maxItems = 5) {
    const queue = await this.readQueue();

    // Filter candidate items ready for selection
    const candidates = queue.filter(item =>
      [QUEUE_STATES.DISCOVERED, QUEUE_STATES.ELIGIBLE, QUEUE_STATES.MATCHED].includes(item.state) &&
      item.eligibility_status !== 'NOT_ELIGIBLE'
    );

    // Score and rank candidates
    const ranked = candidates.map(item => ({
      item,
      score: calculatePriorityScore(item, profile),
    })).filter(r => r.score >= 0);

    // Sort descending by priority score
    ranked.sort((a, b) => b.score - a.score);

    const selected = [];
    for (const r of ranked) {
      if (selected.length >= maxItems) break;

      // Reserve daily slot atomically
      const slot = await this.reserveSlot(r.item.type);
      if (slot.allowed) {
        await this.updateState(r.item.id, QUEUE_STATES.SELECTED, {}, `Selected with priority score ${r.score}`);
        selected.push({ ...r.item, state: QUEUE_STATES.SELECTED, priority_score: r.score });
      }
    }

    return selected;
  }

  // ── Daily Stats Summary ─────────────────────────────────────────────────────

  async getStats() {
    const daily = await this.readDailyStats();
    return {
      date: daily.date,
      timezone: this.timezone,
      counts: daily.counts,
      limits: this.limits,
      remaining: {
        internship: Math.max(0, this.limits.internship - (daily.counts.internship || 0)),
        job: Math.max(0, this.limits.job - (daily.counts.job || 0)),
      },
    };
  }

  // ── Manual Daily Stats Reset ────────────────────────────────────────────────

  async resetDailyStats() {
    return withPipelineLock(this.dailyPath, async () => {
      const today = getTodayDateString(this.timezone);
      const resetStats = {
        date: today,
        timezone: this.timezone,
        counts: { internship: 0, job: 0 },
      };
      writeFileSync(this.dailyPath, JSON.stringify(resetStats, null, 2));
      return resetStats;
    });
  }
}
