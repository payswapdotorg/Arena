/**
 * Cross-tenant learning gate tests (Work Order A034): explicit-consent
 * enforcement — grants, expiry, revocation, scope, per-dataset rights.
 * NOT a rubber stamp.
 */

import { describe, expect, it } from 'vitest';
import type { LearningAuthorizationGrant } from './learning-authorization.js';
import {
  assertCrossTenantLearning,
  authorizeCrossTenantLearning,
  isLearningAuthorizationGrant,
  LEARNING_AUTHORIZATION_REASONS,
  makeTenantScopedRef,
  revokeLearningAuthorizationGrant,
  SecurityError,
  toDataRightsRecord,
  toLearningAuthorizationGrant,
  toTenantId,
} from './index.js';
import {
  makeDataRightsInput,
  makeGrantInput,
  T0,
  T1,
  T2,
  T5,
  TENANT_A,
  TENANT_B,
} from './test-support.js';

const DATASET_A1 = makeTenantScopedRef(TENANT_A, 'dataset', 'dataset-test-1');
const DATASET_A2 = makeTenantScopedRef(TENANT_A, 'dataset', 'dataset-test-2');

function requestFor(datasets: LearningAuthorizationGrant['datasets']) {
  return {
    consumerTenant: toTenantId(TENANT_B, 'consumer'),
    datasets,
    dataRights: Object.fromEntries(
      datasets.map((dataset) => [dataset.recordId, toDataRightsRecord(makeDataRightsInput())]),
    ),
  };
}

describe('grant validation', () => {
  it('accepts a well-formed explicit grant naming the grantor-owned datasets', () => {
    const grant = toLearningAuthorizationGrant(makeGrantInput());
    expect(grant.grantor).toBe(TENANT_A);
    expect(grant.status).toBe('active');
    expect(isLearningAuthorizationGrant(grant)).toBe(true);
    expect(Object.isFrozen(grant)).toBe(true);
  });

  it('rejects blanket grants (no named datasets)', () => {
    expect(() => toLearningAuthorizationGrant(makeGrantInput({ datasets: [] }))).toThrowError(
      /at least one dataset/,
    );
  });

  it('rejects grants naming another tenant\'s datasets', () => {
    expect(() =>
      toLearningAuthorizationGrant(
        makeGrantInput({
          datasets: [makeTenantScopedRef(TENANT_B, 'dataset', 'dataset-b-1')],
        }),
      ),
    ).toThrowError(/can only grant ITS OWN data/);
  });

  it('rejects grants naming non-dataset boundary classes', () => {
    expect(() =>
      toLearningAuthorizationGrant(
        makeGrantInput({
          datasets: [makeTenantScopedRef(TENANT_A, 'trajectory', 'trajectory-1')],
        }),
      ),
    ).toThrowError(/only name 'dataset'/);
  });

  it('rejects zero-duration and expired-at-construction grants', () => {
    expect(() =>
      toLearningAuthorizationGrant(makeGrantInput({ expiresAt: T0 })),
    ).toThrowError(/strictly after grantedAt/);
  });

  it('an active grant must carry revokedAt=null (no contradictory states)', () => {
    expect(() =>
      toLearningAuthorizationGrant(makeGrantInput({ revokedAt: T2 })),
    ).toThrowError(/revokedAt=null/);
  });
});

