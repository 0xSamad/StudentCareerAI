/**
 * scan-metrics.mjs — Canonical discovery counters.
 *
 * FIRST SCAN / SECOND SCAN both report the same shape so incremental
 * behaviour is visible: a second scan must not re-insert stored listings.
 */

export function emptyScanMetrics() {
  return {
    fetched: 0,
    normalized: 0,
    new: 0,
    updated: 0,
    duplicates: 0,
    failed: 0,
  };
}

export function addFetched(metrics, count = 1) {
  metrics.fetched += Math.max(0, Number(count) || 0);
  return metrics;
}

/**
 * Record one persist attempt against the Opportunity Store.
 * `saved` is the return value of upsert / saveDiscoveredListing.
 */
export function addPersistResult(metrics, saved) {
  metrics.normalized += 1;
  if (!saved || saved.failed === true) {
    metrics.failed += 1;
    return metrics;
  }
  if (saved.isNew === true) {
    metrics.new += 1;
  } else if (saved.changed === true) {
    metrics.updated += 1;
  } else {
    metrics.duplicates += 1;
  }
  return metrics;
}

export function mergeScanMetrics(into, extra = {}) {
  const keys = ['fetched', 'normalized', 'new', 'updated', 'duplicates', 'failed'];
  for (const key of keys) {
    into[key] += Math.max(0, Number(extra[key]) || 0);
  }
  return into;
}

export function metricsFromEngineResult(result = {}) {
  return {
    fetched: Number(result.fetched) || 0,
    normalized: Number(result.fetched) || 0,
    new: Number(result.newCount) || 0,
    updated: Number(result.updatedCount) || 0,
    duplicates: Number(result.unchangedCount) || 0,
    failed: result.failed ? 1 : 0,
  };
}

export function formatScanMetrics(metrics = emptyScanMetrics()) {
  return [
    `Fetched: ${metrics.fetched}`,
    `Normalized: ${metrics.normalized}`,
    `New: ${metrics.new}`,
    `Updated: ${metrics.updated}`,
    `Duplicates: ${metrics.duplicates}`,
    `Failed: ${metrics.failed}`,
  ].join('\n');
}
