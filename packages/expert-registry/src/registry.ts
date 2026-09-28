/**
 * The ExpertRegistry — an append-only, tenant-scoped, in-memory query API
 * over expert profiles (Work Order A006 gates 4 and 6;
 * architecture-lock rules 6, 11).
 *
 * The registry is a PURE DATA STRUCTURE in the convention of
 * @arena/capability-case's CaseRegistry: every admission returns a NEW
 * deep-frozen registry; there is no mutation, no delete, no rewrite. Its
 * three invariants are machine-enforced:
 *
 *   1. APPEND-ONLY ADMISSION. `registerExpert` admits a fresh draft
 *      profile (or the idempotent re-assertion of an already-admitted
 *      exact state) and appends exactly one ExpertRegistrationRecord to
 *      the admission log. `recordProfileState` admits the next state of
 *      an admitted profile version ONLY when
 *      `assertProfileHistoryAppendOnly` holds (evidence/task/reliability/
 *      history prefixes preserved) and the appended lifecycle event
 *      matches the state change. `recordSupersession` admits a NEW profile
 *      version ONLY when it supersedes the current version (strictly
 *      higher semver, supersedes ref addressing the current admitted
 *      state, history extension across versions — lock rule 6 holds
 *      ACROSS versions too).
 *
 *   2. TENANT SCOPING (lock rule 11). Every profile carries its owning
 *      tenant scope; every read states the reading tenant. A profile is
 *      visible to a reader iff the reader's tenant equals the profile's
 *      tenant OR the profile lives in the reserved `public` namespace.
 *      Cross-tenant reads fail closed with EXPERT_CROSS_TENANT_ACCESS.
 *      Mutating admissions additionally require the acting principal's
 *      tenant to equal the profile's tenant (no cross-tenant profile
 *      editing — customer data cannot be silently cross-reused).
 *
 *   3. ADDRESSABILITY. Every admitted state stays addressable by its
 *      digest forever: `getExpertByDigest` returns any historical state
 *      (tenant-checked), `listExpertVersions` walks a logical expert's
 *      version history, and `getExpert` returns the current (or explicit
 *      version's latest) state. A superseded version is NEVER evicted.
 *
 * Registration records (gate 4): `registrations` is the append-only
 * admission log — sequence, timestamp, recording principal, the admitted
 * profile state and, for supersessions, the superseded state's ref. The
 * log itself is content: re-registering the same digest is idempotent
 * (returns the registry unchanged — no duplicate record), while a
 * DIFFERENT profile under the same neutral expert id is rejected with
 * EXPERT_IDENTITY_CONFLICT (the first registration wins).
 */

import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import {
  expertLogicalKey,
  expertVersionKey,
  formatExpertVersionRef,
} from './identity.js';
import { expertVersionRef } from './profile.js';
import type { ExpertProfile } from './profile.js';
import { isTerminalProfile, assertProfileHistoryAppendOnly } from './lifecycle.js';
import {
  assertNoDuplicateEvidence,
  compareExpertVersions,
  deepFreeze,
  isPrincipalRefView,
  isTenantScope,
  isTenantVisible,
  toPrincipalRefView,
} from './shared.js';
import type { PrincipalRefLike, TenantScope } from './shared.js';
import { toTaskHistory, assertTaskHistoryAppendOnly } from './task-history.js';
import { assertReliabilityAppendOnly } from './reliability.js';
import { toExpertRegistryTimestamp } from './timestamp.js';

// ---------------------------------------------------------------------------
// Registry shape (plain frozen arrays — canonical objects never carry Maps)
// ---------------------------------------------------------------------------

/** Wire version of the registration record shape. */
export const EXPERT_REGISTRATION_RECORD_VERSION = 1 as const;

/**
 * One append-only registration record: the admission of one profile state
 * into the registry (initial registration, a lifecycle state record, or a
 * superseding version).
 */
export interface ExpertRegistrationRecord {
  readonly recordVersion: typeof EXPERT_REGISTRATION_RECORD_VERSION;
  /** 1-based admission order across the whole registry. */
  readonly sequence: number;
  readonly registeredAt: string;
  readonly registeredBy: ReturnType<typeof toPrincipalRefView>;
  /** The admitted profile state (content-addressed by its own digest). */
  readonly profile: ExpertProfile;
  /** Only on supersession admissions: the superseded state's version ref. */
  readonly supersedes?: ReturnType<typeof expertVersionRef>;
}

