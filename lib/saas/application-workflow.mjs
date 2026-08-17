/**
 * application-workflow.mjs — Independent per-opportunity apply workflow.
 *
 * Implementation lives in ApplicationOrchestrator. This module keeps the
 * previous import path stable for queue, APIs, and tests.
 */

export {
  WORKFLOW_STATUS,
  SKIP_REASON,
  deadlineHasPassed,
  findDuplicateApplication,
  summarizeWorkflowOutcome,
  summarizeBatch,
  readAutoApply,
  runApplicationWorkflow,
  runApplicationBatch,
  ApplicationOrchestrator,
  applyEligibilitySafety,
  applySubmitSafety,
  applyKnowledgeSafety,
  retrySafely,
  USER_STAGE,
  userFacingStage,
  STEP,
} from "./application-orchestrator.mjs";
