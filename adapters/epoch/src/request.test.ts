import { describe, expect, it } from 'vitest';
import {
  EPOCH_REQUEST_VERSION,
  isCapabilityDevelopmentRequest,
  toCapabilityDevelopmentRequest,
  toEpochAuthorizationMetadata,
} from './request.js';
import { EPOCH_ADAPTER_ERROR_CODES } from './errors.js';
import { buildEpochRequest, DIGESTS } from './test-support.js';

function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(buildEpochRequest())) as Record<string, unknown>;
}

describe('epoch adapter — EPI1.0 incoming request validation', () => {
  it('parses a complete capability development request (fail-closed, frozen)', () => {
    const request = toCapabilityDevelopmentRequest(buildEpochRequest());
    expect(request.requestVersion).toBe(EPOCH_REQUEST_VERSION);
    expect(request.requestId).toBe('epoch-req-001');
    expect(request.tenant).toBe('acme');
    expect(request.authorization.principal).toBe('epoch-orchestrator');
    expect(request.caseSeed.evidence).toHaveLength(1);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.caseSeed)).toBe(true);
    expect(Object.isFrozen(request.authorization)).toBe(true);
  });

  it('isCapabilityDevelopmentRequest is non-throwing', () => {
    expect(isCapabilityDevelopmentRequest(buildEpochRequest())).toBe(true);
    expect(isCapabilityDevelopmentRequest({})).toBe(false);
    expect(isCapabilityDevelopmentRequest('nope')).toBe(false);
  });

  it('rejects unknown fields (closed shape)', () => {
    const request = clone();
    request['worldModelHint'] = 'mutate-please';
    expect(() => toCapabilityDevelopmentRequest(request)).toThrow(/unknown field/);
  });

  it('rejects missing required fields', () => {
    const request = clone();
    delete request['caseSeed'];
    expect(() => toCapabilityDevelopmentRequest(request)).toThrow(/missing required field/);
  });

  it('rejects unsupported request versions', () => {
    const request = clone();
    request['requestVersion'] = 2;
    expect(() => toCapabilityDevelopmentRequest(request)).toThrow(
      EPOCH_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION,
    );
  });

  it('rejects requests without an idempotency key (lock rule 17)', () => {
    const request = clone();
    request['idempotencyKey'] = '';
    expect(() => toCapabilityDevelopmentRequest(request)).toThrow(
      EPOCH_ADAPTER_ERROR_CODES.IDEMPOTENCY_REQUIRED,
    );
  });

  it('rejects idempotency keys outside the identifier charset', () => {
    const request = clone();
    request['idempotencyKey'] = 'bad key with spaces!';
    expect(() => toCapabilityDevelopmentRequest(request)).toThrow(
      EPOCH_ADAPTER_ERROR_CODES.IDEMPOTENCY_REQUIRED,
    );
  });

  it('rejects invalid tenants (tenant pattern)', () => {
    const request = clone();
    request['tenant'] = 'Acme_Corp';
    expect(() => toCapabilityDevelopmentRequest(request)).toThrow(/tenant/);
  });

  it('rejects malformed authorization metadata (closed shape + patterns)', () => {
    const base = buildEpochRequest()['authorization'] as Record<string, unknown>;
    expect(() => toEpochAuthorizationMetadata({ ...base, scopes: [] })).toThrow(
      /at least one authorization scope/,
    );
    expect(() =>
      toEpochAuthorizationMetadata({ ...base, principal: 'Not Valid!' }),
    ).toThrow(/principal/);
    expect(() =>
      toEpochAuthorizationMetadata({ ...base, authorizationVersion: 2 }),
    ).toThrow(EPOCH_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION);
    expect(() => toEpochAuthorizationMetadata({ ...base, extra: true })).toThrow(
      /unknown field/,
    );
  });

  it('rejects bad evidence digests (digest-addressed evidence discipline)', () => {
    const request = clone();
    const seed = request['caseSeed'] as Record<string, unknown>;
    const evidence = seed['evidence'] as Record<string, unknown>[];
    evidence[0] = { digest: 'not-a-digest', description: 'bad' };
    expect(() => toCapabilityDevelopmentRequest(request)).toThrow(/digest/);
  });

  it('rejects priorities outside the A005 case priority vocabulary', () => {
    const request = clone();
    const seed = request['caseSeed'] as Record<string, unknown>;
    seed['priority'] = 'urgent';
    expect(() => toCapabilityDevelopmentRequest(request)).toThrow(/priorit/);
  });

  it('rejects empty capability/domain requirements', () => {
    const request = clone();
    request['requirements'] = { capability: [], domain: ['structural-engineering'] };
    expect(() => toCapabilityDevelopmentRequest(request)).toThrow(/at least one capability/);
  });

  it('rejects release channels outside the A024 vocabulary', () => {
    const request = clone();
    request['targetReleaseChannel'] = 'canary';
    expect(() => toCapabilityDevelopmentRequest(request)).toThrow(/release channel/);
  });

  it('rejects malformed failed trajectory refs and evaluation gaps', () => {
    const request = clone();
    request['failedTrajectoryRefs'] = [{ digest: 'short', observedAt: '2026-01-15T09:00:00.000Z' }];
    expect(() => toCapabilityDevelopmentRequest(request)).toThrow(/digest/);

    const gapRequest = clone();
    gapRequest['evaluationGaps'] = [
      { capability: 'x', summary: '', evidenceDigest: DIGESTS.evidence },
    ];
    expect(() => toCapabilityDevelopmentRequest(gapRequest)).toThrow(/summary/);
  });
});
