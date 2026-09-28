/**
 * ExpertProfile — the versioned, content-addressed unit of expert
 * capability-provider registration (Work Order A006; docs/architecture.md
 * §8, verbatim: "Experts are capability providers. Profiles include
 * identity, competencies, qualifications, evidence, task history,
 * reliability, availability and domain/jurisdiction where appropriate.
 * Qualification, reputation and authorization are separate concerns.";
 * requirements R7 registry side, R32 measurement data; architecture-lock
 * rules 6, 9, 11, 23, 24).
 *
 * A profile binds:
 *   - its identity (tenant scope + NEUTRAL expert id) and a semver version;
 *   - its current lifecycle status (see lifecycle.ts) and the append-only
 *     lifecycle event log accumulated so far;
 *   - every §8 field as a validated object: declared identity refs
 *     (digest-addressed — PII minimization), competencies (capability/skill
 *     refs + proficiency evidence refs), qualifications (typed records:
 *     credential refs, evidence digests, status — DATA, never
 *     authorization), evidence refs (digest-addressed), task history
 *     (append-only record refs), reliability (append-only event-sourced
 *     ledger — counters are DERIVED, see reliability.ts), availability
 *     (typed windows), domain/jurisdiction (explicit
 *     professional-limitation metadata per lock rule 23);
 *   - the explicit privacy policy (lock rule 23) that governs public-view
 *     derivation (see public-view.ts);
 *   - OPTIONAL supersedes ref (a NEW version of THIS profile replacing the
 *     previous version) and, once superseded, the supersededBy ref.
 *
 * to a sha256 `digest` computed over the canonical JSON serialization of
 * the digest-free view (canonicalization and hashing REUSED from
 * @arena/protocol-core — never reimplemented here).
 *
 * SEPARATION OF CONCERNS (lock rule 9 — the critical gate): before any
 * field is read, the ENTIRE input is walked by the authority and PII
 * screens (authority-screen.ts): a field asserting system authority,
 * roles or permissions (`systemRole`, `authority`, `adminOf`,
 * `grantedScopes`, …) is REJECTED with EXPERT_AUTHORITY_FIELD_REJECTED;
 * a personal-data field (`email`, `phone`, `legalName`, …) is REJECTED
 * with EXPERT_PII_FIELD_REJECTED. There is no authorization grant, no
 * system authority claim and no personal data anywhere on the profile —
 * qualification, reputation and authorization are separate concerns, and
 * authorization is a separate future protocol.
 *
 * Immutability: `createExpertProfile` validates, computes the digest and
 * DEEP-FREEZES the result. There is no mutation API in this package — no
 * setStatus, no edit field, no removeEvidence — so "same content,
 * different state" can only exist as a DIFFERENT content-addressed object
 * with a DIFFERENT digest, and any object claiming a stale digest fails
 * `verifyExpertProfile` (fail-closed tamper detection).
 *
 * Content addressing note: the digest covers the ENTIRE digest-free view,
 * INCLUDING the lifecycle status, the reliability ledger and the event
 * log. A profile version's digest therefore pins its exact lifecycle
 * state; every historical state stays addressable by its digest, which is
 * what makes the append-only lifecycle auditable (lock rule 6).
 */

