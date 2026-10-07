/**
 * Service unit tests (Work Order C020): dispute lifecycle through the
 * service boundary, COI registry + the typed check, validation-outcome
 * ingestion with fail-closed provenance, idempotent command replay.
 */

import { describe, expect, it } from 'vitest';
import { toIdempotencyKey } from '@arena/protocol-core';
import { NETWORK_QUALITY_ERROR_CODES } from '@arena/network-quality';
import { NetworkQualityService, createNetworkQualityFabric } from './index.js';

const AT_MS = Date.parse('2026-10-05T00:00:00.000Z');
const DIGEST_A = 'a'.repeat(64);

const OPTIONS = { correlationId: 'corr-1', idempotencyKey: toIdempotencyKey('key-1') };

function makeService() {
  const fabric = createNetworkQualityFabric(AT_MS);
  return {
    service: new NetworkQualityService(fabric.sources, fabric.stores, fabric.sinks, fabric.clock),
    fabric,
  };
}

describe('the dispute lifecycle through the service', () => {
  it('opens, reviews and resolves with events + idempotent replay', async () => {
    const { service, fabric } = makeService();
    const opened = await service.openDispute(
      {
        disputeId: 'nq-dispute-1',
        tenant: 'tenant-1',
        complainantParty: 'expert-1',
        respondentParty: 'expert-2',
        subjects: [{ kind: 'validation-verdict', refId: 'av_1', refDigest: null }],
        summary: 'disputed verdict',
      },
      OPTIONS,
    );
    expect(opened.state).toBe('OPEN');

    // idempotent replay: the same key returns the same record verbatim
    const replay = await service.openDispute(
      {
        disputeId: 'nq-dispute-1',
        tenant: 'tenant-1',
        complainantParty: 'expert-1',
        respondentParty: 'expert-2',
        subjects: [{ kind: 'validation-verdict', refId: 'av_1', refDigest: null }],
        summary: 'disputed verdict',
      },
      OPTIONS,
    );
    expect(replay.digest).toBe(opened.digest);

    const reviewed = await service.transitionDispute(
      {
        disputeId: 'nq-dispute-1',
        tenant: 'tenant-1',
        to: 'UNDER_REVIEW',
        reasons: ['reviewer-assigned'],
        reviewerParty: 'reviewer-1',
      },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-2') },
    );
    expect(reviewed.state).toBe('UNDER_REVIEW');
    expect(reviewed.reviewerParty).toBe('reviewer-1');

    const resolved = await service.transitionDispute(
      {
        disputeId: 'nq-dispute-1',
        tenant: 'tenant-1',
        to: 'RESOLVED',
        reasons: ['resolved-on-evidence'],
        reviewerParty: 'reviewer-1',
        resolutionOutcome: 'upheld',
      },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-3') },
    );
    expect(resolved.state).toBe('RESOLVED');
    expect(resolved.resolutionOutcome).toBe('upheld');
    expect(resolved.history).toHaveLength(3);

    const disputeEvents = fabric.eventSink.ofSchema('dispute-transitioned-event');
    expect(disputeEvents).toHaveLength(2);
  });

  it('cross-tenant dispute reads fail closed', async () => {
    const { service } = makeService();
    await service.openDispute(
      {
        disputeId: 'nq-dispute-2',
        tenant: 'tenant-1',
        complainantParty: 'expert-1',
        respondentParty: 'expert-2',
        subjects: [{ kind: 'escalation-request', refId: 'req-1', refDigest: null }],
        summary: 'x',
      },
      OPTIONS,
    );
    await expect(
      service.getDispute('nq-dispute-2', 'tenant-2', { correlationId: 'corr-2' }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.NOT_FOUND });
  });

  it('an idempotency key bound to a different command fails closed', async () => {
    const { service } = makeService();
    await service.openDispute(
      {
        disputeId: 'nq-dispute-3',
        tenant: 'tenant-1',
        complainantParty: 'expert-1',
        respondentParty: 'expert-2',
        subjects: [{ kind: 'escalation-request', refId: 'req-1', refDigest: null }],
        summary: 'x',
      },
      OPTIONS,
    );
    await expect(
      service.openDispute(
        {
          disputeId: 'nq-dispute-4',
          tenant: 'tenant-1',
          complainantParty: 'expert-1',
          respondentParty: 'expert-3',
          subjects: [{ kind: 'escalation-request', refId: 'req-2', refDigest: null }],
          summary: 'different command',
        },
        OPTIONS,
      ),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.IDEMPOTENCY_CONFLICT });
  });
});

