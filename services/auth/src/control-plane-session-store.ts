/**
 * ControlPlaneSessionStore (Work Order B004; issue #69) — the durable
 * SessionStore implementation over the injected B002 ports
 * (spec/service-boundaries.md "Control/API"; the services/persistence
 * composition precedent: adapters live behind ports, injected here).
 *
 * Storage posture (disclosed in the PR):
 *   - AUTHORITY — the control plane (`ControlPlaneRepository`): one
 *     versioned record per session (kind `arena-session`, recordId = the
 *     session id, tenantId = the session tenant, optimistic `revision`)
 *     plus one epoch counter record per principal (kind
 *     `arena-session-epoch`). Tombstones (revoked / rotated) are record
 *     STATUS transitions, never deletes — revocation evidence persists.
 *   - COORDINATION (`CoordinationStore`) — bounded, rebuildable state
 *     ONLY: a short-TTL read-through cache of the principal's revocation
 *     epoch (invalidated on every bump) and the one-time rotation lease
 *     (`arena-session-rotate:<sessionId>`; concurrent rotations fail with
 *     the typed AUTH_ROTATION_CONFLICT). Losing this store loses NO
 *     authoritative session state (FT2.0 coordination discipline).
 *
 * The shared behavioral contract suite (defineSessionContractSuite from
 * @arena/auth) runs against this implementation over the B002 fakes in
 * parity.test.ts — local parity is executed, not asserted.
 *
 * Fail-closed discipline: malformed stored records, unknown statuses,
 * recordId/sessionId mismatches and port failures are typed AUTH_* errors
 * — corrupted storage can never yield a usable session and validation
 * NEVER degrades to an anonymous session.
 */

import { canonicalJson } from '@arena/protocol-core';
import {
  AUTH_ERROR_CODES,
  AuthError,
  isSessionExpired,
  toSessionStoreRecord,
  assertSessionStoreId,
  deepFreeze,
} from '@arena/auth';
import type { SessionRecord } from '@arena/auth';
import type {
  ControlPlaneRecord,
  ControlPlaneRepository,
  CoordinationStore,
  Clock,
} from '@arena/persistence';
import {
  PERSISTENCE_ERROR_CODES,
  PersistenceError,
  SystemClock,
  isRecordId,
  toCoordinationKey,
  toRecordData,
} from '@arena/persistence';
import type { CoordinationKey, JsonSafeValue } from '@arena/persistence';

/** Control-plane record kind: one record per session (recordId = session id). */
export const SESSION_RECORD_KIND = 'arena-session' as const;

/** Control-plane record kind: the per-principal revocation-epoch counter. */
export const SESSION_EPOCH_RECORD_KIND = 'arena-session-epoch' as const;

/** Wire version of the stored session-record payload. */
export const STORED_SESSION_DATA_VERSION = 1 as const;

/** The rotation-lease holder identity (neutral; no provider vocabulary). */
export const ROTATION_LEASE_HOLDER = 'arena-auth-service' as const;

/** Default TTL of the revocation-epoch read-through cache (ms). */
export const DEFAULT_EPOCH_CACHE_TTL_MS = 5_000;

/** Default TTL of the one-time rotation lease (ms). */
export const DEFAULT_ROTATION_LEASE_TTL_MS = 30_000;

/** Page size when enumerating session records for a principal. */
const SESSION_SCAN_PAGE_SIZE = 100;

/** Closed status vocabulary of a stored session record. */
const STORED_STATUSES = Object.freeze(['live', 'revoked', 'rotated'] as const);

type StoredStatus = (typeof STORED_STATUSES)[number];

/** The JSON-safe payload stored inside a control-plane session record. */
interface StoredSessionData {
  readonly recordVersion: typeof STORED_SESSION_DATA_VERSION;
  readonly session: SessionRecord;
  readonly status: StoredStatus;
  readonly supersededBy?: string;
}

/** A parsed, validated stored session (with its optimistic revision). */
interface StoredSession {
  readonly session: SessionRecord;
  readonly status: StoredStatus;
  readonly revision: number;
  readonly data: StoredSessionData;
}