/**
 * The append-only expert registry. `registrations` is the full admission
 * log (every admitted state, in admission order); all lookups are
 * derivable indices (module-private WeakMap cache, the capability-case
 * convention).
 */
export interface ExpertRegistry {
  /** Every registration record, in admission order. Never rewritten. */
  readonly registrations: readonly ExpertRegistrationRecord[];
}

const INDICES = new WeakMap<ExpertRegistry, RegistryIndices>();

interface RegistryIndices {
  /** digest → profile state */
  readonly byDigest: Map<string, ExpertProfile>;
  /** logical key → current version's latest state */
  readonly current: Map<string, ExpertProfile>;
  /** logical key → all states, grouped by version key, latest last */
  readonly versions: Map<string, Map<string, ExpertProfile>>;
}

function buildIndices(registry: ExpertRegistry): RegistryIndices {
  const byDigest = new Map<string, ExpertProfile>();
  const current = new Map<string, ExpertProfile>();
  const versions = new Map<string, Map<string, ExpertProfile>>();
  for (const record of registry.registrations) {
    const profile = record.profile;
    byDigest.set(profile.digest, profile);
    const logicalKey = expertLogicalKey(profile.identity);
    const versionKey = expertVersionKey({
      tenant: profile.identity.tenant,
      expertId: profile.identity.expertId,
      version: profile.version,
    });
    let byVersion = versions.get(logicalKey);
    if (byVersion === undefined) {
      byVersion = new Map<string, ExpertProfile>();
      versions.set(logicalKey, byVersion);
    }
    byVersion.set(versionKey, profile);
    // The logical expert's CURRENT state is its LATEST admitted state —
    // even a superseded-marked one (the expert is honestly "currently
    // superseded" until the superseding version is registered). Later
    // admissions win; the admission paths guarantee versions only advance
    // (registerExpert → first state, recordProfileState → same version,
    // recordSupersession → strictly higher version).
    current.set(logicalKey, profile);
  }
  return { byDigest, current, versions };
}

function indicesOf(registry: ExpertRegistry): RegistryIndices {
  let indices = INDICES.get(registry);
  if (indices === undefined) {
    indices = buildIndices(registry);
    INDICES.set(registry, indices);
  }
  return indices;
}

/** Create an empty expert registry. */
export function createExpertRegistry(): ExpertRegistry {
  return deepFreeze({ registrations: Object.freeze([]) });
}

export function isExpertRegistry(value: unknown): value is ExpertRegistry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['registrations']) &&
    candidate['registrations'].every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record<string, unknown>)['sequence'] === 'number' &&
        typeof (entry as Record<string, unknown>)['profile'] === 'object',
    )
  );
}

// ---------------------------------------------------------------------------
// Admission guards
// ---------------------------------------------------------------------------

