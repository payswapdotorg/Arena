/**
 * http-host unit proofs (Work Order P003) — the PURE transport logic: the
 * documented error renderings, the Authorization header parsing and the
 * tenant-binding verdict. The REAL-listener end-to-end proofs (create →
 * status → result over an actual local URL, signed webhooks, MCP) live in
 * tests/api-host — the P003 acceptance battery.
 */

import { describe, expect, it } from 'vitest';
import { ESCALATION_ERROR_CODES, EscalationError } from '@arena/escalation';
import {
  API_KEY_DENIAL_REASONS,
  API_KEY_ENVIRONMENTS,
  API_KEY_SCOPES,
  HOST_CAPACITY_STATUSES,
  HOST_TRUTH_LENSES,
} from './ports.js';
import {
  DENIAL_CODE_MIRROR,
  DEVELOPER_CODE_HTTP,
  ESCALATION_CODE_HTTP,
  RUNTIME_CODE_HTTP,
  renderApiKeyDenial,
  renderTransportError,
} from './errors.js';
import {
  API_KEY_SECRET_PATTERN_SOURCE,
  authorizeBoundaryRequest,
  isApiKeySecretShape,
  parseAuthorizationHeader,
  tenantBindingVerdict,
} from './auth.js';
import { requestSegments } from './server.js';

const WELL_FORMED_SECRET = 'dak_live_' + 'a'.repeat(64);

describe('http-host vocabulary closure', () => {
  it('keeps the scope, denial, environment, lens and capacity vocabularies closed', () => {
    expect([...API_KEY_SCOPES]).toEqual([
      'escalations:create',
      'escalations:read',
      'sandbox:run',
      'webhooks:manage',
      'observability:read',
    ]);
    expect([...API_KEY_DENIAL_REASONS]).toEqual([
      'key-not-found',
      'secret-invalid',
      'key-revoked',
      'key-rotated',
      'tenant-mismatch',
      'environment-mismatch',
      'scope-missing',
    ]);
    expect([...API_KEY_ENVIRONMENTS]).toEqual(['sandbox', 'live']);
    expect([...HOST_TRUTH_LENSES]).toEqual(['demo', 'customer']);
    expect([...HOST_CAPACITY_STATUSES]).toEqual([
      'AVAILABLE',
      'DEGRADED',
      'EXHAUSTED',
      'DISABLED',
    ]);
  });

  it('maps every denial reason onto a typed developer code rendering', () => {
    for (const reason of API_KEY_DENIAL_REASONS) {
      const rendering = renderApiKeyDenial(reason, {
        scope: 'escalations:create',
        environment: 'live',
      });
      expect(rendering.status).toBeGreaterThanOrEqual(400);
      expect(rendering.body.code.startsWith('DEVELOPER_')).toBe(true);
      expect(typeof rendering.body.category).toBe('string');
      expect(rendering.body.category.length).toBeGreaterThan(0);
      expect(DENIAL_CODE_MIRROR[reason]).toBe(rendering.body.code);
    }
  });

  it('renders every escalation code onto a documented HTTP status', () => {
    for (const code of Object.values(ESCALATION_ERROR_CODES)) {
      expect(ESCALATION_CODE_HTTP[code]).toBeGreaterThanOrEqual(400);
      const rendering = renderTransportError(
        new EscalationError(code, { message: 'proof' }),
      );
      expect(rendering.body.code).toBe(code);
      expect(rendering.body.message).toBe('proof');
    }
  });

  it('renders the identity conflict as a typed 409', () => {
    const rendering = renderTransportError(
      new EscalationError(ESCALATION_ERROR_CODES.IDENTITY_CONFLICT, {
        message: 'idempotency key bound to a different body',
      }),
    );
    expect(rendering.status).toBe(409);
    expect(rendering.body.code).toBe('ESCALATION_IDENTITY_CONFLICT');
    expect(rendering.body.category).toBe('idempotency');
  });

  it('renders every mirrored developer + runtime code and fails closed on unknowns', () => {
    for (const code of Object.keys(DEVELOPER_CODE_HTTP)) {
      const rendering = renderTransportError(
        Object.assign(new Error('proof'), { code, details: { x: 1 } }),
      );
      expect(rendering.body.code).toBe(code);
      expect(rendering.status).toBe(DEVELOPER_CODE_HTTP[code as keyof typeof DEVELOPER_CODE_HTTP]);
    }
    for (const code of Object.keys(RUNTIME_CODE_HTTP)) {
      const rendering = renderTransportError(Object.assign(new Error('proof'), { code }));
      expect(rendering.body.code).toBe(code);
    }
    // Unknown code: fail-closed typed 500 — never a passthrough.
    const unknown = renderTransportError(Object.assign(new Error('boom'), { code: 'NOT_A_CODE' }));
    expect(unknown.status).toBe(500);
    expect(unknown.body.code).toBe('ESCALATION_UNKNOWN_ERROR');
    const thrown = renderTransportError(new Error('raw'));
    expect(thrown.status).toBe(500);
    expect(thrown.body.code).toBe('ESCALATION_UNKNOWN_ERROR');
    expect(renderTransportError('string error').body.code).toBe('ESCALATION_UNKNOWN_ERROR');
  });
});