import { computeExpertProfileDigest, expertProfileContentView } from './digest.js';
import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import { assertScreenedInput } from './authority-screen.js';
import {
  formatExpertVersionRef,
  isExpertVersionRef,
  toExpertVersionRef,
} from './identity.js';
import type { ExpertIdentity, ExpertVersionRef } from './identity.js';
import {
  expertLogicalKey,
  isExpertIdentity,
  toExpertIdentity,
} from './identity.js';
import { toIdentityRefView } from './identity.js';
import type { IdentityRefView } from './identity.js';
import { toExpertCompetencyList } from './competencies.js';
import type { ExpertCompetency } from './competencies.js';
import { toExpertQualificationList } from './qualifications.js';
import type { ExpertQualification } from './qualifications.js';
import { toTaskHistory } from './task-history.js';
import type { TaskRecordRefView } from './task-history.js';
import { toReliabilityLedger } from './reliability.js';
import type { ReliabilityLedgerEntry } from './reliability.js';
import { toExpertAvailability } from './availability.js';
import type { ExpertAvailability } from './availability.js';
import { toExpertDomainScope } from './domain-scope.js';
import type { ExpertDomainScope } from './domain-scope.js';
import {
  isExpertProfilePrivacyPolicy,
  toExpertProfilePrivacyPolicy,
} from './privacy-policy.js';
import type { ExpertProfilePrivacyPolicy } from './privacy-policy.js';
import {
  assertNoDuplicateEvidence,
  compareExpertVersions,
  deepFreeze,
  isContentDigest,
  isExpertVersion,
  toContentDigest,
  toExpertVersion,
  toEvidenceRef,
  toPrincipalRefView,
} from './shared.js';
import type { EvidenceRef, PrincipalRefLike } from './shared.js';
import { toExpertRegistryTimestamp } from './timestamp.js';
import {
  isExpertStatus,
  makeProfileCreatedEvent,
} from './lifecycle.js';
import type { ExpertLifecycleEvent, ExpertStatus } from './lifecycle.js';

/** Wire version of the expert profile record shape. */
export const EXPERT_PROFILE_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The profile shape
// ---------------------------------------------------------------------------

/** Digest-free view of an expert profile — exactly what the digest covers. */
export interface ExpertProfileContentView {
  readonly recordVersion: typeof EXPERT_PROFILE_RECORD_VERSION;
  /** Identity: owning tenant scope + NEUTRAL expert id. */
  readonly identity: ExpertIdentity;
  /** Declared identity refs (digest-addressed attestations — PII minimization). */
  readonly identityRefs: readonly IdentityRefView[];
  /** Semver version of this profile version (no build metadata). */
  readonly version: string;
  /** Current lifecycle status of this profile version. */
  readonly status: ExpertStatus;
  /** Competencies: capability/skill refs + proficiency evidence refs (§8). */
  readonly competencies: readonly ExpertCompetency[];
  /** Qualifications: typed records — credential refs, evidence digests, status (§8). */
  readonly qualifications: readonly ExpertQualification[];
  /** Foundational evidence refs (digest-addressed, append-only — lock rule 6). */
  readonly evidence: readonly EvidenceRef[];
  /** Task history (append-only content-addressed record refs — §8). */
  readonly taskHistory: readonly TaskRecordRefView[];
  /** Reliability ledger (append-only, event-sourced — counters are derived — §8). */
  readonly reliability: readonly ReliabilityLedgerEntry[];
  /** Availability (typed windows — §8). */
  readonly availability: ExpertAvailability;
  /** Domain/jurisdiction + explicit professional limitations (§8, lock rule 23). */
  readonly domainScope: ExpertDomainScope;
  /** Explicit privacy policy governing public-view derivation (lock rule 23). */
  readonly privacyPolicy: ExpertProfilePrivacyPolicy;
  /** Append-only lifecycle event log (deep-frozen; never rewritten). */
  readonly lifecycle: readonly ExpertLifecycleEvent[];
  /** Supersession: the previous version of THIS profile that this version replaces. */
  readonly supersedes?: ExpertVersionRef;
  /** The version that superseded THIS version, once supersession is recorded. */
  readonly supersededBy?: ExpertVersionRef;
  /** When this profile version was declared (injected — constructors never read clocks). */
  readonly declaredAt: string;
}

