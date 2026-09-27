/**
 * Capability-case lifecycle (Work Order A005 gate 3/4; spec CC1.0
 * "Lifecycle"; architecture-lock rule 6).
 *
 * Lifecycle is STRICTLY append-only and terminal-final:
 *
 *   DRAFT → SUBMITTED → TRIAGED → ACTIVE → RESOLVED
 *                                        ↘ SUPERSEDED
 *
 *   - every transition is a PURE function returning a NEW frozen case (the
 *     input case is never modified) and appending exactly one
 *     CaseLifecycleEvent to the embedded append-only history (the event-log
 *     prefix is preserved verbatim — history is never rewritten);
 *   - terminal states (RESOLVED, SUPERSEDED) are FINAL: every lifecycle
 *     operation on a terminal case throws CAPABILITY_CASE_TERMINAL_STATE,
 *     and because cases are deep-frozen, in-place mutation throws as well;
 *   - SUPERSEDED is reached by `supersedeCase`, which records the
 *     superseding version's full content-addressed ref on the terminal case
 *     state (`supersededBy`); the superseded version stays immutable and
 *     addressable (gate 4). The superseding version is created separately
 *     via `createCapabilityCase` carrying the matching `supersedes` ref;
 *   - `attachEvidence` appends digest-addressed evidence refs without a
 *     status change (evidence discipline, lock rule 6); there is NO
 *     evidence-removal API anywhere in this package (the export surface is
 *     asserted by the hygiene suite, and `assertAppendOnly` is the
 *     auditor/registry-level tripwire);
 *   - transitions never read a wall clock: every timestamp is injected.
 *
 * Mapping to the spec CC1.0 delivery lifecycle (OPEN → TRIAGED →
 * TASK_DESIGNED → EXPERT_WORK → EVALUATION → LEARNING → VALIDATED →
 * CLOSED): the protocol-level ACTIVE status covers the delivery phases
 * between triage and resolution (task design, expert work, evaluation,
 * learning); RESOLVED covers VALIDATED→CLOSED. The finer-grained phases
 * live in the objects those phases produce (task specs, trajectories,
 * evaluation records), not in the case protocol — see the A005 final
 * report, "Architecture questions".
 */

import { CAPABILITY_CASE_ERROR_CODES, CapabilityCaseError } from './errors.js';
import { formatCaseVersionRef, toCaseVersionRef } from './identity.js';
import type { CaseIdentity, CaseVersionRef } from './identity.js';
import type { CapabilityCase } from './case.js';
import { computeCapabilityCaseDigest, capabilityCaseContentView } from './digest.js';
import {
  assertNoDuplicateEvidence,
  deepFreeze,
  toEvidenceRef,
  toPrincipalRefView,
} from './shared.js';
import type { EvidenceRef, PrincipalRefLike, PrincipalRefView } from './shared.js';
import { toCapabilityCaseTimestamp } from './timestamp.js';
import type { CapabilityCaseTimestamp } from './timestamp.js';

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

