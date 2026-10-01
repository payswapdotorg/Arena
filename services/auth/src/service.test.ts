/**
 * AuthService tests (Work Order B004; issue #69) — happy paths + typed
 * fail-closed outcomes over the injected fakes (@arena/auth fakes, the
 * B002 in-memory fakes), the cookie contract, the DISABLED posture and
 * the no-leakage canaries. Authentication failures NEVER fall back to an
 * anonymous session; tenant scope is validated on every validation.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTH_ERROR_CODES,
  AuthError,
  createSessionTokenSealer,
  FakeSessionStore,
  ManualAuthClock,
  newSessionId,
  resolveSessionSecret,
  serializeSessionCookie,
  SESSION_COOKIE_NAME,
  isAuthError,
} from '@arena/auth';
import type { SessionRecord } from '@arena/auth';
import {
  FakeControlPlaneRepository,
  FakeCoordinationStore,
  toCoordinationKey,
} from '@arena/persistence';
import { AuthService } from './service.js';
import { StaticCredentialVerifier, sessionSecretFromEnv } from './ports.js';
import { makeAuthenticatedSession, toAuthenticatedSession } from './shared.js';
import { ControlPlaneSessionStore } from './control-plane-session-store.js';
import { createLocalAuthStack } from './local.js';
import {
  fixtureAuthMethod,
  fixturePrincipal,
  fixtureSessionRecord,
  fixtureWorkspaceContext,
  IDENTITY_DANA,
  PRINCIPAL_DANA,
  PRINCIPAL_ZED,
  TENANT_A,
  TENANT_B,
  TEST_SESSION_POLICY,
  TEST_SESSION_SECRET,
} from './test-support.js';

/** Helper: run an operation, expect a typed AuthError, return it. */
async function expectAuthError(
  operation: () => Promise<unknown>,
): Promise<AuthError> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(isAuthError(caught), `expected a typed AuthError, got ${String(caught)}`).toBe(
    true,
  );
  return caught as AuthError;
}

/**
 * Deterministically tamper a sealed cookie: flip the FIRST character of the
 * seal segment. Every character of the unpadded base64url HMAC-SHA256
 * encoding except the LAST is fully significant — the final character of
 * the 43-char encoding carries 2 zero-padding bits, so flipping it between
 * values 0-3 ('A'-'D') decodes to the SAME 32 MAC bytes and the tamper is
 * legitimately undetected (a 1-in-16 flake source per seal draw, observed
 * as CI red on the B005 promotion commit). Flipping the first seal
 * character always changes decoded byte 0 of the MAC, so `timingSafeEqual`
 * fails and `open` throws the typed TOKEN_TAMPERED error every time.
 */
function tamperSeal(cookieValue: string): string {
  const sealStart = cookieValue.lastIndexOf('.') + 1;
  const seal = cookieValue.slice(sealStart);
  const flippedFirst = seal[0] === 'A' ? 'B' : 'A';
  return `${cookieValue.slice(0, sealStart)}${flippedFirst}${seal.slice(1)}`;
}

interface Fixture {
  readonly clock: ManualAuthClock;
  readonly store: FakeSessionStore;
  readonly verifier: StaticCredentialVerifier;
  readonly service: AuthService;
}

function makeFixture(): Fixture {
  const clock = new ManualAuthClock(1_000_000);
  const store = new FakeSessionStore({ clock });
  const verifier = new StaticCredentialVerifier([
    {
      credential: fixtureAuthMethod('local'),
      principal: fixturePrincipal(TENANT_A, PRINCIPAL_DANA),
    },
    {
      credential: fixtureAuthMethod('local-zed'),
      principal: fixturePrincipal(TENANT_A, PRINCIPAL_ZED),
    },
  ]);
  const service = new AuthService({
    clock,
    store,
    secret: resolveSessionSecret((): string => TEST_SESSION_SECRET),
    verifier,
    policy: TEST_SESSION_POLICY,
    cookieSecure: false,
  });
  return { clock, store, verifier, service };
}

