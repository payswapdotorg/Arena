/**
 * Reference evaluator + verifier hooks for the A027 epoch capability-gap
 * learning slice: DETERMINISTIC, SEMANTIC checks over the real protocol
 * objects (no live model calls, no Math.random).
 *
 * The gap discipline: the SAME evaluator version (same descriptor
 * digest) judges BOTH experiment arms — the baseline (the gap: the
 * failed trajectory) and the intervention (the completed repair loop).
 * A changed evaluator between arms is an evaluator-version confound
 * (A020 LE1.0) and must yield 'inconclusive-unless-controlled', never
 * a silent "improvement".
 */

import type { EvaluatorHook } from '@arena/evaluation-fabric';
import type { VerifierHook } from '@arena/verification-fabric';

/** Replay a trajectory into the semantic facts the hooks judge on. */
function trajectoryFacts(entries: readonly { kind: string; payload: unknown }[]): {
  readonly completed: boolean;
  readonly testRuns: number;
  readonly sawFailure: boolean;
  readonly sawGreen: boolean;
  readonly repairLoop: boolean;
} {
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
  return { completed, testRuns, sawFailure, sawGreen, repairLoop: sawFailure && sawGreen && testRuns >= 2 };
}

/**
 * The gap evaluator: judges a test-repair trajectory against its
 * criteria by REPLAYING the trajectory chain. Criterion scores are
 * 0/1; the criteria weights (3,1,2) + passAt 0.75 mean a completed
 * repair loop is the ONLY way to meet the criteria.
 */
export function makeGapEvaluator(): EvaluatorHook {
  return (input) => {
    const facts = trajectoryFacts(input.trajectoryRecord.entries);
    return input.criteria.entries.map((entry) => {
      let score = 0;
      let judgment = 'trajectory does not satisfy the criterion';
      if (entry.criterionId === 'criterion-tests-green') {
        score = facts.completed && facts.sawGreen ? 1 : 0;
        judgment =
          score === 1 ? 'suite is green and the run completed' : 'suite is not green at completion';
      } else if (entry.criterionId === 'criterion-reproduction-shown') {
        score = facts.sawFailure ? 1 : 0;
        judgment = score === 1 ? 'the failure was reproduced before the edit' : 'no failure reproduction';
      } else if (entry.criterionId === 'criterion-no-prohibited-shortcuts') {
        score = facts.completed ? 1 : 0;
        judgment =
          score === 1
            ? 'completed without prohibited shortcuts'
            : 'run did not complete — shortcut suspected';
      }
      return { criterionId: entry.criterionId, score, judgment, notes: null };
    });
  };
}

/** Content shape of the reference test-report artifact. */
export interface GapTestReportContent {
  readonly suite: string;
  readonly testsRun: number;
  readonly passed: number;
  readonly failures: readonly string[];
}

/** Content shape of the reference trajectory-proof artifact. */
export interface GapTrajectoryProofContent {
  readonly chainHead: string;
  readonly outcome: string;
  readonly entryCount: number;
}

/**
 * The gap verifier (constraint_check method): verifies digest-pinned
 * artifacts against the declared requirements. The test report must be
 * green; the trajectory proof must match the observed chain head and
 * outcome. The BASELINE (the gap) deliberately presents a RED report
 * and a failed proof — verification must fail closed on it.
 */
export function makeGapVerifier(observed: {
  readonly chainHead: string;
  readonly entryCount: number;
  readonly outcome: 'completed' | 'failed';
}): VerifierHook {
  return (input) => {
    const content = input.artifact.content as GapTestReportContent | GapTrajectoryProofContent;
    const requirementId = input.requirement.requirementId;
    if (input.requirement.evidenceKind === 'test-report') {
      const report = content as GapTestReportContent;
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
      const proof = content as GapTrajectoryProofContent;
      const consistent =
        proof.chainHead === observed.chainHead &&
        proof.outcome === observed.outcome &&
        proof.entryCount === observed.entryCount;
      return [
        {
          requirementId,
          verdict: consistent ? 'supported' : 'unsupported',
          notes: consistent
            ? 'trajectory proof matches the observed chain head and outcome'
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
