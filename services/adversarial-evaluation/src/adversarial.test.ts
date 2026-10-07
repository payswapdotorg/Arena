/**
 * Adversarial minimum (Work Order C013): the five REQUIRED adversarial
 * cases, each against the REAL service on the reference fabric —
 *   1. self-voting attempt;
 *   2. duplicate-account vote inflation;
 *   3. brigading / rate-limit bypass;
 *   4. conflict-of-interest participant attempt;
 *   5. raw-ratio-masquerading-as-verdict (must FAIL CLOSED).
 */

import { describe, expect, it } from 'vitest';

import {
  AdversarialEvaluationService,
  createReferenceFabric,
  type ReferenceDirectoryInput,
} from './index.js';
import { consumeResultAsCertification, deriveCompetitionResult } from '@arena/adversarial-evaluation';
import { DEFAULT_GUARDRAIL_POLICY } from '@arena/adversarial-evaluation';
import { createTestHarness, nextCommandId, TASK, T0 } from './test-support.js';
import { newCompetitionSubmissionId, newJudgementId } from './test-support.js';

async function competitionWithOneSolution(harness: ReturnType<typeof createTestHarness>): Promise<string> {
  const competitionId = harness.competitionId;
  await harness.service.openCompetition({
    commandId: nextCommandId(),
    competitionId,
    tenantId: 'tenant-test',
    task: TASK,
  });
  await harness.service.advanceState({
    commandId: nextCommandId(),
    competitionId,
    tenantId: 'tenant-test',
    target: 'soliciting',
    reason: null,
  });
  await harness.service.submitSolution({
    commandId: nextCommandId(),
    competitionId,
    tenantId: 'tenant-test',
    submissionId: newCompetitionSubmissionId(),
    authorExpertRef: 'expert-alpha',
    evidenceRefs: ['takeoff-alpha-v1'],
  });
  return competitionId;
}

describe('adversarial 1 — self-voting attempt is denied (fail closed)', () => {
  it('the author\'s upvote on their own submission is denied with the typed violation', async () => {
    const harness = createTestHarness();
    const competitionId = await competitionWithOneSolution(harness);
    const aggregate = await harness.service.getCompetition(competitionId, 'tenant-test');
    const submissionId = aggregate.submissions[0]?.submissionId ?? '';
    const receipt = await harness.service.castJudgment({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      judgmentId: newJudgementId(),
      submissionId,
      expertRef: 'expert-alpha',
      type: 'upvote_with_proof',
      claim: 'my own solution is correct',
      evidence: [
        { kind: 'reproduction', evidenceRef: 'runs/self', supportsClaim: 'self reproduction' },
      ],
    });
    expect(receipt.status).toBe('denied');
    expect(receipt.guardrailViolations?.map((violation) => violation.code)).toContain(
      'self-voting-detected',
    );
    // NOTHING was appended.
    const after = await harness.service.getCompetition(competitionId, 'tenant-test');
    expect(after.judgments).toHaveLength(0);
  });
});

describe('adversarial 2 — duplicate-account vote inflation is denied', () => {
  it('a puppet account of the same principal cluster cannot stack a vote', async () => {
    const harness = createTestHarness();
    const competitionId = await competitionWithOneSolution(harness);
    const aggregate = await harness.service.getCompetition(competitionId, 'tenant-test');
    const submissionId = aggregate.submissions[0]?.submissionId ?? '';
    // The real account votes first.
    const first = await harness.service.castJudgment({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      judgmentId: newJudgementId(),
      submissionId,
      expertRef: 'expert-beta',
      type: 'upvote_with_proof',
      claim: 'the takeoff is reproducible',
      evidence: [{ kind: 'test-log', evidenceRef: 'runs/beta', supportsClaim: 'reproduced' }],
    });
    expect(first.status).toBe('recorded');
    // The puppet account (cluster-beta) tries to stack a second vote.
    const puppet = await harness.service.castJudgment({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      judgmentId: newJudgementId(),
      submissionId,
      expertRef: 'expert-beta-puppet',
      type: 'upvote_with_proof',
      claim: 'also correct, surely',
      evidence: [{ kind: 'test-log', evidenceRef: 'runs/puppet', supportsClaim: 'allegedly reproduced' }],
    });
    expect(puppet.status).toBe('denied');
    expect(puppet.guardrailViolations?.map((violation) => violation.code)).toContain(
      'duplicate-account',
    );
    const after = await harness.service.getCompetition(competitionId, 'tenant-test');
    expect(after.judgments).toHaveLength(1);
  });
});