/** Issue a default session and return its cookie value. */
async function issueDefault(service: AuthService): Promise<string> {
  const issuance = await service.issueSession({
    principal: fixturePrincipal(),
    tenantId: TENANT_A,
    workspaceContext: fixtureWorkspaceContext(),
    authMethod: fixtureAuthMethod(),
  });
  return issuance.cookie.value;
}

describe('AuthService: authenticate', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = makeFixture();
  });

  it('returns the registered principal for a matching credential', async () => {
    const principal = await fixture.service.authenticate({
      method: 'local',
    });
    expect(principal.principalId).toBe(PRINCIPAL_DANA);
    expect(String(principal.tenantScope)).toBe(TENANT_A);
    expect(principal.kind).toBe('customer-identity');
  });

  it('fails closed with typed AUTH_INVALID_CREDENTIALS on a miss (never anonymous)', async () => {
    const error = await expectAuthError(() =>
      fixture.service.authenticate({ method: 'local', claims: { who: 'nope' } }),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
  });

  it('wraps a non-typed verifier failure as AUTH_INVALID_CREDENTIALS (cause kept)', async () => {
    const failing = {
      verify: (): Promise<never> => Promise.reject(new Error('boom')),
    };
    const service = new AuthService({
      clock: fixture.clock,
      store: fixture.store,
      secret: resolveSessionSecret((): string => TEST_SESSION_SECRET),
      verifier: failing,
      policy: TEST_SESSION_POLICY,
      cookieSecure: false,
    });
    const error = await expectAuthError(() => service.authenticate({ method: 'local' }));
    expect(error.code).toBe(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('rejects a malformed credential descriptor with the typed validation error', async () => {
    const error = await expectAuthError(() =>
      fixture.service.authenticate({ method: 'NOT-LOWER!' }),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.INVALID_AUTH_METHOD);
  });
});

describe('AuthService: issueSession', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = makeFixture();
  });

  it('issues a tenant-scoped session and the exact cookie contract', async () => {
    const workspace = fixtureWorkspaceContext();
    const issuance = await fixture.service.issueSession({
      principal: fixturePrincipal(),
      tenantId: TENANT_A,
      workspaceContext: workspace,
      authMethod: fixtureAuthMethod(),
    });

    expect(issuance.recordVersion).toBe(1);
    expect(issuance.session.principal.principalId).toBe(PRINCIPAL_DANA);
    expect(String(issuance.session.tenantId)).toBe(TENANT_A);
    expect(String(issuance.session.tenantRef.tenantId)).toBe(TENANT_A);
    expect(issuance.session.workspaceContext).toBe(workspace);
    expect(issuance.session.requiresRotation).toBe(false);
    expect(issuance.session.issuedAt).toBe(fixture.clock.now());
    expect(issuance.session.expiresAt).toBe(
      fixture.clock.now() + TEST_SESSION_POLICY.sessionTtlMs,
    );

    const cookie = issuance.cookie;
    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/');
    expect(cookie.secure).toBe(false);
    expect(cookie.maxAgeSeconds).toBe(TEST_SESSION_POLICY.sessionTtlMs / 1000);

    const header = serializeSessionCookie(cookie);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).not.toContain('Secure');
  });

  it('marks the cookie Secure when composed for production', async () => {
    const service = new AuthService({
      clock: fixture.clock,
      store: fixture.store,
      secret: resolveSessionSecret((): string => TEST_SESSION_SECRET),
      verifier: fixture.verifier,
      policy: TEST_SESSION_POLICY,
      cookieSecure: true,
    });
    const issuance = await service.issueSession({
      principal: fixturePrincipal(),
      tenantId: TENANT_A,
      workspaceContext: fixtureWorkspaceContext(),
      authMethod: fixtureAuthMethod(),
    });
    expect(issuance.cookie.secure).toBe(true);
    expect(serializeSessionCookie(issuance.cookie)).toContain('Secure');
  });

  it('carries ONLY the opaque sealed id — never principal/tenant/role data', async () => {
    const issuance = await fixture.service.issueSession({
      principal: fixturePrincipal(),
      tenantId: TENANT_A,
      workspaceContext: fixtureWorkspaceContext(),
      authMethod: fixtureAuthMethod(),
    });
    const value = issuance.cookie.value;
    expect(value.startsWith('arena.st')).toBe(true);
    for (const forbidden of [
      TENANT_A,
      PRINCIPAL_DANA,
      IDENTITY_DANA,
      'ws-northwind-main',
      'tenant-owner',
      'customer-identity',
    ]) {
      expect(value).not.toContain(forbidden);
    }
  });

  it('fails closed on cross-tenant issuance input (typed violation)', async () => {
    const error = await expectAuthError(() =>
      fixture.service.issueSession({
        principal: fixturePrincipal(TENANT_A, PRINCIPAL_DANA),
        tenantId: TENANT_B,
        workspaceContext: fixtureWorkspaceContext(TENANT_A),
        authMethod: fixtureAuthMethod(),
      }),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION);
  });
});

