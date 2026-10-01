/**
 * Session contract test kit (Work Order B004; issue #69).
 *
 * `defineSessionContractSuite(name, factory)` runs the SAME behavioral
 * contract tests against ANY SessionStore implementation — the in-memory
 * fake in CI and the control-plane-backed durable store in
 * services/auth (which itself runs this suite over the B002 fakes AND can
 * be pointed at hosted adapters). This is the FT2.0 "Local parity"
 * enforcement mechanism for the session subsystem: parity is not a claim,
 * it is an executed suite.
 *
 * Every suite creates a FRESH fixture per test (`beforeEach`), so tests are
 * order-independent. The fixture provides a ControllableAuthClock —
 * expiry/rotation/revocation transitions are fully deterministic.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { AUTH_ERROR_CODES, AuthError, isAuthError } from '../errors.js';
import { requiresSessionRotation } from '../session.js';
import type { SessionRecord } from '../session.js';
import { SESSION_VALIDATION_STATUSES } from '../store.js';
import type { SessionStore } from '../store.js';
import { isDeepFrozen } from '../shared.js';
import { newSessionId } from '../token.js';
import type { ControllableAuthClock } from '../fakes/clock.js';
import {
  fixturePrincipal,
  fixtureSessionRecord,
  PRINCIPAL_DANA,
  PRINCIPAL_ZED,
  TENANT_A,
  TEST_SESSION_POLICY,
} from '../test-support.js';

/** One fixture per test: the store under test + the controllable clock. */
export interface SessionContractFixture {
  readonly store: SessionStore;
  readonly clock: ControllableAuthClock;
}

export type SessionContractFixtureFactory =
  () => SessionContractFixture | Promise<SessionContractFixture>;

