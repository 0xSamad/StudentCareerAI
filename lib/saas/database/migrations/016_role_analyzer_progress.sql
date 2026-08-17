-- 016_role_analyzer_progress.sql — saved analyses + week/task progress
--
-- Extends Prompt 1 runs so a logged-in student can reopen an analysis and
-- check off weekly tasks. Does not invent skills or market statistics.

ALTER TABLE role_analyzer_runs
    ADD COLUMN IF NOT EXISTS saved BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE role_analyzer_runs
    ADD COLUMN IF NOT EXISTS duration_months NUMERIC(5, 1) NULL;

CREATE INDEX IF NOT EXISTS idx_role_analyzer_runs_saved
    ON role_analyzer_runs (user_id, saved, completed_at DESC);

CREATE TABLE IF NOT EXISTS role_analyzer_progress (
    user_id VARCHAR(64) NOT NULL,
    analysis_id VARCHAR(64) NOT NULL,
    item_key VARCHAR(180) NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, analysis_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_role_analyzer_progress_run
    ON role_analyzer_progress (analysis_id, user_id);
