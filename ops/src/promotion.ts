/**
 * Environment promotion workflow (OPS1.0).
 *
 * Promotion may only move ONE tier upward at a time (dev → staging →
 * production). A production promotion requires, fail-closed:
 *
 *   1. the release checklist digest matches the evaluated checklist
 *      and its verdict is 'go';
 *   2. every health-gate evaluation passed (A035 wiring via DEP1.0);
 *   3. the security verdict is 'pass' (A034 gates);
 *   4. at least one named approval is recorded.
 *
 * Missing input is NEVER a pass: an absent checklist evaluation,
 * absent gate results or zero approvals all reject the promotion.
 */

import type { HealthGateEvaluation } from '@arena/deploy';
import { DEPLOY_TIERS, TIER_RANK } from '@arena/deploy';
import type { DeployTier } from '@arena/deploy';
import {
  OPS_ERROR_CODES,
  OPS_SCHEMA_VERSION,
  OpsError,
  isDigestHex,
  isOpsId,
} from './shared.js';

import type { ChecklistEvaluation } from './checklist.js';

/** A typed promotion plan. */
export interface PromotionPlan {
  readonly planVersion: typeof OPS_SCHEMA_VERSION;
  readonly planId: string;
  readonly fromTier: DeployTier;
  readonly toTier: DeployTier;
  /** sha256 digest of the release checklist being executed. */
  readonly checklistDigest: string;
  readonly approvals: readonly string[];
  readonly createdAt: number;
}

export function isPromotionPlan(value: unknown): value is PromotionPlan {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    p['planVersion'] === OPS_SCHEMA_VERSION &&
    isOpsId(p['planId']) &&
    (DEPLOY_TIERS as readonly string[]).includes(String(p['fromTier'])) &&
    (DEPLOY_TIERS as readonly string[]).includes(String(p['toTier'])) &&
    isDigestHex(p['checklistDigest']) &&
    Array.isArray(p['approvals']) &&
    p['approvals'].every((a) => typeof a === 'string' && a.length > 0) &&
    typeof p['createdAt'] === 'number' &&
    Number.isSafeInteger(p['createdAt'])
  );
}

/** Inputs a promotion decision consumes. */
export interface PromotionInput {
  readonly plan: PromotionPlan;
  readonly checklistEvaluation: ChecklistEvaluation | null;
  readonly gateEvaluations: readonly HealthGateEvaluation[] | null;
  readonly securityVerdict: 'pass' | 'fail' | null;
}

/** The frozen result of a promotion decision. */
export interface PromotionDecision {
  readonly planId: string;
  readonly approved: boolean;
  readonly reasons: readonly string[];
}

/** Evaluate one promotion (pure, fail-closed). */
export function evaluatePromotion(input: PromotionInput): PromotionDecision {
  const { plan, checklistEvaluation, gateEvaluations, securityVerdict } = input;
  if (!isPromotionPlan(plan)) {
    throw new OpsError(OPS_ERROR_CODES.INVALID_PROMOTION, 'promotion plan is not a valid OPS1.0 record');
  }
  const reasons: string[] = [];

  // Rule 1: exactly one tier upward.
  if (TIER_RANK[plan.toTier] - TIER_RANK[plan.fromTier] !== 1) {
    throw new OpsError(
      OPS_ERROR_CODES.TIER_SKIP,
      `promotion must move exactly one tier upward (dev→staging→production); got ${plan.fromTier}→${plan.toTier}`,
    );
  }

  // Rule 2: checklist must be present, evaluated, and 'go'.
  if (checklistEvaluation === null) {
    reasons.push('checklist evaluation missing (fail-closed: absent evidence is not a pass)');
  } else if (checklistEvaluation.checklistId.length === 0) {
    reasons.push('checklist evaluation is malformed');
  } else if (checklistEvaluation.verdict !== 'go') {
    reasons.push(
      `checklist verdict is ${checklistEvaluation.verdict} (failed: ${checklistEvaluation.failedRequiredItems.join(', ') || 'n/a'})`,
    );
  }

  // Rule 3: health gates must be present and all passing.
  if (gateEvaluations === null) {
    reasons.push('health-gate evaluations missing (fail-closed: no-data is not a pass)');
  } else {
    const failed = gateEvaluations.filter((evaluation) => !evaluation.passed);
    if (failed.length > 0) {
      reasons.push(
        `health gates failed: ${failed.map((evaluation) => `${evaluation.gateId}(${evaluation.observedVerdict})`).join(', ')}`,
      );
    }
    if (gateEvaluations.length === 0) {
      reasons.push('no health-gate evaluations supplied (fail-closed)');
    }
  }

  // Rule 4: security verdict must be present and 'pass'.
  if (securityVerdict === null) {
    reasons.push('security verdict missing (fail-closed)');
  } else if (securityVerdict !== 'pass') {
    reasons.push(`security verdict is ${securityVerdict}`);
  }

  // Rule 5: at least one named approval.
  if (plan.approvals.length === 0) {
    reasons.push('promotion has zero approvals');
  }

  return { planId: plan.planId, approved: reasons.length === 0, reasons };
}

/** Convenience guard: promotion decisions are Go/No-Go. */
export function isPromotionApproved(decision: PromotionDecision): boolean {
  return decision.approved;
}