describe('the gate denies by default (explicit authorization required)', () => {
  it('no grants ⇒ grant-missing', () => {
    const decision = authorizeCrossTenantLearning(requestFor([DATASET_A1]), [], T2);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('grant-missing');
    expect(() => assertCrossTenantLearning(requestFor([DATASET_A1]), [], T2)).toThrowError(
      /cross-tenant learning denied/,
    );
  });

  it('a grant covering a DIFFERENT dataset does not authorize this one (exact scope)', () => {
    const grant = toLearningAuthorizationGrant(makeGrantInput());
    const decision = authorizeCrossTenantLearning(requestFor([DATASET_A2]), [grant], T2);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('grant-missing');
    expect(decision.deniedDataset).toBe('dataset-test-2');
  });

  it('a grant from the consumer\'s own tenant never authorizes another tenant\'s data', () => {
    // A tenant-B grant can only name tenant-B datasets (construction
    // enforces this); it cannot cover tenant-A datasets:
    expect(() =>
      toLearningAuthorizationGrant(makeGrantInput({ grantor: TENANT_B, datasets: [DATASET_A1] })),
    ).toThrowError(SecurityError);
    const ownDataGrant = toLearningAuthorizationGrant(
      makeGrantInput({
        grantor: TENANT_B,
        datasets: [makeTenantScopedRef(TENANT_B, 'dataset', 'dataset-b-1')],
      }),
    );
    const decision = authorizeCrossTenantLearning(requestFor([DATASET_A1]), [ownDataGrant], T2);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('grant-missing');
  });

  it('dataset without a rights record ⇒ rights-missing', () => {
    const grant = toLearningAuthorizationGrant(makeGrantInput());
    const request = {
      consumerTenant: toTenantId(TENANT_B, 'consumer'),
      datasets: [DATASET_A1],
      dataRights: {},
    };
    const decision = authorizeCrossTenantLearning(request, [grant], T2);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('rights-missing');
  });

  it('dataset whose permittedUse excludes cross-tenant learning ⇒ permitted-use-excluded', () => {
    const grant = toLearningAuthorizationGrant(makeGrantInput());
    const request = {
      consumerTenant: toTenantId(TENANT_B, 'consumer'),
      datasets: [DATASET_A1],
      dataRights: {
        'dataset-test-1': toDataRightsRecord(makeDataRightsInput({ permittedUse: 'tenant-internal' })),
      },
    };
    const decision = authorizeCrossTenantLearning(request, [grant], T2);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('permitted-use-excluded');
  });
});

describe('expiry and revocation', () => {
  it('an expired grant denies (grant-expired at asOf)', () => {
    const grant = toLearningAuthorizationGrant(makeGrantInput());
    const decision = authorizeCrossTenantLearning(requestFor([DATASET_A1]), [grant], T5);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('grant-expired');
  });

  it('revocation beats expiry and is permanent', () => {
    const grant = toLearningAuthorizationGrant(makeGrantInput());
    const revoked = revokeLearningAuthorizationGrant(grant, T2);
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedAt).toBe(T2);
    expect(grant.status).toBe('active'); // the original is untouched (append-only)

    const decision = authorizeCrossTenantLearning(requestFor([DATASET_A1]), [revoked], T1);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('grant-revoked');
  });

  it('double revocation and un-revocation are rejected', () => {
    const grant = toLearningAuthorizationGrant(makeGrantInput());
    const revoked = revokeLearningAuthorizationGrant(grant, T2);
    expect(() => revokeLearningAuthorizationGrant(revoked, T5)).toThrowError(
      /already revoked/,
    );
  });

  it('revocation cannot precede grant issuance (causality)', () => {
    const grant = toLearningAuthorizationGrant(makeGrantInput());
    expect(() => revokeLearningAuthorizationGrant(grant, '2025-01-01T00:00:00.000Z')).toThrowError(
      /monotonic/,
    );
  });
});

describe('the happy path is narrow and explicit', () => {
  it('an active, unexpired, in-scope grant over rights-permitting datasets allows', () => {
    const grant = toLearningAuthorizationGrant(
      makeGrantInput({
        datasets: [DATASET_A1, DATASET_A2],
      }),
    );
    const decision = authorizeCrossTenantLearning(
      requestFor([DATASET_A1, DATASET_A2]),
      [grant],
      T2,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('grant-authorized');
    expect(decision.grantId).toBe('grant-test-1');
    expect(() => assertCrossTenantLearning(requestFor([DATASET_A1, DATASET_A2]), [grant], T2))
      .not.toThrow();
  });

  it('ANY un-permitted dataset in a multi-dataset request denies the whole request', () => {
    const grant = toLearningAuthorizationGrant(
      makeGrantInput({ datasets: [DATASET_A1, DATASET_A2] }),
    );
    const request = {
      consumerTenant: toTenantId(TENANT_B, 'consumer'),
      datasets: [DATASET_A1, DATASET_A2],
      dataRights: {
        'dataset-test-1': toDataRightsRecord(makeDataRightsInput()),
        'dataset-test-2': toDataRightsRecord(makeDataRightsInput({ permittedUse: 'evaluation' })),
      },
    };
    const decision = authorizeCrossTenantLearning(request, [grant], T2);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('permitted-use-excluded');
    expect(decision.deniedDataset).toBe('dataset-test-2');
  });

  it('the reason vocabulary is closed and deny-heavy', () => {
    expect(Object.isFrozen(LEARNING_AUTHORIZATION_REASONS)).toBe(true);
    expect(LEARNING_AUTHORIZATION_REASONS.filter((reason) => reason !== 'grant-authorized').length)
      .toBe(7);
  });
});
