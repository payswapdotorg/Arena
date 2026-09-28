/**
 * @arena/evaluation-fabric — the in-process REFERENCE EVALUATOR FABRIC
 * for Arena evaluation (Work Order A012 gate 6; requirements R12, R23;
 * spec EV1.0; docs/architecture.md §5, §18).
 *
 * Pure TypeScript, ZERO external runtime dependencies: only
 * @arena/protocol-core, @arena/evaluation and the two judged-object
 * domain packages (@arena/capability-case, @arena/trajectory — their
 * real structural guards anchor the input contract to the REAL
 * packages).
 *
 * Surface:
 *   - EvaluatorRegistry — register evaluators (descriptor + hook) and
 *     criteria, idempotent by digest; duplicate id+version with
 *     different bytes is an identity conflict (the quality model's
 *     evaluator-versioning rule); queries by kind/case;
 *   - EvaluationFabric — the reference runner + record ledger:
 *     `evaluate(evaluatorRef, caseRecord, trajectoryRecord, options)`
 *     = resolve refs → enforce the input contract → invoke the hook →
 *     build the frozen, content-addressed EvaluationRecord; idempotent
 *     by run key (lock rule 17); queries by digest / case /
 *     trajectory / time range;
 *   - reference evaluator implementations for exactly TWO EV1.0
 *     kinds — deterministic-test and rubric (seeded, reproducible);
 *     model-based / expert / simulation / comparative / adversarial
 *     are declared descriptor types with pluggable hooks and NO
 *     implementations (A012 scope NOTE).
 */

export * from './evaluators.js';
export * from './registry.js';
export * from './fabric.js';

import { EvaluationFabric } from './fabric.js';

/** Factory: a fresh, empty in-process reference fabric. */
export function createEvaluationFabric(): EvaluationFabric {
  return new EvaluationFabric();
}
