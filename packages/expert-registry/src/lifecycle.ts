/**
 * Expert-profile lifecycle (Work Order A006 gate 5; docs/architecture.md §8;
 * architecture-lock rule 6).
 *
 * Lifecycle is STRICTLY append-only and terminal-final:
 *
 *   DRAFT → PUBLISHED → SUSPENDED → PUBLISHED (reinstatement)
 *                      ↘ RETIRED (terminal)
 *            ↘ RETIRED (terminal)
 *   any non-terminal → supersession-marked (profile-superseded event,
 *                      status unchanged — supersession is a VERSION-level
 *                      concern, not a status; see below)
 *
 *   - every transition is a PURE function returning a NEW frozen profile
 *     (the input profile is never modified) and appending exactly one
 *     ExpertLifecycleEvent to the embedded append-only history (the
 *     event-log prefix is preserved verbatim — history is never
 *     rewritten);
 *   - the terminal status RETIRED is FINAL: every lifecycle operation on a
 *     retired profile throws EXPERT_TERMINAL_STATE, and because profiles
 *     are deep-frozen, in-place mutation throws as well;
 *   - SUPERSESSION is version-level, not a status: `supersedeProfile`
 *     appends a `profile-superseded` event and records the superseding
 *     version's full content-addressed ref on the state (`supersededBy`);
 *     the superseded version stays immutable and addressable forever
 *     (gate 5). The superseding version is created separately via
 *     `createExpertProfile` carrying the matching `supersedes` ref;
 *   - `attachExpertEvidence`, `recordTaskHistory` and
 *     `recordReliabilityOutcome` append without a status change (evidence
 *     discipline and event-sourced reliability, lock rule 6); there is NO
 *     removal API anywhere in this package (the export surface is
 *     asserted by the hygiene suite, and `assertProfileHistoryAppendOnly`
 *     is the auditor/registry-level tripwire);
 *   - transitions never read a wall clock: every timestamp is injected.
 */

import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import {
  expertLogicalKey,
  formatExpertVersionRef,
  toExpertVersionRef,
} from './identity.js';
import type { ExpertIdentity, ExpertVersionRef } from './identity.js';
import type { ExpertProfile } from './profile.js';
import { computeExpertProfileDigest, expertProfileContentView } from './digest.js';
import {
  assertNoDuplicateEvidence,
  deepFreeze,
  toEvidenceRef,
  toPrincipalRefView,
} from './shared.js';
import {
  assertTaskHistoryAppendOnly,
  toTaskHistory,
  toTaskRecordRefView,
} from './task-history.js';
import type { TaskRecordRefLike, TaskRecordRefView } from './task-history.js';
import {
  appendReliabilityEntry,
  assertReliabilityAppendOnly,
} from './reliability.js';
import type { ReliabilityLedgerEntry } from './reliability.js';
import { toExpertRegistryTimestamp } from './timestamp.js';
import type { EvidenceRef, PrincipalRefLike, PrincipalRefView } from './shared.js';

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

/** The closed lifecycle status set (gate 5: DRAFT → PUBLISHED → SUSPENDED → RETIRED). */
export const EXPERT_STATUSES = [
  'draft',
  'published',
  'suspended',
  'retired',
] as const;

export type ExpertStatus = (typeof EXPERT_STATUSES)[number];

/** Terminal status: final, immutable-by-transition, forever addressable. */
export const EXPERT_TERMINAL_STATUSES = ['retired'] as const;

export type TerminalExpertStatus = (typeof EXPERT_TERMINAL_STATUSES)[number];

export function isExpertStatus(value: unknown): value is ExpertStatus {
  return (
    typeof value === 'string' &&
    (EXPERT_STATUSES as readonly string[]).includes(value)
  );
}

export function isTerminalExpertStatus(
  value: ExpertStatus,
): value is TerminalExpertStatus {
  return (EXPERT_TERMINAL_STATUSES as readonly string[]).includes(value);
}

