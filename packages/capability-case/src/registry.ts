/**
 * The CaseRegistry — an append-only, tenant-scoped, in-memory query API over
 * capability cases (Work Order A005 gates 4/5/6; architecture-lock rules 6,
 * 11).
 *
 * The registry is a PURE DATA STRUCTURE in the convention of
 * @arena/capability-graph's graph store: every admission returns a NEW
 * deep-frozen registry; there is no mutation, no delete, no rewrite. Its
 * three invariants are machine-enforced:
 *
 *   1. APPEND-ONLY ADMISSION. `registerCase` admits a fresh draft case (or
 *      the idempotent re-assertion of an already-admitted exact state).
 *      `recordTransition` admits the next state of an admitted case version
 *      ONLY when `assertAppendOnly` holds (evidence prefix preserved,
 *      history prefix preserved, same version) and the recorded lifecycle
 *      event matches the transition. `recordSupersession` admits a NEW case
 *      version ONLY when it supersedes the current version (strictly higher
 *      semver, matching digest of the superseded state) and its evidence
 *      list extends the superseded version's evidence (lock rule 6 holds
 *      ACROSS versions too — history is never rewritten by a new version).
 *
 *   2. TENANT SCOPING (lock rule 11). Every case carries its owning tenant
 *      scope; every read states the reading tenant. A case is visible to a
 *      reader iff the reader's tenant equals the case's tenant OR the case
 *      lives in the reserved `public` namespace. Cross-tenant reads fail
 *      closed with CAPABILITY_CASE_CROSS_TENANT_ACCESS. Mutating admissions
 *      additionally require the acting principal's tenant to equal the
 *      case's tenant (no cross-tenant case editing — customer data cannot be
 *      silently cross-reused).
 *
 *   3. ADDRESSABILITY (R3-style). Every admitted state stays addressable by
 *      its digest forever: `getCaseByDigest` returns any historical state
 *      (tenant-checked), `listCaseVersions` walks a logical case's version
 *      history, and `getCase` returns the current (or explicit version's
 *      latest) state. A superseded version is NEVER evicted.
 */

import { CAPABILITY_CASE_ERROR_CODES, CapabilityCaseError } from './errors.js';
import {
  caseLogicalKey,
  caseVersionKey,
  formatCaseVersionRef,
} from './identity.js';
import { caseVersionRef } from './case.js';
import type { CapabilityCase } from './case.js';
import {
  assertAppendOnly,
  isTerminalCase,
} from './lifecycle.js';
import type { EvidenceRef } from './shared.js';
import {
  compareCaseVersions,
  deepFreeze,
  isTenantScope,
  isTenantVisible,
} from './shared.js';
import type { TenantScope } from './shared.js';

// ---------------------------------------------------------------------------
// Registry shape (plain frozen arrays — canonical objects never carry Maps)
// ---------------------------------------------------------------------------

/**
 * The append-only case registry. `cases` is the full append log (every
 * admitted state, in admission order); all lookups are derivable indices
 * (module-private WeakMap cache, the capability-graph convention).
 */
export interface CaseRegistry {
  /** Every admitted case state, in admission order. Never rewritten. */
  readonly cases: readonly CapabilityCase[];
}

const INDICES = new WeakMap<CaseRegistry, RegistryIndices>();

interface RegistryIndices {
  /** digest → case state */
  readonly byDigest: Map<string, CapabilityCase>;
  /** logical key → current version's latest state */
  readonly current: Map<string, CapabilityCase>;
  /** logical key → all states, grouped by version key, latest last */
  readonly versions: Map<string, Map<string, CapabilityCase>>;
  /** logical key → superseded terminal states (for supersession chains) */
  readonly supersededFinals: Map<string, CapabilityCase[]>;
}