describe('AuthService: validateSession', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = makeFixture();
  });

  it('validates a live session cookie and returns the session view', async () => {
    const cookieValue = await issueDefault(fixture.service);
    const session = await fixture.service.validateSession(cookieValue);
    expect(String(session.tenantId)).toBe(TENANT_A);
    expect(session.principal.principalId).toBe(PRINCIPAL_DANA);
    expect(session.workspaceContext.workspaceId).toBe('ws-northwind-main');
    expect(session.requiresRotation).toBe(false);
  });

  it('accepts a matching expectedTenantId', async () => {
    const cookieValue = await issueDefault(fixture.service);
    const session = await fixture.service.validateSession(cookieValue, {
      expectedTenantId: TENANT_A,
    });
    expect(String(session.tenantId)).toBe(TENANT_A);
  });

  it('fails closed on a cross-tenant expectation (typed violation)', async () => {
    const cookieValue = await issueDefault(fixture.service);
    const error = await expectAuthError(() =>
      fixture.service.validateSession(cookieValue, { expectedTenantId: TENANT_B }),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION);
  });

  it('rejects a malformed expectedTenantId (typed violation)', async () => {
    const cookieValue = await issueDefault(fixture.service);
    const error = await expectAuthError(() =>
      fixture.service.validateSession(cookieValue, {
        expectedTenantId: 'Not A Tenant!',
      }),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION);
  });

  it('rejects a malformed cookie value (typed, fail closed)', async () => {
    const error = await expectAuthError(() =>
      fixture.service.validateSession('garbage'),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.MALFORMED_TOKEN);
  });

  it('rejects a tampered seal (typed integrity failure)', async () => {
    const cookieValue = await issueDefault(fixture.service);
    const tampered = tamperSeal(cookieValue);
    const error = await expectAuthError(() =>
      fixture.service.validateSession(tampered),
    );
    expect(
      error.code === AUTH_ERROR_CODES.TOKEN_TAMPERED ||
        error.code === AUTH_ERROR_CODES.MALFORMED_TOKEN,
    ).toBe(true);
  });

  it('rejects an expired session (typed)', async () => {
    const cookieValue = await issueDefault(fixture.service);
    fixture.clock.advance(TEST_SESSION_POLICY.sessionTtlMs);
    const error = await expectAuthError(() =>
      fixture.service.validateSession(cookieValue),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.SESSION_EXPIRED);
  });

  it('rejects a revoked session (typed)', async () => {
    const cookieValue = await issueDefault(fixture.service);
    await fixture.service.revokeSession(cookieValue);
    const error = await expectAuthError(() =>
      fixture.service.validateSession(cookieValue),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.SESSION_REVOKED);
  });

  it('rejects an unknown (never-issued) session id (typed)', async () => {
    const sealer = createSessionTokenSealer({
      secret: resolveSessionSecret((): string => TEST_SESSION_SECRET),
    });
    const error = await expectAuthError(() =>
      fixture.service.validateSession(sealer.seal(newSessionId())),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.SESSION_NOT_FOUND);
  });

  it('surfaces the rotation hint without failing a still-live session', async () => {
    const cookieValue = await issueDefault(fixture.service);
    fixture.clock.advance(TEST_SESSION_POLICY.rotationWindowMs + 1);
    const session = await fixture.service.validateSession(cookieValue);
    expect(session.requiresRotation).toBe(true);
  });
});

