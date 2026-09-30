/**
 * Reference evaluator + verifier hooks for the Structural Engineer
 * walkthrough: DETERMINISTIC, SEMANTIC checks over the real protocol
 * objects (no live model calls, no Math.random).
 */

import type { EvaluatorHook } from '@arena/evaluation-fabric';
import type { VerifierHook } from '@arena/verification-fabric';

/**
 * The reference structural-engineer evaluator: judges an
 * analysis-correction trajectory against its criteria by REPLAYING the
 * trajectory chain. A criterion scores 1 only when the trajectory
 * demonstrates a completed analysis-correction loop (failing check →
 * load/model correction → green check set).
 */
export function makeStructuralEngineerEvaluator(): EvaluatorHook {
  return (input) => {
    const entries = [...input.trajectoryRecord.entries];
    const completion = entries.find((entry) => entry.kind === 'completion');
    const completed =
      completion !== undefined &&
      (completion.payload as { outcome?: string }).outcome === 'completed';
    const solverRuns = entries.filter(
      (entry) =>
        entry.kind === 'action' &&
        (entry.payload as { actionId?: string }).actionId === 'run-structural-analysis',
    ).length;
    const parameterCorrections = entries.filter(
      (entry) =>
        entry.kind === 'action' &&
        (entry.payload as { actionId?: string }).actionId === 'update-load-model',
    ).length;
    const solverLog = entries
      .filter((entry) => entry.kind === 'observation')
      .map((entry) => String((entry.payload as { content?: unknown }).content ?? ''));
    const sawFailure = solverLog.some((line) => line.includes('failing'));
    const sawGreen = solverLog.some((line) => line.includes('all') && line.includes('passed'));
    const repairLoop =
      sawFailure && sawGreen && solverRuns >= 2 && parameterCorrections >= 1;

    return input.criteria.entries.map((entry) => {
      const score = completed && repairLoop ? 1 : 0;
      return {
        criterionId: entry.criterionId,
        score,
        judgment:
          score === 1
            ? 'completed analysis-correction loop: failing check reproduced, load/model parameters corrected, check set green'
            : 'trajectory does not demonstrate a completed analysis-correction loop',
        notes: null,
      };
    });
  };
}

/** Content shape of the reference compliance-report artifact. */
export interface StructComplianceReportContent {
  readonly suite: string;
  readonly checksRun: number;
  readonly passed: number;
  readonly failures: readonly string[];
  readonly maxUtilization: number;
}

/** Content shape of the reference trajectory-proof artifact. */
export interface StructTrajectoryProofContent {
  readonly chainHead: string;
  readonly outcome: string;
  readonly entryCount: number;
}

/**
 * The reference structural-engineer verifier (constraint_check
 * method): verifies digest-pinned artifacts against the declared
 * requirements. The compliance report must be green (every check
 * passed, no failing checks, maximum utilization within the limit
 * state); the trajectory proof must match the observed chain head and
 * a completed outcome.
 */
export function makeStructuralEngineerVerifier(observed: {
  readonly chainHead: string;
  readonly entryCount: number;
}): VerifierHook {
  return (input) => {
    const content = input.artifact.content as
      | StructComplianceReportContent
      | StructTrajectoryProofContent;
    const requirementId = input.requirement.requirementId;
    if (input.requirement.evidenceKind === 'compliance-report') {
      const report = content as StructComplianceReportContent;
      const green =
        report.suite === 'reference-compliance-suite' &&
        report.checksRun === report.passed &&
        report.failures.length === 0 &&
        report.maxUtilization <= 1;
      return [
        {
          requirementId,
          verdict: green ? 'supported' : 'unsupported',
          notes: green
            ? 'compliance report is green: every limit-state check passed within the utilization limit in the pinned sandbox'
            : 'compliance report contradicts the requirement: failing or over-utilized check set',
        },
      ];
    }
    if (input.requirement.evidenceKind === 'trajectory-proof') {
      const proof = content as StructTrajectoryProofContent;
      const consistent =
        proof.chainHead === observed.chainHead &&
        proof.outcome === 'completed' &&
        proof.entryCount === observed.entryCount;
      return [
        {
          requirementId,
          verdict: consistent ? 'supported' : 'unsupported',
          notes: consistent
            ? 'trajectory proof matches the observed chain head and completed outcome'
            : 'trajectory proof does not match the observed trajectory',
        },
      ];
    }
    return [
      {
        requirementId,
        verdict: 'indeterminate',
        notes: `no reference check implemented for evidence kind ${input.requirement.evidenceKind}`,
      },
    ];
  };
}