/** True iff the profile has reached a terminal state. */
export function isTerminalProfile(profile: ExpertProfile): boolean {
  return isTerminalExpertStatus(profile.status);
}

/** Validate and coerce a status string; throws INVALID_STATUS otherwise. */
export function toExpertStatus(value: string): ExpertStatus {
  if (!isExpertStatus(value)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_STATUS, {
      message: `unknown expert profile status: ${JSON.stringify(value)} (known: ${EXPERT_STATUSES.join(', ')})`,
      details: { known: [...EXPERT_STATUSES] },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Lifecycle events (append-only history)
// ---------------------------------------------------------------------------

/** Wire version of the lifecycle event shape. */
export const EXPERT_LIFECYCLE_EVENT_VERSION = 1 as const;

/** The closed lifecycle event kind set. */
export const EXPERT_LIFECYCLE_EVENT_KINDS = [
  'profile-created',
  'profile-published',
  'profile-suspended',
  'profile-reinstated',
  'profile-retired',
  'profile-superseded',
  'evidence-attached',
  'task-recorded',
  'reliability-recorded',
] as const;

export type ExpertLifecycleEventKind = (typeof EXPERT_LIFECYCLE_EVENT_KINDS)[number];

export function isExpertLifecycleEventKind(
  value: unknown,
): value is ExpertLifecycleEventKind {
  return (
    typeof value === 'string' &&
    (EXPERT_LIFECYCLE_EVENT_KINDS as readonly string[]).includes(value)
  );
}

/**
 * One append-only lifecycle event: what happened (kind), when
 * (occurredAt), who (actor), the status transition (from → to), an
 * optional human note, and — for the structured kinds — the data the
 * event commits (appended evidence refs / task record refs / reliability
 * ledger entries / the superseding version ref).
 */
export interface ExpertLifecycleEvent {
  readonly eventVersion: typeof EXPERT_LIFECYCLE_EVENT_VERSION;
  /** 1-based, strictly increasing within a profile version's history. */
  readonly sequence: number;
  readonly kind: ExpertLifecycleEventKind;
  readonly occurredAt: string;
  readonly actor: PrincipalRefView;
  readonly fromStatus: ExpertStatus;
  readonly toStatus: ExpertStatus;
  readonly note?: string;
  /** Only on `evidence-attached`: the evidence refs appended by the event. */
  readonly evidenceAppended?: readonly EvidenceRef[];
  /** Only on `task-recorded`: the task record refs appended by the event. */
  readonly taskRecordAppended?: readonly TaskRecordRefView[];
  /** Only on `reliability-recorded`: the ledger entries appended by the event. */
  readonly reliabilityAppended?: readonly ReliabilityLedgerEntry[];
  /** Only on `profile-superseded`: the superseding profile version ref. */
  readonly supersededBy?: ExpertVersionRef;
}

export function isExpertLifecycleEvent(
  value: unknown,
): value is ExpertLifecycleEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const actor = candidate['actor'];
  return (
    candidate['eventVersion'] === EXPERT_LIFECYCLE_EVENT_VERSION &&
    typeof candidate['sequence'] === 'number' &&
    Number.isInteger(candidate['sequence']) &&
    candidate['sequence'] >= 1 &&
    isExpertLifecycleEventKind(candidate['kind']) &&
    typeof candidate['occurredAt'] === 'string' &&
    isExpertStatus(candidate['fromStatus']) &&
    isExpertStatus(candidate['toStatus']) &&
    typeof actor === 'object' &&
    actor !== null &&
    typeof (actor as Record<string, unknown>)['principalId'] === 'string' &&
    (candidate['note'] === undefined ||
      (typeof candidate['note'] === 'string' && candidate['note'].length > 0)) &&
    (candidate['evidenceAppended'] === undefined ||
      Array.isArray(candidate['evidenceAppended'])) &&
    (candidate['taskRecordAppended'] === undefined ||
      Array.isArray(candidate['taskRecordAppended'])) &&
    (candidate['reliabilityAppended'] === undefined ||
      Array.isArray(candidate['reliabilityAppended'])) &&
    (candidate['supersededBy'] === undefined ||
      typeof candidate['supersededBy'] === 'object')
  );
}

// ---------------------------------------------------------------------------
// Event constructors (events are produced by transitions; profile-created
// is exported for profile.ts construction)
// ---------------------------------------------------------------------------

function makeEvent(
  kind: ExpertLifecycleEventKind,
  input: {
    sequence: number;
    occurredAt: string;
    actor: PrincipalRefView;
    fromStatus: ExpertStatus;
    toStatus: ExpertStatus;
    note?: string;
    evidenceAppended?: readonly EvidenceRef[];
    taskRecordAppended?: readonly TaskRecordRefView[];
    reliabilityAppended?: readonly ReliabilityLedgerEntry[];
    supersededBy?: ExpertVersionRef;
  },
): ExpertLifecycleEvent {
  const occurredAt = toExpertRegistryTimestamp(input.occurredAt);
  if (input.note !== undefined && input.note.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIFECYCLE, {
      message: `lifecycle event notes, when present, must be non-empty: ${JSON.stringify(input.note)}`,
      details: { kind },
    });
  }
  return deepFreeze({
    eventVersion: EXPERT_LIFECYCLE_EVENT_VERSION,
    sequence: input.sequence,
    kind,
    occurredAt,
    actor: input.actor,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.evidenceAppended !== undefined
      ? { evidenceAppended: input.evidenceAppended }
      : {}),
    ...(input.taskRecordAppended !== undefined
      ? { taskRecordAppended: input.taskRecordAppended }
      : {}),
    ...(input.reliabilityAppended !== undefined
      ? { reliabilityAppended: input.reliabilityAppended }
      : {}),
    ...(input.supersededBy !== undefined ? { supersededBy: input.supersededBy } : {}),
  });
}