/** Run the session store contract suite against a fixture factory. */
export function defineSessionContractSuite(
  name: string,
  factory: SessionContractFixtureFactory,
): void {
  describe(`session store contract: ${name}`, () => {
    let store: SessionStore;
    let clock: ControllableAuthClock;

    beforeEach(async () => {
      const fixture = await factory();
      store = fixture.store;
      clock = fixture.clock;
    });

    it('issues a frozen, epoch-stamped record; get + validate agree', async () => {
      const record = fixtureSessionRecord({ issuedAt: clock.now() });
      const stored = await store.issue(record);
      expect(stored.sessionId).toBe(record.sessionId);
      expect(stored.revocationEpoch).toBe(0);
      expect(isDeepFrozen(stored)).toBe(true);

      const fetched = await store.get(record.sessionId);
      expect(fetched).not.toBeNull();
      expect(fetched?.sessionId).toBe(record.sessionId);

      const outcome = await store.validate(record.sessionId);
      expect(outcome.status).toBe('valid');
      expect(outcome.session?.sessionId).toBe(record.sessionId);
      expect(SESSION_VALIDATION_STATUSES).toContain('valid');
    });

    it('validates an unknown session id as the typed unknown outcome (fail closed)', async () => {
      const outcome = await store.validate(newSessionId());
      expect(outcome).toEqual({ status: 'unknown', session: null });
    });

    it('expires exactly at expiresAt (typed expired outcome)', async () => {
      const record = fixtureSessionRecord({ issuedAt: clock.now() });
      await store.issue(record);
      clock.advance(TEST_SESSION_POLICY.sessionTtlMs - 1);
      expect((await store.validate(record.sessionId)).status).toBe('valid');
      clock.advance(1);
      const outcome = await store.validate(record.sessionId);
      expect(outcome).toEqual({ status: 'expired', session: null });
      expect(await store.get(record.sessionId)).toBeNull();
    });

    it('revokes: true once, typed revoked outcome, get null afterwards', async () => {
      const record = fixtureSessionRecord({ issuedAt: clock.now() });
      await store.issue(record);
      expect(await store.revoke(record.sessionId)).toBe(true);
      expect(await store.revoke(record.sessionId)).toBe(false);
      const outcome = await store.validate(record.sessionId);
      expect(outcome).toEqual({ status: 'revoked', session: null });
      expect(await store.get(record.sessionId)).toBeNull();
    });

    it('revoke returns false for absent and expired sessions (no phantom revocations)', async () => {
      expect(await store.revoke(newSessionId())).toBe(false);
      const record = fixtureSessionRecord({ issuedAt: clock.now() });
      await store.issue(record);
      clock.advance(TEST_SESSION_POLICY.sessionTtlMs);
      expect(await store.revoke(record.sessionId)).toBe(false);
    });

    it('rotates ONE-TIME: the old id is rotated, the new id is valid, claims are preserved', async () => {
      const original = await store.issue(fixtureSessionRecord({ issuedAt: clock.now() }));
      clock.advance(TEST_SESSION_POLICY.rotationWindowMs);
      const nextInput = fixtureSessionRecord({
        sessionId: newSessionId(),
        issuedAt: clock.now(),
        principal: original.principal,
        workspace: original.workspaceContext,
      });
      const rotated = await store.rotate(original.sessionId, nextInput);

      expect(rotated.sessionId).toBe(nextInput.sessionId);
      expect(rotated.principal).toBe(original.principal);
      expect(rotated.workspaceContext).toBe(original.workspaceContext);
      expect(rotated.tenantId).toBe(original.tenantId);
      expect(rotated.revocationEpoch).toBe(original.revocationEpoch);
      expect(rotated.expiresAt).toBeGreaterThan(original.expiresAt);

      expect((await store.validate(nextInput.sessionId)).status).toBe('valid');
      expect((await store.validate(original.sessionId)).status).toBe('rotated');
      expect(await store.get(original.sessionId)).toBeNull();

      // One-time property: rotating the tombstoned id fails closed.
      const replay = await expectToRejectAuth(
        () => store.rotate(original.sessionId, nextInput),
      );
      expect(replay.code).toBe(AUTH_ERROR_CODES.SESSION_ROTATED);
    });

    it('rotating an unknown session id fails closed (typed)', async () => {
      const error = await expectToRejectAuth(() =>
        store.rotate(newSessionId(), fixtureSessionRecord({ issuedAt: clock.now() })),
      );
      expect(error.code).toBe(AUTH_ERROR_CODES.SESSION_NOT_FOUND);
    });

    it('rotating an expired session fails closed (typed)', async () => {
      const record = await store.issue(fixtureSessionRecord({ issuedAt: clock.now() }));
      clock.advance(TEST_SESSION_POLICY.sessionTtlMs);
      const error = await expectToRejectAuth(() =>
        store.rotate(
          record.sessionId,
          fixtureSessionRecord({
            issuedAt: clock.now(),
            principal: record.principal,
            workspace: record.workspaceContext,
          }),
        ),
      );
      expect(error.code).toBe(AUTH_ERROR_CODES.SESSION_EXPIRED);
    });

    it('revokeAllForPrincipal bumps the epoch: live sessions count and die; others survive', async () => {
      const danaOne = await store.issue(
        fixtureSessionRecord({ issuedAt: clock.now(), principal: fixturePrincipal(TENANT_A, PRINCIPAL_DANA) }),
      );
      const danaTwo = await store.issue(
        fixtureSessionRecord({
          issuedAt: clock.now(),
          principal: fixturePrincipal(TENANT_A, PRINCIPAL_DANA),
        }),
      );
      const zed = await store.issue(
        fixtureSessionRecord({
          issuedAt: clock.now(),
          principal: fixturePrincipal(TENANT_A, PRINCIPAL_ZED),
        }),
      );

      const revoked = await store.revokeAllForPrincipal(PRINCIPAL_DANA);
      expect(revoked).toBe(2);
      expect((await store.validate(danaOne.sessionId)).status).toBe('revoked');
      expect((await store.validate(danaTwo.sessionId)).status).toBe('revoked');
      expect((await store.validate(zed.sessionId)).status).toBe('valid');

      // A NEW session for the revoked principal is stamped with the bumped epoch.
      const reissued = await store.issue(
        fixtureSessionRecord({ issuedAt: clock.now(), principal: fixturePrincipal(TENANT_A, PRINCIPAL_DANA) }),
      );
      expect(reissued.revocationEpoch).toBe(1);
      expect((await store.validate(reissued.sessionId)).status).toBe('valid');
    });

    it('revokeAllForPrincipal does not count expired sessions', async () => {
      clock.advance(1_000_000);
      const clockNow = clock.now();
      const live = await store.issue(fixtureSessionRecord({ issuedAt: clockNow }));
      const expired = await store.issue(
        fixtureSessionRecord({ issuedAt: clockNow - TEST_SESSION_POLICY.sessionTtlMs }),
      );
      expect((await store.validate(expired.sessionId)).status).toBe('expired');
      const count = await store.revokeAllForPrincipal(live.principal.principalId);
      expect(count).toBe(1);
      expect((await store.validate(live.sessionId)).status).toBe('revoked');
    });

    it('issue is idempotent for identical replay and conflicts on divergence', async () => {
      const record = fixtureSessionRecord({ issuedAt: clock.now() });
      const first = await store.issue(record);
      const replay = await store.issue(record);
      expect(replay.sessionId).toBe(first.sessionId);
      expect(replay.revocationEpoch).toBe(first.revocationEpoch);

      const conflicting = fixtureSessionRecord({
        sessionId: record.sessionId,
        principal: fixturePrincipal(TENANT_A, PRINCIPAL_ZED),
      });
      const error = await expectToRejectAuth(() => store.issue(conflicting));
      expect(error.code).toBe(AUTH_ERROR_CODES.SESSION_EXISTS);
    });

    it('rejects malformed session records on entry (fail closed, typed)', async () => {
      const malformed = {
        ...fixtureSessionRecord({ issuedAt: clock.now() }),
        tenantId: 'not a tenant!',
      } as unknown as SessionRecord;
      const error = await expectToRejectAuth(() => store.issue(malformed));
      expect(error.code).toBe(AUTH_ERROR_CODES.INVALID_SESSION_RECORD);
    });

    it('rejects malformed session ids on every address (fail closed, typed)', async () => {
      const badId = 'not a session id!';
      for (const operation of [
        () => store.get(badId),
        () => store.validate(badId),
        () => store.revoke(badId),
        () => store.rotate(badId, fixtureSessionRecord({ issuedAt: clock.now() })),
      ]) {
        const error = await expectToRejectAuth(operation);
        expect(error.code).toBe(AUTH_ERROR_CODES.INVALID_SESSION_ID);
      }
    });

    it('records the rotation window: a due session still validates as valid', async () => {
      const record = await store.issue(fixtureSessionRecord({ issuedAt: clock.now() }));
      clock.advance(TEST_SESSION_POLICY.rotationWindowMs);
      const outcome = await store.validate(record.sessionId);
      expect(outcome.status).toBe('valid');
      expect(requiresSessionRotation(record, clock.now())).toBe(true);
      clock.advance(TEST_SESSION_POLICY.sessionTtlMs);
      expect((await store.validate(record.sessionId)).status).toBe('expired');
    });
  });
}

/** Helper: run an operation, expect an AuthError, return it. */
async function expectToRejectAuth(
  operation: () => Promise<unknown>,
): Promise<AuthError> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(isAuthError(caught), `expected a typed AuthError, got ${String(caught)}`).toBe(true);
  return caught as AuthError;
}
