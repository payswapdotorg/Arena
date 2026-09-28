/**
 * Shared test fixtures for @arena/evaluation (NOT part of the public
 * surface — hygiene.test.ts asserts it is not exported).
 */

import type { CreateEvaluationCriteriaInput, CriterionEntryInput } from './criteria.js';
import type { CreateEvaluatorDescriptorInput } from './descriptor.js';
import type { CriterionVerdictInput } from './record.js';

export const DIGEST_A =
  '1111111111111111111111111111111111111111111111111111111111111111';
export const DIGEST_B =
  '2222222222222222222222222222222222222222222222222222222222222222';
export const DIGEST_C =
  '3333333333333333333333333333333333333333333333333333333333333333';
export const DIGEST_D =
  '4444444444444444444444444444444444444444444444444444444444444444';
export const DIGEST_E =
  '5555555555555555555555555555555555555555555555555555555555555555';
export const DIGEST_F =
  '6666666666666666666666666666666666666666666666666666666666666666';

export const T0 = '2026-01-15T09:30:00.000Z';
export const T1 = '2026-01-15T09:30:01.000Z';
export const T2 = '2026-01-15T09:30:02.000Z';
export const T3 = '2026-01-15T09:30:03.000Z';
export const T4 = '2026-01-15T09:30:04.000Z';
export const T5 = '2026-01-15T09:30:05.000Z';
export const T6 = '2026-01-15T09:30:06.000Z';
export const T7 = '2026-01-15T09:30:07.000Z';

export interface CriteriaOverrides {
  readonly criteriaId?: string;
  readonly version?: string;
  readonly aggregation?: 'weighted-sum' | 'pass-threshold' | 'rubric-level';
  readonly passAt?: number;
  readonly entryCount?: number;
}

export function makeCriteriaEntries(
  count: number,
  targetRef: string = DIGEST_F,
): CriterionEntryInput[] {
  const entries: CriterionEntryInput[] = [];
  for (let index = 0; index < count; index += 1) {
    entries.push({
      criterionId: `criterion-${String(index + 1).padStart(3, '0')}`,
      weight: 1 + index,
      description: `criterion ${String(index + 1)}: expected behavior statement ${String(index + 1)}`,
      targetRef,
    });
  }
  return entries;
}

export function makeCriteriaInput(
  overrides: CriteriaOverrides = {},
): CreateEvaluationCriteriaInput {
  const aggregation = overrides.aggregation ?? 'weighted-sum';
  const passAt =
    overrides.passAt === undefined ? (aggregation === 'rubric-level' ? 4 : 0.75) : overrides.passAt;
  return {
    criteriaId: overrides.criteriaId ?? 'criteria-000042',
    version: overrides.version ?? '1.0.0',
    entries: makeCriteriaEntries(overrides.entryCount ?? 3),
    aggregation,
    thresholds: { passAt },
  };
}

export interface DescriptorOverrides {
  readonly evaluatorId?: string;
  readonly version?: string;
  readonly kind?: string;
  readonly caseRef?: string;
  readonly trajectoryRef?: string;
  readonly bodyRef?: string | null;
  readonly substrateRef?: string | null;
  readonly criteriaRef?: string;
  readonly deterministic?: boolean;
  readonly seeded?: boolean;
  readonly requiresHuman?: boolean;
  readonly confidence?: number;
}

export function makeDescriptorInput(
  overrides: DescriptorOverrides = {},
): CreateEvaluatorDescriptorInput {
  return {
    evaluatorId: overrides.evaluatorId ?? 'eval-000042',
    version: overrides.version ?? '1.0.0',
    kind: overrides.kind ?? 'deterministic-test',
    inputs: {
      caseRef: overrides.caseRef ?? DIGEST_A,
      trajectoryRef: overrides.trajectoryRef ?? DIGEST_B,
      bodyRef: overrides.bodyRef === undefined ? DIGEST_D : overrides.bodyRef,
      substrateRef: overrides.substrateRef === undefined ? DIGEST_E : overrides.substrateRef,
    },
    criteriaRef: overrides.criteriaRef ?? DIGEST_C,
    outputSchema: { namespace: 'evaluation', name: 'evaluation-record', version: '1.0.0' },
    reproducibility: {
      deterministic: overrides.deterministic ?? true,
      seeded: overrides.seeded ?? true,
      requiresHuman: overrides.requiresHuman ?? false,
    },
    confidence: overrides.confidence ?? 0.9,
    limitations: 'reference evaluator; judgments are seeded derivations, not human review',
    provenance: {
      authoredBy: 'arena-reference-fabric',
      submittedAt: T0,
      notes: 'authored by the A012 reference fabric',
    },
  };
}

export interface VerdictOverrides {
  readonly scores?: readonly number[];
  readonly judgment?: string | null;
  readonly notes?: string | null;
}

export function makeVerdicts(
  count: number,
  overrides: VerdictOverrides = {},
): CriterionVerdictInput[] {
  const verdicts: CriterionVerdictInput[] = [];
  for (let index = 0; index < count; index += 1) {
    const fallback = overrides.scores?.[index] ?? 1;
    verdicts.push({
      criterionId: `criterion-${String(index + 1).padStart(3, '0')}`,
      score: fallback,
      judgment: overrides.judgment === undefined ? null : overrides.judgment,
      notes: overrides.notes === undefined ? null : overrides.notes,
    });
  }
  return verdicts;
}

/**
 * Deterministic 32-bit LCG for property tests (Numerical Recipes
 * constants — mirrors @arena/trajectory's TestLcg; kept in test-support
 * because the determinism primitive is A010's owned surface, not this
 * package's).
 */
export class TestLcg {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x2f6e2b1;
  }

  nextUint32(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state;
  }

  next(): number {
    return this.nextUint32() / 2 ** 32;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  bool(): boolean {
    return this.nextUint32() % 2 === 0;
  }
}