function buildIndices(registry: CaseRegistry): RegistryIndices {
  const byDigest = new Map<string, CapabilityCase>();
  const current = new Map<string, CapabilityCase>();
  const versions = new Map<string, Map<string, CapabilityCase>>();
  const supersededFinals = new Map<string, CapabilityCase[]>();
  for (const caseRecord of registry.cases) {
    byDigest.set(caseRecord.digest, caseRecord);
    const logicalKey = caseLogicalKey(caseRecord.identity);
    const versionKey = caseVersionKey({
      tenant: caseRecord.identity.tenant,
      caseId: caseRecord.identity.caseId,
      version: caseRecord.version,
    });
    let byVersion = versions.get(logicalKey);
    if (byVersion === undefined) {
      byVersion = new Map<string, CapabilityCase>();
      versions.set(logicalKey, byVersion);
    }
    byVersion.set(versionKey, caseRecord);
    if (caseRecord.status === 'superseded') {
      const finals = supersededFinals.get(logicalKey) ?? [];
      finals.push(caseRecord);
      supersededFinals.set(logicalKey, finals);
    }
    // The logical case's CURRENT state is its LATEST admitted state — even
    // a superseded one (the case is honestly "currently superseded" until
    // the superseding version is registered). Later admissions win; the
    // admission paths guarantee versions only advance (registerCase →
    // first state, recordTransition → same version, recordSupersession →
    // strictly higher version).
    current.set(logicalKey, caseRecord);
  }
  return { byDigest, current, versions, supersededFinals };
}

function indicesOf(registry: CaseRegistry): RegistryIndices {
  let indices = INDICES.get(registry);
  if (indices === undefined) {
    indices = buildIndices(registry);
    INDICES.set(registry, indices);
  }
  return indices;
}

/** Create an empty case registry. */
export function createCaseRegistry(): CaseRegistry {
  return deepFreeze({ cases: Object.freeze([]) });
}

export function isCaseRegistry(value: unknown): value is CaseRegistry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['cases']) &&
    candidate['cases'].every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record<string, unknown>)['digest'] === 'string',
    )
  );
}

// ---------------------------------------------------------------------------
// Admission guards
// ---------------------------------------------------------------------------

