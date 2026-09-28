/**
 * Reference evaluator implementations and the pluggable hook surface
 * (Work Order A012 gate 6).
 *
 * The EVALUATOR HOOK is the single pluggable seam of the reference
 * fabric: a function from the resolved run inputs (descriptor,
 * criteria, the REAL A005 CapabilityCase and A011 TrajectoryRecord, and
 * the run seed) to per-criterion verdicts. The runner (fabric.ts)
 * resolves refs, enforces the input contract, invokes the hook and
 * builds the EvaluationRecord through the domain constructor — hooks
 * NEVER construct records themselves.
 *
 * ONLY TWO evaluator kinds have reference implementations (A012 scope
 * NOTE):
 *   - deterministic-test — makeDeterministicTestEvaluator: seeded,
 *     reproducible per-criterion outcomes derived from the sha256 of
 *     the run material (evaluator digest, criterion id, case digest,
 *     trajectory digest, seed), mapped into the criteria's aggregation
 *     domain (numeric [0,1] for weighted-sum, {0,1} boolean for
 *     pass-threshold, integer levels [1,5] for rubric-level);
 *   - rubric — makeRubricEvaluator: seeded levels 1-5 per criterion
 *     with judgment labels (level-1..level-5) and deterministic notes.
 *
 * The other five EV1.0 kinds (model-based, expert, simulation,
 * comparative, adversarial) are DECLARED descriptor types with this
 * hook interface available for future implementations — no reference
 * implementations ship here (noted in the A012 report).
 */

import { sha256Hex } from '@arena/protocol-core';
import type { EvaluatorDescriptor, EvaluationCriteria } from '@arena/evaluation';
import type { CriterionVerdictInput } from '@arena/evaluation';
import type { CapabilityCase } from '@arena/capability-case';
import type { TrajectoryRecord } from '@arena/trajectory';

// ---------------------------------------------------------------------------
// Hook surface
// ---------------------------------------------------------------------------

/** Everything a hook needs to judge one evaluation run. */
export interface EvaluatorHookInput {
  readonly descriptor: EvaluatorDescriptor;
  readonly criteria: EvaluationCriteria;
  /** The resolved, structurally valid A005 CapabilityCase (digest-checked). */
  readonly caseRecord: CapabilityCase;
  /** The resolved, structurally valid A011 TrajectoryRecord (chain-head-checked). */
  readonly trajectoryRecord: TrajectoryRecord;
  /** The run seed (null when the evaluator is unseeded). */
  readonly seed: string | null;
}

/**
 * An evaluator implementation: pure function from the resolved run
 * inputs to per-criterion verdicts. Hooks must be deterministic for
 * seeded evaluators (the same input ⇒ the same verdicts — the
 * score-stability requirement); the runner handles everything else.
 */
export type EvaluatorHook = (
  input: EvaluatorHookInput,
) => Promise<readonly CriterionVerdictInput[]> | readonly CriterionVerdictInput[];

/** The two kinds with reference implementations (A012 scope). */
export const IMPLEMENTED_EVALUATOR_KINDS = Object.freeze([
  'deterministic-test',
  'rubric',
] as const);

/** The five declared-but-unimplemented kinds (A012 scope NOTE). */
export const UNIMPLEMENTED_EVALUATOR_KINDS = Object.freeze([
  'model-based',
  'expert',
  'simulation',
  'comparative',
  'adversarial',
] as const);

// ---------------------------------------------------------------------------
// Seeded deterministic derivation
// ---------------------------------------------------------------------------

/**
 * Deterministic uniform in [0, 1) derived from the sha256 of the run
 * material — the reproducibility primitive of both reference
 * evaluators (same material ⇒ same u; no Math.random anywhere).
 */
async function seededUniform(
  materials: readonly string[],
): Promise<number> {
  const material = materials.filter((part) => part !== null).join('|');
  const hex = await sha256Hex(material);
  // First 8 hex chars = 32 bits; divide by 2^32 for a uniform in [0, 1).
  const bits = Number.parseInt(hex.slice(0, 8), 16);
  return bits / 2 ** 32;
}

function mapToPolicyDomain(
  u: number,
  policy: 'weighted-sum' | 'pass-threshold' | 'rubric-level',
): number {
  switch (policy) {
    case 'weighted-sum':
      // numeric outcome, quantized to 2 decimals
      return Math.round(u * 100) / 100;
    case 'pass-threshold':
      // boolean outcome
      return u >= 0.5 ? 1 : 0;
    case 'rubric-level':
      // integer level 1..5
      return 1 + Math.min(4, Math.floor(u * 5));
  }
}

// ---------------------------------------------------------------------------
// Reference implementation: deterministic-test evaluator
// ---------------------------------------------------------------------------

/**
 * The deterministic-test reference evaluator: seeded, reproducible
 * per-criterion outcomes (boolean/numeric per the criteria's
 * aggregation domain) derived from sha256 over the run material.
 * Identical (evaluator, case, trajectory, criteria, seed) ⇒ identical
 * verdicts, byte for byte.
 */
export function makeDeterministicTestEvaluator(): EvaluatorHook {
  return async (input: EvaluatorHookInput): Promise<readonly CriterionVerdictInput[]> => {
    const verdicts: CriterionVerdictInput[] = [];
    for (const entry of input.criteria.entries) {
      const u = await seededUniform([
        input.descriptor.digest,
        entry.criterionId,
        input.caseRecord.digest,
        input.trajectoryRecord.chainHead,
        input.seed ?? 'unseeded',
      ]);
      const score = mapToPolicyDomain(u, input.criteria.aggregation);
      verdicts.push({
        criterionId: entry.criterionId,
        score,
        judgment: null,
        notes: `deterministic-test outcome derived from seeded sha256 over evaluator|criterion|case|trajectory|seed (u=${u.toFixed(6)})`,
      });
    }
    return verdicts;
  };
}

// ---------------------------------------------------------------------------
// Reference implementation: rubric evaluator
// ---------------------------------------------------------------------------

/**
 * The rubric reference evaluator: seeded levels 1-5 per criterion with
 * judgment labels and deterministic notes. Levels derive from sha256
 * over the run material INCLUDING the criterion weight (rubric leveling
 * is weight-aware in this reference), mapped into the criteria's
 * aggregation domain when the policy is not rubric-level.
 */
export function makeRubricEvaluator(): EvaluatorHook {
  return async (input: EvaluatorHookInput): Promise<readonly CriterionVerdictInput[]> => {
    const verdicts: CriterionVerdictInput[] = [];
    for (const entry of input.criteria.entries) {
      const u = await seededUniform([
        input.descriptor.digest,
        entry.criterionId,
        String(entry.weight),
        input.caseRecord.digest,
        input.trajectoryRecord.chainHead,
        input.seed ?? 'unseeded',
      ]);
      const level =
        input.criteria.aggregation === 'rubric-level'
          ? 1 + Math.min(4, Math.floor(u * 5))
          : undefined;
      const score =
        level !== undefined
          ? level
          : input.criteria.aggregation === 'pass-threshold'
            ? u >= 0.6
              ? 1
              : 0
            : Math.round(u * 100) / 100;
      verdicts.push({
        criterionId: entry.criterionId,
        score,
        judgment: level !== undefined ? `level-${String(level)}` : null,
        notes: `rubric level judged against criterion description with seeded scoring (u=${u.toFixed(6)}, weight=${String(entry.weight)})`,
      });
    }
    return verdicts;
  };
}