function requireReaderTenant(tenant: string): TenantScope {
  if (!isTenantScope(tenant)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid reader tenant scope: ${JSON.stringify(tenant)}`,
    });
  }
  return tenant;
}

/**
 * Fail closed unless `profile` is visible to a reader acting as
 * `readerTenant` (lock rule 11; the reserved public namespace is globally
 * readable).
 */
function assertReadable(profile: ExpertProfile, readerTenant: string): void {
  if (!isTenantVisible(profile.identity.tenant, readerTenant)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.CROSS_TENANT_ACCESS, {
      message: `cross-tenant access denied: expert ${JSON.stringify(profile.identity.expertId)} belongs to tenant ${JSON.stringify(profile.identity.tenant)} and is not visible to tenant ${JSON.stringify(readerTenant)} (customer data is tenant-scoped — architecture-lock rule 11)`,
      details: {
        profileTenant: profile.identity.tenant,
        readerTenant,
        expertId: profile.identity.expertId,
      },
    });
  }
}

/** Fail closed unless the acting principal's tenant matches the profile's. */
function assertSameTenantActor(profile: ExpertProfile, actorTenant: string): void {
  if (actorTenant !== profile.identity.tenant) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.CROSS_TENANT_ACCESS, {
      message: `cross-tenant mutation denied: actor from tenant ${JSON.stringify(actorTenant)} cannot mutate a profile owned by tenant ${JSON.stringify(profile.identity.tenant)} (lock rule 11)`,
      details: {
        profileTenant: profile.identity.tenant,
        actorTenant,
        expertId: profile.identity.expertId,
      },
    });
  }
}

function admitted(registry: ExpertRegistry, digest: string): ExpertProfile | undefined {
  return indicesOf(registry).byDigest.get(digest);
}

/** Validation context for an admission (all inputs explicit). */
export interface RegistrationContext {
  readonly registeredBy: PrincipalRefLike;
  readonly registeredAt: string;
}

function registrationContextOf(
  context: RegistrationContext,
): {
  registeredBy: ReturnType<typeof toPrincipalRefView>;
  registeredAt: string;
} {
  if (!isPrincipalRefView(context.registeredBy)) {
    toPrincipalRefView(context.registeredBy); // throws the precise error
  }
  return {
    registeredBy: toPrincipalRefView(context.registeredBy),
    registeredAt: toExpertRegistryTimestamp(context.registeredAt),
  };
}

function appendRecord(
  registry: ExpertRegistry,
  context: { registeredBy: ReturnType<typeof toPrincipalRefView>; registeredAt: string },
  profile: ExpertProfile,
  supersedes?: ReturnType<typeof expertVersionRef>,
): ExpertRegistry {
  const record: ExpertRegistrationRecord = deepFreeze({
    recordVersion: EXPERT_REGISTRATION_RECORD_VERSION,
    sequence: registry.registrations.length + 1,
    registeredAt: context.registeredAt,
    registeredBy: context.registeredBy,
    profile,
    ...(supersedes !== undefined ? { supersedes } : {}),
  });
  return deepFreeze({
    registrations: Object.freeze([...registry.registrations, record]),
  });
}

// ---------------------------------------------------------------------------
// Admission: initial registration
// ---------------------------------------------------------------------------

/**
 * Register an expert: the FIRST state of a logical expert (a fresh draft
 * profile whose history is exactly one `profile-created` event), or the
 * IDEMPOTENT re-assertion of an already-admitted exact state (same digest
 * — the registry is returned unchanged, no duplicate record). Throws
 * EXPERT_IDENTITY_CONFLICT when a different state is already registered
 * under the same (tenant, expertId) — the first registration wins and is
 * never rewritten.
 */
export function registerExpert(
  registry: ExpertRegistry,
  profile: ExpertProfile,
  context: RegistrationContext,
): ExpertRegistry {
  const validated = registrationContextOf(context);
  assertSameTenantActor(profile, validated.registeredBy.tenant);
  const logicalKey = expertLogicalKey(profile.identity);
  const indices = indicesOf(registry);
  const existingCurrent = indices.current.get(logicalKey);
  if (existingCurrent !== undefined || indices.versions.get(logicalKey)?.size) {
    // Idempotent re-assertion of the exact same state is a no-op.
    if (admitted(registry, profile.digest) !== undefined) return registry;
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.IDENTITY_CONFLICT, {
      message: `expert ${JSON.stringify(profile.identity.expertId)} is already registered in tenant ${JSON.stringify(profile.identity.tenant)} (first registration wins; use recordSupersession for new versions)`,
      details: {
        tenant: profile.identity.tenant,
        expertId: profile.identity.expertId,
        registeredVersion: existingCurrent?.version ?? 'superseded-history',
        incomingVersion: profile.version,
        registeredDigest: existingCurrent?.digest,
        incomingDigest: profile.digest,
      },
    });
  }
  if (
    profile.lifecycle.length !== 1 ||
    profile.lifecycle[0]?.kind !== 'profile-created'
  ) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIFECYCLE, {
      message: `initial registration requires a fresh draft profile (exactly one profile-created event), got ${profile.lifecycle.length} event(s) in status ${profile.status}`,
      details: {
        expertId: profile.identity.expertId,
        status: profile.status,
        events: profile.lifecycle.length,
      },
    });
  }
  if (profile.status !== 'draft') {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIFECYCLE, {
      message: `initial registration requires status "draft", got ${JSON.stringify(profile.status)}`,
      details: { expertId: profile.identity.expertId, status: profile.status },
    });
  }
  if (profile.supersededBy !== undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIFECYCLE, {
      message: 'a fresh profile cannot carry a supersededBy ref',
      details: { expertId: profile.identity.expertId },
    });
  }
  return appendRecord(registry, validated, profile);
}

// ---------------------------------------------------------------------------
// Admission: lifecycle states (append-only within a version)
// ---------------------------------------------------------------------------

/**
 * Find the prior admitted state a `next` profile state extends: the latest
 * recorded state of the same profile version whose history is a strict
 * prefix of `next`'s history. Returns the prior state, or `undefined`
 * when `next` is already admitted (idempotent), or `null` when no prior
 * state exists.
 */
function findPriorState(
  registry: ExpertRegistry,
  next: ExpertProfile,
): ExpertProfile | undefined | null {
  if (admitted(registry, next.digest) !== undefined) return undefined;
  const logicalKey = expertLogicalKey(next.identity);
  const versionKey = expertVersionKey({
    tenant: next.identity.tenant,
    expertId: next.identity.expertId,
    version: next.version,
  });
  const latest = indicesOf(registry).versions.get(logicalKey)?.get(versionKey);
  if (latest === undefined) return null;
  return latest;
}

/**
 * Record the next state of an already-admitted profile version (produced
 * by the pure transition functions: publishProfile, suspendProfile,
 * reinstateProfile, retireProfile, supersedeProfile, attachExpertEvidence,
 * recordTaskHistory, recordReliabilityOutcome). Fails closed unless:
 *   - the previous state (by digest) is admitted and is the version's
 *     latest recorded state;
 *   - `assertProfileHistoryAppendOnly(previous, next)` holds (evidence +
 *     task history + reliability + history prefixes preserved — lock
 *     rule 6);
 *   - the appended event matches the state change (from → to);
 *   - the acting principal's tenant matches the profile's tenant (lock
 *     rule 11).
 */
export function recordProfileState(
  registry: ExpertRegistry,
  next: ExpertProfile,
  context: RegistrationContext,
): ExpertRegistry {
  const validated = registrationContextOf(context);
  assertSameTenantActor(next, validated.registeredBy.tenant);
  const prior = findPriorState(registry, next);
  if (prior === undefined) return registry; // idempotent re-assertion
  if (prior === null) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.EXPERT_NOT_FOUND, {
      message: `cannot record a state for an unregistered profile version: ${expertLogicalKey(next.identity)}@${next.version} (register the expert first)`,
      details: {
        expert: expertLogicalKey(next.identity),
        version: next.version,
      },
    });
  }
  const previous = prior;
  if (isTerminalProfile(previous)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.TERMINAL_STATE, {
      message: `expert ${JSON.stringify(previous.identity.expertId)}@${JSON.stringify(previous.version)} is ${previous.status}: terminal states are final and admit no further recorded states`,
      details: {
        tenant: previous.identity.tenant,
        expertId: previous.identity.expertId,
        version: previous.version,
        status: previous.status,
      },
    });
  }
  assertProfileHistoryAppendOnly(previous, next);

  const appended = next.lifecycle[next.lifecycle.length - 1];
  if (appended === undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIFECYCLE, {
      message: 'a recorded state must append exactly one lifecycle event',
      details: { expertId: next.identity.expertId },
    });
  }
  if (appended.fromStatus !== previous.status || appended.toStatus !== next.status) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TRANSITION, {
      message: `recorded transition event does not match the state change: event says ${appended.fromStatus} → ${appended.toStatus}, states say ${previous.status} → ${next.status}`,
      details: {
        expertId: next.identity.expertId,
        eventFrom: appended.fromStatus,
        eventTo: appended.toStatus,
        stateFrom: previous.status,
        stateTo: next.status,
      },
    });
  }
  if (next.supersededBy !== undefined && appended.kind !== 'profile-superseded') {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_SUPERSESSION, {
      message: 'a supersededBy ref may only appear with a profile-superseded event',
      details: { expertId: next.identity.expertId },
    });
  }
  // Event/growth consistency: an appended structured event must match
  // EXACTLY the corresponding growth of the recorded state (a state
  // cannot claim appends while dropping or inventing them).
  if (appended.kind === 'evidence-attached') {
    const appendedEvidence = appended.evidenceAppended ?? [];
    const expected: ExpertProfile['evidence'][number][] = [
      ...previous.evidence,
      ...appendedEvidence,
    ];
    if (
      next.evidence.length !== expected.length ||
      next.evidence.some(
        (ref, i) =>
          expected[i]?.digest !== ref.digest ||
          expected[i]?.description !== ref.description,
      )
    ) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_EVIDENCE, {
        message: `recorded evidence-attached event does not match the state's evidence growth (expected ${expected.length} ref(s) after append, got ${next.evidence.length})`,
        details: {
          expertId: next.identity.expertId,
          expectedCount: expected.length,
          actualCount: next.evidence.length,
        },
      });
    }
  }
  if (appended.kind === 'task-recorded') {
    const appendedRecords = appended.taskRecordAppended ?? [];
    if (next.taskHistory.length !== previous.taskHistory.length + appendedRecords.length) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
        message: `recorded task-recorded event does not match the state's task-history growth`,
        details: {
          expertId: next.identity.expertId,
          expectedCount: previous.taskHistory.length + appendedRecords.length,
          actualCount: next.taskHistory.length,
        },
      });
    }
  }
  if (appended.kind === 'reliability-recorded') {
    const appendedEntries = appended.reliabilityAppended ?? [];
    if (next.reliability.length !== previous.reliability.length + appendedEntries.length) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_RELIABILITY, {
        message: `recorded reliability-recorded event does not match the state's ledger growth`,
        details: {
          expertId: next.identity.expertId,
          expectedCount: previous.reliability.length + appendedEntries.length,
          actualCount: next.reliability.length,
        },
      });
    }
  }
  return appendRecord(registry, validated, next);
}