function requireReaderTenant(tenant: string): TenantScope {
  if (!isTenantScope(tenant)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid reader tenant scope: ${JSON.stringify(tenant)}`,
    });
  }
  return tenant;
}

/**
 * Fail closed unless `caseRecord` is visible to a reader acting as
 * `readerTenant` (lock rule 11; the reserved public namespace is globally
 * readable).
 */
function assertReadable(
  caseRecord: CapabilityCase,
  readerTenant: string,
): void {
  if (!isTenantVisible(caseRecord.identity.tenant, readerTenant)) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.CROSS_TENANT_ACCESS,
      {
        message: `cross-tenant access denied: case ${JSON.stringify(caseRecord.identity.caseId)} belongs to tenant ${JSON.stringify(caseRecord.identity.tenant)} and is not visible to tenant ${JSON.stringify(readerTenant)} (customer data is tenant-scoped — architecture-lock rule 11)`,
        details: {
          caseTenant: caseRecord.identity.tenant,
          readerTenant,
          caseId: caseRecord.identity.caseId,
        },
      },
    );
  }
}

/** Fail closed unless the acting principal's tenant matches the case's. */
function assertSameTenantActor(caseRecord: CapabilityCase, actorTenant: string): void {
  if (actorTenant !== caseRecord.identity.tenant) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.CROSS_TENANT_ACCESS,
      {
        message: `cross-tenant mutation denied: actor from tenant ${JSON.stringify(actorTenant)} cannot mutate a case owned by tenant ${JSON.stringify(caseRecord.identity.tenant)} (lock rule 11)`,
        details: {
          caseTenant: caseRecord.identity.tenant,
          actorTenant,
          caseId: caseRecord.identity.caseId,
        },
      },
    );
  }
}

function admitted(registry: CaseRegistry, digest: string): CapabilityCase | undefined {
  return indicesOf(registry).byDigest.get(digest);
}

// ---------------------------------------------------------------------------
// Admission: initial registration
// ---------------------------------------------------------------------------

/**
 * Register a case: the FIRST state of a logical case (a fresh draft whose
 * history is exactly one `case-created` event), or the IDEMPOTENT
 * re-assertion of an already-admitted exact state. Throws
 * CAPABILITY_CASE_IDENTITY_CONFLICT when a different state is already
 * registered under the same (tenant, caseId) — the first registration wins
 * and is never rewritten.
 */
export function registerCase(
  registry: CaseRegistry,
  caseRecord: CapabilityCase,
): CaseRegistry {
  const logicalKey = caseLogicalKey(caseRecord.identity);
  const indices = indicesOf(registry);
  const existingCurrent = indices.current.get(logicalKey);
  if (existingCurrent !== undefined || indices.versions.get(logicalKey)?.size) {
    // Idempotent re-assertion of the exact same state is a no-op.
    if (admitted(registry, caseRecord.digest) !== undefined) return registry;
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.IDENTITY_CONFLICT,
      {
        message: `case ${JSON.stringify(caseRecord.identity.caseId)} is already registered in tenant ${JSON.stringify(caseRecord.identity.tenant)} (first registration wins; use recordSupersession for new versions)`,
        details: {
          tenant: caseRecord.identity.tenant,
          caseId: caseRecord.identity.caseId,
          registeredVersion: existingCurrent?.version ?? 'superseded-history',
          incomingVersion: caseRecord.version,
        },
      },
    );
  }
  if (caseRecord.lifecycle.length !== 1 || caseRecord.lifecycle[0]?.kind !== 'case-created') {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_LIFECYCLE, {
      message: `initial registration requires a fresh draft case (exactly one case-created event), got ${caseRecord.lifecycle.length} event(s) in status ${caseRecord.status}`,
      details: {
        caseId: caseRecord.identity.caseId,
        status: caseRecord.status,
        events: caseRecord.lifecycle.length,
      },
    });
  }
  if (caseRecord.status !== 'draft') {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_LIFECYCLE, {
      message: `initial registration requires status "draft", got ${JSON.stringify(caseRecord.status)}`,
      details: { caseId: caseRecord.identity.caseId, status: caseRecord.status },
    });
  }
  if (caseRecord.supersededBy !== undefined) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_LIFECYCLE, {
      message: 'a fresh case cannot carry a supersededBy ref',
      details: { caseId: caseRecord.identity.caseId },
    });
  }
  return deepFreeze({
    cases: Object.freeze([...registry.cases, caseRecord]),
  });
}

// ---------------------------------------------------------------------------
// Admission: lifecycle transitions (append-only within a version)
// ---------------------------------------------------------------------------

/**
 * Record the next state of an already-admitted case version (produced by
 * the pure transition functions: submitCase, triageCase, activateCase,
 * resolveCase, supersedeCase, attachEvidence). Fails closed unless:
 *   - the previous state (by digest) is admitted and is the version's
 *     latest recorded state;
 *   - `assertAppendOnly(previous, next)` holds (evidence + history
 *     prefixes preserved — lock rule 6);
 *   - the appended event matches the status transition (from → to) and the
 *     evidence appended;
 *   - the acting principal's tenant matches the case's tenant (lock
 *     rule 11).
 */
export function recordTransition(
  registry: CaseRegistry,
  next: CapabilityCase,
  options?: { actorTenant?: string },
): CaseRegistry {
  const prior = findPriorState(registry, next);
  if (prior === undefined) return registry; // idempotent re-assertion
  if (prior === null) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.CASE_NOT_FOUND, {
      message: `cannot record a transition for an unregistered case version: ${caseLogicalKey(next.identity)}@${next.version} (register the case first)`,
      details: {
        case: caseLogicalKey(next.identity),
        version: next.version,
      },
    });
  }
  const previous = prior;
  if (isTerminalCase(previous)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.TERMINAL_STATE, {
      message: `case ${JSON.stringify(previous.identity.caseId)}@${JSON.stringify(previous.version)} is ${previous.status}: terminal states are final and admit no further recorded transitions`,
      details: {
        tenant: previous.identity.tenant,
        caseId: previous.identity.caseId,
        version: previous.version,
        status: previous.status,
      },
    });
  }
  assertAppendOnly(previous, next);

  const actorTenant = options?.actorTenant ?? next.lifecycle[next.lifecycle.length - 1]?.actor.tenant;
  if (actorTenant !== undefined) {
    assertSameTenantActor(next, actorTenant);
  }

  const appended = next.lifecycle[next.lifecycle.length - 1];
  if (appended === undefined) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_LIFECYCLE, {
      message: 'a recorded transition must append exactly one lifecycle event',
      details: { caseId: next.identity.caseId },
    });
  }
  if (
    appended.fromStatus !== previous.status ||
    appended.toStatus !== next.status
  ) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION,
      {
        message: `recorded transition event does not match the state change: event says ${appended.fromStatus} → ${appended.toStatus}, states say ${previous.status} → ${next.status}`,
        details: {
          caseId: next.identity.caseId,
          eventFrom: appended.fromStatus,
          eventTo: appended.toStatus,
          stateFrom: previous.status,
          stateTo: next.status,
        },
      },
    );
  }
  if (next.status === 'superseded' && next.supersededBy === undefined) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_SUPERSESSION, {
      message: 'a superseded terminal state must record the superseding version ref',
      details: { caseId: next.identity.caseId },
    });
  }
  // Event/evidence consistency: an appended evidence-attached event must
  // match EXACTLY the evidence growth of the recorded state (a state cannot
  // claim evidence was attached while dropping or inventing it).
  if (appended.kind === 'evidence-attached') {
    const appendedEvidence = appended.evidenceAppended ?? [];
    const expectedEvidence: EvidenceRef[] = [...previous.evidence, ...appendedEvidence];
    if (
      next.evidence.length !== expectedEvidence.length ||
      next.evidence.some(
        (ref, i) =>
          expectedEvidence[i]?.digest !== ref.digest ||
          expectedEvidence[i]?.description !== ref.description,
      )
    ) {
      throw new CapabilityCaseError(
        CAPABILITY_CASE_ERROR_CODES.INVALID_EVIDENCE,
        {
          message: `recorded evidence-attached event does not match the state's evidence growth (expected ${expectedEvidence.length} ref(s) after append, got ${next.evidence.length})`,
          details: {
            caseId: next.identity.caseId,
            expectedCount: expectedEvidence.length,
            actualCount: next.evidence.length,
          },
        },
      );
    }
  }
  return deepFreeze({
    cases: Object.freeze([...registry.cases, next]),
  });
}

