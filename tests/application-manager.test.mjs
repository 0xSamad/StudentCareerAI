// tests/application-manager.test.mjs — Autonomous Application Manager Test Suite
import { pass, fail, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'url';
import { join } from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

const MOD = pathToFileURL(join(ROOT, 'lib/application-manager.mjs')).href;
console.log('\napplication-manager — autonomous application queue & limit manager');

const {
  ApplicationManager,
  QUEUE_STATES,
  getTodayDateString,
  calculatePriorityScore,
} = await import(MOD);

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'app-mgr-test-'));
}

// ═══════════════════════════════════════════════════════════════
// 1. Timezone Date String Helper
// ═══════════════════════════════════════════════════════════════
console.log('\n  1. Timezone Date String Helper');
{
  const dateKarachi = getTodayDateString('Asia/Karachi');
  check('Asia/Karachi date is YYYY-MM-DD format', /^\d{4}-\d{2}-\d{2}$/.test(dateKarachi), true);

  const dateNY = getTodayDateString('America/New_York');
  check('America/New_York date is YYYY-MM-DD format', /^\d{4}-\d{2}-\d{2}$/.test(dateNY), true);
}

// ═══════════════════════════════════════════════════════════════
// 2. Selection Priority Scoring
// ═══════════════════════════════════════════════════════════════
console.log('\n  2. Selection Priority Scoring');
{
  const eligibleItem = {
    title: 'Machine Learning Intern',
    company: 'Careem',
    eligibility_status: 'ELIGIBLE',
    match_score: 90,
    source: 'greenhouse',
    deadline: '2026-08-30',
  };

  const score1 = calculatePriorityScore(eligibleItem);
  check('Eligible item has positive score', score1 > 10000, true);

  const ineligibleItem = {
    title: 'Senior Staff Engineer',
    company: 'Careem',
    eligibility_status: 'NOT_ELIGIBLE',
  };

  const score2 = calculatePriorityScore(ineligibleItem);
  check('Ineligible item returns -1', score2, -1);
}

