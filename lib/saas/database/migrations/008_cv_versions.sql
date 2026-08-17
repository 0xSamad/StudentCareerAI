-- 008_cv_versions.sql — Immutable CV version history per application
-- MASTER is always stored. TAILORED only after claim validation passes.

CREATE TABLE IF NOT EXISTS cv_versions (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id VARCHAR(64) NULL,
    opportunity_id VARCHAR(64) NULL,
    kind VARCHAR(20) NOT NULL,
    cv_text TEXT NOT NULL DEFAULT '',
    cv_html TEXT NULL,
    decision JSONB NOT NULL DEFAULT '{}'::jsonb,
    changes JSONB NOT NULL DEFAULT '[]'::jsonb,
    reason TEXT NULL,
    validation JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_cv_version_kind CHECK (kind IN ('MASTER', 'TAILORED', 'REJECTED', 'REUSED'))
);
CREATE INDEX IF NOT EXISTS idx_cv_versions_user_app
  ON cv_versions(tenant_id, user_id, application_id, created_at DESC);