describe('AuthService: rotateSession', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = makeFixture();
  });

  it('rotates one-time over the SAME claims; the old cookie dies', async () => {
    const cookieValue = await issueDefault(fixture.service);
    const before = await fixture.service.validateSession(cookieValue);
    fixture.clock.advance(TEST_SESSION_POLICY.rotationWindowMs);
    const rotated = await fixture.service.rotateSession(cookieValue);

    expect(rotated.session.sessionId).not.toBe(before.sessionId);
    const fresh = await fixture.service.validateSession(rotated.cookie.value);
    expect(fresh.principal.principalId).toBe(PRINCIPAL_DANA);
    expect(String(fresh.tenantId)).toBe(TENANT_A);

    const replay = await expectAuthError(() =>
      fixture.service.validateSession(cookieValue),
    );
    expect(replay.code).toBe(AUTH_ERROR_CODES.SESSION_ROTATED);
  });

  it('fails closed rotating an expired session (typed)', async () => {
    const cookieValue = await issueDefault(fixture.service);
    fixture.clock.advance(TEST_SESSION_POLICY.sessionTtlMs);
    const error = await expectAuthError(() =>
      fixture.service.rotateSession(cookieValue),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.SESSION_EXPIRED);
  });
});

describe('AuthService: revocation', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = makeFixture();
  });

  it('revokeSession is idempotent (true once, false after)', async () => {
    const cookieValue = await issueDefault(fixture.service);
    expect(await fixture.service.revokeSession(cookieValue)).toBe(true);
    expect(await fixture.service.revokeSession(cookieValue)).toBe(false);
    const error = await expectAuthError(() =>
      fixture.service.validateSession(cookieValue),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.SESSION_REVOKED);
  });

  it('revokeAll invalidates every live session of the principal only', async () => {
    const danaOne = await issueDefault(fixture.service);
    const danaTwo = await issueDefault(fixture.service);
    const zed = await fixture.service.issueSession({
      principal: fixturePrincipal(TENANT_A, PRINCIPAL_ZED),
      tenantId: TENANT_A,
      workspaceContext: fixtureWorkspaceContext(TENANT_A, 'zed-002'),
      authMethod: fixtureAuthMethod('local-zed'),
    });

    const revoked = await fixture.service.revokeAll(PRINCIPAL_DANA);
    expect(revoked).toBe(2);

    for (const cookieValue of [danaOne, danaTwo]) {
      const error = await expectAuthError(() =>
        fixture.service.validateSession(cookieValue),
      );
      expect(error.code).toBe(AUTH_ERROR_CODES.SESSION_REVOKED);
    }
    const survivor = await fixture.service.validateSession(zed.cookie.value);
    expect(survivor.principal.principalId).toBe(PRINCIPAL_ZED);

    // A NEW session for the revoked principal is stamped with the bumped
    // epoch and validates again.
    const reissued = await issueDefault(fixture.service);
    const fresh = await fixture.service.validateSession(reissued);
    expect(fresh.principal.principalId).toBe(PRINCIPAL_DANA);
  });
});