/** The initial `profile-created` event (sequence 1, draft → draft). */
export function makeProfileCreatedEvent(input: {
  sequence: number;
  occurredAt: string;
  actor: PrincipalRefView;
  expertIdentity: ExpertIdentity;
}): ExpertLifecycleEvent {
  if (input.sequence !== 1) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIFECYCLE, {
      message: `profile-created is always the first event (sequence 1), got ${input.sequence}`,
    });
  }
  if (input.expertIdentity === undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIFECYCLE, {
      message: 'profile-created event requires the expert identity',
    });
  }
  return makeEvent('profile-created', {
    sequence: input.sequence,
    occurredAt: input.occurredAt,
    actor: input.actor,
    fromStatus: 'draft',
    toStatus: 'draft',
  });
}

// ---------------------------------------------------------------------------
// Transition core (guards)
// ---------------------------------------------------------------------------

function assertNotTerminal(profile: ExpertProfile): void {
  if (isTerminalProfile(profile)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.TERMINAL_STATE, {
      message: `expert ${profile.identity.expertId} (${profile.identity.tenant}) is ${profile.status} and cannot be mutated: terminal states are final (append-only history preserves the full lifecycle)`,
      details: {
        tenant: profile.identity.tenant,
        expertId: profile.identity.expertId,
        version: profile.version,
        status: profile.status,
        digest: profile.digest,
        events: profile.lifecycle.length,
      },
    });
  }
}

function requireStatus(profile: ExpertProfile, expected: ExpertStatus): void {
  assertNotTerminal(profile);
  if (profile.status !== expected) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TRANSITION, {
      message: `expert ${profile.identity.expertId} cannot transition from ${profile.status} (expected source state ${expected})`,
      details: {
        tenant: profile.identity.tenant,
        expertId: profile.identity.expertId,
        from: profile.status,
        expected,
      },
    });
  }
}

/**
 * Rebuild a profile with a new status, one appended event and (optionally)
 * extended evidence / task history / reliability / a supersededBy ref,
 * preserving every other field and the full history prefix. Recomputes the
 * content digest — the new state is a NEW content-addressed object; the
 * previous state stays immutable and addressable by ITS digest.
 */