/** A frozen expert profile: the content view plus its sha256 digest. */
export interface ExpertProfile extends ExpertProfileContentView {
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface CreateExpertProfileInput {
  readonly identity: {
    tenant: string;
    expertId: string;
  };
  readonly identityRefs: readonly {
    kind: string;
    digest: string;
    locator?: string;
    note?: string;
  }[];
  readonly version: string;
  readonly competencies: readonly {
    capability: {
      kind: string;
      id: string;
      version: string;
      digest: string;
    };
    proficiency: string;
    proficiencyEvidence: readonly { digest: string; description: string }[];
    domainType?: string;
    domainMetadata?: Readonly<Record<string, string | number | boolean>>;
  }[];
  readonly qualifications: readonly {
    credential: {
      kind: string;
      reference: string;
      issuer?: string;
    };
    evidence: readonly string[];
    status: string;
    validFrom?: string;
    validUntil?: string;
    jurisdiction?: { country: string; region?: string };
    note?: string;
  }[];
  readonly evidence: readonly {
    digest: string;
    description: string;
  }[];
  readonly taskHistory: readonly {
    kind: string;
    tenant: string;
    taskId: string;
    version: string;
    digest: string;
    occurredAt: string;
  }[];
  readonly reliability: readonly {
    sequence: number;
    kind: string;
    occurredAt: string;
    recordedBy: {
      type: string;
      tenant: string;
      principalId: string;
    };
    taskRecord?: {
      kind: string;
      tenant: string;
      taskId: string;
      version: string;
      digest: string;
      occurredAt: string;
    };
    note?: string;
    evidence?: readonly { digest: string; description: string }[];
  }[];
  readonly availability: {
    windows: readonly {
      recurrence: string;
      dayOfWeek?: number;
      startUtc: string;
      endUtc: string;
      date?: string;
      note?: string;
    }[];
    note?: string;
  };
  readonly domainScope: {
    domains: readonly {
      kind: string;
      id: string;
      version: string;
      digest: string;
    }[];
    jurisdictions: readonly { country: string; region?: string }[];
    limitations: readonly {
      class: string;
      statement: string;
      jurisdiction?: { country: string; region?: string };
      appliesUntil?: string;
    }[];
  };
  readonly privacyPolicy: {
    visibility: Readonly<Record<string, string>>;
  };
  /**
   * Who declared this profile (input-only: recorded as the actor of the
   * initial profile-created event, never a separate content field).
   */
  readonly declaredBy: PrincipalRefLike;
  readonly supersedes?: {
    tenant: string;
    expertId: string;
    version: string;
    digest: string;
  };
  readonly declaredAt: string;
}

/** The closed top-level key set of the profile input (extras are rejected). */
const PROFILE_INPUT_KEYS = [
  'identity',
  'identityRefs',
  'version',
  'competencies',
  'qualifications',
  'evidence',
  'taskHistory',
  'reliability',
  'availability',
  'domainScope',
  'privacyPolicy',
  'declaredBy',
  'supersedes',
  'declaredAt',
] as const;

/** Missing-required-group error helper (gate 2: per-group negatives). */
function requireGroup(input: Record<string, unknown>, field: string): unknown {
  if (input[field] === undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message: `an expert profile requires the ${JSON.stringify(field)} field (§8 field group; missing required field)`,
      details: { field },
    });
  }
  return input[field];
}

/**
 * Create an immutable expert profile in the DRAFT status: screens the
 * whole input (authority + PII vocabulary — lock rule 9 and §8 identity),
 * rejects unknown top-level fields (including any hand-crafted derived
 * data such as `reliabilityMetrics` — counters are RECOMPUTED from the
 * ledger, never declarable), validates every §8 field group (a missing or
 * invalid required group is a structured ExpertRegistryError naming the
 * group), computes the sha256 digest over the canonical serialization of
 * the content view, appends the initial `profile-created` lifecycle event,
 * and DEEP-FREEZES the result. The returned object can never be mutated
 * in place.
 */
