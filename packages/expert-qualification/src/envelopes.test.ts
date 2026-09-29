/**
 * Envelope wiring tests (Work Order A007) — commands with REQUIRED
 * idempotency keys, events, queries/responses without them, schema
 * pinning, tamper tripwires.
 */

import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import {
  EXPERT_QUALIFICATION_SCHEMAS,
  EXPERT_QUALIFICATION_SCHEMA_VERSION,
  checkExpertQualificationEnvelope,
  expertQualificationEnvelopeDigest,
  expertQualificationSchemaRef,
  isKnownExpertQualificationSchema,
  makeMatchCompletedResponse,
  makeMatchExpertsQuery,
  makeQualificationRecordedEvent,
  makeQualifyClaimCommand,
  makeRecordQualificationExpiryCommand,
  parseExpertQualificationEnvelope,
} from './envelopes.js';
import { ExpertQualificationError } from './errors.js';
import {
  CORR_A,
  DIGEST_A,
  IDEM_A,
  T0,
  makeClaim,
  makeMatchingPolicy,
  makeQualificationPolicy,
  makeVerificationEvidence,
  makeWorkProductEvidence,
} from './test-support.js';
import { evaluateCompetencyClaim } from './qualification.js';
import { createMatchRequest } from './match-request.js';
import { SKILL_RUST_REVIEW } from './test-support.js';

const correlationId = toCorrelationId(CORR_A);
const idempotencyKey = toIdempotencyKey(IDEM_A);

describe('schema registry', () => {
  it('registers every owned schema at the same version', () => {
    const names = Object.keys(EXPERT_QUALIFICATION_SCHEMAS);
    expect(names.length).toBe(15);
    for (const name of names) {
      expect(EXPERT_QUALIFICATION_SCHEMAS[name as keyof typeof EXPERT_QUALIFICATION_SCHEMAS]).toBe(
        EXPERT_QUALIFICATION_SCHEMA_VERSION,
      );
    }
    const ref = expertQualificationSchemaRef('expert-qualification/qualification-record');
    expect(ref.namespace).toBe('expert-qualification');
    expect(ref.name).toBe('qualification-record');
    expect(isKnownExpertQualificationSchema(ref)).toBe(true);
    expect(
      isKnownExpertQualificationSchema({ namespace: 'expert-qualification', name: 'rogue', version: '1.0.0' }),
    ).toBe(false);
  });

  it('rejects unknown schema names', () => {
    expect(() =>
      expertQualificationSchemaRef('expert-qualification/no-such-schema' as never),
    ).toThrow(/unknown expert-qualification protocol schema/);
  });
});

describe('command envelopes (idempotency keys REQUIRED — lock rule 17)', () => {
  it('builds and round-trips a qualify-claim command', async () => {
    const envelope = makeQualifyClaimCommand(
      { claimRef: DIGEST_A, policyRef: DIGEST_A, evaluatedAt: T0, renew: false },
      { correlationId, idempotencyKey },
    );
    expect(envelope.kind).toBe('command');
    expect(envelope.idempotencyKey).toBe(IDEM_A);
    const raw = canonicalJson(envelope);
    const parsed = parseExpertQualificationEnvelope<{ claimRef: string }>(
      raw,
      'expert-qualification/qualify-claim-command',
    );
    expect(parsed.payload.claimRef).toBe(DIGEST_A);
    // tamper tripwire
    const digest = await expertQualificationEnvelopeDigest(envelope);
    await expect(checkExpertQualificationEnvelope(raw, digest)).resolves.toBeTruthy();
    await expect(checkExpertQualificationEnvelope(raw, DIGEST_A)).rejects.toThrow(
      ExpertQualificationError,
    );
  });

  it('rejects commands without an idempotency key', () => {
    expect(() =>
      makeQualifyClaimCommand(
        { claimRef: DIGEST_A, policyRef: DIGEST_A, evaluatedAt: T0, renew: false },
        { correlationId },
      ),
    ).toThrow(/command envelopes require an idempotency key/);
    expect(() =>
      makeRecordQualificationExpiryCommand({ claimRef: DIGEST_A, evaluatedAt: T0 }, { correlationId }),
    ).toThrow(/command envelopes require an idempotency key/);
  });

  it('validates command payloads (digests + timestamps)', () => {
    expect(() =>
      makeQualifyClaimCommand(
        { claimRef: 'not-a-digest', policyRef: DIGEST_A, evaluatedAt: T0, renew: true },
        { correlationId, idempotencyKey },
      ),
    ).toThrow(/valid content digest/);
    expect(() =>
      makeQualifyClaimCommand(
        { claimRef: DIGEST_A, policyRef: DIGEST_A, evaluatedAt: 'nope', renew: true },
        { correlationId, idempotencyKey },
      ),
    ).toThrow(/ms-precision UTC/);
    expect(() =>
      makeRecordQualificationExpiryCommand(
        { claimRef: DIGEST_A, evaluatedAt: 'nope' },
        { correlationId, idempotencyKey },
      ),
    ).toThrow(/ms-precision UTC/);
  });
});

