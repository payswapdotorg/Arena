/**
 * Integration tests (Work Order C020): the dispute + finding flow over
 * injected C009/C010/C013 fakes on the reference fabric — the anti-gaming
 * detection job over a scripted competition, the fraud detection job over
 * scripted payment audit events, enforcement cases and the reputation
 * reads.
 */

import { describe, expect, it } from 'vitest';
import { toIdempotencyKey } from '@arena/protocol-core';
import { NetworkQualityService, createNetworkQualityFabric } from './index.js';

const AT_MS = Date.parse('2026-10-05T00:00:00.000Z');
const AT = '2026-10-01T12:00:00.000Z';
const DIGEST_A = 'a'.repeat(64);

function t(minutes: number): string {
  return new Date(Date.parse(AT) + minutes * 60 * 1000).toISOString();
}

const OPTIONS = { correlationId: 'corr-1', idempotencyKey: toIdempotencyKey('key-1') };

function payoutEvent(index: number, requestId: string, expertRef: string) {
  const suffix = String(index).padStart(8, '0');
  return {
    eventId: `cevt_${'d'.repeat(24)}${suffix}`,
    kind: 'payment.release.recorded',
    requestId,
    tenantId: 'tenant-1',
    expertRef,
    operationKey: `payop_${'d'.repeat(24)}${suffix}`,
    sequence: index + 1,
    occurredAt: t(index * 30),
    ledgerStateAfter: 'released',
  };
}

describe('the anti-gaming detection job over the C013 fake', () => {
  it('detects a sybil + brigading competition, books conduct-flag evidence, proposes requalification', async () => {
    const fabric = createNetworkQualityFabric(AT_MS);
    const service = new NetworkQualityService(
      fabric.sources,
      fabric.stores,
      fabric.sinks,
      fabric.clock,
    );
    fabric.fakes.voting.add('tenant-1', 'comp-1', {
      participants: [
        { expertRef: 'expert-1', tenant: 'tenant-1', principalClusterRef: 'cluster-a', joinedAt: AT },
        { expertRef: 'expert-2', tenant: 'tenant-1', principalClusterRef: 'cluster-b', joinedAt: AT },
        { expertRef: 'expert-3', tenant: 'tenant-1', principalClusterRef: 'cluster-b', joinedAt: AT },
        { expertRef: 'expert-4', tenant: 'tenant-1', principalClusterRef: 'cluster-c', joinedAt: AT },
        { expertRef: 'expert-5', tenant: 'tenant-1', principalClusterRef: 'cluster-d', joinedAt: AT },
      ],
      submissions: [
        { submissionId: 'sub-1', competitionId: 'comp-1', authorExpertRef: 'expert-1', submittedAt: AT },
      ],
      judgments: [
        { judgmentId: 'judg-1', competitionId: 'comp-1', submissionId: 'sub-1', expertRef: 'expert-2', type: 'upvote_with_proof', recordedAt: t(0) },
        { judgmentId: 'judg-2', competitionId: 'comp-1', submissionId: 'sub-1', expertRef: 'expert-3', type: 'upvote_with_proof', recordedAt: t(3) },
        { judgmentId: 'judg-3', competitionId: 'comp-1', submissionId: 'sub-1', expertRef: 'expert-4', type: 'upvote_with_proof', recordedAt: t(6) },
        { judgmentId: 'judg-4', competitionId: 'comp-1', submissionId: 'sub-1', expertRef: 'expert-5', type: 'upvote_with_proof', recordedAt: t(9) },
      ],
      deniedAttempts: [],
      competitionOutcomes: [
        {
          agreement: 'agreed',
          competitionId: 'comp-1',
          tenantId: 'tenant-1',
          expertRef: 'expert-1',
          taskFamily: 'code-review-arena',
          recordDigest: DIGEST_A,
          observedAt: AT,
        },
      ],
    });

    const run = await service.runAntiGamingDetection(
      { tenant: 'tenant-1', competitionId: 'comp-1' },
      OPTIONS,
    );
    // cluster-b double-votes (sybil) + a 4-cluster upvote brigade
    expect(run.replayed).toBe(false);
    expect(run.findings.length).toBeGreaterThanOrEqual(2);
    expect(run.findings.map((finding) => finding.kind).sort()).toEqual([
      'coordinated-brigading',
      'duplicate-account-sybil',
    ]);
    // conduct-flag reputation evidence booked per finding
    expect(run.reputationRecords).toHaveLength(run.findings.length);
    for (const record of run.reputationRecords) {
      expect(record.family).toBe('conduct-flag');
      expect(record.outcome).toBe('flag-raised');
    }
    // finding-recorded events emitted
    expect(fabric.eventSink.ofSchema('finding-recorded-event')).toHaveLength(run.findings.length);
    // high/critical findings proposed requalification triggers into C004
    expect(fabric.requalificationProposals.proposals.length).toBeGreaterThanOrEqual(1);
    expect(
      fabric.requalificationProposals.proposals.every(
        (proposal) => proposal.trigger === 'anti-gaming-finding',
      ),
    ).toBe(true);

    // the reputation family read returns the conduct-flag records + aggregate
    // (expert-3 is the sybil-inflating account; expert-1 is the brigaded author)
    const family = await service.getReputationFamily(
      { tenant: 'tenant-1', expertId: 'expert-3', family: 'conduct-flag' },
      { correlationId: 'corr-2' },
    );
    expect(family.records.length).toBeGreaterThanOrEqual(1);
    expect(family.aggregateDigest).toMatch(/^[0-9a-f]{64}$/);

    // competition-outcome ingestion books competition-agreement evidence + a C005 proposal
    const outcomeRecords = await service.ingestCompetitionOutcomes(
      { recordId: 'nq-comp-1', tenant: 'tenant-1', competitionId: 'comp-1' },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-2') },
    );
    expect(outcomeRecords).toHaveLength(1);
    expect(outcomeRecords[0]?.family).toBe('competition-agreement');
    expect(fabric.profileEvidenceProposals.proposals.length).toBe(1);

    // IDEMPOTENT JOB: re-running replays the same findings verbatim
    const rerun = await service.runAntiGamingDetection(
      { tenant: 'tenant-1', competitionId: 'comp-1' },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-3') },
    );
    expect(rerun.replayed).toBe(true);
    expect(rerun.findings.map((finding) => finding.findingId).sort()).toEqual(
      run.findings.map((finding) => finding.findingId).sort(),
    );
    // no duplicate findings were stored
    const all = await service.listFindings('tenant-1', { correlationId: 'corr-3' });
    expect(all).toHaveLength(run.findings.length);
  });
});

