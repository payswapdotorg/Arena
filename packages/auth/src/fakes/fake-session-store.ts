/**
 * FakeSessionStore (Work Order B004) — the local in-memory implementation
 * of the server-side session port, with FULL contract parity with the
 * control-plane-backed store (the shared contract suite runs against both;
 * FT2.0 "Local parity": local install/Demo mode needs ZERO providers).
 *
 * Semantics (asserted by defineSessionContractSuite):
 *   - records are re-validated on entry (malformed input fails closed);
 *   - issue() stamps the principal's current revocation epoch;
 *   - validate() returns the typed closed outcome (never an anonymous
 *     fallback);
 *   - rotate() is one-time (tombstone 'rotated' + supersededBy);
 *   - revoke()/revokeAllForPrincipal() tombstone / bump the epoch.
 */

import { canonicalJson } from '@arena/protocol-core';
import { AUTH_ERROR_CODES, AuthError } from '../errors.js';
import { isSessionExpired } from '../session.js';
import type { SessionRecord } from '../session.js';
import {
  assertSessionStoreId,
  toSessionStoreRecord,
} from '../store.js';
import type {
  SessionStore,
  SessionValidationOutcome,
} from '../store.js';
import { deepFreeze } from '../shared.js';
import { SystemAuthClock } from './clock.js';
import type { AuthClock } from '../shared.js';

/** Tombstone kinds: explicit revoke vs one-time rotation supersession. */
type Tombstone =
  | { readonly kind: 'revoked' }
  | { readonly kind: 'rotated'; readonly supersededBy: string };

function sessionFingerprint(session: SessionRecord): string {
  // Everything EXCEPT the provisional epoch — replay detection.
  return canonicalJson({
    recordVersion: session.recordVersion,
    sessionId: session.sessionId,
    principal: session.principal,
    tenantId: session.tenantId,
    tenantRef: session.tenantRef,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    rotatesAt: session.rotatesAt,
    workspaceContext: session.workspaceContext,
    authMethod: session.authMethod,
  });
}

export interface FakeSessionStoreOptions {
  readonly clock?: AuthClock;
}

export class FakeSessionStore implements SessionStore {
  private readonly clock: AuthClock;
  private readonly records = new Map<string, SessionRecord>();
  private readonly tombstones = new Map<string, Tombstone>();
  private readonly epochs = new Map<string, number>();

  constructor(options: FakeSessionStoreOptions = {}) {
    this.clock = options.clock ?? new SystemAuthClock();
  }

  private epochFor(principalId: string): number {
    return this.epochs.get(principalId) ?? 0;
  }

  private isLive(session: SessionRecord, now: number): boolean {
    if (now >= session.expiresAt) return false;
    if (this.tombstones.has(session.sessionId)) return false;
    if (session.revocationEpoch < this.epochFor(session.principal.principalId)) {
      return false;
    }
    return true;
  }

  async issue(session: SessionRecord): Promise<SessionRecord> {
    const validated = toSessionStoreRecord(session);
    const sessionId = assertSessionStoreId(validated.sessionId);
    const existing = this.records.get(sessionId);
    if (existing !== undefined) {
      if (sessionFingerprint(existing) === sessionFingerprint(validated)) {
        return existing; // idempotent replay
      }
      throw new AuthError(AUTH_ERROR_CODES.SESSION_EXISTS, {
        message: `a different session already exists under id ${JSON.stringify(sessionId)}`,
        details: { sessionId },
      });
    }
    const epoch = this.epochFor(validated.principal.principalId);
    const stored = deepFreeze({ ...validated, revocationEpoch: epoch });
    this.records.set(sessionId, stored);
    return stored;
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    assertSessionStoreId(sessionId);
    if (this.tombstones.has(sessionId)) return null;
    const record = this.records.get(sessionId);
    if (record === undefined) return null;
    if (isSessionExpired(record, this.clock.now())) return null;
    return record;
  }

  async validate(sessionId: string): Promise<SessionValidationOutcome> {
    assertSessionStoreId(sessionId);
    const tombstone = this.tombstones.get(sessionId);
    if (tombstone !== undefined) {
      return { status: tombstone.kind, session: null };
    }
    const record = this.records.get(sessionId);
    if (record === undefined) {
      return { status: 'unknown', session: null };
    }
    const now = this.clock.now();
    if (isSessionExpired(record, now)) {
      return { status: 'expired', session: null };
    }
    if (record.revocationEpoch < this.epochFor(record.principal.principalId)) {
      return { status: 'revoked', session: null };
    }
    return { status: 'valid', session: record };
  }

  async rotate(sessionId: string, next: SessionRecord): Promise<SessionRecord> {
    assertSessionStoreId(sessionId);
    const validatedNext = toSessionStoreRecord(next);
    const nextId = assertSessionStoreId(validatedNext.sessionId);

    const tombstone = this.tombstones.get(sessionId);
    if (tombstone !== undefined) {
      if (tombstone.kind === 'revoked') {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_REVOKED, {
          message: `session ${JSON.stringify(sessionId)} was revoked and cannot rotate`,
          details: { sessionId },
        });
      }
      throw new AuthError(AUTH_ERROR_CODES.SESSION_ROTATED, {
        message: `session ${JSON.stringify(sessionId)} was already rotated (superseded by ${tombstone.supersededBy})`,
        details: { sessionId, supersededBy: tombstone.supersededBy },
      });
    }
    const record = this.records.get(sessionId);
    if (record === undefined) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_NOT_FOUND, {
        message: `session ${JSON.stringify(sessionId)} does not exist and cannot rotate`,
        details: { sessionId },
      });
    }
    const now = this.clock.now();
    if (isSessionExpired(record, now)) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_EXPIRED, {
        message: `session ${JSON.stringify(sessionId)} expired and cannot rotate`,
        details: { sessionId },
      });
    }
    if (record.revocationEpoch < this.epochFor(record.principal.principalId)) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_REVOKED, {
        message: `session ${JSON.stringify(sessionId)} was revoked by epoch and cannot rotate`,
        details: { sessionId },
      });
    }
    if (this.records.has(nextId) || this.tombstones.has(nextId)) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_EXISTS, {
        message: `the rotation target id ${JSON.stringify(nextId)} already exists`,
        details: { sessionId: nextId },
      });
    }
    const epoch = this.epochFor(validatedNext.principal.principalId);
    const stored = deepFreeze({ ...validatedNext, revocationEpoch: epoch });
    this.records.set(nextId, stored);
    this.tombstones.set(sessionId, { kind: 'rotated', supersededBy: nextId });
    return stored;
  }

  async revoke(sessionId: string): Promise<boolean> {
    assertSessionStoreId(sessionId);
    if (this.tombstones.has(sessionId)) return false;
    const record = this.records.get(sessionId);
    if (record === undefined) return false;
    if (!this.isLive(record, this.clock.now())) return false;
    this.tombstones.set(sessionId, { kind: 'revoked' });
    return true;
  }

  async revokeAllForPrincipal(principalId: string): Promise<number> {
    if (typeof principalId !== 'string' || principalId.length === 0) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_PRINCIPAL, {
        message: 'revokeAllForPrincipal requires a non-empty principal id',
      });
    }
    const now = this.clock.now();
    let live = 0;
    for (const record of this.records.values()) {
      if (record.principal.principalId === principalId && this.isLive(record, now)) {
        live += 1;
      }
    }
    this.epochs.set(principalId, this.epochFor(principalId) + 1);
    return live;
  }
}