/**
 * Find the prior admitted state a `next` case state extends: the latest
 * recorded state of the same case version whose history is a strict prefix
 * of `next`'s history. Returns the prior state, or `undefined` when `next`
 * is already admitted (idempotent), or `null` when no prior state exists.
 */
function findPriorState(
  registry: CaseRegistry,
  next: CapabilityCase,
): CapabilityCase | undefined | null {
  if (admitted(registry, next.digest) !== undefined) return undefined;
  const logicalKey = caseLogicalKey(next.identity);
  const versionKey = caseVersionKey({
    tenant: next.identity.tenant,
    caseId: next.identity.caseId,
    version: next.version,
  });
  const latest = indicesOf(registry).versions.get(logicalKey)?.get(versionKey);
  if (latest === undefined) return null;
  return latest;
}

// ---------------------------------------------------------------------------
// Admission: supersession (new versions of a logical case)
// ---------------------------------------------------------------------------

/**
 * Register a NEW VERSION of an admitted logical case (created via
 * `createCapabilityCase` with the `supersedes` ref pointing at the current
 * version's latest admitted state). Fails closed unless:
 *   - the new version is a fresh draft (single case-created event);
 *   - `supersedes` addresses the current version's latest admitted state
 *     (same tenant/caseId, same digest) with STRICTLY lower semver
 *     precedence than the new version (enforced again here — defense in
 *     depth);
 *   - the new version's evidence list EXTENDS the superseded state's
 *     evidence list (lock rule 6 across versions);
 *   - the acting principal's tenant matches the case's tenant.
 *
 * The superseded version's states all stay admitted and addressable —
 * nothing is evicted, nothing is rewritten (gate 4).
 */
