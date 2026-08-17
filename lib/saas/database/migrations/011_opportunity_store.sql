-- 011_opportunity_store.sql — Global Opportunity Store + per-user saved states
--
-- Architecture: FETCH → NORMALIZE → DEDUPLICATE → PERSIST → SERVE FROM DATABASE.
-- opportunity_store is GLOBAL: one row per real-world listing, deduplicated by
-- dedupe_key (source+source_id preferred, else normalized URL, else fingerprint).
-- User-specific state (saved / ignored / applied / hidden) lives in
-- saved_opportunities so one discovery serves every user.

CREATE TABLE IF NOT EXISTS opportunity_store (
    id VARCHAR(64) PRIMARY KEY,
    dedupe_key TEXT NOT NULL,
    url_key TEXT NULL,
    source VARCHAR(100) NOT NULL DEFAULT 'unknown',
    source_type VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN',
    source_id VARCHAR(255) NULL,
    source_url TEXT NULL,
    application_url TEXT NULL,
    company VARCHAR(255) NOT NULL DEFAULT 'Unknown',
    title VARCHAR(255) NOT NULL DEFAULT 'Untitled role',
    description TEXT NULL,
    location VARCHAR(255) NULL,
    country VARCHAR(100) NULL,
    opportunity_type VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    employment_type VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    remote BOOLEAN NOT NULL DEFAULT FALSE,
    posted_at TIMESTAMP WITH TIME ZONE NULL,
    deadline DATE NULL,
    salary VARCHAR(255) NULL,
    raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash VARCHAR(64) NULL,
    first_discovered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_opp_store_dedupe UNIQUE (dedupe_key),
    CONSTRAINT chk_opp_store_type CHECK (opportunity_type IN ('INTERNSHIP', 'JOB', 'OTHER', 'UNKNOWN')),
    CONSTRAINT chk_opp_store_status CHECK (status IN ('ACTIVE', 'EXPIRED', 'CLOSED', 'REMOVED', 'UNKNOWN'))
);

CREATE INDEX IF NOT EXISTS idx_opp_store_url_key ON opportunity_store(url_key) WHERE url_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_store_type ON opportunity_store(opportunity_type) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_opp_store_last_seen ON opportunity_store(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_opp_store_company ON opportunity_store(company);
CREATE INDEX IF NOT EXISTS idx_opp_store_country ON opportunity_store(country) WHERE country IS NOT NULL;

CREATE TABLE IF NOT EXISTS saved_opportunities (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
    user_id VARCHAR(64) NOT NULL,
    opportunity_id VARCHAR(64) NOT NULL REFERENCES opportunity_store(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'SAVED',
    saved_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_saved_opps_user_opp UNIQUE (user_id, opportunity_id),
    CONSTRAINT chk_saved_opps_status CHECK (status IN ('SAVED', 'IGNORED', 'APPLIED', 'HIDDEN'))
);

CREATE INDEX IF NOT EXISTS idx_saved_opps_user ON saved_opportunities(user_id, status);

-- Backfill: seed the global store from previously discovered tenant listings.
-- Dedupe key precedence mirrors lib/saas/opportunity-store/opportunity-record.mjs:
-- source+source_id when both exist, else normalized URL (lowercased, no
-- query string/fragment, no trailing slash). Conflicts (the same listing seen
-- by multiple tenants) collapse into one global row.
INSERT INTO opportunity_store (
    id, dedupe_key, url_key, source, source_type, source_id, source_url, application_url,
    company, title, description, location, opportunity_type, remote,
    posted_at, deadline, raw_data,
    first_discovered_at, last_seen_at, last_checked_at,
    status, is_active, created_at, updated_at
)
SELECT
    o.id,
    CASE
        WHEN o.source_name IS NOT NULL AND o.source_id IS NOT NULL AND o.source_id <> ''
            THEN 'src:' || lower(o.source_name) || ':' || lower(o.source_id)
        ELSE 'url:' || regexp_replace(regexp_replace(lower(o.url), '[?#].*$', ''), '/+$', '')
    END,
    regexp_replace(regexp_replace(lower(o.url), '[?#].*$', ''), '/+$', ''),
    lower(COALESCE(o.source_name, 'unknown')),
    'UNKNOWN',
    o.source_id,
    o.url,
    o.url,
    COALESCE(o.company_name, 'Unknown'),
    COALESCE(o.title, 'Untitled role'),
    o.description,
    o.location,
    CASE
        WHEN o.opportunity_type IN ('INTERNSHIP', 'JOB') THEN o.opportunity_type
        WHEN o.opportunity_type IN ('CO_OP', 'FELLOWSHIP') THEN 'OTHER'
        ELSE 'UNKNOWN'
    END,
    COALESCE(o.is_remote, FALSE),
    o.posted_date,
    o.deadline,
    COALESCE(o.metadata, '{}'::jsonb),
    COALESCE(o.discovered_at, o.created_at, NOW()),
    COALESCE(o.updated_at, NOW()),
    COALESCE(o.updated_at, NOW()),
    'ACTIVE',
    TRUE,
    COALESCE(o.created_at, NOW()),
    NOW()
FROM opportunities o
WHERE o.url IS NOT NULL
  AND o.deleted_at IS NULL
  AND o.is_demo IS NOT TRUE
ON CONFLICT (dedupe_key) DO NOTHING;
