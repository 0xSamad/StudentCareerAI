-- 014_application_queue_states.sql — Queue machine states the apply workflow writes.
-- Postgres was rejecting SKIPPED and COVER_LETTER_PREPARATION (UPDATE still
-- reports "new row ... violates check constraint chk_app_state").

ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS chk_app_state;

ALTER TABLE applications
  ADD CONSTRAINT chk_app_state CHECK (state IN (
    'DISCOVERED', 'ELIGIBILITY_CHECK', 'NOT_ELIGIBLE', 'REQUIRES_REVIEW', 'ELIGIBLE',
    'MATCHED', 'SELECTED', 'ANALYZING', 'CV_PREPARATION', 'COVER_LETTER_PREPARATION',
    'APPLICATION_PREPARATION', 'CV_GENERATED', 'APPLICATION_READY', 'READY',
    'APPLYING', 'SUBMITTED', 'FAILED', 'BLOCKED', 'DRY_RUN', 'PREPARED',
    'REQUIRES_USER_INPUT', 'DRY_RUN_COMPLETED', 'APPLIED', 'INTERVIEWING',
    'OFFER', 'REJECTED', 'PAUSED', 'ERROR', 'SKIPPED', 'CLOSED'
  ));