export function recordSupersession(
  registry: CaseRegistry,
  next: CapabilityCase,
  options?: { actorTenant?: string },
): CaseRegistry {
  if (admitted(registry, next.digest) !== undefined) return registry;
  const logicalKey = caseLogicalKey(next.identity);
  const indices = indicesOf(registry);
  const current = indices.current.get(logicalKey);
  if (current === undefined) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.CASE_NOT_FOUND, {
      message: `cannot register a superseding version for an unknown case: ${logicalKey} (register the base version first)`,
      details: { case: logicalKey },
    });
  }
  if (
    next.lifecycle.length !== 1 ||
    next.lifecycle[0]?.kind !== 'case-created' ||
    next.status !== 'draft'
  ) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_SUPERSESSION, {
      message: `a superseding version must be a fresh draft (one case-created event), got ${next.lifecycle.length} event(s) in status ${next.status}`,
      details: { caseId: next.identity.caseId },
    });
  }
  const supersedes = next.supersedes;
  if (supersedes === undefined) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_SUPERSESSION,
      {
        message: `a superseding version must carry a supersedes ref (expected the current state ${formatCaseVersionRef(caseVersionRef(current))})`,
        details: { current: formatCaseVersionRef(caseVersionRef(current)) },
      },
    );
  }
  if (supersedes.tenant !== current.identity.tenant || supersedes.caseId !== current.identity.caseId) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_SUPERSESSION,
      {
        message: `supersedes ref must address the same logical case: ${JSON.stringify(supersedes.tenant)}/${JSON.stringify(supersedes.caseId)} vs ${logicalKey}`,
        details: { supersedes: formatCaseVersionRef(supersedes), case: logicalKey },
      },
    );
  }
  if (supersedes.version !== current.version || supersedes.digest !== current.digest) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_SUPERSESSION,
      {
        message: `supersedes ref must address the CURRENT admitted state of ${logicalKey}: expected ${formatCaseVersionRef(caseVersionRef(current))}, got ${formatCaseVersionRef(supersedes)}`,
        details: {
          expected: formatCaseVersionRef(caseVersionRef(current)),
          got: formatCaseVersionRef(supersedes),
        },
      },
    );
  }
  if (compareCaseVersions(supersedes.version, next.version) >= 0) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_SUPERSESSION,
      {
        message: `superseding version must have strictly higher semver precedence: ${JSON.stringify(next.version)} does not supersede ${JSON.stringify(supersedes.version)}`,
        details: { supersedes: formatCaseVersionRef(supersedes), version: next.version },
      },
    );
  }
  // Evidence monotonicity ACROSS versions (lock rule 6: history is never
  // rewritten by learning — or by a new case version).
  if (next.evidence.length < current.evidence.length) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.EVIDENCE_REMOVAL,
      {
        message: `a superseding version cannot drop evidence: ${next.evidence.length} ref(s) vs the superseded version's ${current.evidence.length} (historical evidence is append-only — lock rule 6)`,
        details: {
          caseId: next.identity.caseId,
          supersededCount: current.evidence.length,
          supersedingCount: next.evidence.length,
        },
      },
    );
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
      throw new CapabilityCaseError(
        CAPABILITY_CASE_ERROR_CODES.EVIDENCE_REMOVAL,
        {
          message: `a superseding version cannot rewrite evidence at position ${i} (historical evidence is append-only — lock rule 6)`,
          details: { position: i },
        },
      );
    }
  }
  const actorTenant = options?.actorTenant ?? next.source.tenant;
  assertSameTenantActor(next, actorTenant);
  return deepFreeze({
    cases: Object.freeze([...registry.cases, next]),
  });
}

// ---------------------------------------------------------------------------
// Queries (tenant-scoped; cross-tenant reads fail closed)
// ---------------------------------------------------------------------------

/** Options for tenant-scoped reads. */
export interface CaseReadScope {
  /** The tenant the reader acts in (lock rule 11). */
  readonly tenant: string;
}

/**
 * Get the CURRENT state of a logical case (or, with `version`, the latest
 * recorded state of that version). Cross-tenant reads fail closed with
 * CAPABILITY_CASE_CROSS_TENANT_ACCESS unless the case is `public`.
 */
export function getCase(
  registry: CaseRegistry,
  identity: { tenant: string; caseId: string },
  scope: CaseReadScope,
  version?: string,
): CapabilityCase {
  requireReaderTenant(scope.tenant);
  const logicalKey = `${identity.tenant}/${identity.caseId}`;
  const indices = indicesOf(registry);
  let found: CapabilityCase | undefined;
  if (version === undefined) {
    found = indices.current.get(logicalKey);
  } else {
    found = indices.versions.get(logicalKey)?.get(`${identity.tenant}/${identity.caseId}@${version}`);
  }
  if (found === undefined) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.CASE_NOT_FOUND, {
      message: `case not found: ${logicalKey}${version === undefined ? '' : `@${version}`}`,
      details: { case: logicalKey, version },
    });
  }
  assertReadable(found, scope.tenant);
  return found;
}

/**
 * Get an exact historical state by digest (tenant-checked). Every admitted
 * state stays addressable forever — append-only history (lock rule 6).
 */
