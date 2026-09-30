/**
 * Reference evaluator + verifier hooks for the Software Engineer
 * walkthrough: DETERMINISTIC, SEMANTIC checks over the real protocol
 * objects (no live model calls, no Math.random).
 */

import type { EvaluatorHook } from '@arena/evaluation-fabric';
import type { VerifierHook } from '@arena/verification-fabric';

/**
 * The reference software-engineer evaluator: judges a test-repair
 * trajectory against its criteria by REPLAYING the trajectory chain.
 * A criterion scores 1 only when the trajectory demonstrates a
 * completed test-repair loop (failing suite → edit → green suite).
 */
export function makeSoftwareEngineerEvaluator(): EvaluatorHook {
  return (input) => {
    const entries = [...input.trajectoryRecord.entries];
    const completion = entries.find((entry) => entry.kind === 'completion');
    const completed =
      completion !== undefined &&
      (completion.payload as { outcome?: string }).outcome === 'completed';
    const testRuns = entries.filter(
      (entry) =>
        entry.kind === 'action' &&
        (entry.payload as { actionId?: string }).actionId === 'run-test-suite',
    ).length;
    const stdout = entries
      .filter((entry) => entry.kind === 'observation')
      .map((entry) => String((entry.payload as { content?: unknown }).content ?? ''));
    const sawFailure = stdout.some((line) => line.includes('failing'));
    const sawGreen = stdout.some((line) => line.includes('all') && line.includes('passed'));
    const repairLoop = sawFailure && sawGreen && testRuns >= 2;

    return input.criteria.entries.map((entry) => {
      const score = completed && repairLoop ? 1 : 0;
      return {
        criterionId: entry.criterionId,
        score,
        judgment:
          score === 1
            ? 'completed repair loop: failing suite reproduced, edit applied, suite green'
            : 'trajectory does not demonstrate a completed test-repair loop',
        notes: null,
      };
    });
  };
}

/** Content shape of the reference test-report artifact. */
export interface SeTestReportContent {
  readonly suite: string;
  readonly testsRun: number;
  readonly passed: number;
  readonly failures: readonly string[];
}

/** Content shape of the reference trajectory-proof artifact. */
export interface SeTrajectoryProofContent {
  readonly chainHead: string;
  readonly outcome: string;
  readonly entryCount: number;
}

/**
 * The reference software-engineer verifier (constraint_check method):
 * verifies digest-pinned artifacts against the declared requirements.
 * The test report must be green; the trajectory proof must match the
 * observed chain head and a completed outcome.
 */
export function makeSoftwareEngineerVerifier(observed: {
  readonly chainHead: string;
  readonly entryCount: number;
}): VerifierHook {
  return (input) => {
    const content = input.artifact.content as
      | SeTestReportContent
      | SeTrajectoryProofContent;
    const requirementId = input.requirement.requirementId;
    if (input.requirement.evidenceKind === 'test-report') {
      const report = content as SeTestReportContent;
      const green =
        report.suite === 'reference-repair-suite' &&
        report.testsRun === report.passed &&
        report.failures.length === 0;
      return [
        {
          requirementId,
          verdict: green ? 'supported' : 'unsupported',
          notes: green
            ? 'test report is green: every declared test passed in the pinned sandbox'
            : 'test report contradicts the requirement: failing or incomplete suite',
        },
      ];
    }
    if (input.requirement.evidenceKind === 'trajectory-proof') {
      const proof = content as SeTrajectoryProofContent;
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