describe('the COI registry + typed check through the service', () => {
  it('registers, checks (conflicted-with-reasons) and retracts', async () => {
    const { service, fabric } = makeService();
    await service.registerCoi(
      {
        coiId: 'nq-coi-1',
        tenant: 'tenant-1',
        party: 'expert-1',
        counterparty: 'expert-2',
        kind: 'prior-engagement',
        origin: 'declared',
        scope: 'software',
      },
      OPTIONS,
    );
    const conflicted = await service.checkCoi(
      { tenant: 'tenant-1', party: 'expert-1', counterparty: 'expert-2' },
      { correlationId: 'corr-2' },
    );
    expect(conflicted.verdict).toBe('conflicted-with-reasons');
    expect(conflicted.reasons).toHaveLength(1);

    const retracted = await service.retractCoi(
      { coiId: 'nq-coi-1', tenant: 'tenant-1', reason: 'clarified' },
      { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-2') },
    );
    expect(retracted.status).toBe('RETRACTED');

    const cleared = await service.checkCoi(
      { tenant: 'tenant-1', party: 'expert-1', counterparty: 'expert-2' },
      { correlationId: 'corr-3' },
    );
    expect(cleared.verdict).toBe('clear');
    expect(fabric.eventSink.ofSchema('coi-check-response')).toHaveLength(2);
  });

  it('an empty registry checks to unknown-insufficient-data (never a silent pass)', async () => {
    const { service } = makeService();
    const result = await service.checkCoi(
      { tenant: 'tenant-1', party: 'expert-1', counterparty: 'expert-2' },
      { correlationId: 'corr-1' },
    );
    expect(result.verdict).toBe('unknown-insufficient-data');
  });
});

describe('validation-outcome ingestion (the C009 seam)', () => {
  it('ingests a provenance-verified C009 outcome and proposes profile evidence (AQ-1)', async () => {
    const { service, fabric } = makeService();
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
    const record = await service.ingestValidationOutcome(
      { recordId: 'nq-rep-1', tenant: 'tenant-1', requestId: 'req-1', expertRef: 'expert-1', refDigest: DIGEST_A },
      OPTIONS,
    );
    expect(record.family).toBe('validation-outcome');
    expect(record.outcome).toBe('rejected');
    // the proposal surfaced to the C005 seam
    expect(fabric.profileEvidenceProposals.proposals).toHaveLength(1);
    expect(fabric.profileEvidenceProposals.proposals[0]?.targetFamily).toBe('expert-match-history');
    expect(fabric.profileEvidenceProposals.proposals[0]?.targetDimension).toBe('review-outcome');
    expect(fabric.eventSink.ofSchema('profile-evidence-proposal-event')).toHaveLength(1);
  });

  it('fabricated provenance (unresolved digest) fails closed', async () => {
    const { service } = makeService();
    await expect(
      service.ingestValidationOutcome(
        { recordId: 'nq-rep-2', tenant: 'tenant-1', requestId: 'req-404', expertRef: 'expert-1', refDigest: DIGEST_A },
        OPTIONS,
      ),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE });
  });

  it('the same C009 digest cannot book twice (evidence-replay defense)', async () => {
    const { service, fabric } = makeService();
    fabric.fakes.validationOutcomes.add(
      { tenant: 'tenant-1', requestId: 'req-1', refDigest: DIGEST_A },
      {
        verdict: 'accepted',
        requestId: 'req-1',
        tenantId: 'tenant-1',
        expertRef: 'expert-1',
        taskFamily: 'bug-fix-review',
        recordDigest: DIGEST_A,
        observedAt: '2026-10-01T00:00:00.000Z',
      },
    );
    await service.ingestValidationOutcome(
      { recordId: 'nq-rep-3', tenant: 'tenant-1', requestId: 'req-1', expertRef: 'expert-1', refDigest: DIGEST_A },
      OPTIONS,
    );
    await expect(
      service.ingestValidationOutcome(
        { recordId: 'nq-rep-4', tenant: 'tenant-1', requestId: 'req-1', expertRef: 'expert-1', refDigest: DIGEST_A },
        { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-9') },
      ),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.DUPLICATE_EVIDENCE });
  });
});