async function advance(
  profile: ExpertProfile,
  patch: {
    status: ExpertStatus;
    event: ExpertLifecycleEvent;
    evidence?: readonly EvidenceRef[];
    taskHistory?: readonly TaskRecordRefView[];
    reliability?: readonly ReliabilityLedgerEntry[];
    supersededBy?: ExpertVersionRef;
  },
): Promise<ExpertProfile> {
  const previous = expertProfileContentView(profile);
  const nextView = {
    ...previous,
    status: patch.status,
    evidence: patch.evidence ?? profile.evidence,
    taskHistory: patch.taskHistory ?? profile.taskHistory,
    reliability: patch.reliability ?? profile.reliability,
    ...(patch.supersededBy !== undefined ? { supersededBy: patch.supersededBy } : {}),
    lifecycle: Object.freeze([...profile.lifecycle, patch.event]),
  };
  const digest = await computeExpertProfileDigest(nextView);
  return deepFreeze({ ...nextView, digest });
}

// ---------------------------------------------------------------------------
// Lifecycle transitions (pure; terminal states are final)
// ---------------------------------------------------------------------------

/** Common context for a lifecycle transition (all inputs explicit). */
export interface ProfileTransitionContext {
  /** When the transition occurred (injected — transitions never read clocks). */
  readonly at: string;
  /** Who performed the transition (tenant-scoped principal). */
  readonly actor: PrincipalRefLike;
  /** Optional human note recorded on the event. */
  readonly note?: string;
}

function actorOf(context: ProfileTransitionContext, profile: ExpertProfile): PrincipalRefView {
  const actor = toPrincipalRefView(context.actor);
  if (actor.tenant !== profile.identity.tenant) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.CROSS_TENANT_ACCESS, {
      message: `cross-tenant mutation denied: actor from tenant ${JSON.stringify(actor.tenant)} cannot mutate a profile owned by tenant ${JSON.stringify(profile.identity.tenant)} (lock rule 11)`,
      details: {
        profileTenant: profile.identity.tenant,
        actorTenant: actor.tenant,
        expertId: profile.identity.expertId,
      },
    });
  }
  return actor;
}

/** Publish a draft profile: DRAFT → PUBLISHED. */
export async function publishProfile(
  profile: ExpertProfile,
  context: ProfileTransitionContext,
): Promise<ExpertProfile> {
  requireStatus(profile, 'draft');
  const event = makeEvent('profile-published', {
    sequence: profile.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context, profile),
    fromStatus: 'draft',
    toStatus: 'published',
    ...(context.note !== undefined ? { note: context.note } : {}),
  });
  return advance(profile, { status: 'published', event });
}

/** Suspend a published profile (e.g. availability pause): PUBLISHED → SUSPENDED. */
export async function suspendProfile(
  profile: ExpertProfile,
  context: ProfileTransitionContext,
): Promise<ExpertProfile> {
  requireStatus(profile, 'published');
  const event = makeEvent('profile-suspended', {
    sequence: profile.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context, profile),
    fromStatus: 'published',
    toStatus: 'suspended',
    ...(context.note !== undefined ? { note: context.note } : {}),
  });
  return advance(profile, { status: 'suspended', event });
}

/** Reinstate a suspended profile: SUSPENDED → PUBLISHED. */
export async function reinstateProfile(
  profile: ExpertProfile,
  context: ProfileTransitionContext,
): Promise<ExpertProfile> {
  requireStatus(profile, 'suspended');
  const event = makeEvent('profile-reinstated', {
    sequence: profile.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context, profile),
    fromStatus: 'suspended',
    toStatus: 'published',
    ...(context.note !== undefined ? { note: context.note } : {}),
  });
  return advance(profile, { status: 'published', event });
}

/**
 * Retire a published or suspended profile: → RETIRED (TERMINAL). The
 * retirement note is REQUIRED — a retirement without a stated rationale
 * is not auditable.
 */
