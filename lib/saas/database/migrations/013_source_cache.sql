-- 013_source_cache.sql — Per-query source cache + rate-limit counters
--
-- SourceCache stores one row per (source, query fingerprint) so a recently
-- fetched search is served from the database instead of hitting the API again.
-- discovery_state gains request/429/backoff counters used by canRefresh().

CREATE TABLE IF NOT EXISTS source_cache (
    id VARCHAR(64) PRIMARY KEY,
    source_id VARCHAR(100) NOT NULL,
    query TEXT NULL,
    country VARCHAR(8) NULL,
    opportunity_type VARCHAR(20) NULL,
    parameters_hash VARCHAR(64) NOT NULL,
    last_fetched_at TIMESTAMP WITH TIME ZONE NULL,
    last_checked_at TIMESTAMP WITH TIME ZONE NULL,
    next_fetch_at TIMESTAMP WITH TIME ZONE NULL,
    result_count INTEGER NOT NULL DEFAULT 0,
    etag TEXT NULL,
    last_modified TEXT NULL,
    cursor TEXT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ok',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (source_id, parameters_hash)
);

CREATE INDEX IF NOT EXISTS idx_source_cache_next_fetch
    ON source_cache (next_fetch_at);

CREATE INDEX IF NOT EXISTS idx_source_cache_source
    ON source_cache (source_id, last_fetched_at DESC);

ALTER TABLE discovery_state
    ADD COLUMN IF NOT EXISTS requests_made INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discovery_state
    ADD COLUMN IF NOT EXISTS requests_remaining INTEGER NULL;
ALTER TABLE discovery_state
    ADD COLUMN IF NOT EXISTS last_429_at TIMESTAMP WITH TIME ZONE NULL;
ALTER TABLE discovery_state
    ADD COLUMN IF NOT EXISTS backoff_until TIMESTAMP WITH TIME ZONE NULL;
ALTER TABLE discovery_state
    ADD COLUMN IF NOT EXISTS last_new_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discovery_state
    ADD COLUMN IF NOT EXISTS last_updated_count INTEGER NOT NULL DEFAULT 0;
