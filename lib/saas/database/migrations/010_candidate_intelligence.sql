-- 010_candidate_intelligence.sql — Long-term Candidate Intelligence Profile
-- Feedback events are append-only. AI-generated drafts are never stored as facts.

CREATE TABLE IF NOT EXISTS candidate_intelligence_profiles (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cand_intel_user UNIQUE (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cand_intel_user
  ON candidate_intelligence_profiles(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS candidate_feedback_events (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(40) NOT NULL,
    field VARCHAR(120) NULL,
    previous_value TEXT NULL,
    new_value TEXT NULL,
    question TEXT NULL,
    proposed_answer TEXT NULL,
    corrected_answer TEXT NULL,
    verdict VARCHAR(20) NULL,
    opportunity_id VARCHAR(128) NULL,
    company VARCHAR(255) NULL,
    authority VARCHAR(30) NOT NULL DEFAULT 'USER_SUPPLIED',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_feedback_kind CHECK (kind IN (
      'CORRECTION', 'PREFERENCE', 'ANSWER_APPROVED', 'ANSWER_REJECTED',
      'ANSWER_CORRECTED', 'INTERVIEW_NOTE', 'CONFIRMATION', 'PROFILE_SYNC'
    )),
    CONSTRAINT chk_feedback_authority CHECK (authority IN (
      'USER_SUPPLIED', 'TRUSTED_DOCUMENT', 'USER_CONFIRMED', 'GENERATED'
    ))
);
CREATE INDEX IF NOT EXISTS idx_cand_feedback_user
  ON candidate_feedback_events(tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cand_feedback_kind
  ON candidate_feedback_events(tenant_id, user_id, kind);