export interface ControlPlaneSessionStoreOptions {
  /** The authoritative control-plane port (B002, injected). */
  readonly controlPlane: ControlPlaneRepository;
  /** The bounded/rebuildable coordination port (B002, injected). */
  readonly coordination: CoordinationStore;
  /** Injected time source; defaults to the system clock. */
  readonly clock?: Clock;
  /**
   * TTL of the revocation-epoch read-through cache. `0` disables caching
   * entirely (every validation reads the authoritative epoch record);
   * losing or expiring the cache can only make validation STRICTER, never
   * more permissive, because the cache is invalidated on every bump.
   */
  readonly epochCacheTtlMs?: number;
  /** TTL of the one-time rotation lease (concurrent-rotation guard). */
  readonly rotationLeaseTtlMs?: number;
}

/** The recordId of a principal's revocation-epoch counter (fail closed). */
function epochRecordId(principalId: string): string {
  const recordId = `arena-session-epoch.${principalId}`;
  if (!isRecordId(recordId)) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `the principal id does not yield a valid epoch record id: ${JSON.stringify(principalId)}`,
    });
  }
  return recordId;
}

/** The coordination cache key of a principal's revocation epoch. */
function epochCacheKey(principalId: string): CoordinationKey {
  return toCoordinationKey(`arena-session-epoch:${principalId}`);
}

/** The coordination lease key guarding one-time rotation of a session. */
function rotationLeaseKey(sessionId: string): CoordinationKey {
  return toCoordinationKey(`arena-session-rotate:${sessionId}`);
}