export function getCaseByDigest(
  registry: CaseRegistry,
  digest: string,
  scope: CaseReadScope,
): CapabilityCase {
  requireReaderTenant(scope.tenant);
  const found = indicesOf(registry).byDigest.get(digest);
  if (found === undefined) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.CASE_NOT_FOUND, {
      message: `case state not found by digest: ${digest}`,
      details: { digest },
    });
  }
  assertReadable(found, scope.tenant);
  return found;
}

/**
 * List every version of a logical case with its latest recorded state,
 * ordered by semver precedence (tenant-checked). Includes superseded
 * versions — the full supersession chain is inspectable.
 */
export function listCaseVersions(
  registry: CaseRegistry,
  identity: { tenant: string; caseId: string },
  scope: CaseReadScope,
): readonly CapabilityCase[] {
  requireReaderTenant(scope.tenant);
  const logicalKey = `${identity.tenant}/${identity.caseId}`;
  const byVersion = indicesOf(registry).versions.get(logicalKey);
  if (byVersion === undefined || byVersion.size === 0) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.CASE_NOT_FOUND, {
      message: `case not found: ${logicalKey}`,
      details: { case: logicalKey },
    });
  }
  const first = byVersion.values().next().value;
  if (first === undefined) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.CASE_NOT_FOUND, {
      message: `case not found: ${logicalKey}`,
      details: { case: logicalKey },
    });
  }
  assertReadable(first, scope.tenant);
  const states = [...byVersion.values()];
  states.sort((a, b) => compareCaseVersions(a.version, b.version));
  return Object.freeze(states);
}

/**
 * List the logical cases visible to a reading tenant: the tenant's own
 * cases plus cases in the reserved `public` namespace (lock rule 11).
 * Returns the CURRENT state of each, sorted by logical key.
 */
export function listCases(
  registry: CaseRegistry,
  scope: CaseReadScope,
): readonly CapabilityCase[] {
  requireReaderTenant(scope.tenant);
  const visible: CapabilityCase[] = [];
  for (const current of indicesOf(registry).current.values()) {
    if (isTenantVisible(current.identity.tenant, scope.tenant)) {
      visible.push(current);
    }
  }
  visible.sort((a, b) =>
    caseLogicalKey(a.identity) < caseLogicalKey(b.identity) ? -1 : 1,
  );
  return Object.freeze(visible);
}

/** True iff a logical case exists and is visible to the reading tenant. */
export function hasCase(
  registry: CaseRegistry,
  identity: { tenant: string; caseId: string },
  scope: CaseReadScope,
): boolean {
  requireReaderTenant(scope.tenant);
  const logicalKey = `${identity.tenant}/${identity.caseId}`;
  const current = indicesOf(registry).current.get(logicalKey);
  if (current === undefined) return false;
  return isTenantVisible(current.identity.tenant, scope.tenant);
}

/**
 * The supersession chain of a logical case (tenant-checked): every
 * superseded terminal state in admission order, oldest first. The chain is
 * inspectable end-to-end; every link stays immutable + addressable (gate 4).
 */
export function supersessionChainOf(
  registry: CaseRegistry,
  identity: { tenant: string; caseId: string },
  scope: CaseReadScope,
): readonly CapabilityCase[] {
  requireReaderTenant(scope.tenant);
  const logicalKey = `${identity.tenant}/${identity.caseId}`;
  const finals = indicesOf(registry).supersededFinals.get(logicalKey);
  if (finals === undefined || finals.length === 0) {
    // Distinguish "unknown case" from "known case, never superseded".
    const current = indicesOf(registry).current.get(logicalKey);
    if (current === undefined) {
      throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.CASE_NOT_FOUND, {
        message: `case not found: ${logicalKey}`,
        details: { case: logicalKey },
      });
    }
    assertReadable(current, scope.tenant);
    return Object.freeze([]);
  }
  const first = finals[0];
  if (first !== undefined) assertReadable(first, scope.tenant);
  return Object.freeze([...finals]);
}

/** Convenience: is the current state of a logical case terminal? */
export function isCaseTerminalIn(
  registry: CaseRegistry,
  identity: { tenant: string; caseId: string },
  scope: CaseReadScope,
): boolean {
  return isTerminalCase(getCase(registry, identity, scope));
}
