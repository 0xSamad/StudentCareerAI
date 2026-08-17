-- 015_role_analyzer.sql — Role Readiness Analyzer
--
-- Market research is cached per canonical role + market scope so the same
-- role is not re-fetched on every click. Per-user runs store the personalized
-- readiness result (profile match differs even when the market snapshot is shared).

CREATE TABLE IF NOT EXISTS role_analyzer_market_cache (
    cache_key VARCHAR(180) PRIMARY KEY,
    canonical_role VARCHAR(120) NOT NULL,
    market_scope VARCHAR(32) NOT NULL DEFAULT 'ALL',
    searched_titles JSONB NOT NULL DEFAULT '[]'::jsonb,
    postings JSONB NOT NULL DEFAULT '[]'::jsonb,
    skill_demand JSONB NOT NULL DEFAULT '{}'::jsonb,
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    unavailable_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    pakistan_count INTEGER NOT NULL DEFAULT 0,
    international_count INTEGER NOT NULL DEFAULT 0,
    unknown_count INTEGER NOT NULL DEFAULT 0,
    posting_count INTEGER NOT NULL DEFAULT 0,
    researched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_role_analyzer_cache_scope CHECK (market_scope IN ('ALL', 'PAKISTAN', 'INTERNATIONAL'))
);

CREATE INDEX IF NOT EXISTS idx_role_analyzer_cache_role
    ON role_analyzer_market_cache (canonical_role, researched_at DESC);

CREATE TABLE IF NOT EXISTS role_analyzer_runs (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
    user_id VARCHAR(64) NOT NULL,
    canonical_role VARCHAR(120) NOT NULL,
    raw_role TEXT NOT NULL,
    market_scope VARCHAR(32) NOT NULL DEFAULT 'ALL',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    force_refresh BOOLEAN NOT NULL DEFAULT FALSE,
    searched_titles JSONB NOT NULL DEFAULT '[]'::jsonb,
    result JSONB NULL,
    error TEXT NULL,
    cache_key VARCHAR(180) NULL,
    started_at TIMESTAMP WITH TIME ZONE NULL,
    completed_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_role_analyzer_run_scope CHECK (market_scope IN ('ALL', 'PAKISTAN', 'INTERNATIONAL')),
    CONSTRAINT chk_role_analyzer_run_status CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_role_analyzer_runs_user
    ON role_analyzer_runs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_role_analyzer_runs_status
    ON role_analyzer_runs (status, updated_at DESC);