describe('AuthService: DISABLED posture (no weak default key exists)', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = makeFixture();
  });

  it('a missing secret refuses construction (typed AUTH_DISABLED)', () => {
    const resolution = sessionSecretFromEnv({});
    expect(resolution.status).toBe('disabled');
    expect(
      isAuthError(
        (() => {
          try {
            new AuthService({
              clock: fixture.clock,
              store: fixture.store,
              secret: resolution,
              verifier: fixture.verifier,
              policy: TEST_SESSION_POLICY,
              cookieSecure: false,
            });
            return null;
          } catch (error) {
            return error;
          }
        })(),
      ),
    ).toBe(true);
    const error = (() => {
      try {
        new AuthService({
          clock: fixture.clock,
          store: fixture.store,
          secret: resolution,
          verifier: fixture.verifier,
          policy: TEST_SESSION_POLICY,
          cookieSecure: false,
        });
      } catch (caught) {
        return caught as AuthError;
      }
      expect.unreachable('construction must fail');
    })();
    expect(error.code).toBe(AUTH_ERROR_CODES.DISABLED);
  });

  it('a short secret refuses construction (typed AUTH_DISABLED)', () => {
    const resolution = sessionSecretFromEnv({
      ARENA_SESSION_SECRET: 'too-short',
    });
    expect(resolution.status).toBe('disabled');
    expect(() => {
      new AuthService({
        clock: fixture.clock,
        store: fixture.store,
        secret: resolution,
        verifier: fixture.verifier,
        policy: TEST_SESSION_POLICY,
        cookieSecure: false,
      });
    }).toThrowError(AuthError);
  });

  it('rejects a missing injected clock / verifier / cookieSecure (typed)', () => {
    const secret = resolveSessionSecret((): string => TEST_SESSION_SECRET);
    const cases: Array<Record<string, unknown>> = [
      {
        store: fixture.store,
        secret,
        verifier: fixture.verifier,
        policy: TEST_SESSION_POLICY,
        cookieSecure: false,
      },
      {
        clock: fixture.clock,
        store: fixture.store,
        secret,
        policy: TEST_SESSION_POLICY,
        cookieSecure: false,
      },
      {
        clock: fixture.clock,
        store: fixture.store,
        secret,
        verifier: fixture.verifier,
        policy: TEST_SESSION_POLICY,
      },
    ];
    for (const deps of cases) {
      let code = '';
      try {
        new AuthService(deps as never);
      } catch (error) {
        expect(isAuthError(error)).toBe(true);
        code = (error as AuthError).code;
      }
      expect(code).toBe(AUTH_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
});

describe('no-leakage canaries (B002 precedent)', () => {
  it('no auth error message carries secret material', async () => {
    const fixture = makeFixture();
    const messages: string[] = [];
    try {
      new AuthService({
        clock: fixture.clock,
        store: fixture.store,
        secret: sessionSecretFromEnv({}),
        verifier: fixture.verifier,
        policy: TEST_SESSION_POLICY,
        cookieSecure: false,
      });
    } catch (error) {
      messages.push(String((error as Error).message));
    }
    try {
      await fixture.service.authenticate({ method: 'nope' });
    } catch (error) {
      messages.push(String((error as Error).message));
    }
    const cookieValue = await issueDefault(fixture.service);
    const flipped = tamperSeal(cookieValue);
    try {
      await fixture.service.validateSession(flipped);
    } catch (error) {
      messages.push(String((error as Error).message));
    }
    expect(messages.length).toBe(3);
    for (const message of messages) {
      expect(message).not.toContain(TEST_SESSION_SECRET);
      expect(message).not.toContain(TEST_SESSION_SECRET.slice(0, 16));
    }
  });
});

describe('the versioned contract surface (shared.ts)', () => {
  it('round-trips an AuthenticatedSession through the strict parser', () => {
    const record = fixtureSessionRecord({ issuedAt: 1_000_000 });
    const view = makeAuthenticatedSession(record, 1_000_000 + 61_000);
    const transported = JSON.parse(
      JSON.stringify(view),
    ) as unknown;
    const parsed = toAuthenticatedSession(transported);
    expect(parsed.recordVersion).toBe(view.recordVersion);
    expect(parsed.sessionId).toBe(view.sessionId);
    expect(parsed.principal).toEqual(view.principal);
    expect(parsed.tenantId).toBe(view.tenantId);
    expect(parsed.requiresRotation).toBe(view.requiresRotation);
    expect(parsed.workspaceContext).toEqual(view.workspaceContext);
  });

  it('rejects an unsupported recordVersion (fail closed)', () => {
    const view = makeAuthenticatedSession(
      fixtureSessionRecord({ issuedAt: 1_000_000 }),
      1_000_000,
    );
    const wrong = { ...(JSON.parse(JSON.stringify(view)) as object), recordVersion: 2 };
    expect(() => toAuthenticatedSession(wrong)).toThrowError(AuthError);
  });

  it('rejects a non-boolean requiresRotation (fail closed)', () => {
    const view = makeAuthenticatedSession(
      fixtureSessionRecord({ issuedAt: 1_000_000 }),
      1_000_000,
    );
    const wrong = {
      ...(JSON.parse(JSON.stringify(view)) as object),
      requiresRotation: 'yes',
    };
    expect(() => toAuthenticatedSession(wrong)).toThrowError(AuthError);
  });

  it('rejects a non-object (fail closed)', () => {
    expect(() => toAuthenticatedSession('nope')).toThrowError(AuthError);
    expect(() => toAuthenticatedSession(null)).toThrowError(AuthError);
  });
});

describe('ControlPlaneSessionStore over the B002 fakes', () => {
  function makeDurableFixture(): {
    clock: ManualAuthClock;
    controlPlane: FakeControlPlaneRepository;
    store: ControlPlaneSessionStore;
  } {
    const clock = new ManualAuthClock(1_000_000);
    const controlPlane = new FakeControlPlaneRepository({ clock });
    const store = new ControlPlaneSessionStore({
      controlPlane,
      coordination: makeCoordination(clock),
      clock,
      epochCacheTtlMs: 5_000,
    });
    return { clock, controlPlane, store };
  }

  function makeCoordination(clock: ManualAuthClock) {
    return new FakeCoordinationStore({ clock });
  }

  it('stores sessions as versioned control-plane records (tenant-scoped)', async () => {
    const { controlPlane, store } = makeDurableFixture();
    const record = fixtureSessionRecord({ issuedAt: 1_000_000 });
    const stored = await store.issue(record);
    expect(String(stored.sessionId)).toBe(String(record.sessionId));

    const rows = await controlPlane.list({ kind: 'arena-session' });
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row?.recordId).toBe(String(record.sessionId));
    expect(row?.tenantId).toBe(TENANT_A);
    expect(row?.kind).toBe('arena-session');
    expect(row?.version).toBe(1);
  });

  it('keeps tombstones as persisted record state (revocation evidence)', async () => {
    const { controlPlane, store } = makeDurableFixture();
    const record = await store.issue(fixtureSessionRecord({ issuedAt: 1_000_000 }));
    expect(await store.revoke(String(record.sessionId))).toBe(true);
    const row = await controlPlane.get(String(record.sessionId));
    expect(row).not.toBeNull();
    expect((row?.data as Record<string, unknown>)['status']).toBe('revoked');
  });

  it('releases the rotation lease after a completed rotation', async () => {
    const { clock } = makeDurableFixture();
    const coordination = makeCoordination(clock);
    const durable = new ControlPlaneSessionStore({
      controlPlane: new FakeControlPlaneRepository({ clock }),
      coordination,
      clock,
    });
    const original = await durable.issue(fixtureSessionRecord({ issuedAt: clock.now() }));
    const next = fixtureSessionRecord({
      sessionId: newSessionId(),
      issuedAt: clock.now(),
      principal: original.principal,
      workspace: original.workspaceContext,
    });
    await durable.rotate(String(original.sessionId), next);
    expect(
      await coordination.leaseHolder(toCoordinationKey(`arena-session-rotate:${String(original.sessionId)}`)),
    ).toBeNull();
  });

  it('bumps the authoritative epoch record and invalidates the epoch cache', async () => {
    const { clock, controlPlane } = makeDurableFixture();
    const coordination = makeCoordination(clock);
    const durable = new ControlPlaneSessionStore({
      controlPlane,
      coordination,
      clock,
      epochCacheTtlMs: 60_000,
    });
    const one = await durable.issue(fixtureSessionRecord({ issuedAt: clock.now() }));
    const two = await durable.issue(fixtureSessionRecord({ issuedAt: clock.now() }));
    const revoked = await durable.revokeAllForPrincipal(PRINCIPAL_DANA);
    expect(revoked).toBe(2);
    // The epoch cache was invalidated by the bump (BEFORE any revalidation
    // repopulates it through the read-through).
    expect(
      await coordination.cacheGet(toCoordinationKey(`arena-session-epoch:${PRINCIPAL_DANA}`)),
    ).toBeNull();
    expect((await durable.validate(String(one.sessionId))).status).toBe('revoked');
    expect((await durable.validate(String(two.sessionId))).status).toBe('revoked');
    const epochRow = await controlPlane.get(`arena-session-epoch.${PRINCIPAL_DANA}`);
    expect((epochRow?.data as Record<string, unknown>)['epoch']).toBe(1);
  });

  it('epochCacheTtlMs=0 performs no cache writes at all', async () => {
    const { clock, controlPlane } = makeDurableFixture();
    const coordination = makeCoordination(clock);
    const durable = new ControlPlaneSessionStore({
      controlPlane,
      coordination,
      clock,
      epochCacheTtlMs: 0,
    });
    await durable.issue(fixtureSessionRecord({ issuedAt: clock.now() }));
    expect(
      await coordination.cacheGet(toCoordinationKey(`arena-session-epoch:${PRINCIPAL_DANA}`)),
    ).toBeNull();
  });

  it('fails closed on a corrupted stored record (typed, never usable)', async () => {
    const { clock, controlPlane } = makeDurableFixture();
    const store = new ControlPlaneSessionStore({
      controlPlane,
      coordination: makeCoordination(clock),
      clock,
    });
    const record = await store.issue(fixtureSessionRecord({ issuedAt: clock.now() }));
    await controlPlane.update(String(record.sessionId), {
      expectedRevision: 1,
      data: { recordVersion: 1, session: 'corrupted', status: 'live' },
    });
    const error = await expectAuthError(() =>
      store.validate(String(record.sessionId)),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.INVALID_SESSION_RECORD);
  });

  it('maps a failing port to the typed AUTH_STORE_FAILED error', async () => {
    const { clock, controlPlane } = makeDurableFixture();
    const broken: FakeControlPlaneRepository = Object.create(controlPlane);
    broken.get = (): Promise<null> => Promise.reject(new Error('boom'));
    const store = new ControlPlaneSessionStore({
      controlPlane: broken,
      coordination: makeCoordination(clock),
      clock,
    });
    const error = await expectAuthError(() => store.get(newSessionId()));
    expect(error.code).toBe(AUTH_ERROR_CODES.STORE_FAILED);
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('guards one-time rotation with the typed AUTH_ROTATION_CONFLICT', async () => {
    const { clock, controlPlane } = makeDurableFixture();
    const coordination = makeCoordination(clock);
    const store = new ControlPlaneSessionStore({
      controlPlane,
      coordination,
      clock,
    });
    const original = await store.issue(fixtureSessionRecord({ issuedAt: clock.now() }));
    const leaseKey = `arena-session-rotate:${String(original.sessionId)}`;
    expect(
      await coordination.acquireLease(toCoordinationKey(leaseKey), 'another-holder', 10_000),
    ).toBe(true);
    const next = fixtureSessionRecord({
      sessionId: newSessionId(),
      issuedAt: clock.now(),
      principal: original.principal,
      workspace: original.workspaceContext,
    });
    const error = await expectAuthError(() =>
      store.rotate(String(original.sessionId), next),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.ROTATION_CONFLICT);
  });

  it('rejects malformed records and ids on every address (fail closed)', async () => {
    const { clock, controlPlane } = makeDurableFixture();
    const store = new ControlPlaneSessionStore({
      controlPlane,
      coordination: makeCoordination(clock),
      clock,
    });
    const malformed = {
      ...fixtureSessionRecord({ issuedAt: clock.now() }),
      tenantId: 'not a tenant!',
    } as unknown as SessionRecord;
    const entry = await expectAuthError(() => store.issue(malformed));
    expect(entry.code).toBe(AUTH_ERROR_CODES.INVALID_SESSION_RECORD);

    const badId = 'not a session id!';
    for (const operation of [
      () => store.get(badId),
      () => store.validate(badId),
      () => store.revoke(badId),
      () => store.rotate(badId, fixtureSessionRecord({ issuedAt: clock.now() })),
    ]) {
      const error = await expectAuthError(operation);
      expect(error.code).toBe(AUTH_ERROR_CODES.INVALID_SESSION_ID);
    }
  });
});

describe('createLocalAuthStack (FT2.0 local parity)', () => {
  it('runs the full session lifecycle with zero providers (durable store)', async () => {
    const stack = createLocalAuthStack({
      secret: TEST_SESSION_SECRET,
      policy: TEST_SESSION_POLICY,
      credentials: [
        {
          credential: fixtureAuthMethod('local'),
          principal: fixturePrincipal(),
        },
      ],
    });
    const clock = stack.clock as ManualAuthClock;
    const principal = await stack.service.authenticate({ method: 'local' });
    expect(principal.principalId).toBe(PRINCIPAL_DANA);

    const issuance = await stack.service.issueSession({
      principal,
      tenantId: TENANT_A,
      workspaceContext: fixtureWorkspaceContext(),
      authMethod: fixtureAuthMethod(),
    });
    const session = await stack.service.validateSession(issuance.cookie.value);
    expect(session.principal.principalId).toBe(PRINCIPAL_DANA);

    clock.advance(TEST_SESSION_POLICY.rotationWindowMs);
    const rotated = await stack.service.rotateSession(issuance.cookie.value);
    expect(await stack.service.validateSession(rotated.cookie.value)).toBeTruthy();

    expect(await stack.service.revokeSession(rotated.cookie.value)).toBe(true);
    const error = await expectAuthError(() =>
      stack.service.validateSession(rotated.cookie.value),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.SESSION_REVOKED);
  });

  it('refuses construction with a DISABLED secret (no default key)', () => {
    expect(() =>
      createLocalAuthStack({ secret: 'too-short' }),
    ).toThrowError(AuthError);
  });

  it('supports the pure in-memory store posture with the same lifecycle', async () => {
    const stack = createLocalAuthStack({
      secret: TEST_SESSION_SECRET,
      policy: TEST_SESSION_POLICY,
      useMemoryStore: true,
      credentials: [
        { credential: fixtureAuthMethod('local'), principal: fixturePrincipal() },
      ],
    });
    const principal = await stack.service.authenticate({ method: 'local' });
    const issuance = await stack.service.issueSession({
      principal,
      tenantId: TENANT_A,
      workspaceContext: fixtureWorkspaceContext(),
      authMethod: fixtureAuthMethod(),
    });
    const session = await stack.service.validateSession(issuance.cookie.value);
    expect(session.principal.principalId).toBe(PRINCIPAL_DANA);
  });
});
