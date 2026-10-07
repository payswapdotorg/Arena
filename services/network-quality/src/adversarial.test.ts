/**
 * Service-level adversarial tests (Work Order C020): cross-tenant
 * fail-closed reads, tampered store entries, the reviewer-COI exclusion
 * at the service boundary, a sybil detection job end-to-end and the
 * absence of any silent-adjustment path.
 */

import { describe, expect, it } from 'vitest';
import { toIdempotencyKey } from '@arena/protocol-core';
import { NETWORK_QUALITY_ERROR_CODES } from '@arena/network-quality';
import { NetworkQualityService, createNetworkQualityFabric } from './index.js';

const AT_MS = Date.parse('2026-10-05T00:00:00.000Z');
const AT = '2026-10-01T12:00:00.000Z';
const DIGEST_A = 'a'.repeat(64);

const OPTIONS = { correlationId: 'corr-1', idempotencyKey: toIdempotencyKey('key-1') };

function t(minutes: number): string {
  return new Date(Date.parse(AT) + minutes * 60 * 1000).toISOString();
}

describe('adversarial — cross-tenant isolation', () => {
  it('a tenant cannot read, transition or retract another tenant\'s records', async () => {
    const fabric = createNetworkQualityFabric(AT_MS);
    const service = new NetworkQualityService(
      fabric.sources,
      fabric.stores,
      fabric.sinks,
      fabric.clock,
    );
    await service.openDispute(
      {
        disputeId: 'nq-dispute-1',
        tenant: 'tenant-1',
        complainantParty: 'expert-1',
        respondentParty: 'expert-2',
        subjects: [{ kind: 'escalation-request', refId: 'req-1', refDigest: null }],
        summary: 'x',
      },
      OPTIONS,
    );
    await expect(
      service.transitionDispute(
        {
          disputeId: 'nq-dispute-1',
          tenant: 'tenant-2',
          to: 'UNDER_REVIEW',
          reasons: ['reviewer-assigned'],
          reviewerParty: 'reviewer-1',
        },
        { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-2') },
      ),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.NOT_FOUND });
    await expect(
      service.getDispute('nq-dispute-1', 'tenant-2', { correlationId: 'corr-2' }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.NOT_FOUND });
    await expect(
      service.retractCoi(
        { coiId: 'nq-coi-1', tenant: 'tenant-2', reason: 'x' },
        { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-9') },
      ),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.NOT_FOUND });
  });

  it('cross-tenant COI checks never see another tenant\'s registry', async () => {
    const fabric = createNetworkQualityFabric(AT_MS);
    const service = new NetworkQualityService(
      fabric.sources,
      fabric.stores,
      fabric.sinks,
      fabric.clock,
    );
    await service.registerCoi(
      {
        coiId: 'nq-coi-1',
        tenant: 'tenant-1',
        party: 'expert-1',
        counterparty: 'expert-2',
        kind: 'tenant-overlap',
        origin: 'declared',
      },
      OPTIONS,
    );
    const foreignCheck = await service.checkCoi(
      { tenant: 'tenant-2', party: 'expert-1', counterparty: 'expert-2' },
      { correlationId: 'corr-2' },
    );
    expect(foreignCheck.verdict).toBe('unknown-insufficient-data');
    expect(foreignCheck.examined).toBe(0);
  });
});

describe('adversarial — tampered store entries fail closed', () => {
  it('a mutated stored dispute fails digest verification on transition', async () => {
    const fabric = createNetworkQualityFabric(AT_MS);
    const service = new NetworkQualityService(
      fabric.sources,
      fabric.stores,
      fabric.sinks,
      fabric.clock,
    );
    await service.openDispute(
      {
        disputeId: 'nq-dispute-1',
        tenant: 'tenant-1',
        complainantParty: 'expert-1',
        respondentParty: 'expert-2',
        subjects: [{ kind: 'escalation-request', refId: 'req-1', refDigest: null }],
        summary: 'x',
      },
      OPTIONS,
    );
    // tamper: rewrite the stored snapshot directly in the store
    const store = fabric.stores.disputes as unknown as {
      byId: Map<string, unknown>;
    };
    const key = 'tenant-1:nq-dispute-1';
    const stored = store.byId.get(key) as { state: string } | undefined;
    expect(stored).toBeDefined();
    store.byId.set(key, { ...stored, state: 'RESOLVED' });
    await expect(
      service.transitionDispute(
        {
          disputeId: 'nq-dispute-1',
          tenant: 'tenant-1',
          to: 'UNDER_REVIEW',
          reasons: ['reviewer-assigned'],
          reviewerParty: 'reviewer-1',
        },
        { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-2') },
      ),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.TAMPERED });
  });
});

