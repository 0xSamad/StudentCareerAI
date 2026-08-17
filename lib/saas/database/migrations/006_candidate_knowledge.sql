-- 006_candidate_knowledge.sql — Per-user Candidate Knowledge Base
-- Documents → chunks → grounded facts. Never a single concatenated prompt.

CREATE TABLE IF NOT EXISTS candidate_documents (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    source_name VARCHAR(255) NULL,
    text TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE NULL
);
CREATE INDEX IF NOT EXISTS idx_cand_docs_user ON candidate_documents(tenant_id, user_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS candidate_chunks (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id VARCHAR(64) NOT NULL REFERENCES candidate_documents(id) ON DELETE CASCADE,
    ordinal INT NOT NULL,
    text TEXT NOT NULL,
    embedding JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cand_chunks_user ON candidate_chunks(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_cand_chunks_doc ON candidate_chunks(document_id);

CREATE TABLE IF NOT EXISTS candidate_facts (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id VARCHAR(64) NULL REFERENCES candidate_documents(id) ON DELETE SET NULL,
    fact_type VARCHAR(50) NOT NULL,
    value TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    snippet TEXT NOT NULL,
    confidence NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_fact_confidence CHECK (confidence >= 0.0 AND confidence <= 1.0)
);
CREATE INDEX IF NOT EXISTS idx_cand_facts_user ON candidate_facts(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_cand_facts_norm ON candidate_facts(tenant_id, user_id, fact_type, normalized_value);