// ═══════════════════════════════════════════════════════════════
// 3. Duplicate Job Prevention
// ═══════════════════════════════════════════════════════════════
console.log('\n  3. Duplicate Job Prevention');
{
  const tmp = makeTmpDir();
  try {
    const mgr = new ApplicationManager({ dataDir: tmp });

    const job1 = {
      title: 'Backend Intern',
      company: 'Arbisoft',
      url: 'https://arbisoft.com/jobs/123',
      opportunity_type: 'INTERNSHIP',
    };

    const res1 = await mgr.addToQueue(job1);
    check('First job added successfully', res1.added, true);
    check('State is DISCOVERED', res1.item.state, QUEUE_STATES.DISCOVERED);

    // Add exact duplicate by URL
    const res2 = await mgr.addToQueue(job1);
    check('Duplicate URL rejected', res2.added, false);
    check('Duplicate flag set', res2.duplicate, true);

    // Add duplicate by Company + Title
    const job1Copy = {
      title: 'Backend Intern',
      company: 'Arbisoft',
      url: 'https://arbisoft.com/jobs/different-url',
    };

    const res3 = await mgr.addToQueue(job1Copy);
    check('Duplicate Company+Title rejected', res3.added, false);
    check('Duplicate flag set for company+title', res3.duplicate, true);

    const queue = await mgr.readQueue();
    check('Queue length remains 1', queue.length, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. Daily Limit Enforcement (Internships & Jobs independent)
// ═══════════════════════════════════════════════════════════════
console.log('\n  4. Daily Limit Enforcement');
{
  const tmp = makeTmpDir();
  try {
    const mgr = new ApplicationManager({
      dataDir: tmp,
      internship_applications_per_day: 3,
      job_applications_per_day: 2,
    });

    // Reserve 3 internship slots
    for (let i = 1; i <= 3; i++) {
      const slot = await mgr.reserveSlot('INTERNSHIP');
      check(`Internship slot ${i} allowed`, slot.allowed, true);
    }

    // 4th internship slot should be blocked
    const slot4 = await mgr.reserveSlot('INTERNSHIP');
    check('4th internship slot blocked', slot4.allowed, false);
    check('Reason states daily limit reached', slot4.reason.includes('Daily limit of 3 reached'), true);

    // Job slots should still be available (independent limits)
    const jobSlot1 = await mgr.reserveSlot('JOB');
    check('Job slot 1 allowed independently', jobSlot1.allowed, true);

    const jobSlot2 = await mgr.reserveSlot('JOB');
    check('Job slot 2 allowed independently', jobSlot2.allowed, true);

    const jobSlot3 = await mgr.reserveSlot('JOB');
    check('3rd job slot blocked', jobSlot3.allowed, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. Restarts & Persistence
// ═══════════════════════════════════════════════════════════════
console.log('\n  5. Restarts & Persistence');
{
  const tmp = makeTmpDir();
  try {
    // 1st instance: populate queue & reserve slots
    const mgr1 = new ApplicationManager({ dataDir: tmp, internship_applications_per_day: 5 });
    await mgr1.addToQueue({ title: 'AI Intern', company: '10Pearls', url: 'https://10pearls.com/job/1' });
    await mgr1.reserveSlot('internship');
    await mgr1.reserveSlot('internship');

    // 2nd instance: instantiate with same directory
    const mgr2 = new ApplicationManager({ dataDir: tmp, internship_applications_per_day: 5 });
    const queue = await mgr2.readQueue();
    check('Restored queue item count', queue.length, 1);
    check('Restored queue company name', queue[0].company, '10Pearls');

    const stats = await mgr2.getStats();
    check('Restored internship count', stats.counts.internship, 2);
    check('Restored remaining slots', stats.remaining.internship, 3);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. Timezone-Aware Daily Reset
// ═══════════════════════════════════════════════════════════════
console.log('\n  6. Timezone-Aware Daily Reset');
{
  const tmp = makeTmpDir();
  try {
    const mgr = new ApplicationManager({ dataDir: tmp, timezone: 'Asia/Karachi' });
    await mgr.reserveSlot('job');
    await mgr.reserveSlot('job');

    const statsBefore = await mgr.getStats();
    check('Initial job count before reset', statsBefore.counts.job, 2);

    // Simulate yesterday's date in daily file
    const dailyData = JSON.parse(await import('fs').then(f => f.readFileSync(mgr.dailyPath, 'utf-8')));
    dailyData.date = '2020-01-01';
    await mgr.writeDailyStats(dailyData);

    // Reading stats should trigger automatic daily reset
    const statsAfter = await mgr.getStats();
    check('Job count reset to 0 for new day', statsAfter.counts.job, 0);
    check('Date updated to today', statsAfter.date, getTodayDateString('Asia/Karachi'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 7. Concurrent Workers & Race Condition Prevention
// ═══════════════════════════════════════════════════════════════
console.log('\n  7. Concurrent Workers & Race Condition Prevention');
{
  const tmp = makeTmpDir();
  try {
    const limit = 5;
    const mgr = new ApplicationManager({
      dataDir: tmp,
      internship_applications_per_day: limit,
    });

    // Launch 15 concurrent workers all racing to reserve internship slots
    const workerPromises = Array.from({ length: 15 }, (_, i) =>
      mgr.reserveSlot('internship')
    );

    const results = await Promise.all(workerPromises);

    const allowedCount = results.filter(r => r.allowed).length;
    const blockedCount = results.filter(r => !r.allowed).length;

    check('Allowed slot count equals daily limit exactly', allowedCount, limit);
    check('Blocked slot count equals excess requests', blockedCount, 10);

    const finalStats = await mgr.getStats();
    check('Persisted daily count equals limit', finalStats.counts.internship, limit);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 8. Queue State Transitions & Selection Flow
// ═══════════════════════════════════════════════════════════════
console.log('\n  8. Queue State Transitions & Selection Flow');
{
  const tmp = makeTmpDir();
  try {
    const mgr = new ApplicationManager({
      dataDir: tmp,
      internship_applications_per_day: 2,
    });

    await mgr.addToQueue({
      title: 'Frontend Intern',
      company: 'Venturedive',
      url: 'https://venturedive.com/job/1',
      eligibility_status: 'ELIGIBLE',
      match_score: 95,
      opportunity_type: 'INTERNSHIP',
    });

    await mgr.addToQueue({
      title: 'Data Science Intern',
      company: 'Sistemas',
      url: 'https://sistemas.com/job/2',
      eligibility_status: 'ELIGIBLE',
      match_score: 85,
      opportunity_type: 'INTERNSHIP',
    });

    const selected = await mgr.selectNextItems({}, 5);
    check('Selected items count respects limit (2)', selected.length, 2);
    check('Highest match score selected first', selected[0].company, 'Venturedive');
    check('Selected item state updated', selected[0].state, QUEUE_STATES.SELECTED);

    // Transition state to CV_GENERATED -> APPLICATION_READY -> APPLIED
    const item = selected[0];
    await mgr.updateState(item.id, QUEUE_STATES.CV_GENERATED, { artifacts: { cv_path: 'cv.pdf' } });
    await mgr.updateState(item.id, QUEUE_STATES.APPLICATION_READY);
    await mgr.updateState(item.id, QUEUE_STATES.APPLIED, {}, 'Successfully submitted');

    const updatedQueue = await mgr.readQueue();
    const finalItem = updatedQueue.find(i => i.id === item.id);
    check('Final item state is APPLIED', finalItem.state, QUEUE_STATES.APPLIED);
    check('State history length', finalItem.state_history.length, 5);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// 9. Legacy queue items without state_history
// ═══════════════════════════════════════════════════════════════
console.log('\n  9. Legacy queue items without state_history');
{
  const tmp = makeTmpDir();
  const legacyPath = join(tmp, 'legacy-queue.json');
  try {
    writeFileSync(legacyPath, JSON.stringify([{
      id: 'legacy-no-history',
      company: 'LegacyCo',
      title: 'Software Intern',
      url: 'https://legacy.example/job/1',
      state: QUEUE_STATES.DISCOVERED,
      eligibility_status: 'ELIGIBLE',
      match_score: 90,
      type: 'internship',
      discovered_at: '2026-01-01T00:00:00.000Z',
    }], null, 2));

    const mgr = new ApplicationManager({
      dataDir: tmp,
      queuePath: legacyPath,
      dailyPath: join(tmp, 'daily.json'),
      internship_applications_per_day: 5,
    });

    await mgr.updateState('legacy-no-history', QUEUE_STATES.SELECTED, {}, 'Legacy migration test');
    const queue = await mgr.readQueue();
    const item = queue.find(i => i.id === 'legacy-no-history');
    check('Legacy item migrated with state_history', Array.isArray(item?.state_history), true);
    check('Legacy item state updated', item?.state, QUEUE_STATES.SELECTED);
    check('State history has migration + transition', item?.state_history?.length >= 2, true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