// ---------------------------------------------------------------------------
// Admission: supersession (new versions of a logical expert)
// ---------------------------------------------------------------------------

/**
 * Register a NEW VERSION of an admitted logical expert (created via
 * `createExpertProfile` with the `supersedes` ref pointing at the current
 * version's latest admitted state). Fails closed unless:
 *   - the new version is a fresh draft (single profile-created event);
 *   - `supersedes` addresses the current version's latest admitted state
 *     (same tenant/expertId, same digest) with STRICTLY lower semver
 *     precedence than the new version (enforced again here — defense in
 *     depth);
 *   - the new version's append-only lists EXTEND the superseded state's
 *     (evidence, task history, reliability — lock rule 6 across versions)
 *     and its declared identity refs are a superset (declared identity
 *     refs are never retracted);
 *   - the acting principal's tenant matches the profile's tenant.
 *
 * The superseded version's states all stay admitted and addressable —
 * nothing is evicted, nothing is rewritten (gate 5).
 */
export function recordSupersession(
  registry: ExpertRegistry,
  next: ExpertProfile,
  context: RegistrationContext,
): ExpertRegistry {
  const validated = registrationContextOf(context);
  assertSameTenantActor(next, validated.registeredBy.tenant);
  if (admitted(registry, next.digest) !== undefined) return registry;
  const logicalKey = expertLogicalKey(next.identity);
  const indices = indicesOf(registry);
  const current = indices.current.get(logicalKey);
  if (current === undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.EXPERT_NOT_FOUND, {
      message: `cannot register a superseding version for an unknown expert: ${logicalKey} (register the base version first)`,
      details: { expert: logicalKey },
    });
  }
  if (
    next.lifecycle.length !== 1 ||
    next.lifecycle[0]?.kind !== 'profile-created' ||
    next.status !== 'draft'
  ) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_SUPERSESSION, {
      message: `a superseding version must be a fresh draft (one profile-created event), got ${next.lifecycle.length} event(s) in status ${next.status}`,
      details: { expertId: next.identity.expertId },
    });
  }
  const supersedes = next.supersedes;
  if (supersedes === undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_SUPERSESSION, {
      message: `a superseding version must carry a supersedes ref (expected the current state ${formatExpertVersionRef(expertVersionRef(current))})`,
      details: { current: formatExpertVersionRef(expertVersionRef(current)) },
    });
  }
  if (
    supersedes.tenant !== current.identity.tenant ||
    supersedes.expertId !== current.identity.expertId
  ) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_SUPERSESSION, {
      message: `supersedes ref must address the same logical expert: ${JSON.stringify(supersedes.tenant)}/${JSON.stringify(supersedes.expertId)} vs ${logicalKey}`,
      details: { supersedes: formatExpertVersionRef(supersedes), expert: logicalKey },
    });
  }
  if (supersedes.version !== current.version || supersedes.digest !== current.digest) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_SUPERSESSION, {
      message: `supersedes ref must address the CURRENT admitted state of ${logicalKey}: expected ${formatExpertVersionRef(expertVersionRef(current))}, got ${formatExpertVersionRef(supersedes)}`,
      details: {
        expected: formatExpertVersionRef(expertVersionRef(current)),
        got: formatExpertVersionRef(supersedes),
      },
    });
  }
  if (compareExpertVersions(supersedes.version, next.version) >= 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_SUPERSESSION, {
      message: `superseding version must have strictly higher semver precedence: ${JSON.stringify(next.version)} does not supersede ${JSON.stringify(supersedes.version)}`,
      details: { supersedes: formatExpertVersionRef(supersedes), version: next.version },
    });
  }
  // Append-only monotonicity ACROSS versions (lock rule 6: history is
  // never rewritten — not even by a new profile version).
  if (next.evidence.length < current.evidence.length) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.EVIDENCE_REMOVAL, {
      message: `a superseding version cannot drop evidence: ${next.evidence.length} ref(s) vs the superseded version's ${current.evidence.length} (historical evidence is append-only — lock rule 6)`,
      details: {
        expertId: next.identity.expertId,
        supersededCount: current.evidence.length,
        supersedingCount: next.evidence.length,
      },
    });
  }
  for (let i = 0; i < current.evidence.length; i += 1) {
    const before = current.evidence[i];
    const after = next.evidence[i];
    if (
      before === undefined ||
      after === undefined ||
      before.digest !== after.digest ||
      before.description !== after.description
    ) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.EVIDENCE_REMOVAL, {
        message: `a superseding version cannot rewrite evidence at position ${i} (historical evidence is append-only — lock rule 6)`,
        details: { position: i },
      });
    }
  }
  // Task history and reliability must also extend across versions.
  assertTaskHistoryAppendOnly(current.taskHistory, next.taskHistory);
  assertReliabilityAppendOnly(current.reliability, next.reliability);
  // Declared identity refs are never retracted (superset discipline).
  const currentIdentityRefs = new Set(
    current.identityRefs.map((ref) => `${ref.kind}:${ref.digest}`),
  );
  for (const ref of next.identityRefs) {
    currentIdentityRefs.delete(`${ref.kind}:${ref.digest}`);
  }
  if (currentIdentityRefs.size > 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_IDENTITY_REF, {
      message: `a superseding version cannot retract declared identity refs: ${[...currentIdentityRefs].join(', ')} (declared identity refs are append-only — PII-minimized identity data is never silently withdrawn)`,
      details: { retracted: [...currentIdentityRefs] },
    });
  }
  // Validate the combined lists structurally (duplicates etc.).
  toTaskHistory(next.taskHistory);
  assertNoDuplicateEvidence(next.evidence);
  return appendRecord(registry, validated, next, expertVersionRef(current));
}

