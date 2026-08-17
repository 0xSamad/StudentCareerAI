-- 012_discovery_state.sql — Per-source incremental discovery state
--
-- One row per external source (adzuna, pakistan-top100, international-top100,
-- ats-round-robin, …). Lets the discovery engine ask "what changed since our
-- last successful fetch?" instead of repeating full historical scans, and
-- persists rate-limit backoff across process restarts.

CREATE TABLE IF NOT EXISTS discovery_state (
    source_id VARCHAR(100) PRIMARY KEY,
    last_successful_fetch_at TIMESTAMP WITH TIME ZONE NULL,
    last_attempt_at TIMESTAMP WITH TIME ZONE NULL,
    last_cursor TEXT NULL,
    last_page INTEGER NULL,
    last_published_at TIMESTAMP WITH TIME ZONE NULL,
    last_known_opportunity_id VARCHAR(255) NULL,
    last_error TEXT NULL,
    rate_limit_reset_at TIMESTAMP WITH TIME ZONE NULL,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    total_fetches INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
