/**
 * Rollback procedures (OPS1.0), triggered by A035 error-budget
 * policy.
 *
 * A rollback is REQUIRED when any SLO evaluation in the window
 * reports 'breached' or 'no-data', or when an error budget is
 * exhausted — the same fail-closed semantics as A035 policy 3
 * ("missing telemetry is an incident, not a pass"). Zero-budget SLOs
 * (isolation, certification determinism, audit chain) trigger on ANY
 * bad event: `zeroBudgetSloIds` lists them and a single bad sample
 * among their evaluations forces rollback.
 */

import type { SloEvaluation } from '@arena/observability';
import {
  OPS_ERROR_CODES,
  OPS_SCHEMA_VERSION,
  OpsError,
  isOpsId,
} from './shared.js';

/** A typed rollback procedure record. */
export interface RollbackPolicy {
  readonly policyVersion: typeof OPS_SCHEMA_VERSION;
  readonly policyId: string;
  /** SLO ids whose single bad event forces rollback (freeze rule). */
  readonly zeroBudgetSloIds: readonly string[];
  /** The topology version rollback restores. */
  readonly targetTopologyId: string;
  readonly steps: readonly string[];
}

export function isRollbackPolicy(value: unknown): value is RollbackPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r['policyVersion'] === OPS_SCHEMA_VERSION &&
    isOpsId(r['policyId']) &&
    Array.isArray(r['zeroBudgetSloIds']) &&
    r['zeroBudgetSloIds'].every((id) => typeof id === 'string' && id.length > 0) &&
    isOpsId(r['targetTopologyId']) &&
    Array.isArray(r['steps']) &&
    r['steps'].length > 0 &&
    r['steps'].every((step) => typeof step === 'string' && step.length > 0)
  );
}

/** The frozen result of a rollback-trigger evaluation. */
export interface RollbackDecision {
  readonly policyId: string;
  readonly required: boolean;
  readonly reasons: readonly string[];
}

/**
 * Evaluate whether current SLO state forces a rollback (pure).
 * Fail-closed: absent evaluations for zero-budget SLOs also trigger
 * (no-data is an incident).
 */
export function evaluateRollbackTrigger(
  policy: RollbackPolicy,
  sloEvaluations: readonly SloEvaluation[],
): RollbackDecision {
  if (!isRollbackPolicy(policy)) {
    throw new OpsError(
      OPS_ERROR_CODES.INVALID_ROLLBACK_POLICY,
      'rollback policy must be a structurally valid OPS1.0 record',
    );
  }
  const reasons: string[] = [];
  const bySlo = new Map<string, SloEvaluation>();
  for (const evaluation of sloEvaluations) {
    bySlo.set(String(evaluation.sloId), evaluation);
  }

  for (const [sloId, evaluation] of bySlo) {
    if (evaluation.verdict === 'breached') {
      reasons.push(`${sloId}: SLO breached (achieved ${evaluation.achievedRatio} < target ${evaluation.targetRatio})`);
    } else if (evaluation.verdict === 'no-data') {
      reasons.push(`${sloId}: no-data (missing telemetry is an incident — A035 policy 3)`);
    }
    if (evaluation.errorBudget !== undefined && evaluation.errorBudget.exhausted) {
      reasons.push(`${sloId}: error budget exhausted`);
    }
    if (
      policy.zeroBudgetSloIds.includes(sloId) &&
      evaluation.badCount > 0
    ) {
      reasons.push(`${sloId}: zero-budget SLO observed ${evaluation.badCount} bad event(s) — freeze rule`);
    }
  }
  for (const sloId of policy.zeroBudgetSloIds) {
    if (!bySlo.has(sloId)) {
      reasons.push(`${sloId}: zero-budget SLO has NO evaluation in window (fail-closed)`);
    }
  }
  return { policyId: policy.policyId, required: reasons.length > 0, reasons };
}