// ---------------------------------------------------------------------------
// Queries (tenant-scoped; cross-tenant reads fail closed)
// ---------------------------------------------------------------------------

/** Options for tenant-scoped reads. */
export interface ExpertReadScope {
  /** The tenant the reader acts in (lock rule 11). */
  readonly tenant: string;
}

/**
 * Get the CURRENT state of a logical expert (or, with `version`, the
 * latest recorded state of that version). Cross-tenant reads fail closed
 * with EXPERT_CROSS_TENANT_ACCESS unless the profile is `public`.
 */
export function getExpert(
  registry: ExpertRegistry,
  identity: { tenant: string; expertId: string },
  scope: ExpertReadScope,
  version?: string,
): ExpertProfile {
  requireReaderTenant(scope.tenant);
  const logicalKey = `${identity.tenant}/${identity.expertId}`;
  const indices = indicesOf(registry);
  let found: ExpertProfile | undefined;
  if (version === undefined) {
    found = indices.current.get(logicalKey);
  } else {
    found = indices.versions
      .get(logicalKey)
      ?.get(`${identity.tenant}/${identity.expertId}@${version}`);
  }
  if (found === undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.EXPERT_NOT_FOUND, {
      message: `expert not found: ${logicalKey}${version === undefined ? '' : `@${version}`}`,
      details: { expert: logicalKey, version },
    });
  }
  assertReadable(found, scope.tenant);
  return found;
}

