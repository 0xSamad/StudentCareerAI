"use client";

/**
 * AutoScanRunner used to POST /api/opportunities/scan on page load.
 * That is forbidden: opening the dashboard/Jobs/Internships must never
 * trigger an external fetch. Discovery is owned by the backend scheduler.
 * This component is kept as a no-op so leftover imports do not scan.
 */
export function AutoScanRunner() {
  return null;
}
