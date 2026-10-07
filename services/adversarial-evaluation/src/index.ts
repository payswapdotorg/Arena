/**
 * The adversarial-evaluation service barrel (Work Order C013).
 */

export {
  AdversarialEvaluationService,
  REFERENCE_GUARDRAIL_POLICY,
} from './service.js';
export type { ServiceDeps, CommandReceipt } from './service.js';
export * from './ports.js';
export {
  CollectingEventSink,
  CollectingResearchSink,
  FixedClock,
  InMemoryCompetitionStore,
  InMemoryJobLog,
  ReferenceCalibration,
  ReferenceEvaluator,
  ReferenceFinalAdjudicator,
  ReferenceVerifier,
  StaticExpertDirectory,
  createReferenceFabric,
} from './fabric.js';
export type {
  CollectedResearchCandidate,
  ReferenceDirectoryInput,
  ReferenceFabric,
} from './fabric.js';