/** The closed lifecycle status set (gate 3). */
export const CASE_STATUSES = [
  'draft',
  'submitted',
  'triaged',
  'active',
  'resolved',
  'superseded',
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Terminal statuses: final, immutable-by-transition, forever addressable. */
export const CASE_TERMINAL_STATUSES = ['resolved', 'superseded'] as const;

export type TerminalCaseStatus = (typeof CASE_TERMINAL_STATUSES)[number];

export function isCaseStatus(value: unknown): value is CaseStatus {
  return (
    typeof value === 'string' &&
    (CASE_STATUSES as readonly string[]).includes(value)
  );
}

export function isTerminalCaseStatus(
  value: CaseStatus,
): value is TerminalCaseStatus {
  return (CASE_TERMINAL_STATUSES as readonly string[]).includes(value);
}

/** True iff the case has reached a terminal state. */
export function isTerminalCase(caseRecord: CapabilityCase): boolean {
  return isTerminalCaseStatus(caseRecord.status);
}

/** Validate and coerce a status string; throws INVALID_STATUS otherwise. */
export function toCaseStatus(value: string): CaseStatus {
  if (!isCaseStatus(value)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_STATUS, {
      message: `unknown case status: ${JSON.stringify(value)} (known: ${CASE_STATUSES.join(', ')})`,
      details: { known: [...CASE_STATUSES] },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Lifecycle events (append-only history)
// ---------------------------------------------------------------------------

/** Wire version of the lifecycle event shape. */
export const CASE_LIFECYCLE_EVENT_VERSION = 1 as const;

/** The closed lifecycle event kind set. */
export const CASE_LIFECYCLE_EVENT_KINDS = [
  'case-created',
  'case-submitted',
  'case-triaged',
  'case-activated',
  'case-resolved',
  'case-superseded',
  'evidence-attached',
] as const;

export type CaseLifecycleEventKind = (typeof CASE_LIFECYCLE_EVENT_KINDS)[number];

export function isCaseLifecycleEventKind(
  value: unknown,
): value is CaseLifecycleEventKind {
  return (
    typeof value === 'string' &&
    (CASE_LIFECYCLE_EVENT_KINDS as readonly string[]).includes(value)
  );
}

/**
 * One append-only lifecycle event: what happened (kind), when (occurredAt),
 * who (actor), the status transition (from → to), an optional human note,
 * and — for the structured kinds — the data the event commits (appended
 * evidence refs / the superseding version ref).
 */
export interface CaseLifecycleEvent {
  readonly eventVersion: typeof CASE_LIFECYCLE_EVENT_VERSION;
  /** 1-based, strictly increasing within a case version's history. */
  readonly sequence: number;
  readonly kind: CaseLifecycleEventKind;
  readonly occurredAt: CapabilityCaseTimestamp;
  readonly actor: PrincipalRefView;
  readonly fromStatus: CaseStatus;
  readonly toStatus: CaseStatus;
  readonly note?: string;
  /** Only on `evidence-attached`: the evidence refs appended by the event. */
  readonly evidenceAppended?: readonly EvidenceRef[];
  /** Only on `case-superseded`: the superseding case version ref. */
  readonly supersededBy?: CaseVersionRef;
}

export function isCaseLifecycleEvent(value: unknown): value is CaseLifecycleEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const actor = candidate['actor'];
  return (
    candidate['eventVersion'] === CASE_LIFECYCLE_EVENT_VERSION &&
    typeof candidate['sequence'] === 'number' &&
    Number.isInteger(candidate['sequence']) &&
    candidate['sequence'] >= 1 &&
    isCaseLifecycleEventKind(candidate['kind']) &&
    typeof candidate['occurredAt'] === 'string' &&
    isCaseStatus(candidate['fromStatus']) &&
    isCaseStatus(candidate['toStatus']) &&
    typeof actor === 'object' &&
    actor !== null &&
    typeof (actor as Record<string, unknown>)['principalId'] === 'string' &&
    (candidate['note'] === undefined ||
      (typeof candidate['note'] === 'string' && candidate['note'].length > 0)) &&
    (candidate['evidenceAppended'] === undefined ||
      Array.isArray(candidate['evidenceAppended']))
  );
}

// ---------------------------------------------------------------------------
// Event constructors (events are produced by transitions; case-created is
// exported for case.ts construction)
// ---------------------------------------------------------------------------

function makeEvent(
  kind: CaseLifecycleEventKind,
  input: {
    sequence: number;
    occurredAt: string;
    actor: PrincipalRefView;
    fromStatus: CaseStatus;
    toStatus: CaseStatus;
    note?: string;
    evidenceAppended?: readonly EvidenceRef[];
    supersededBy?: CaseVersionRef;
  },
): CaseLifecycleEvent {
  const occurredAt = toCapabilityCaseTimestamp(input.occurredAt);
  if (input.note !== undefined && input.note.length === 0) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_LIFECYCLE, {
      message: `lifecycle event notes, when present, must be non-empty: ${JSON.stringify(input.note)}`,
      details: { kind },
    });
  }
  const event: CaseLifecycleEvent = deepFreeze({
    eventVersion: CASE_LIFECYCLE_EVENT_VERSION,
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
    ...(input.supersededBy !== undefined ? { supersededBy: input.supersededBy } : {}),
  });
  return event;
}

/** The initial `case-created` event (sequence 1, draft → draft). */
export function makeCaseCreatedEvent(input: {
  sequence: number;
  occurredAt: string;
  actor: PrincipalRefView;
  caseIdentity: CaseIdentity;
}): CaseLifecycleEvent {
  if (input.sequence !== 1) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_LIFECYCLE, {
      message: `case-created is always the first event (sequence 1), got ${input.sequence}`,
    });
  }
  if (input.caseIdentity === undefined) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_LIFECYCLE, {
      message: 'case-created event requires the case identity',
    });
  }
  return makeEvent('case-created', {
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

function assertNotTerminal(caseRecord: CapabilityCase): void {
  if (isTerminalCase(caseRecord)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.TERMINAL_STATE, {
      message: `case ${caseRecord.identity.caseId} (${caseRecord.identity.tenant}) is ${caseRecord.status} and cannot be mutated: terminal states are final (append-only history preserves the full lifecycle)`,
      details: {
        tenant: caseRecord.identity.tenant,
        caseId: caseRecord.identity.caseId,
        version: caseRecord.version,
        status: caseRecord.status,
        digest: caseRecord.digest,
        events: caseRecord.lifecycle.length,
      },
    });
  }
}

function requireStatus(caseRecord: CapabilityCase, expected: CaseStatus): void {
  assertNotTerminal(caseRecord);
  if (caseRecord.status !== expected) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION, {
      message: `case ${caseRecord.identity.caseId} cannot transition from ${caseRecord.status} (expected source state ${expected})`,
      details: {
        tenant: caseRecord.identity.tenant,
        caseId: caseRecord.identity.caseId,
        from: caseRecord.status,
        expected,
      },
    });
  }
}