/**
 * Get an exact historical state by digest (tenant-checked). Every
 * admitted state stays addressable forever — append-only history (lock
 * rule 6).
 */
export function getExpertByDigest(
  registry: ExpertRegistry,
  digest: string,
  scope: ExpertReadScope,
): ExpertProfile {
  requireReaderTenant(scope.tenant);
  const found = indicesOf(registry).byDigest.get(digest);
  if (found === undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.EXPERT_NOT_FOUND, {
      message: `expert profile state not found by digest: ${digest}`,
      details: { digest },
    });
  }
  assertReadable(found, scope.tenant);
  return found;
}

/**
 * List every version of a logical expert with its latest recorded state,
 * ordered by semver precedence (tenant-checked). Includes superseded
 * versions — the full supersession chain is inspectable.
 */
export function listExpertVersions(
  registry: ExpertRegistry,
  identity: { tenant: string; expertId: string },
  scope: ExpertReadScope,
): readonly ExpertProfile[] {
  requireReaderTenant(scope.tenant);
  const logicalKey = `${identity.tenant}/${identity.expertId}`;
  const byVersion = indicesOf(registry).versions.get(logicalKey);
  if (byVersion === undefined || byVersion.size === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.EXPERT_NOT_FOUND, {
      message: `expert not found: ${logicalKey}`,
      details: { expert: logicalKey },
    });
  }
  const first = byVersion.values().next().value;
  if (first === undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.EXPERT_NOT_FOUND, {
      message: `expert not found: ${logicalKey}`,
      details: { expert: logicalKey },
    });
  }
  assertReadable(first, scope.tenant);
  const states = [...byVersion.values()];
  states.sort((a, b) => compareExpertVersions(a.version, b.version));
  return Object.freeze(states);
}

