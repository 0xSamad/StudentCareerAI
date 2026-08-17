-- 009_cover_letter_versions.sql — Cover letter decision history per job
-- SKIPPED when not needed. GENERATED only after claim validation.

CREATE TABLE IF NOT EXISTS cover_letter_versions (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id VARCHAR(64) NULL,
    job_id VARCHAR(64) NULL,
    kind VARCHAR(20) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    cover_letter TEXT NULL,
    subject_line TEXT NULL,
    source_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    requirement VARCHAR(20) NULL,
    reason TEXT NULL,
    validation JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_cover_letter_kind CHECK (kind IN ('SKIPPED', 'GENERATED', 'REJECTED', 'EDITED'))
);
CREATE INDEX IF NOT EXISTS idx_cover_letter_versions_user_job
  ON cover_letter_versions(tenant_id, user_id, job_id, created_at DESC);