/**
 * Rebuild a case with a new status, one appended event and (optionally)
 * extended evidence / a supersededBy ref, preserving every other field and
 * the full history prefix. Recomputes the content digest — the new state is
 * a NEW content-addressed object; the previous state stays immutable and
 * addressable by ITS digest.
 */
async function advance(
  caseRecord: CapabilityCase,
  patch: {
    status: CaseStatus;
    event: CaseLifecycleEvent;
    evidence?: readonly EvidenceRef[];
    supersededBy?: CaseVersionRef;
  },
): Promise<CapabilityCase> {
  const previous = capabilityCaseContentView(caseRecord);
  const nextView = {
    ...previous,
    status: patch.status,
    evidence: patch.evidence ?? caseRecord.evidence,
    ...(patch.supersededBy !== undefined
      ? { supersededBy: patch.supersededBy }
      : {}),
    lifecycle: Object.freeze([...caseRecord.lifecycle, patch.event]),
  };
  const digest = await computeCapabilityCaseDigest(nextView);
  return deepFreeze({ ...nextView, digest });
}

// ---------------------------------------------------------------------------
// Lifecycle transitions (pure; terminal states are final)
// ---------------------------------------------------------------------------

/** Common context for a lifecycle transition (all inputs explicit). */
export interface CaseTransitionContext {
  /** When the transition occurred (injected — transitions never read clocks). */
  readonly at: string;
  /** Who performed the transition (tenant-scoped principal). */
  readonly actor: PrincipalRefLike;
  /** Optional human note recorded on the event. */
  readonly note?: string;
}

function actorOf(context: CaseTransitionContext): PrincipalRefView {
  return toPrincipalRefView(context.actor);
}

/** Submit a draft case for triage: DRAFT → SUBMITTED. */
export async function submitCase(
  caseRecord: CapabilityCase,
  context: CaseTransitionContext,
): Promise<CapabilityCase> {
  requireStatus(caseRecord, 'draft');
  const event = makeEvent('case-submitted', {
    sequence: caseRecord.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context),
    fromStatus: 'draft',
    toStatus: 'submitted',
    ...(context.note !== undefined ? { note: context.note } : {}),
  });
  return advance(caseRecord, { status: 'submitted', event });
}

/**
 * Record the triage decision: SUBMITTED → TRIAGED. The triage note is
 * REQUIRED — the selection/triage rationale stays inspectable (spec CC1.0
 * "Active learning": "the selection rationale remains inspectable").
 */
export async function triageCase(
  caseRecord: CapabilityCase,
  context: CaseTransitionContext & { note: string },
): Promise<CapabilityCase> {
  requireStatus(caseRecord, 'submitted');
  if (typeof context.note !== 'string' || context.note.length === 0) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION,
      {
        message:
          'triage requires a non-empty rationale note (the selection rationale remains inspectable)',
        details: { caseId: caseRecord.identity.caseId },
      },
    );
  }
  const event = makeEvent('case-triaged', {
    sequence: caseRecord.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context),
    fromStatus: 'submitted',
    toStatus: 'triaged',
    note: context.note,
  });
  return advance(caseRecord, { status: 'triaged', event });
}

