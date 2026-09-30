/**
 * Envelope wiring tests (Work Order A034): command/event round trips,
 * idempotency-key discipline, fail-closed parsing of foreign schemas.
 */

import { describe, expect, it } from 'vitest';
import { serializeEnvelope } from '@arena/protocol-core';
import {
  makeAuthorizationDecidedEvent,
  makeAuthorizeLearningCommand,
  makeEvaluateAuthorizationCommand,
  makePolicyBundleRegisteredEvent,
  makeRegisterPolicyBundleCommand,
  parseAuthorizationDecidedEvent,
  parseEvaluateAuthorizationCommand,
  parsePolicyBundleRegisteredEvent,
  parseRegisterPolicyBundleCommand,
  SECURITY_ERROR_CODES,
  SecurityError,
  SECURITY_PROTOCOL_VERSION,
  SECURITY_SCHEMAS,
  securitySchemaRef,
  toAuthorizationDecision,
  toSecurityPrincipal,
  toTenantScopedRef,
  isKnownSecuritySchema,
} from './index.js';
import type { CorrelationId, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import {
  captureSecurityError,
  CORR_ID,
  IDEM_KEY,
  makeDataRightsInput,
  makePrincipalInput,
  makeTenantScopedRefInput,
  T1,
} from './test-support.js';

const principal = toSecurityPrincipal(makePrincipalInput());
const resource = toTenantScopedRef(makeTenantScopedRefInput());

describe('the in-package schema registry (A019/A022 precedent)', () => {
  it('owns the security namespace at a single version', () => {
    expect(SECURITY_PROTOCOL_VERSION).toBe('1.0.0');
    for (const name of Object.keys(SECURITY_SCHEMAS)) {
      expect(name.startsWith('security/')).toBe(true);
      expect(SECURITY_SCHEMAS[name as keyof typeof SECURITY_SCHEMAS]).toBe('1.0.0');
    }
    expect(Object.keys(SECURITY_SCHEMAS).length).toBeGreaterThan(10);
  });

  it('securitySchemaRef resolves well-formed refs; isKnownSecuritySchema pins them', () => {
    const ref = securitySchemaRef('security/principal');
    expect(ref).toEqual({ namespace: 'security', name: 'principal', version: '1.0.0' });
    expect(isKnownSecuritySchema(ref)).toBe(true);
    expect(
      isKnownSecuritySchema({ namespace: 'security', name: 'principal', version: '9.9.9' } as SchemaRef),
    ).toBe(false);
    expect(
      isKnownSecuritySchema({ namespace: 'events', name: 'principal', version: '1.0.0' } as SchemaRef),
    ).toBe(false);
  });

  it('unknown schema names are rejected (closed registry)', () => {
    expect(() => securitySchemaRef('security/not-a-schema' as never)).toThrowError(
      SecurityError,
    );
  });
});

describe('command envelopes require idempotency keys', () => {
  it('evaluate-authorization-command round-trips through canonical JSON', () => {
    const command = makeEvaluateAuthorizationCommand(
      { principal, action: 'read', resource, evaluatedAt: T1 },
      CORR_ID,
      IDEM_KEY,
    );
    const raw = serializeEnvelope(command);
    const parsed = parseEvaluateAuthorizationCommand(raw);
    expect(parsed.id).toBe(command.id);
    expect(parsed.correlationId).toBe(CORR_ID);
    expect(parsed.idempotencyKey).toBe(IDEM_KEY);
    expect(parsed.payload.action).toBe('read');
    expect(parsed.payload.principal.principalId).toBe('principal-test-1');
  });

  it('commands with malformed principals are rejected BEFORE the wire', () => {
    expect(() =>
      makeEvaluateAuthorizationCommand(
        { principal: { bad: true } as never, action: 'read', resource, evaluatedAt: T1 },
        CORR_ID,
        IDEM_KEY,
      ),
    ).toThrowError(SecurityError);
    expect(
      captureSecurityError(() =>
        makeEvaluateAuthorizationCommand(
          { principal: { bad: true } as never, action: 'read', resource, evaluatedAt: T1 },
          CORR_ID,
          IDEM_KEY,
        ),
      ).code,
    ).toBe(SECURITY_ERROR_CODES.INVALID_PRINCIPAL);
  });

  it('commands with non-vocabulary actions are rejected BEFORE the wire', () => {
    expect(() =>
      makeEvaluateAuthorizationCommand(
        { principal, action: 'sudo' as never, resource, evaluatedAt: T1 },
        CORR_ID,
        IDEM_KEY,
      ),
    ).toThrowError(SecurityError);
    expect(
      captureSecurityError(() =>
        makeEvaluateAuthorizationCommand(
          { principal, action: 'sudo' as never, resource, evaluatedAt: T1 },
          CORR_ID,
          IDEM_KEY,
        ),
      ).code,
    ).toBe(SECURITY_ERROR_CODES.INVALID_ACTION);
  });

  it('register-policy-bundle-command round-trips', () => {
    const command = makeRegisterPolicyBundleCommand(
      { bundle: { placeholder: true } },
      CORR_ID,
      IDEM_KEY,
    );
    const parsed = parseRegisterPolicyBundleCommand(serializeEnvelope(command));
    expect(parsed.payload.bundle).toEqual({ placeholder: true });
  });

  it('authorize-learning-command validates its dataset/grants/rights inputs', () => {
    expect(() =>
      makeAuthorizeLearningCommand(
        {
          consumerTenant: 'tenant-beta',
          datasets: [resource],
          grants: [{ junk: true }],
          dataRights: { 'dataset-test-1': makeDataRightsInput() },
          asOf: T1,
        },
        CORR_ID,
        IDEM_KEY,
      ),
    ).toThrowError(SecurityError);
    expect(() =>
      makeAuthorizeLearningCommand(
        {
          consumerTenant: 'tenant-beta',
          datasets: [{ junk: true } as never],
          grants: [],
          dataRights: {},
          asOf: T1,
        },
        CORR_ID,
        IDEM_KEY,
      ),
    ).toThrowError(/must be validated TenantScopedRefs/);
  });
});

describe('event envelopes are correlation-addressed', () => {
  it('authorization-decided-event round-trips with its audit record', () => {
    const event = makeAuthorizationDecidedEvent(
      {
        decision: toAuthorizationDecision({
          recordVersion: 1,
          effect: 'deny',
          reason: 'no-matching-policy',
          principalId: 'principal-test-1',
          tenantScope: 'tenant-alpha',
          action: 'read',
          boundaryClass: 'dataset',
          recordId: 'dataset-test-1',
          policyStatementId: null,
          matchedDenyIds: [],
          evaluatedAt: T1,
        }),
        auditRecord: {
          recordVersion: 1,
          sequence: 1,
          previousDigest: '0'.repeat(64),
          payload: { placeholder: true } as never,
          digest: 'a'.repeat(64),
        },
      },
      CORR_ID,
    );
    const parsed = parseAuthorizationDecidedEvent(serializeEnvelope(event));
    expect(parsed.payload.decision.reason).toBe('no-matching-policy');
  });

  it('policy-bundle-registered-event round-trips', () => {
    const event = makePolicyBundleRegisteredEvent(
      { bundleId: 'bundle-test', version: '1.0.0', digest: 'a'.repeat(64), statementCount: 2 },
      CORR_ID,
    );
    const parsed = parsePolicyBundleRegisteredEvent(serializeEnvelope(event));
    expect(parsed.payload.statementCount).toBe(2);
  });
});

describe('fail-closed parsing of foreign envelopes', () => {
  it('a foreign schema does not parse as a security command', () => {
    const foreign = serializeEnvelope(
      makePolicyBundleRegisteredEvent(
        { bundleId: 'b', version: '1.0.0', digest: 'a'.repeat(64), statementCount: 0 },
        CORR_ID,
      ),
    );
    expect(() => parseEvaluateAuthorizationCommand(foreign)).toThrowError();
  });

  it('garbage does not parse at all', () => {
    expect(() => parseEvaluateAuthorizationCommand('not json')).toThrowError();
    expect(() => parseRegisterPolicyBundleCommand('{}')).toThrowError();
  });
});

/** Type-level guards (compile-time only). */
export type _CorrelationId = CorrelationId;
export type _IdempotencyKey = IdempotencyKey;