export async function createExpertProfile(
  input: CreateExpertProfileInput,
): Promise<ExpertProfile> {
  if (typeof input !== 'object' || input === null) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message: 'an expert profile input must be a plain object',
    });
  }
  const record = input as unknown as Record<string, unknown>;

  // Gate 3 (lock rule 9) + PII minimization, FIRST: the deep vocabulary
  // screen rejects authority-shaped and personal-data-shaped fields at
  // any depth of the input.
  assertScreenedInput(input, 'expert profile input');

  // Closed top-level key set: extras are rejected (this also structurally
  // forbids declaring DERIVED data — e.g. reliabilityMetrics — or any
  // future authority-shaped top-level group).
  for (const key of Object.keys(record)) {
    if (!(PROFILE_INPUT_KEYS as readonly string[]).includes(key)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
        message: `unknown expert profile input field: ${JSON.stringify(key)} (known: ${PROFILE_INPUT_KEYS.join(', ')}; derived data such as reliability metrics is never declarable — it is recomputed from the ledger)`,
        details: { field: key, known: [...PROFILE_INPUT_KEYS] },
      });
    }
  }

  // --- identity group -----------------------------------------------------
  if (typeof record['identity'] !== 'object' || record['identity'] === null) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message:
        'an expert profile requires the identity field (tenant scope + neutral expert id — §8 identity group)',
      details: { field: 'identity' },
    });
  }
  const identity = toExpertIdentity(record['identity'] as {
    tenant: string;
    expertId: string;
  });
  if (typeof input.version !== 'string' || !isExpertVersion(input.version)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message: `an expert profile requires a semver version (no build metadata): ${JSON.stringify(input.version)}`,
      details: { field: 'version' },
    });
  }
  const version = input.version;

  const identityRefsInput = requireGroup(record, 'identityRefs');
  if (!Array.isArray(identityRefsInput)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message:
        'identityRefs must be an array of declared identity refs (possibly empty — the ONLY identity data a profile may carry)',
      details: { field: 'identityRefs' },
    });
  }
  const frozenIdentityRefs = Object.freeze(
    (identityRefsInput as CreateExpertProfileInput['identityRefs']).map((ref) =>
      toIdentityRefView(ref),
    ),
  );

  // --- competencies group -------------------------------------------------
  const competencies = toExpertCompetencyList(
    requireGroup(record, 'competencies') as CreateExpertProfileInput['competencies'],
  );

  // --- qualifications group -----------------------------------------------
  const qualifications = toExpertQualificationList(
    requireGroup(record, 'qualifications') as CreateExpertProfileInput['qualifications'],
  );

  // --- evidence group -----------------------------------------------------
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message:
        'an expert profile requires at least one digest-addressed foundational evidence ref (an evidence-free capability-provider claim is not a profile — R7)',
      details: { field: 'evidence' },
    });
  }
  const evidence = Object.freeze(input.evidence.map((ref) => toEvidenceRef(ref)));
  assertNoDuplicateEvidence(evidence);

  // --- task history group -------------------------------------------------
  const taskHistory = toTaskHistory(
    requireGroup(record, 'taskHistory') as CreateExpertProfileInput['taskHistory'],
  );
  for (const taskRecord of taskHistory) {
    if (taskRecord.tenant !== identity.tenant) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
        message: `task history record ${JSON.stringify(taskRecord.taskId)} belongs to tenant ${JSON.stringify(taskRecord.tenant)}, not the profile's tenant ${JSON.stringify(identity.tenant)} (customer data is tenant-scoped — architecture-lock rule 11)`,
        details: {
          recordTenant: taskRecord.tenant,
          profileTenant: identity.tenant,
          taskId: taskRecord.taskId,
        },
      });
    }
  }

  // --- reliability group --------------------------------------------------
  const reliability = toReliabilityLedger(
    requireGroup(record, 'reliability') as CreateExpertProfileInput['reliability'],
  );
  for (const entry of reliability) {
    if (entry.recordedBy.tenant !== identity.tenant) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_RELIABILITY, {
        message: `reliability entry ${entry.sequence} was recorded by a principal of tenant ${JSON.stringify(entry.recordedBy.tenant)}, not the profile's tenant ${JSON.stringify(identity.tenant)} (customer data is tenant-scoped — architecture-lock rule 11)`,
        details: {
          sequence: entry.sequence,
          recordedByTenant: entry.recordedBy.tenant,
          profileTenant: identity.tenant,
        },
      });
    }
    if (entry.taskRecord !== undefined && entry.taskRecord.tenant !== identity.tenant) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_RELIABILITY, {
        message: `reliability entry ${entry.sequence} references a task record of tenant ${JSON.stringify(entry.taskRecord.tenant)}, not the profile's tenant (architecture-lock rule 11)`,
        details: { sequence: entry.sequence, taskTenant: entry.taskRecord.tenant },
      });
    }
  }

  // --- availability group -------------------------------------------------
  if (typeof record['availability'] !== 'object' || record['availability'] === null) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message:
        'an expert profile requires the availability field (typed windows — §8 availability group)',
      details: { field: 'availability' },
    });
  }
  const availability = toExpertAvailability(
    record['availability'] as CreateExpertProfileInput['availability'],
  );

  // --- domain/jurisdiction group -------------------------------------------
  if (typeof record['domainScope'] !== 'object' || record['domainScope'] === null) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message:
        'an expert profile requires the domainScope field (domain/jurisdiction + explicit professional limitations — §8, lock rule 23)',
      details: { field: 'domainScope' },
    });
  }
  const domainScope = toExpertDomainScope(
    record['domainScope'] as CreateExpertProfileInput['domainScope'],
  );

  // --- privacy policy -------------------------------------------------------
  if (typeof record['privacyPolicy'] !== 'object' || record['privacyPolicy'] === null) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message:
        'an expert profile requires the privacyPolicy field (lock rule 23: privacy is explicit metadata)',
      details: { field: 'privacyPolicy' },
    });
  }
  // Delegate to the strict validator for precise per-group errors.
  const privacyPolicy = toExpertProfilePrivacyPolicy(
    record['privacyPolicy'] as CreateExpertProfileInput['privacyPolicy'],
  );

  // --- declarer + declaration time ----------------------------------------
  const declaredBy = toPrincipalRefView(
    requireGroup(record, 'declaredBy') as PrincipalRefLike,
  );
  if (declaredBy.tenant !== identity.tenant) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message: `the declaring principal belongs to tenant ${JSON.stringify(declaredBy.tenant)}, not the profile's tenant ${JSON.stringify(identity.tenant)} (architecture-lock rule 11)`,
      details: { field: 'declaredBy', declaredByTenant: declaredBy.tenant, profileTenant: identity.tenant },
    });
  }
  if (typeof input.declaredAt !== 'string') {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message:
        'an expert profile requires the declaredAt field (UTC millisecond-precision timestamp)',
      details: { field: 'declaredAt' },
    });
  }
  const declaredAt = toExpertRegistryTimestamp(input.declaredAt);

  // --- supersession ---------------------------------------------------------
  const supersedes =
    input.supersedes === undefined ? undefined : toExpertVersionRef(input.supersedes);
  if (supersedes !== undefined) {
    if (
      supersedes.tenant !== identity.tenant ||
      supersedes.expertId !== identity.expertId
    ) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_SUPERSESSION, {
        message: `supersession must target the same logical expert: ${JSON.stringify(supersedes.tenant)}/${JSON.stringify(supersedes.expertId)} does not match ${expertLogicalKey(identity)}`,
        details: {
          supersedes: formatExpertVersionRef(supersedes),
          expert: expertLogicalKey(identity),
        },
      });
    }
    if (compareExpertVersions(supersedes.version, version) >= 0) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_SUPERSESSION, {
        message: `a superseding profile version must have STRICTLY higher semver precedence than the version it supersedes: ${JSON.stringify(version)} does not supersede ${JSON.stringify(supersedes.version)}`,
        details: { supersedes: formatExpertVersionRef(supersedes), version },
      });
    }
  }

  const createdEvent = makeProfileCreatedEvent({
    sequence: 1,
    occurredAt: declaredAt,
    actor: declaredBy,
    expertIdentity: identity,
  });

  const view: ExpertProfileContentView = {
    recordVersion: EXPERT_PROFILE_RECORD_VERSION,
    identity,
    identityRefs: frozenIdentityRefs,
    version,
    status: 'draft',
    competencies,
    qualifications,
    evidence,
    taskHistory,
    reliability,
    availability,
    domainScope,
    privacyPolicy,
    ...(supersedes !== undefined ? { supersedes } : {}),
    lifecycle: Object.freeze([createdEvent]),
    declaredAt,
  };
  const digest = toContentDigest(await computeExpertProfileDigest(view));
  const profile: ExpertProfile = deepFreeze({ ...view, digest });
  return profile;
}