/** Activate a triaged case (capability development begins): TRIAGED → ACTIVE. */
export async function activateCase(
  caseRecord: CapabilityCase,
  context: CaseTransitionContext,
): Promise<CapabilityCase> {
  requireStatus(caseRecord, 'triaged');
  const event = makeEvent('case-activated', {
    sequence: caseRecord.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context),
    fromStatus: 'triaged',
    toStatus: 'active',
    ...(context.note !== undefined ? { note: context.note } : {}),
  });
  return advance(caseRecord, { status: 'active', event });
}

/**
 * Resolve an active case: ACTIVE → RESOLVED (TERMINAL). The resolution
 * statement is REQUIRED — a resolution without a stated outcome is not a
 * resolution.
 */
export async function resolveCase(
  caseRecord: CapabilityCase,
  context: CaseTransitionContext & { resolution: string },
): Promise<CapabilityCase> {
  requireStatus(caseRecord, 'active');
  if (typeof context.resolution !== 'string' || context.resolution.length === 0) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION,
      {
        message: 'resolution requires a non-empty outcome statement',
        details: { caseId: caseRecord.identity.caseId },
      },
    );
  }
  const event = makeEvent('case-resolved', {
    sequence: caseRecord.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context),
    fromStatus: 'active',
    toStatus: 'resolved',
    note: context.resolution,
  });
  return advance(caseRecord, { status: 'resolved', event });
}

/**
 * Mark a case SUPERSEDED by a new case version: any non-terminal status →
 * SUPERSEDED (TERMINAL). The superseding version's full content-addressed
 * ref is recorded on the terminal state (`supersededBy`) AND on the event;
 * the superseded version stays immutable and addressable (gate 4). The
 * superseding version (created separately via `createCapabilityCase` with
 * the matching `supersedes` ref) must belong to the same logical case.
 */
export async function supersedeCase(
  caseRecord: CapabilityCase,
  context: CaseTransitionContext & {
    superseding: {
      tenant: string;
      caseId: string;
      version: string;
      digest: string;
    };
  },
): Promise<CapabilityCase> {
  assertNotTerminal(caseRecord);
  const superseding = toCaseVersionRef(context.superseding);
  if (
    superseding.tenant !== caseRecord.identity.tenant ||
    superseding.caseId !== caseRecord.identity.caseId
  ) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_SUPERSESSION,
      {
        message: `supersession must stay within one logical case: ${JSON.stringify(superseding.tenant)}/${JSON.stringify(superseding.caseId)} does not supersede ${JSON.stringify(caseRecord.identity.tenant)}/${JSON.stringify(caseRecord.identity.caseId)}`,
        details: {
          superseding: formatCaseVersionRef(superseding),
          case: `${caseRecord.identity.tenant}/${caseRecord.identity.caseId}`,
        },
      },
    );
  }
  if (superseding.version === caseRecord.version) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_SUPERSESSION,
      {
        message: `a case version cannot be superseded by the same version: ${JSON.stringify(caseRecord.version)}`,
        details: { version: caseRecord.version },
      },
    );
  }
  if (superseding.digest === caseRecord.digest) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_SUPERSESSION,
      {
        message: 'the superseding ref must address a DIFFERENT content state',
        details: { digest: superseding.digest },
      },
    );
  }
  const event = makeEvent('case-superseded', {
    sequence: caseRecord.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context),
    fromStatus: caseRecord.status,
    toStatus: 'superseded',
    ...(context.note !== undefined ? { note: context.note } : {}),
    supersededBy: superseding,
  });
  return advance(caseRecord, {
    status: 'superseded',
    event,
    supersededBy: superseding,
  });
}

/**
 * Append digest-addressed evidence to a case (lock rule 6: evidence is
 * append-only). No status change: any NON-TERMINAL status may gain
 * evidence. Each appended digest must be new (duplicates are rejected);
 * there is NO API that removes or rewrites attached evidence —
 * `assertAppendOnly` is the auditor/registry-level tripwire.
 */