/**
 * List the logical experts visible to a reading tenant: the tenant's own
 * experts plus experts in the reserved `public` namespace (lock rule 11).
 * Returns the CURRENT state of each, sorted by logical key.
 */
export function listExperts(
  registry: ExpertRegistry,
  scope: ExpertReadScope,
): readonly ExpertProfile[] {
  requireReaderTenant(scope.tenant);
  const visible: ExpertProfile[] = [];
  for (const current of indicesOf(registry).current.values()) {
    if (isTenantVisible(current.identity.tenant, scope.tenant)) {
      visible.push(current);
    }
  }
  visible.sort((a, b) =>
    expertLogicalKey(a.identity) < expertLogicalKey(b.identity) ? -1 : 1,
  );
  return Object.freeze(visible);
}

/** True iff a logical expert exists and is visible to the reading tenant. */
export function hasExpert(
  registry: ExpertRegistry,
  identity: { tenant: string; expertId: string },
  scope: ExpertReadScope,
): boolean {
  requireReaderTenant(scope.tenant);
  const found = indicesOf(registry).current.get(
    `${identity.tenant}/${identity.expertId}`,
  );
  if (found === undefined) return false;
  return isTenantVisible(found.identity.tenant, scope.tenant);
}

/**
 * The append-only registration log, tenant-scoped: every admission record
 * whose admitted profile is visible to the reading tenant, in admission
 * order. The log is the registry's audit surface (R28-style audit
 * evidence for consequential admissions).
 */
export function listRegistrationRecords(
  registry: ExpertRegistry,
  scope: ExpertReadScope,
): readonly ExpertRegistrationRecord[] {
  requireReaderTenant(scope.tenant);
  const visible = registry.registrations.filter((record) =>
    isTenantVisible(record.profile.identity.tenant, scope.tenant),
  );
  return Object.freeze(visible);
}