export async function retireProfile(
  profile: ExpertProfile,
  context: ProfileTransitionContext & { note: string },
): Promise<ExpertProfile> {
  assertNotTerminal(profile);
  if (profile.status !== 'published' && profile.status !== 'suspended') {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TRANSITION, {
      message: `expert ${profile.identity.expertId} cannot retire from ${profile.status} (expected source state published or suspended)`,
      details: {
        tenant: profile.identity.tenant,
        expertId: profile.identity.expertId,
        from: profile.status,
        expected: 'published|suspended',
      },
    });
  }
  if (typeof context.note !== 'string' || context.note.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TRANSITION, {
      message: 'retirement requires a non-empty rationale note',
      details: { expertId: profile.identity.expertId },
    });
  }
  const event = makeEvent('profile-retired', {
    sequence: profile.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context, profile),
    fromStatus: profile.status,
    toStatus: 'retired',
    note: context.note,
  });
  return advance(profile, { status: 'retired', event });
}

/**
 * Mark a profile version SUPERSEDED by a new profile version: any
 * NON-TERMINAL status → same status, with the superseding version's full
 * content-addressed ref recorded on the state (`supersededBy`) AND on the
 * event. The superseded version stays immutable and addressable (gate 5).
 * The superseding version (created separately via `createExpertProfile`
 * with the matching `supersedes` ref) must belong to the same logical
 * expert and have strictly higher semver precedence.
 */
export async function supersedeProfile(
  profile: ExpertProfile,
  context: ProfileTransitionContext & {
    superseding: {
      tenant: string;
      expertId: string;
      version: string;
      digest: string;
    };
  },
): Promise<ExpertProfile> {
  assertNotTerminal(profile);
  if (profile.supersededBy !== undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_SUPERSESSION, {
      message: `profile ${expertLogicalKey(profile.identity)}@${profile.version} is already superseded by ${formatExpertVersionRef(profile.supersededBy)} (supersession is once per version)`,
      details: { supersededBy: formatExpertVersionRef(profile.supersededBy) },
    });
  }
  const superseding = toExpertVersionRef(context.superseding);
  if (
    superseding.tenant !== profile.identity.tenant ||
    superseding.expertId !== profile.identity.expertId
  ) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_SUPERSESSION, {
      message: `supersession must stay within one logical expert: ${JSON.stringify(superseding.tenant)}/${JSON.stringify(superseding.expertId)} does not supersede ${expertLogicalKey(profile.identity)}`,
      details: {
        superseding: formatExpertVersionRef(superseding),
        expert: expertLogicalKey(profile.identity),
      },
    });
  }
  if (superseding.version === profile.version) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_SUPERSESSION, {
      message: `a profile version cannot be superseded by the same version: ${JSON.stringify(profile.version)}`,
      details: { version: profile.version },
    });
  }
  if (superseding.digest === profile.digest) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_SUPERSESSION, {
      message: 'the superseding ref must address a DIFFERENT content state',
      details: { digest: superseding.digest },
    });
  }
  const event = makeEvent('profile-superseded', {
    sequence: profile.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context, profile),
    fromStatus: profile.status,
    toStatus: profile.status,
    ...(context.note !== undefined ? { note: context.note } : {}),
    supersededBy: superseding,
  });
  return advance(profile, {
    status: profile.status,
    event,
    supersededBy: superseding,
  });
}

/**
 * Append digest-addressed foundational evidence to a profile (lock rule 6:
 * evidence is append-only). No status change: any NON-TERMINAL status may
 * gain evidence. Each appended digest must be new (duplicates are
 * rejected); there is NO API that removes or rewrites attached evidence —
 * `assertProfileHistoryAppendOnly` is the auditor/registry-level tripwire.
 */