describe('event envelope', () => {
  it('builds a qualification-recorded event from a REAL record', async () => {
    const work1 = await makeWorkProductEvidence(1);
    const work2 = await makeWorkProductEvidence(2);
    const verify = await makeVerificationEvidence('pass');
    const claim = await makeClaim([work1.digest, work2.digest, verify.digest]);
    const policy = await makeQualificationPolicy();
    const record = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [work1, work2, verify],
      evaluatedAt: T0,
    });
    const envelope = makeQualificationRecordedEvent(
      { record },
      { correlationId, idempotencyKey },
    );
    expect(envelope.kind).toBe('event');
    expect(envelope.schema).toBe(
      'arena:schema/expert-qualification/qualification-recorded-event@1.0.0',
    );
    const raw = canonicalJson(envelope);
    const parsed = parseExpertQualificationEnvelope<{ record: { status: string } }>(
      raw,
      'expert-qualification/qualification-recorded-event',
    );
    expect(parsed.payload.record.status).toBe('qualified');
  });

  it('rejects events with malformed records', () => {
    expect(() =>
      makeQualificationRecordedEvent(
        { record: { nope: true } as never },
        { correlationId },
      ),
    ).toThrow(/structurally valid qualification record/);
  });
});

describe('query/response envelopes (no idempotency keys — pure queries)', () => {
  it('round-trips match-experts query and match-completed response', async () => {
    const request = await createMatchRequest({
      tenant: 'tenant-alpha',
      requirements: [
        { requirementId: 'req-rust', capability: SKILL_RUST_REVIEW, minimumProficiency: 'proficient' },
      ],
      evaluatedAt: T0,
    });
    const policy = await makeMatchingPolicy();
    const query = makeMatchExpertsQuery({ request, policy }, { correlationId });
    expect(query.kind).toBe('query');
    expect(query.idempotencyKey).toBeNull();
    const raw = canonicalJson(query);
    const parsed = parseExpertQualificationEnvelope<unknown>(
      raw,
      'expert-qualification/match-experts-query',
    );
    expect(parsed.kind).toBe('query');

    const response = makeMatchCompletedResponse(
      {
        result: {
          resultVersion: 1,
          requestDigest: request.digest,
          matchingPolicyDigest: policy.digest,
          evaluatedAt: T0,
          candidates: [],
          requirementsUnmet: ['req-rust'],
          truncated: false,
          digest: DIGEST_A,
        } as never,
      },
      { correlationId },
    );
    expect(response.kind).toBe('response');
    expect(() =>
      makeMatchCompletedResponse({ result: { nope: 1 } as never }, { correlationId }),
    ).toThrow(/structurally valid match result/);
  });
});