export async function attachEvidence(
  caseRecord: CapabilityCase,
  context: CaseTransitionContext & {
    evidence: readonly { digest: string; description: string }[];
  },
): Promise<CapabilityCase> {
  assertNotTerminal(caseRecord);
  if (!Array.isArray(context.evidence) || context.evidence.length === 0) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_EVIDENCE, {
      message: 'attachEvidence requires at least one evidence reference',
      details: { caseId: caseRecord.identity.caseId },
    });
  }
  const appended = Object.freeze(
    context.evidence.map((ref) => toEvidenceRef(ref)),
  );
  const existing = new Set(caseRecord.evidence.map((ref) => ref.digest));
  for (const ref of appended) {
    if (existing.has(ref.digest)) {
      throw new CapabilityCaseError(
        CAPABILITY_CASE_ERROR_CODES.DUPLICATE_EVIDENCE,
        {
          message: `evidence digest already attached to this case: ${ref.digest}`,
          details: { digest: ref.digest },
        },
      );
    }
    existing.add(ref.digest);
  }
  assertNoDuplicateEvidence([...caseRecord.evidence, ...appended]);
  const event = makeEvent('evidence-attached', {
    sequence: caseRecord.lifecycle.length + 1,
    occurredAt: context.at,
    actor: actorOf(context),
    fromStatus: caseRecord.status,
    toStatus: caseRecord.status,
    evidenceAppended: appended,
    ...(context.note !== undefined ? { note: context.note } : {}),
  });
  return advance(caseRecord, {
    status: caseRecord.status,
    event,
    evidence: Object.freeze([...caseRecord.evidence, ...appended]),
  });
}

/**
 * Assert that a candidate case state's evidence list and lifecycle history
 * EXTEND a previous state of the same case version (append-only discipline,
 * lock rule 6): the previous evidence list must be a strict prefix of the
 * new one, the previous history must be a prefix of the new one, and the
 * identity/version must match. Throws EVIDENCE_REMOVAL / INVALID_LIFECYCLE
 * otherwise. Used by the registry (registry.ts) and available to auditors.
 */
export function assertAppendOnly(
  previous: CapabilityCase,
  next: CapabilityCase,
): void {
  if (
    previous.identity.tenant !== next.identity.tenant ||
    previous.identity.caseId !== next.identity.caseId
  ) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_LIFECYCLE,
      {
        message: 'append-only discipline applies within one logical case',
        details: {
          previous: `${previous.identity.tenant}/${previous.identity.caseId}`,
          next: `${next.identity.tenant}/${next.identity.caseId}`,
        },
      },
    );
  }
  if (previous.version !== next.version) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_LIFECYCLE,
      {
        message: `append-only discipline applies within one case version: ${JSON.stringify(previous.version)} → ${JSON.stringify(next.version)} (use supersession for new versions)`,
        details: { previous: previous.version, next: next.version },
      },
    );
  }
  // Evidence monotonicity: the previous evidence list is a PREFIX of the next.
  if (next.evidence.length < previous.evidence.length) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.EVIDENCE_REMOVAL,
      {
        message: `evidence removal detected: evidence count shrank from ${previous.evidence.length} to ${next.evidence.length} (historical evidence is append-only — lock rule 6)`,
        details: {
          previousCount: previous.evidence.length,
          nextCount: next.evidence.length,
        },
      },
    );
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
      throw new CapabilityCaseError(
        CAPABILITY_CASE_ERROR_CODES.EVIDENCE_REMOVAL,
        {
          message: `evidence rewrite detected at position ${i}: historical evidence is append-only and never rewritten (lock rule 6)`,
          details: { position: i },
        },
      );
    }
  }
  // History monotonicity: the previous history is a PREFIX of the next.
  if (next.lifecycle.length < previous.lifecycle.length) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_LIFECYCLE,
      {
        message: `lifecycle history shrink detected: events shrank from ${previous.lifecycle.length} to ${next.lifecycle.length} (history is append-only)`,
        details: {
          previousEvents: previous.lifecycle.length,
          nextEvents: next.lifecycle.length,
        },
      },
    );
  }
  for (let i = 0; i < previous.lifecycle.length; i += 1) {
    const before = previous.lifecycle[i];
    const after = next.lifecycle[i];
    if (before !== after) {
      throw new CapabilityCaseError(
        CAPABILITY_CASE_ERROR_CODES.INVALID_LIFECYCLE,
        {
          message: `lifecycle history rewrite detected at position ${i}: history is append-only and never rewritten`,
          details: { position: i },
        },
      );
    }
  }
}
