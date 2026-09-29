/**
 * @arena/compatibility — Body/substrate compatibility engine (Work Order A022;
 * requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4).
 */

// Export all types and functions from the implementation modules
export * from './evaluator.js';
export * from './registry.js';
export * from './shared.js';

// Re-export key types from @arena/agent-body for convenience
export type {
  SubstrateCompatibilityProfile,
  CognitiveSubstrate,
  BodyVersionRef,
} from '@arena/agent-body';

// Export error types
export type { CompatibilityError, CompatibilityErrorCode } from './errors.js';

// Version exports
export { COMPATIBILITY_VERDICTS } from './shared.js';
export type { CompatibilityVerdictKind } from './shared.js';
export type { CompatibilityResult, CompatibilityRecord } from './shared.js';

// Registry exports
export { CompatibilityRegistry, createCompatibilityRegistry } from './registry.js';

// Evaluator exports
export {
  evaluateBodySubstrateCompatibility,
  evaluateMultipleSubstrates,
  isCompatible,
  type CompatibilityEvaluationContext,
  type CompatibilityEvaluationOptions,
} from './evaluator.js';