describe('the fraud detection job over the C010 fake', () => {
  it('detects a duplicate payout, opens an enforcement case and walks it to CLOSED', async () => {
    const fabric = createNetworkQualityFabric(AT_MS);
    const service = new NetworkQualityService(
      fabric.sources,
      fabric.stores,
      fabric.sinks,
      fabric.clock,
    );
    fabric.fakes.payoutAudit.add([
      payoutEvent(1, 'req-1', 'expert-1'),
      payoutEvent(2, 'req-1', 'expert-1'),
      payoutEvent(3, 'req-2', 'expert-1'),
    ]);

    const run = await service.runFraudDetection(
      { tenant: 'tenant-1', sinceMs: Date.parse(AT) - 1000 },
      OPTIONS,
    );
    expect(run.findings).toHaveLength(1);
    const finding = run.findings[0];
    expect(finding?.kind).toBe('duplicate-payout-attempt');
    expect(finding?.severity).toBe('critical');
    expect(fabric.requalificationProposals.proposals).toHaveLength(1);

    // the finding's HOLD proposal becomes an explicit enforcement case
    const theCase = await service.openEnforcement(
      {
        caseId: 'nq-case-1',
        tenant: 'tenant-1',
        subjectParty: finding?.subjectParty ?? 'expert-1',
        sourceFindingDigests: [finding?.digest ?? DIGEST_A],
        proposedAction: 'HOLD',
        actorParty: 'operator-1',
        reason: 'duplicate payout attempt',
      },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-2') },
    );
    expect(theCase.state).toBe('ACTION_PROPOSED');
    const active = await service.transitionEnforcement(
      {
        caseId: 'nq-case-1',
        tenant: 'tenant-1',
        to: 'ACTION_ACTIVE',
        actorParty: 'operator-1',
        reason: 'payouts held pending investigation',
      },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-3') },
    );
    expect(active.state).toBe('ACTION_ACTIVE');
    const closed = await service.transitionEnforcement(
      {
        caseId: 'nq-case-1',
        tenant: 'tenant-1',
        to: 'CLOSED',
        actorParty: 'operator-2',
        reason: 'investigation closed',
      },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-4') },
    );
    expect(closed.state).toBe('CLOSED');
    expect(closed.auditHistory).toHaveLength(3);
    expect(fabric.eventSink.ofSchema('enforcement-updated-event')).toHaveLength(3);
  });
});

describe('the full dispute flow over the C009 fake', () => {
  it('a disputed C009 outcome resolves through the service with retained audit history', async () => {
    const fabric = createNetworkQualityFabric(AT_MS);
    const service = new NetworkQualityService(
      fabric.sources,
      fabric.stores,
      fabric.sinks,
      fabric.clock,
    );
    fabric.fakes.validationOutcomes.add(
      { tenant: 'tenant-1', requestId: 'req-1', refDigest: DIGEST_A },
      {
        verdict: 'rejected',
        requestId: 'req-1',
        tenantId: 'tenant-1',
        expertRef: 'expert-1',
        taskFamily: 'bug-fix-review',
        recordDigest: DIGEST_A,
        observedAt: '2026-10-01T00:00:00.000Z',
      },
    );
    // the disputed outcome is ingested as dimensional evidence first
    await service.ingestValidationOutcome(
      { recordId: 'nq-rep-1', tenant: 'tenant-1', requestId: 'req-1', expertRef: 'expert-1', refDigest: DIGEST_A },
      OPTIONS,
    );
    // then the dispute over it is opened, reviewed and resolved
    await service.openDispute(
      {
        disputeId: 'nq-dispute-1',
        tenant: 'tenant-1',
        complainantParty: 'expert-1',
        respondentParty: 'expert-2',
        subjects: [{ kind: 'validation-verdict', refId: 'req-1', refDigest: DIGEST_A }],
        summary: 'the rejected verdict is disputed',
      },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-2') },
    );
    await service.transitionDispute(
      {
        disputeId: 'nq-dispute-1',
        tenant: 'tenant-1',
        to: 'UNDER_REVIEW',
        reasons: ['reviewer-assigned'],
        reviewerParty: 'reviewer-5',
      },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-3') },
    );
    const resolved = await service.transitionDispute(
      {
        disputeId: 'nq-dispute-1',
        tenant: 'tenant-1',
        to: 'RESOLVED',
        reasons: ['resolved-on-evidence'],
        reviewerParty: 'reviewer-5',
        resolutionOutcome: 'partially-upheld',
      },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-4') },
    );
    expect(resolved.resolutionOutcome).toBe('partially-upheld');
    expect(resolved.history).toHaveLength(3);
    const family = await service.getReputationFamily(
      { tenant: 'tenant-1', expertId: 'expert-1', family: 'validation-outcome' },
      { correlationId: 'corr-2' },
    );
    expect(family.records).toHaveLength(1);
    expect(family.records[0]?.outcome).toBe('rejected');
  });
});