export async function attachExpertEvidence(
  profile: ExpertProfile,
  context: ProfileTransitionContext & {
    evidence: readonly { digest: string; description: string }[];
  },
): Promise<ExpertProfile> {
  assertNotTerminal(profile);
  if (!Array.isArray(context.evidence) || context.evidence.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_EVIDENCE, {
      message: 'attachExpertEvidence requires at least one evidence reference',
      details: { expertId: profile.identity.expertId },
    });
  }
  const appended = Object.freeze(context.evidence.map((ref) => toEvidenceRef(ref)));
  const existing = new Set(profile.evidence.map((ref) => ref.digest));
  for (const ref of appended) {
    if (existing.has(ref.digest)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.DUPLICATE_EVIDENCE, {
        message: `evidence digest already attached to this profile: ${ref.digest}`,
        details: { digest: ref.digest },
      });
    }
    existing.add(ref.digest);
  }
  assertNoDuplicateEvidence([...profile.evidence, ...appended]);
  const event = makeEvent('evidence-attached', {
    sequence: profile.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context, profile),
    fromStatus: profile.status,
    toStatus: profile.status,
    evidenceAppended: appended,
    ...(context.note !== undefined ? { note: context.note } : {}),
  });
  return advance(profile, {
    status: profile.status,
    event,
    evidence: Object.freeze([...profile.evidence, ...appended]),
  });
}

/**
 * Append content-addressed task record refs to the profile's task history
 * (lock rule 6: history is append-only). No status change: any
 * NON-TERMINAL status may gain history. Each appended record must be new
 * (duplicates rejected) and belong to the profile's tenant (lock rule 11).
 */
export async function recordTaskHistory(
  profile: ExpertProfile,
  context: ProfileTransitionContext & {
    records: readonly TaskRecordRefLike[];
  },
): Promise<ExpertProfile> {
  assertNotTerminal(profile);
  if (!Array.isArray(context.records) || context.records.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
      message: 'recordTaskHistory requires at least one task record ref',
      details: { expertId: profile.identity.expertId },
    });
  }
  const appended = context.records.map((record) => toTaskRecordRefView(record));
  for (const record of appended) {
    if (record.tenant !== profile.identity.tenant) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
        message: `appended task record ${JSON.stringify(record.taskId)} belongs to tenant ${JSON.stringify(record.tenant)}, not the profile's tenant (lock rule 11)`,
        details: { recordTenant: record.tenant, profileTenant: profile.identity.tenant },
      });
    }
  }
  const nextHistory = toTaskHistory([...profile.taskHistory, ...appended]);
  const event = makeEvent('task-recorded', {
    sequence: profile.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context, profile),
    fromStatus: profile.status,
    toStatus: profile.status,
    taskRecordAppended: Object.freeze(appended),
    ...(context.note !== undefined ? { note: context.note } : {}),
  });
  return advance(profile, {
    status: profile.status,
    event,
    taskHistory: nextHistory,
  });
}

/**
 * Append one event-sourced reliability outcome entry to the profile's
 * ledger (§8 reliability; R32). No status change: any NON-TERMINAL status
 * may gain outcome events. The entry's sequence is assigned by the ledger
 * itself; the recorded-by principal must belong to the profile's tenant.
 * Counters are NEVER stored — they are derived via
 * `recomputeReliabilityMetrics`.
 */
export async function recordReliabilityOutcome(
  profile: ExpertProfile,
  context: ProfileTransitionContext & {
    entry: {
      kind: string;
      occurredAt: string;
      recordedBy: PrincipalRefLike;
      taskRecord?: TaskRecordRefLike;
      note?: string;
      evidence?: readonly { digest: string; description: string }[];
    };
  },
): Promise<ExpertProfile> {
  assertNotTerminal(profile);
  const recordedBy = toPrincipalRefView(context.entry.recordedBy);
  if (recordedBy.tenant !== profile.identity.tenant) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_RELIABILITY, {
      message: `reliability outcomes are recorded by the profile's own tenant principals: ${JSON.stringify(recordedBy.tenant)} is not ${JSON.stringify(profile.identity.tenant)} (lock rule 11)`,
      details: { recordedByTenant: recordedBy.tenant, profileTenant: profile.identity.tenant },
    });
  }
  const nextLedger = appendReliabilityEntry(profile.reliability, {
    ...context.entry,
    recordedBy,
  });
  const appended = nextLedger[nextLedger.length - 1];
  if (appended === undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_RELIABILITY, {
      message: 'reliability append produced no entry',
    });
  }
  const event = makeEvent('reliability-recorded', {
    sequence: profile.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context, profile),
    fromStatus: profile.status,
    toStatus: profile.status,
    reliabilityAppended: Object.freeze([appended]),
    ...(context.note !== undefined ? { note: context.note } : {}),
  });
  return advance(profile, {
    status: profile.status,
    event,
    reliability: nextLedger,
  });
}