describe('adversarial 3 — brigading / rate-limit bypass is denied', () => {
  it('a rapid-fire judgment burst beyond the window budget is denied', async () => {
    const participants: readonly ReferenceDirectoryInput[] = [
      { expertRef: 'expert-alpha', tenant: 'tenant-test', principalClusterRef: 'c-a', qualified: true },
      { expertRef: 'expert-brigade', tenant: 'tenant-test', principalClusterRef: 'c-b', qualified: true },
    ];
    const fabric = createReferenceFabric({ at: T0, participants });
    const service = new AdversarialEvaluationService({
      clock: fabric.clock,
      store: fabric.store,
      directory: fabric.directory,
      evaluator: fabric.evaluator,
      verifier: fabric.verifier,
      finalAdjudication: fabric.finalAdjudication,
      calibration: fabric.calibration,
      events: fabric.events,
      research: fabric.research,
      jobLog: fabric.jobLog,
      policy: {
        policyVersion: 1,
        minQualifiedVoters: 3,
        minEvidenceItems: 1,
        maxJudgmentsPerExpertPerWindow: 3,
        rateLimitWindowMs: 60_000,
      },
    });
    const competitionId = 'cmp_000000000000000000000000000000aa';
    await service.openCompetition({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      task: TASK,
    });
    await service.advanceState({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      target: 'soliciting',
      reason: null,
    });
    const submissionId = newCompetitionSubmissionId();
    await service.submitSolution({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      submissionId,
      authorExpertRef: 'expert-alpha',
      evidenceRefs: ['takeoff-alpha-v1'],
    });
    // Three rapid judgments are admitted...
    for (let index = 0; index < 3; index += 1) {
      fabric.clock.advance(1_000);
      const receipt = await service.castJudgment({
        commandId: nextCommandId(),
        competitionId,
        tenantId: 'tenant-test',
        judgmentId: newJudgementId(),
        submissionId,
        expertRef: 'expert-brigade',
        type: index === 2 ? 'needs_more_evidence' : 'downvote_with_proof',
        claim: `brigade judgment ${index}`,
        evidence: [{ kind: 'citation', evidenceRef: `brigade-${index}`, supportsClaim: 'noise' }],
      });
      expect(receipt.status).toBe('recorded');
    }
    // ...the fourth inside the window is DENIED (rate-limit-exceeded).
    fabric.clock.advance(1_000);
    const denied = await service.castJudgment({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      judgmentId: newJudgementId(),
      submissionId,
      expertRef: 'expert-brigade',
      type: 'downvote_with_proof',
      claim: 'brigade judgment 4',
      evidence: [{ kind: 'citation', evidenceRef: 'brigade-4', supportsClaim: 'noise' }],
    });
    expect(denied.status).toBe('denied');
    expect(denied.guardrailViolations?.map((violation) => violation.code)).toContain(
      'rate-limit-exceeded',
    );
    // The event sink recorded the typed denial.
    expect(
      fabric.events.events.some(
        (event) => event.type === 'competition.judgment.denied',
      ),
    ).toBe(true);
  });
});

describe('adversarial 4 — conflict-of-interest participant attempt is denied', () => {
  it('a participant who declared a conflict cannot judge the conflicted submission', async () => {
    const participants: readonly ReferenceDirectoryInput[] = [
      { expertRef: 'expert-alpha', tenant: 'tenant-test', principalClusterRef: 'c-a', qualified: true },
      { expertRef: 'expert-conflicted', tenant: 'tenant-test', principalClusterRef: 'c-c', qualified: true, declaredConflicts: ['expert-alpha'] },
    ];
    const harness = createTestHarness(participants);
    const competitionId = await competitionWithOneSolution(harness);
    const aggregate = await harness.service.getCompetition(competitionId, 'tenant-test');
    const submissionId = aggregate.submissions[0]?.submissionId ?? '';
    const receipt = await harness.service.castJudgment({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      judgmentId: newJudgementId(),
      submissionId,
      expertRef: 'expert-conflicted',
      type: 'upvote_with_proof',
      claim: 'no conflict here, surely',
      evidence: [{ kind: 'citation', evidenceRef: 'coi', supportsClaim: 'coi evidence' }],
    });
    expect(receipt.status).toBe('denied');
    expect(receipt.guardrailViolations?.map((violation) => violation.code)).toContain(
      'conflict-of-interest',
    );
    const after = await harness.service.getCompetition(competitionId, 'tenant-test');
    expect(after.judgments).toHaveLength(0);
  });
});

