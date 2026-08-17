-- 007_candidate_fact_attribution.sql — Source, evidence, timestamp, verification
-- Uncertain enrichment must not be stored as verified fact.

ALTER TABLE candidate_facts
  ADD COLUMN IF NOT EXISTS source VARCHAR(160) NOT NULL DEFAULT 'user_document',
  ADD COLUMN IF NOT EXISTS source_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS evidence TEXT NULL,
  ADD COLUMN IF NOT EXISTS observed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) NOT NULL DEFAULT 'VERIFIED';

ALTER TABLE candidate_facts
  DROP CONSTRAINT IF EXISTS chk_fact_verification;

ALTER TABLE candidate_facts
  ADD CONSTRAINT chk_fact_verification CHECK (verification_status IN ('VERIFIED', 'UNCERTAIN', 'UNKNOWN'));

UPDATE candidate_facts
   SET evidence = snippet
 WHERE evidence IS NULL;