// ---------------------------------------------------------------------------
// Digest / verification
// ---------------------------------------------------------------------------

// Digest helpers live in digest.ts (shared with lifecycle.ts, no runtime
// cycle); re-exported here so the package surface keeps one home.
export { computeExpertProfileDigest, expertProfileContentView } from './digest.js';

export function isExpertProfile(value: unknown): value is ExpertProfile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === EXPERT_PROFILE_RECORD_VERSION &&
    isExpertIdentity(candidate['identity']) &&
    Array.isArray(candidate['identityRefs']) &&
    candidate['identityRefs'].every(
      (ref) =>
        typeof ref === 'object' &&
        ref !== null &&
        typeof (ref as Record<string, unknown>)['digest'] === 'string',
    ) &&
    isExpertVersion(candidate['version']) &&
    isExpertStatus(candidate['status']) &&
    Array.isArray(candidate['competencies']) &&
    candidate['competencies'].length > 0 &&
    Array.isArray(candidate['qualifications']) &&
    Array.isArray(candidate['evidence']) &&
    candidate['evidence'].length > 0 &&
    Array.isArray(candidate['taskHistory']) &&
    Array.isArray(candidate['reliability']) &&
    typeof candidate['availability'] === 'object' &&
    candidate['availability'] !== null &&
    Array.isArray((candidate['availability'] as Record<string, unknown>)['windows']) &&
    typeof candidate['domainScope'] === 'object' &&
    candidate['domainScope'] !== null &&
    Array.isArray((candidate['domainScope'] as Record<string, unknown>)['limitations']) &&
    isExpertProfilePrivacyPolicy(candidate['privacyPolicy']) &&
    Array.isArray(candidate['lifecycle']) &&
    candidate['lifecycle'].every(
      (event) =>
        typeof event === 'object' &&
        event !== null &&
        typeof (event as Record<string, unknown>)['sequence'] === 'number',
    ) &&
    (candidate['supersedes'] === undefined ||
      isExpertVersionRef(candidate['supersedes'])) &&
    (candidate['supersededBy'] === undefined ||
      isExpertVersionRef(candidate['supersededBy'])) &&
    isContentDigest(candidate['digest'])
  );
}

/**
 * Re-compute a profile's digest and compare it with the claimed digest (or
 * an explicitly expected one). FAILS CLOSED with EXPERT_TAMPERED on any
 * mismatch — a mutation of any field, ledger entry, status or history
 * event is always detected. Returns the verified digest.
 */
export async function verifyExpertProfile(
  profile: ExpertProfile,
  expectedDigest?: string,
): Promise<string> {
  if (!isExpertProfile(profile)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message: 'not a structurally valid expert profile',
    });
  }
  const actual = await computeExpertProfileDigest(
    expertProfileContentView(profile),
  );
  const claimed = expectedDigest ?? profile.digest;
  if (actual !== claimed) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.TAMPERED, {
      message: `expert profile digest mismatch: expected ${claimed}, recomputed ${actual}`,
      details: { expected: claimed, actual },
    });
  }
  return actual;
}

/** A content-addressed ref to this exact profile state (identity+version+digest). */
export function expertVersionRef(profile: ExpertProfile): ExpertVersionRef {
  return Object.freeze({
    tenant: profile.identity.tenant,
    expertId: profile.identity.expertId,
    version: toExpertVersion(profile.version),
    digest: toContentDigest(profile.digest),
  });
}