describe('adversarial 5 — raw-ratio-masquerading-as-verdict MUST FAIL CLOSED', () => {
  it('a 100% raw upvote ratio CANNOT produce a verdict when final verification is unknown (fail closed)', async () => {
    const participants: readonly ReferenceDirectoryInput[] = [
      { expertRef: 'expert-alpha', tenant: 'tenant-test', principalClusterRef: 'c-a', qualified: true },
      { expertRef: 'expert-p1', tenant: 'tenant-test', principalClusterRef: 'c-1', qualified: true },
      { expertRef: 'expert-p2', tenant: 'tenant-test', principalClusterRef: 'c-2', qualified: true },
      { expertRef: 'expert-p3', tenant: 'tenant-test', principalClusterRef: 'c-3', qualified: true },
    ];
    const fabric = createReferenceFabric({ at: T0, participants });
    // A host-controlled FINAL VERIFICATION SEAM that cannot establish
    // evidence support (the C009/A013 authority says UNKNOWN).
    const unknownFinalSeam = {
      adjudicateSubmission: async () => ({ outcome: 'unknown' as const, recordDigest: null, stub: false }),
    };
    const service = new AdversarialEvaluationService({
      clock: fabric.clock,
      store: fabric.store,
      directory: fabric.directory,
      evaluator: fabric.evaluator,
      verifier: fabric.verifier,
      finalAdjudication: unknownFinalSeam,
      calibration: fabric.calibration,
      events: fabric.events,
      research: fabric.research,
      jobLog: fabric.jobLog,
    });
    const competitionId = 'cmp_000000000000000000000000000000bb';
    await service.openCompetition({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      task: TASK,
    });
    await service.advanceState({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      target: 'soliciting',
      reason: null,
    });
    const submissionId = newCompetitionSubmissionId();
    await service.submitSolution({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      submissionId,
      authorExpertRef: 'expert-alpha',
      evidenceRefs: ['takeoff-alpha-v1'],
    });
    // Three distinct qualified experts upvote — the RAW RATIO IS 3/3 = 1.0.
    for (const expertRef of ['expert-p1', 'expert-p2', 'expert-p3']) {
      fabric.clock.advance(1_000);
      await service.castJudgment({
        commandId: nextCommandId(),
        competitionId,
        tenantId: 'tenant-test',
        judgmentId: newJudgementId(),
        submissionId,
        expertRef,
        type: 'upvote_with_proof',
        claim: 'the takeoff reproduces',
        evidence: [{ kind: 'reproduction', evidenceRef: `runs/${expertRef}`, supportsClaim: 'reproduced within 2%' }],
      });
    }
    const receipt = await service.runAdjudication({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
    });
    // The final verification seam is UNKNOWN: the competition DEFERS to
    // needs_more_evidence — the perfect raw ratio cannot masquerade as
    // a verdict (fail closed).
    expect(receipt.result?.outcome).toBe('needs_more_evidence');
    expect(receipt.result?.winnerSubmissionId).toBeNull();
    // And the discovery signal is STILL surfaced (labelled, verdict-free).
    const aggregate = await service.getCompetition(competitionId, 'tenant-test');
    expect(aggregate.signals[0]?.ratio).toBe(1);
    expect(aggregate.signals[0]?.label).toBe('discovery-signal');
    expect(aggregate.signals[0]?.smallSample).toBe(false);
  });

  it('consuming a competition result as a certification throws (lock rule 34, no happy path)', () => {
    const result = deriveCompetitionResult({
      competitionId: 'cmp_000000000000000000000000000000cc',
      tenantId: 'tenant-test',
      solutions: [
        {
          submissionId: 'sub_00000000000000000000000000000001',
          authorExpertRef: 'expert-alpha',
          votes: [
            { expertRef: 'p1', direction: 'up', evidenceQuality: 1, calibrationWeight: 1 },
            { expertRef: 'p2', direction: 'down', evidenceQuality: 1, calibrationWeight: 1 },
            { expertRef: 'p3', direction: 'down', evidenceQuality: 1, calibrationWeight: 1 },
          ],
          challenges: [],
          verifierOutcome: { outcome: 'pass', recordDigest: 'd' },
          evaluatorOutcome: { outcome: 'meets-criteria', recordDigest: 'e' },
        },
      ],
      agreementPatterns: [],
      policy: DEFAULT_GUARDRAIL_POLICY,
      now: T0,
    });
    expect(() => consumeResultAsCertification(result)).toThrow(
      /cannot be consumed as a certification/,
    );
  });
});