/**
 * Assert that a candidate profile state's evidence list, task history,
 * reliability ledger and lifecycle history EXTEND a previous state of the
 * same profile version (append-only discipline, lock rule 6): each
 * previous list must be a strict prefix of the new one and the history
 * must be a prefix of the new one, with matching identity/version.
 * Throws EVIDENCE_REMOVAL / TASK_HISTORY_REMOVAL /
 * RELIABILITY_MUTATION / INVALID_LIFECYCLE otherwise. Used by the
 * registry (registry.ts) and available to auditors.
 */
export function assertProfileHistoryAppendOnly(
  previous: ExpertProfile,
  next: ExpertProfile,
): void {
  if (
    previous.identity.tenant !== next.identity.tenant ||
    previous.identity.expertId !== next.identity.expertId
  ) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIFECYCLE, {
      message: 'append-only discipline applies within one logical expert',
      details: {
        previous: `${previous.identity.tenant}/${previous.identity.expertId}`,
        next: `${next.identity.tenant}/${next.identity.expertId}`,
      },
    });
  }
  if (previous.version !== next.version) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIFECYCLE, {
      message: `append-only discipline applies within one profile version: ${JSON.stringify(previous.version)} → ${JSON.stringify(next.version)} (use supersession for new versions)`,
      details: { previous: previous.version, next: next.version },
    });
  }
  // Evidence monotonicity: the previous evidence list is a PREFIX of the next.
  if (next.evidence.length < previous.evidence.length) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.EVIDENCE_REMOVAL, {
      message: `evidence removal detected: evidence count shrank from ${previous.evidence.length} to ${next.evidence.length} (historical evidence is append-only — lock rule 6)`,
      details: {
        previousCount: previous.evidence.length,
        nextCount: next.evidence.length,
      },
    });
  }
  for (let i = 0; i < previous.evidence.length; i += 1) {
    const before = previous.evidence[i];
    const after = next.evidence[i];
    if (
      before === undefined ||
      after === undefined ||
      before.digest !== after.digest ||
      before.description !== after.description
    ) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.EVIDENCE_REMOVAL, {
        message: `evidence rewrite detected at position ${i}: historical evidence is append-only and never rewritten (lock rule 6)`,
        details: { position: i },
      });
    }
  }
  // Task-history monotonicity.
  assertTaskHistoryAppendOnly(previous.taskHistory, next.taskHistory);
  // Reliability monotonicity.
  assertReliabilityAppendOnly(previous.reliability, next.reliability);
  // History monotonicity: the previous history is a PREFIX of the next.
  if (next.lifecycle.length < previous.lifecycle.length) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIFECYCLE, {
      message: `lifecycle history shrink detected: events shrank from ${previous.lifecycle.length} to ${next.lifecycle.length} (history is append-only)`,
      details: {
        previousEvents: previous.lifecycle.length,
        nextEvents: next.lifecycle.length,
      },
    });
  }
  for (let i = 0; i < previous.lifecycle.length; i += 1) {
    const before = previous.lifecycle[i];
    const after = next.lifecycle[i];
    if (before !== after) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_LIFECYCLE, {
        message: `lifecycle history rewrite detected at position ${i}: history is append-only and never rewritten`,
        details: { position: i },
      });
    }
  }
}