describe('http-host Authorization header parsing', () => {
  it('accepts a well-formed bearer secret (case-insensitive scheme)', () => {
    expect(parseAuthorizationHeader(`Bearer ${WELL_FORMED_SECRET}`)).toEqual({
      outcome: 'presented',
      secret: WELL_FORMED_SECRET,
    });
    expect(parseAuthorizationHeader(`bearer ${WELL_FORMED_SECRET}  `)).toEqual({
      outcome: 'presented',
      secret: WELL_FORMED_SECRET,
    });
  });

  it('rejects missing, scheme-less, unsupported and malformed presentations', () => {
    expect(parseAuthorizationHeader(undefined)).toEqual({
      outcome: 'rejected',
      reason: 'header-missing',
    });
    expect(parseAuthorizationHeader('   ')).toEqual({
      outcome: 'rejected',
      reason: 'header-missing',
    });
    expect(parseAuthorizationHeader('nonsense')).toEqual({
      outcome: 'rejected',
      reason: 'scheme-missing',
    });
    expect(parseAuthorizationHeader('Basic abcdef')).toEqual({
      outcome: 'rejected',
      reason: 'scheme-unsupported',
    });
    expect(parseAuthorizationHeader('Bearer not-a-secret')).toEqual({
      outcome: 'rejected',
      reason: 'secret-malformed',
    });
    expect(parseAuthorizationHeader('Bearer dak_live_short')).toEqual({
      outcome: 'rejected',
      reason: 'secret-malformed',
    });
  });

  it('mirrors the developer key secret wire pattern', () => {
    expect(API_KEY_SECRET_PATTERN_SOURCE).toBe('^dak_(sandbox|live)_[0-9a-f]{64}$');
    expect(isApiKeySecretShape(WELL_FORMED_SECRET)).toBe(true);
    expect(isApiKeySecretShape('dak_sandbox_' + '0'.repeat(64))).toBe(true);
    expect(isApiKeySecretShape('dak_test_' + '0'.repeat(64))).toBe(false);
    expect(isApiKeySecretShape('dak_live_' + 'G'.repeat(64))).toBe(false);
  });
});

describe('http-host boundary authorization', () => {
  it('short-circuits rejected presentations to the typed secret-invalid denial', async () => {
    const verdict = await authorizeBoundaryRequest({
      authenticator: {
        authenticate: async () => ({ outcome: 'denied', reason: 'key-not-found' }),
      },
      authorizationHeader: 'garbage',
      scope: 'escalations:create',
      environment: 'live',
    });
    expect(verdict).toEqual({ outcome: 'denied', reason: 'secret-invalid' });
  });

  it('carries authenticator verdicts through unchanged (authorized + denied)', async () => {
    const identity = {
      keyId: 'devkey_' + '1'.repeat(32),
      clientAppId: 'app_x',
      tenantId: 'tenant-alpha',
      environment: 'live' as const,
      scopes: ['escalations:create' as const],
    };
    const ok = await authorizeBoundaryRequest({
      authenticator: { authenticate: async () => ({ outcome: 'authorized', identity }) },
      authorizationHeader: `Bearer ${WELL_FORMED_SECRET}`,
      scope: 'escalations:create',
      environment: 'live',
    });
    expect(ok).toEqual({ outcome: 'authorized', identity });
    const denied = await authorizeBoundaryRequest({
      authenticator: { authenticate: async () => ({ outcome: 'denied', reason: 'scope-missing' }) },
      authorizationHeader: `Bearer ${WELL_FORMED_SECRET}`,
      scope: 'escalations:create',
      environment: 'live',
    });
    expect(denied).toEqual({ outcome: 'denied', reason: 'scope-missing' });
  });

  it('binds the tenant only when the claim equals the identity tenant', () => {
    const identity = { tenantId: 'tenant-alpha' };
    expect(tenantBindingVerdict(identity, 'tenant-alpha')).toEqual({
      outcome: 'bound',
      tenantId: 'tenant-alpha',
    });
    expect(tenantBindingVerdict(identity, 'tenant-beta')).toEqual({ outcome: 'mismatch' });
  });
});

describe('http-host request path normalization', () => {
  it('splits routable segments (query + fragment stripped)', () => {
    expect(requestSegments('/v1/escalations')).toEqual(['v1', 'escalations']);
    expect(requestSegments('/v1/escalations/req_1?trace=1')).toEqual([
      'v1',
      'escalations',
      'req_1',
    ]);
    expect(requestSegments('/healthz#fragment')).toEqual(['healthz']);
    expect(requestSegments(undefined)).toEqual([]);
    expect(requestSegments('/')).toEqual([]);
  });
});