describe('adversarial — the reviewer COI exclusion at the service boundary', () => {
  it('the respondent cannot review or resolve the dispute through the service', async () => {
    const fabric = createNetworkQualityFabric(AT_MS);
    const service = new NetworkQualityService(
      fabric.sources,
      fabric.stores,
      fabric.sinks,
      fabric.clock,
    );
    await service.openDispute(
      {
        disputeId: 'nq-dispute-1',
        tenant: 'tenant-1',
        complainantParty: 'expert-1',
        respondentParty: 'expert-2',
        subjects: [{ kind: 'validation-verdict', refId: 'av_1', refDigest: null }],
        summary: 'x',
      },
      OPTIONS,
    );
    await expect(
      service.transitionDispute(
        {
          disputeId: 'nq-dispute-1',
          tenant: 'tenant-1',
          to: 'UNDER_REVIEW',
          reasons: ['reviewer-assigned'],
          reviewerParty: 'expert-2',
        },
        { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-2') },
      ),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.REVIEWER_COI_CONFLICT });
  });
});

describe('adversarial — a sybil vote-inflation attempt through the detection job', () => {
  it('one principal cluster with three accounts is caught end-to-end (detection + proposals)', async () => {
    const fabric = createNetworkQualityFabric(AT_MS);
    const service = new NetworkQualityService(
      fabric.sources,
      fabric.stores,
      fabric.sinks,
      fabric.clock,
    );
    fabric.fakes.voting.add('tenant-1', 'comp-sybil', {
      participants: [
        { expertRef: 'expert-1', tenant: 'tenant-1', principalClusterRef: 'author', joinedAt: AT },
        { expertRef: 'puppet-1', tenant: 'tenant-1', principalClusterRef: 'puppet-master', joinedAt: AT },
        { expertRef: 'puppet-2', tenant: 'tenant-1', principalClusterRef: 'puppet-master', joinedAt: AT },
        { expertRef: 'puppet-3', tenant: 'tenant-1', principalClusterRef: 'puppet-master', joinedAt: AT },
      ],
      submissions: [
        { submissionId: 'sub-1', competitionId: 'comp-sybil', authorExpertRef: 'expert-1', submittedAt: AT },
      ],
      judgments: [
        { judgmentId: 'judg-p1', competitionId: 'comp-sybil', submissionId: 'sub-1', expertRef: 'puppet-1', type: 'upvote_with_proof', recordedAt: t(0) },
        { judgmentId: 'judg-p2', competitionId: 'comp-sybil', submissionId: 'sub-1', expertRef: 'puppet-2', type: 'upvote_with_proof', recordedAt: t(2) },
        { judgmentId: 'judg-p3', competitionId: 'comp-sybil', submissionId: 'sub-1', expertRef: 'puppet-3', type: 'upvote_with_proof', recordedAt: t(4) },
      ],
      deniedAttempts: [],
      competitionOutcomes: [],
    });
    const run = await service.runAntiGamingDetection(
      { tenant: 'tenant-1', competitionId: 'comp-sybil' },
      OPTIONS,
    );
    expect(run.findings).toHaveLength(2); // puppet-2 + puppet-3 inflation findings
    expect(run.findings.every((finding) => finding.kind === 'duplicate-account-sybil')).toBe(true);
    expect(run.findings.every((finding) => finding.severity === 'critical')).toBe(true);
    // INVESTIGATE enforcement proposals forwarded? — findings carry them;
    // the requalification triggers landed for the critical severities
    expect(fabric.requalificationProposals.proposals.length).toBe(2);
    // and the conduct-flag reputation evidence is dimensional (no score)
    const family = await service.getReputationFamily(
      { tenant: 'tenant-1', expertId: 'puppet-2', family: 'conduct-flag' },
      { correlationId: 'corr-2' },
    );
    expect(family.records).toHaveLength(1);
    expect(JSON.stringify(family.records[0])).not.toContain('score');
  });
});

describe('adversarial — no silent-adjustment path through the service', () => {
  it('the service exposes no score/adjustment surface: finding evidence refs only', async () => {
    const fabric = createNetworkQualityFabric(AT_MS);
    const service = new NetworkQualityService(
      fabric.sources,
      fabric.stores,
      fabric.sinks,
      fabric.clock,
    );
    const methodNames = Object.getOwnPropertyNames(
      Object.getPrototypeOf(service),
    );
    expect(methodNames.some((name) => name.toLowerCase().includes('score'))).toBe(false);
    expect(methodNames.some((name) => name.toLowerCase().includes('adjust'))).toBe(false);
    // fabricated C009 provenance (the laundering route) fails closed
    await expect(
      service.ingestValidationOutcome(
        { recordId: 'nq-rep-x', tenant: 'tenant-1', requestId: 'req-x', expertRef: 'expert-1', refDigest: DIGEST_A },
        OPTIONS,
      ),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE });
  });
});