/** Replay fingerprint: everything except the provisional epoch. */
function sessionFingerprint(session: SessionRecord): string {
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

/** Wrap a port failure as the typed AUTH_STORE_FAILED error (cause kept). */
function wrapPortFailure(operation: string, cause: unknown): AuthError {
  return new AuthError(AUTH_ERROR_CODES.STORE_FAILED, {
    message: `the session store port failed during ${operation}`,
    cause,
  });
}

/** True when a thrown value is a PersistenceError with the given code. */
function isPersistenceCode(error: unknown, code: string): boolean {
  return error instanceof PersistenceError && error.code === code;
}

/**
 * The durable SessionStore over the B002 ports. Implements the exact
 * semantics the shared contract suite asserts (issue/validate/rotate/
 * revoke/revokeAllForPrincipal — typed outcomes, one-time rotation,
 * epoch-stamped issuance).
 */
export class ControlPlaneSessionStore {
  private readonly controlPlane: ControlPlaneRepository;
  private readonly coordination: CoordinationStore;
  private readonly clock: Clock;
  private readonly epochCacheTtlMs: number;
  private readonly rotationLeaseTtlMs: number;

  constructor(options: ControlPlaneSessionStoreOptions) {
    if (typeof options.controlPlane?.insert !== 'function') {
      throw new AuthError(AUTH_ERROR_CODES.STORE_FAILED, {
        message: 'ControlPlaneSessionStore requires an injected ControlPlaneRepository',
      });
    }
    if (typeof options.coordination?.cacheGet !== 'function') {
      throw new AuthError(AUTH_ERROR_CODES.STORE_FAILED, {
        message: 'ControlPlaneSessionStore requires an injected CoordinationStore',
      });
    }
    this.controlPlane = options.controlPlane;
    this.coordination = options.coordination;
    this.clock = options.clock ?? new SystemClock();
    this.epochCacheTtlMs = options.epochCacheTtlMs ?? DEFAULT_EPOCH_CACHE_TTL_MS;
    this.rotationLeaseTtlMs =
      options.rotationLeaseTtlMs ?? DEFAULT_ROTATION_LEASE_TTL_MS;
    if (
      !Number.isInteger(this.epochCacheTtlMs) ||
      this.epochCacheTtlMs < 0
    ) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_TTL, {
        message: 'epochCacheTtlMs must be a non-negative integer (0 disables caching)',
      });
    }
    if (
      !Number.isInteger(this.rotationLeaseTtlMs) ||
      this.rotationLeaseTtlMs <= 0
    ) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_TTL, {
        message: 'rotationLeaseTtlMs must be a positive integer',
      });
    }
  }

  async issue(session: SessionRecord): Promise<SessionRecord> {
    const validated = toSessionStoreRecord(session);
    const sessionId = assertSessionStoreId(validated.sessionId);
    try {
      const existing = await this.fetchStored(sessionId);
      if (existing !== null) {
        if (
          existing.status === 'live' &&
          sessionFingerprint(existing.session) === sessionFingerprint(validated)
        ) {
          return existing.session; // idempotent replay
        }
        throw new AuthError(AUTH_ERROR_CODES.SESSION_EXISTS, {
          message: `a different session already exists under id ${JSON.stringify(sessionId)}`,
          details: { sessionId },
        });
      }
      const epoch = await this.currentEpoch(validated.principal.principalId);
      const stored = deepFreeze({ ...validated, revocationEpoch: epoch });
      const inserted = await this.controlPlane.insert({
        recordId: sessionId,
        tenantId: String(stored.tenantId),
        kind: SESSION_RECORD_KIND,
        version: STORED_SESSION_DATA_VERSION,
        data: this.toStoredData(stored, 'live'),
      });
      if (!inserted.created) {
        // A concurrent writer inserted the same id with different content.
        throw new AuthError(AUTH_ERROR_CODES.SESSION_EXISTS, {
          message: `a different session already exists under id ${JSON.stringify(sessionId)}`,
          details: { sessionId },
        });
      }
      return this.parseStored(inserted.record).session;
    } catch (error) {
      throw this.mapInsertFailure(error, sessionId);
    }
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    assertSessionStoreId(sessionId);
    const stored = await this.fetchStored(sessionId);
    if (stored === null) return null;
    if (stored.status !== 'live') return null;
    if (isSessionExpired(stored.session, this.clock.now())) return null;
    if (await this.isEpochRevoked(stored.session)) return null;
    return stored.session;
  }

  async validate(sessionId: string): Promise<
    import('@arena/auth').SessionValidationOutcome
  > {
    assertSessionStoreId(sessionId);
    const stored = await this.fetchStored(sessionId);
    if (stored === null) return { status: 'unknown', session: null };
    if (stored.status === 'revoked') return { status: 'revoked', session: null };
    if (stored.status === 'rotated') return { status: 'rotated', session: null };
    if (isSessionExpired(stored.session, this.clock.now())) {
      return { status: 'expired', session: null };
    }
    if (await this.isEpochRevoked(stored.session)) {
      return { status: 'revoked', session: null };
    }
    return { status: 'valid', session: stored.session };
  }

  async rotate(sessionId: string, next: SessionRecord): Promise<SessionRecord> {
    assertSessionStoreId(sessionId);
    const validatedNext = toSessionStoreRecord(next);
    const nextId = assertSessionStoreId(validatedNext.sessionId);

    // One-time rotation guard: a live lease means a concurrent rotation.
    const leaseKey = rotationLeaseKey(sessionId);
    const acquired = await this.coordination
      .acquireLease(leaseKey, ROTATION_LEASE_HOLDER, this.rotationLeaseTtlMs)
      .catch((error: unknown): never => {
        throw wrapPortFailure('rotation-lease acquisition', error);
      });
    if (!acquired) {
      throw new AuthError(AUTH_ERROR_CODES.ROTATION_CONFLICT, {
        message: `session ${JSON.stringify(sessionId)} is already being rotated concurrently`,
        details: { sessionId },
      });
    }
    try {
      const stored = await this.fetchStored(sessionId);
      if (stored === null) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_NOT_FOUND, {
          message: `session ${JSON.stringify(sessionId)} does not exist and cannot rotate`,
          details: { sessionId },
        });
      }
      if (stored.status === 'revoked') {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_REVOKED, {
          message: `session ${JSON.stringify(sessionId)} was revoked and cannot rotate`,
          details: { sessionId },
        });
      }
      if (stored.status === 'rotated') {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_ROTATED, {
          message: `session ${JSON.stringify(sessionId)} was already rotated`,
          details: { sessionId, supersededBy: stored.data.supersededBy ?? null },
        });
      }
      const now = this.clock.now();
      if (isSessionExpired(stored.session, now)) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_EXPIRED, {
          message: `session ${JSON.stringify(sessionId)} expired and cannot rotate`,
          details: { sessionId },
        });
      }
      if (await this.isEpochRevoked(stored.session)) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_REVOKED, {
          message: `session ${JSON.stringify(sessionId)} was revoked by epoch and cannot rotate`,
          details: { sessionId },
        });
      }
      if ((await this.fetchStored(nextId)) !== null) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_EXISTS, {
          message: `the rotation target id ${JSON.stringify(nextId)} already exists`,
          details: { sessionId: nextId },
        });
      }

      const epoch = await this.currentEpoch(validatedNext.principal.principalId);
      const stamped = deepFreeze({ ...validatedNext, revocationEpoch: epoch });
      const inserted = await this.controlPlane.insert({
        recordId: nextId,
        tenantId: String(stamped.tenantId),
        kind: SESSION_RECORD_KIND,
        version: STORED_SESSION_DATA_VERSION,
        data: this.toStoredData(stamped, 'live'),
      });
      if (!inserted.created) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_EXISTS, {
          message: `the rotation target id ${JSON.stringify(nextId)} already exists`,
          details: { sessionId: nextId },
        });
      }
      try {
        await this.controlPlane.update(sessionId, {
          expectedRevision: stored.revision,
          data: this.toStoredData(stored.session, 'rotated', nextId),
        });
      } catch (error) {
        if (isPersistenceCode(error, PERSISTENCE_ERROR_CODES.REVISION_CONFLICT)) {
          throw new AuthError(AUTH_ERROR_CODES.ROTATION_CONFLICT, {
            message: `session ${JSON.stringify(sessionId)} was rotated concurrently`,
            details: { sessionId },
          });
        }
        throw error;
      }
      return this.parseStored(inserted.record).session;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (isPersistenceCode(error, PERSISTENCE_ERROR_CODES.RECORD_EXISTS)) {
        throw new AuthError(AUTH_ERROR_CODES.SESSION_EXISTS, {
          message: `the rotation target id ${JSON.stringify(nextId)} already exists`,
          details: { sessionId: nextId },
        });
      }
      throw wrapPortFailure('session rotation', error);
    } finally {
      // The lease is advisory and TTL-bounded; release is best-effort.
      await this.coordination
        .releaseLease(leaseKey, ROTATION_LEASE_HOLDER)
        .catch(() => undefined);
    }
  }

  async revoke(sessionId: string): Promise<boolean> {
    assertSessionStoreId(sessionId);
    try {
      const stored = await this.fetchStored(sessionId);
      if (stored === null) return false;
      if (stored.status !== 'live') return false;
      if (isSessionExpired(stored.session, this.clock.now())) return false;
      if (await this.isEpochRevoked(stored.session)) return false;
      await this.controlPlane.update(sessionId, {
        expectedRevision: stored.revision,
        data: this.toStoredData(stored.session, 'revoked'),
      });
      return true;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (isPersistenceCode(error, PERSISTENCE_ERROR_CODES.REVISION_CONFLICT)) {
        // A concurrent writer changed the record first: THIS call did not
        // tombstone a live session, so it reports false (never a phantom
        // revocation, never a crash).
        return false;
      }
      throw wrapPortFailure('session revocation', error);
    }
  }

  async revokeAllForPrincipal(principalId: string): Promise<number> {
    if (typeof principalId !== 'string' || principalId.length === 0) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_PRINCIPAL, {
        message: 'revokeAllForPrincipal requires a non-empty principal id',
      });
    }
    const recordId = epochRecordId(principalId);
    try {
      const before = await this.currentEpoch(principalId);
      // Enumerate the principal's session records (authoritative scan).
      const sessions = await this.scanSessionsForPrincipal(principalId);
      const now = this.clock.now();
      let live = 0;
      let tenant: string | null = null;
      for (const stored of sessions) {
        if (stored.session.principal.principalId !== principalId) continue;
        if (tenant === null) tenant = String(stored.session.tenantId);
        if (stored.status !== 'live') continue;
        if (isSessionExpired(stored.session, now)) continue;
        if (stored.session.revocationEpoch < before) continue; // already dead
        live += 1;
      }
      if (tenant === null) {
        // No session record has ever existed for this principal: nothing
        // to invalidate and no epoch counter to create.
        return 0;
      }
      // Bump the authoritative epoch counter under the principal's tenant.
      const existing = await this.controlPlane.get(recordId);
      const nextEpoch = before + 1;
      const epochData = toRecordData({
        recordVersion: 1,
        principalId,
        epoch: nextEpoch,
      });
      if (existing === null) {
        await this.controlPlane.insert({
          recordId,
          tenantId: tenant,
          kind: SESSION_EPOCH_RECORD_KIND,
          version: 1,
          data: epochData,
        });
      } else {
        await this.controlPlane.update(recordId, {
          expectedRevision: existing.revision,
          data: epochData,
        });
      }
      // Invalidate the epoch cache so revocation takes effect immediately.
      await this.coordination.cacheDelete(epochCacheKey(principalId));
      return live;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (isPersistenceCode(error, PERSISTENCE_ERROR_CODES.REVISION_CONFLICT)) {
        throw new AuthError(AUTH_ERROR_CODES.ROTATION_CONFLICT, {
          message: 'the revocation epoch was bumped concurrently',
          details: { principalId },
        });
      }
      throw wrapPortFailure('principal-wide revocation', error);
    }
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private toStoredData(
    session: SessionRecord,
    status: StoredStatus,
    supersededBy?: string,
  ): JsonSafeValue {
    // toRecordData is the B002 runtime JSON-safety gate (typed JsonSafeValue
    // out; a non-JSON-safe payload throws the typed persistence error, which
    // issue/rotate map onto AUTH_STORE_FAILED — fail closed, never stored).
    return toRecordData({
      recordVersion: STORED_SESSION_DATA_VERSION,
      session,
      status,
      ...(supersededBy !== undefined ? { supersededBy } : {}),
    });
  }

  /** Fetch + strictly parse the stored session record (null when absent). */
  private async fetchStored(sessionId: string): Promise<StoredSession | null> {
    let record: ControlPlaneRecord | null;
    try {
      record = await this.controlPlane.get(sessionId);
    } catch (error) {
      throw wrapPortFailure('session lookup', error);
    }
    if (record === null) return null;
    if (record.kind !== SESSION_RECORD_KIND) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
        message: `record ${JSON.stringify(sessionId)} is not a session record`,
      });
    }
    return this.parseStored(record);
  }

  /** Strict, fail-closed parse of a stored record's payload. */
  private parseStored(record: ControlPlaneRecord): StoredSession {
    const data = record.data as unknown;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
        message: 'a stored session payload must be a plain object',
      });
    }
    const payload = data as Record<string, unknown>;
    if (payload['recordVersion'] !== STORED_SESSION_DATA_VERSION) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
        message: `unsupported stored-session recordVersion ${String(payload['recordVersion'])}`,
      });
    }
    const status = payload['status'];
    if (
      typeof status !== 'string' ||
      !STORED_STATUSES.includes(status as StoredStatus)
    ) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
        message: `unknown stored-session status ${String(status)}`,
      });
    }
    const supersededBy = payload['supersededBy'];
    if (
      supersededBy !== undefined &&
      (typeof supersededBy !== 'string' || supersededBy.length === 0)
    ) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
        message: 'supersededBy must be a non-empty string when present',
      });
    }
    let session: SessionRecord;
    try {
      // toSessionStoreRecord passes structurally valid records through
      // UNCHANGED (reference-preserving read discipline) and strict-parses
      // anything else — corrupted storage can never yield a usable session.
      session = toSessionStoreRecord(payload['session']);
    } catch (cause) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
        message: 'the stored session record failed strict revalidation (fail closed)',
        cause,
      });
    }
    // Integrity: the control-plane recordId IS the session id.
    if (String(session.sessionId) !== record.recordId) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
        message: 'stored session id does not match its control-plane record id',
      });
    }
    return {
      session,
      status: status as StoredStatus,
      revision: record.revision,
      data: payload as unknown as StoredSessionData,
    };
  }

  /** The principal's CURRENT revocation epoch (read-through cache). */
  private async currentEpoch(principalId: string): Promise<number> {
    const key = epochCacheKey(principalId);
    if (this.epochCacheTtlMs > 0) {
      const cached = await this.coordination.cacheGet(key).catch(
        (error: unknown): never => {
          throw wrapPortFailure('epoch cache lookup', error);
        },
      );
      // An unparsable cache value is treated as a miss: the cache is
      // rebuildable from the authoritative control-plane record.
      if (cached !== null && /^\d+$/.test(cached)) {
        return Number(cached);
      }
    }
    const recordId = epochRecordId(principalId);
    let record: ControlPlaneRecord | null;
    try {
      record = await this.controlPlane.get(recordId);
    } catch (error) {
      throw wrapPortFailure('epoch record lookup', error);
    }
    let epoch = 0;
    if (record !== null) {
      if (record.kind !== SESSION_EPOCH_RECORD_KIND) {
        throw new AuthError(AUTH_ERROR_CODES.STORE_FAILED, {
          message: `record ${JSON.stringify(recordId)} is not a revocation-epoch record`,
        });
      }
      const payload = record.data as unknown;
      if (
        typeof payload !== 'object' ||
        payload === null ||
        Array.isArray(payload) ||
        (payload as Record<string, unknown>)['recordVersion'] !== 1 ||
        (payload as Record<string, unknown>)['principalId'] !== principalId
      ) {
        throw new AuthError(AUTH_ERROR_CODES.STORE_FAILED, {
          message: 'the stored revocation-epoch record failed validation (fail closed)',
        });
      }
      const value = (payload as Record<string, unknown>)['epoch'];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new AuthError(AUTH_ERROR_CODES.STORE_FAILED, {
          message: 'the stored revocation epoch must be a non-negative integer',
        });
      }
      epoch = value;
    }
    if (this.epochCacheTtlMs > 0) {
      try {
        await this.coordination.cacheSet(key, String(epoch), this.epochCacheTtlMs);
      } catch (error) {
        throw wrapPortFailure('epoch cache write', error);
      }
    }
    return epoch;
  }

  /** True when the session's epoch is below the principal's current epoch. */
  private async isEpochRevoked(session: SessionRecord): Promise<boolean> {
    const current = await this.currentEpoch(session.principal.principalId);
    return session.revocationEpoch < current;
  }

  /** Enumerate every stored session record for a principal (all tenants). */
  private async scanSessionsForPrincipal(
    principalId: string,
  ): Promise<readonly StoredSession[]> {
    const found: StoredSession[] = [];
    try {
      let offset = 0;
      for (;;) {
        const page = await this.controlPlane.list({
          kind: SESSION_RECORD_KIND,
          limit: SESSION_SCAN_PAGE_SIZE,
          offset,
        });
        for (const record of page) {
          const stored = this.parseStored(record);
          if (stored.session.principal.principalId === principalId) {
            found.push(stored);
          }
        }
        if (page.length < SESSION_SCAN_PAGE_SIZE) break;
        offset += page.length;
      }
      return found;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw wrapPortFailure('session enumeration', error);
    }
  }

  /** Map port insert failures onto the typed auth vocabulary. */
  private mapInsertFailure(error: unknown, sessionId: string): unknown {
    if (error instanceof AuthError) return error;
    if (isPersistenceCode(error, PERSISTENCE_ERROR_CODES.RECORD_EXISTS)) {
      return new AuthError(AUTH_ERROR_CODES.SESSION_EXISTS, {
        message: `a different session already exists under id ${JSON.stringify(sessionId)}`,
        details: { sessionId },
      });
    }
    return wrapPortFailure('session issuance', error);
  }
}
