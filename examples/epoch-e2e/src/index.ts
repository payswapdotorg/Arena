/**
 * @arena/example-epoch-e2e — the A027 reference end-to-end
 * capability-gap learning slice (public surface).
 */

export {
  SCENARIO,
  keyOf,
  correlationOf,
  fixedClock,
  buildReferenceSubstrate,
  buildReferenceVertical,
  buildTargetCapabilityNode,
  buildEpochGapRequest,
} from './fixtures.js';

export {
  makeGapEvaluator,
  makeGapVerifier,
} from './hooks.js';
export type { GapTestReportContent, GapTrajectoryProofContent } from './hooks.js';

export {
  buildBaselineTrajectory,
  buildInterventionTrajectory,
  runEpochCapabilityGapLoop,
  receiptDigests,
} from './walkthrough.js';
export type { GapScenarioReceipt } from './walkthrough.js';
