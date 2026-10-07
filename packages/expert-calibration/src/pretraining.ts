/**
 * The pre-training track (Work Order C004) — gap-filling assignments
 * derived from the C003 intake gap-list, executed through the A017
 * workbench surface.
 *
 * C003's typed gap-list (IntakeGap: closed reason + item id + starved
 * routing input) drives pre-training: the CAPABILITY-shaped gaps an
 * expert can TRAIN on (capability-unanswered, experience-unanswered,
 * evidence-missing, scenario-unanswered) become assignments; the
 * declaration-shaped gaps (privacy-consent, locale, jurisdiction,
 * availability) are NOT training work — they are repairable only by
 * resuming the interview, and deriving a track from them fails closed
 * with a typed error.
 *
 * State is EXPLICIT: an assignment is `not-yet` or `pre-trained`; the
 * track is `not-yet-started`, `in-progress` or `pre-trained`. Completing
 * pre-training PROPOSES a qualification update to A007 — a pure data
 * proposal in exactly the C003 claim-candidate input shape (expertId,
 * tenant, capability, proficiency, evidence digests, declaredAt). It
 * NEVER writes A007 records directly: the proposal is handed to the
 * injected A007 port by the reference service (spec/service-boundaries.md
 * — submissions go to the public ports).
 *
 * The workbench execution surface is modeled as DATA (the workbench task
 * descriptor each assignment carries); @arena/workbench renders tasks,
 * it never mutates domain state — this package never imports it.
 */

import { digestCanonical } from '@arena/protocol-core';
import { capabilityNodeRefViewKey } from '@arena/expert-qualification';
import { EXPERT_CALIBRATION_ERROR_CODES, ExpertCalibrationError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectNonEmptyString,
  screenFieldNames,
  toCalibrationContentDigest,
  toCalibrationNeutralText,
  toCalibrationTimestamp,
  toPreTrainingTrackId,
} from './shared.js';
import type { CalibrationTimestamp } from './shared.js';

// ---------------------------------------------------------------------------
// Closed vocabularies (derived from the C003 IntakeGapReason vocabulary)
// ---------------------------------------------------------------------------

/**
 * The C003 intake gap reasons pre-training can CLOSE by training — the
 * capability-shaped subset of INTAKE_GAP_REASONS.
 */
export const PRE_TRAINABLE_GAP_REASONS = Object.freeze([
  'capability-unanswered',
  'experience-unanswered',
  'evidence-missing',
  'scenario-unanswered',
] as const);

export type PreTrainableGapReason = (typeof PRE_TRAINABLE_GAP_REASONS)[number];

/** The closed assignment focus vocabulary (one per pre-trainable gap reason). */
export const PRE_TRAINING_FOCUS_KINDS = Object.freeze([
  'capability',
  'experience',
  'evidence',
  'scenario',
] as const);

export type PreTrainingFocusKind = (typeof PRE_TRAINING_FOCUS_KINDS)[number];

export function isPreTrainingFocusKind(value: unknown): value is PreTrainingFocusKind {
  return (
    typeof value === 'string' &&
    (PRE_TRAINING_FOCUS_KINDS as readonly string[]).includes(value)
  );
}

/** The closed pre-training track states (EXPLICIT pre-trained / not-yet). */
export const PRE_TRAINING_TRACK_STATES = Object.freeze([
  'not-yet-started',
  'in-progress',
  'pre-trained',
] as const);

export type PreTrainingTrackState = (typeof PRE_TRAINING_TRACK_STATES)[number];

export function isPreTrainingTrackState(value: unknown): value is PreTrainingTrackState {
  return (
    typeof value === 'string' &&
    (PRE_TRAINING_TRACK_STATES as readonly string[]).includes(value)
  );
}

/** The closed assignment states. */
export const PRE_TRAINING_ASSIGNMENT_STATES = Object.freeze([
  'not-yet',
  'pre-trained',
] as const);

export type PreTrainingAssignmentState = (typeof PRE_TRAINING_ASSIGNMENT_STATES)[number];

/** Map a pre-trainable C003 gap reason to its assignment focus kind. */
const GAP_REASON_TO_FOCUS: Readonly<Record<PreTrainableGapReason, PreTrainingFocusKind>> =
  Object.freeze({
    'capability-unanswered': 'capability',
    'experience-unanswered': 'experience',
    'evidence-missing': 'evidence',
    'scenario-unanswered': 'scenario',
  });

// ---------------------------------------------------------------------------
// The assignment
// ---------------------------------------------------------------------------

/**
 * The A017 workbench task descriptor — pure DATA the workbench surface
 * renders/executes; carried per assignment (the execution surface is a
 * projection, never a mutation path into this domain).
 */
export interface WorkbenchTaskDescriptor {
  /** The closed workbench task kind (pre-training work). */
  readonly taskKind: 'calibration-pre-training';
  /** The workbench route the assignment surfaces at. */
  readonly route: string;
  /** Digest of the gap-derived task payload the route renders. */
  readonly payloadDigest: string;
}

export interface PreTrainingAssignment {
  readonly assignmentId: string;
  readonly focus: PreTrainingFocusKind;
  /** The C003 gap this assignment closes (reason + item + starved routing input). */
  readonly sourceGap: {
    readonly reason: PreTrainableGapReason;
    readonly itemId: string;
    readonly routingInput: string;
  };
  readonly workbenchTask: WorkbenchTaskDescriptor;
  readonly state: PreTrainingAssignmentState;
  readonly completedAt: CalibrationTimestamp | null;
}

// ---------------------------------------------------------------------------
// The track
// ---------------------------------------------------------------------------

/** Wire version of the pre-training-track shape. */
export const PRE_TRAINING_TRACK_VERSION = 1 as const;

export interface PreTrainingTrackView {
  readonly trackVersion: typeof PRE_TRAINING_TRACK_VERSION;
  readonly trackId: string;
  readonly tenant: string;
  readonly expertId: string;
  /** The C003 intake session the gap-list was derived from. */
  readonly intakeSessionId: string;
  /** The ordered assignments (deterministic — sorted by focus, then item id). */
  readonly assignments: readonly PreTrainingAssignment[];
  readonly state: PreTrainingTrackState;
  /** Digests of the source gaps, deterministically sorted (the derivation input). */
  readonly derivedFromGapDigests: readonly string[];
  readonly derivedAt: CalibrationTimestamp;
}

/** A frozen, content-addressed pre-training track: view + digest. */
export interface PreTrainingTrack extends PreTrainingTrackView {
  readonly digest: string;
}

/** The C003 gap shape consumed here (structural mirror of IntakeGap). */
export interface IntakeGapInput {
  readonly reason: string;
  readonly itemId: string;
  readonly routingInput: string;
}

async function gapDigest(gap: IntakeGapInput): Promise<string> {
  return digestCanonical({
    reason: gap.reason,
    itemId: gap.itemId,
    routingInput: gap.routingInput,
  });
}

/**
 * Derive the pre-training track from the C003 intake gap-list. PURE and
 * deterministic: assignments are sorted by (focus, itemId) regardless of
 * input order; each assignment carries a workbench task descriptor.
 *
 * Fails closed when a gap reason is NOT pre-trainable (declaration-shaped
 * gaps — privacy/consent, locale, jurisdiction, availability — are
 * repairable only by resuming the interview, not by training).
 */
export async function derivePreTrainingTrack(
  input: IntakeGapInput[] | readonly IntakeGapInput[],
  options: {
    readonly trackId: string;
    readonly tenant: string;
    readonly expertId: string;
    readonly intakeSessionId: string;
    readonly derivedAt: string;
  },
): Promise<PreTrainingTrack> {
  const record = expectFields(
    options,
    ['trackId', 'tenant', 'expertId', 'intakeSessionId', 'derivedAt'],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_TRACK,
    'pre-training track',
  );
  if (!Array.isArray(input)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_TRACK, {
      message: 'pre-training track derivation requires an intake gap list (array)',
    });
  }
  if (input.length === 0) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_TRACK, {
      message: 'pre-training track derivation requires a non-empty gap list (a gap-free intake needs no pre-training)',
    });
  }

  const assignments: PreTrainingAssignment[] = [];
  const gapDigests: string[] = [];
  for (const gap of input) {
    const reason = gap.reason;
    if (
      typeof reason !== 'string' ||
      !(PRE_TRAINABLE_GAP_REASONS as readonly string[]).includes(reason)
    ) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_TRACK, {
        message: `pre-training track: intake gap reason ${JSON.stringify(reason)} is not pre-trainable (declaration-shaped gaps are repairable only by resuming the interview; pre-trainable: ${PRE_TRAINABLE_GAP_REASONS.join(', ')})`,
        details: { itemId: gap.itemId, known: [...PRE_TRAINABLE_GAP_REASONS] },
      });
    }
    if (typeof gap.itemId !== 'string' || gap.itemId.length === 0) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_TRACK, {
        message: 'pre-training track: intake gap requires an itemId',
      });
    }
    if (typeof gap.routingInput !== 'string' || gap.routingInput.length === 0) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_TRACK, {
        message: 'pre-training track: intake gap requires a routingInput',
      });
    }
    const focus = GAP_REASON_TO_FOCUS[reason as PreTrainableGapReason];
    const payloadDigest = await digestCanonical({
      focus,
      reason,
      itemId: gap.itemId,
      routingInput: gap.routingInput,
    });
    assignments.push(
      deepFreeze({
        assignmentId: `assign-${focus}-${gap.itemId}`,
        focus,
        sourceGap: deepFreeze({
          reason: reason as PreTrainableGapReason,
          itemId: gap.itemId,
          routingInput: gap.routingInput,
        }),
        workbenchTask: deepFreeze({
          taskKind: 'calibration-pre-training',
          route: `/workbench/pre-training/${encodeURIComponent(gap.itemId)}`,
          payloadDigest,
        }),
        state: 'not-yet',
        completedAt: null,
      }),
    );
    gapDigests.push(await gapDigest(gap));
  }
  // SEEDED ORDERING — deterministic regardless of input order.
  assignments.sort((a, b) =>
    a.focus === b.focus
      ? a.sourceGap.itemId < b.sourceGap.itemId
        ? -1
        : 1
      : a.focus < b.focus
        ? -1
        : 1,
  );
  gapDigests.sort((a, b) => (a < b ? -1 : 1));

  const view: PreTrainingTrackView = {
    trackVersion: PRE_TRAINING_TRACK_VERSION,
    trackId: toPreTrainingTrackId(
      typeof record['trackId'] === 'string' ? record['trackId'] : '',
      'pre-training track trackId',
    ),
    tenant: expectNonEmptyString(record['tenant'], 'tenant', EXPERT_CALIBRATION_ERROR_CODES.INVALID_TRACK, 'pre-training track'),
    expertId: expectNonEmptyString(record['expertId'], 'expertId', EXPERT_CALIBRATION_ERROR_CODES.INVALID_TRACK, 'pre-training track'),
    intakeSessionId: expectNonEmptyString(record['intakeSessionId'], 'intakeSessionId', EXPERT_CALIBRATION_ERROR_CODES.INVALID_TRACK, 'pre-training track'),
    assignments: Object.freeze([...assignments]),
    state: 'not-yet-started',
    derivedFromGapDigests: Object.freeze(
      gapDigests.map((entry) => toCalibrationContentDigest(entry, 'pre-training gap digest')),
    ),
    derivedAt: toCalibrationTimestamp(
      typeof record['derivedAt'] === 'string' ? record['derivedAt'] : '',
      'pre-training track derivedAt',
    ),
  };
  screenFieldNames(view, 'preTrainingTrack');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as PreTrainingTrack;
}

/**
 * Mark one assignment PRE-TRAINED (the workbench completion callback).
 * Returns a NEW frozen track — the input track is never mutated
 * (append-only discipline). Fails closed on unknown assignment, double
 * completion and cross-tenant/expert mismatch.
 */
export function completePreTrainingAssignment(
  track: PreTrainingTrack,
  assignmentId: string,
  options: { readonly tenant: string; readonly expertId: string; readonly completedAt: string },
): PreTrainingTrack {
  if (track.tenant !== options.tenant) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.TENANT_MISMATCH, {
      message: `pre-training track ${track.trackId} belongs to tenant ${track.tenant}, not ${options.tenant} (cross-tenant completion fails closed — lock rule 11)`,
      details: { trackId: track.trackId, ownerTenant: track.tenant, readerTenant: options.tenant },
    });
  }
  if (track.expertId !== options.expertId) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.LIFECYCLE_CONFLICT, {
      message: `pre-training track ${track.trackId} belongs to expert ${track.expertId}, not ${options.expertId}`,
      details: { trackId: track.trackId },
    });
  }
  const completedAt = toCalibrationTimestamp(options.completedAt, 'pre-training completion completedAt');
  const assignment = track.assignments.find((entry) => entry.assignmentId === assignmentId);
  if (assignment === undefined) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.NOT_FOUND, {
      message: `no pre-training assignment ${JSON.stringify(assignmentId)} on track ${track.trackId}`,
      details: { trackId: track.trackId, assignmentId },
    });
  }
  if (assignment.state === 'pre-trained') {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.LIFECYCLE_CONFLICT, {
      message: `pre-training assignment ${JSON.stringify(assignmentId)} is already pre-trained (append-only: completions are recorded once)`,
      details: { trackId: track.trackId, assignmentId },
    });
  }
  const assignments = track.assignments.map((entry) =>
    entry.assignmentId === assignmentId
      ? deepFreeze({ ...entry, state: 'pre-trained', completedAt })
      : entry,
  );
  const state: PreTrainingTrackState = assignments.every((entry) => entry.state === 'pre-trained')
    ? 'pre-trained'
    : 'in-progress';
  return deepFreeze({
    ...track,
    assignments: Object.freeze([...assignments]),
    state,
  }) as PreTrainingTrack;
}

// ---------------------------------------------------------------------------
// The A007 qualification-update proposal (proposal, NEVER a write)
// ---------------------------------------------------------------------------

/** Wire version of the qualification-update-proposal shape. */
export const QUALIFICATION_UPDATE_PROPOSAL_VERSION = 1 as const;

export interface QualificationUpdateProposalView {
  readonly proposalVersion: typeof QUALIFICATION_UPDATE_PROPOSAL_VERSION;
  readonly tenant: string;
  readonly expertId: string;
  /** What completed: 'pre-training-completed'. */
  readonly kind: 'pre-training-completed';
  /** The content-addressed pre-training track that completed. */
  readonly trackDigest: string;
  /** The capability the completed training closes gaps FOR. */
  readonly capability: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  /** The proficiency evidence of completion points at (evidence digests, sorted). */
  readonly evidence: readonly string[];
  readonly rationale: string;
  readonly proposedAt: CalibrationTimestamp;
}

/** A frozen, content-addressed qualification-update proposal: view + digest. */
export interface QualificationUpdateProposal extends QualificationUpdateProposalView {
  readonly digest: string;
}

/**
 * Build the A007 qualification-update PROPOSAL for a completed
 * pre-training track — pure DATA in exactly the C003 claim-candidate
 * input shape (the A007 port consumes expertId, tenant, capability,
 * proficiency, evidence, declaredAt). NEVER writes A007 records: the
 * reference service hands this proposal to the injected A007 port.
 *
 * Fails closed when the track is not fully pre-trained (an incomplete
 * track proposes nothing).
 */
export async function buildQualificationUpdateProposal(
  track: PreTrainingTrack,
  options: {
    readonly capability: { readonly kind: string; readonly id: string; readonly version: string; readonly digest: string };
    readonly evidence: readonly string[];
    readonly proposedAt: string;
    readonly rationale?: string;
  },
): Promise<QualificationUpdateProposal> {
  if (track.state !== 'pre-trained') {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.LIFECYCLE_CONFLICT, {
      message: `pre-training track ${track.trackId} is ${track.state}, not pre-trained — completing pre-training is the ONLY trigger for a qualification-update proposal (proposal-not-write boundary)`,
      details: { trackId: track.trackId, state: track.state },
    });
  }
  const record = expectFields(
    options,
    ['capability', 'evidence', 'proposedAt'],
    ['rationale'],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROPOSAL,
    'qualification update proposal',
  );
  const rawEvidence = record['evidence'];
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROPOSAL, {
      message: 'qualification update proposal requires at least one evidence digest (an evidence-free proposal is not a proposal — A007 discipline)',
    });
  }
  const evidence = [...rawEvidence]
    .sort((a, b) => (a < b ? -1 : 1))
    .map((entry) => toCalibrationContentDigest(entry, 'qualification update proposal evidence'));
  const rationaleRaw = record['rationale'];
  const rationale =
    rationaleRaw === undefined
      ? `pre-training completed: all ${track.assignments.length} gap-filling assignments pre-trained on track ${track.trackId}`
      : toCalibrationNeutralText(rationaleRaw as string, 'qualification update proposal rationale');

  const view: QualificationUpdateProposalView = {
    proposalVersion: QUALIFICATION_UPDATE_PROPOSAL_VERSION,
    tenant: track.tenant,
    expertId: track.expertId,
    kind: 'pre-training-completed',
    trackDigest: track.digest,
    capability: deepFreeze({ ...(record['capability'] as Record<string, unknown>) }) as QualificationUpdateProposalView['capability'],
    evidence: Object.freeze([...evidence]),
    rationale,
    proposedAt: toCalibrationTimestamp(
      typeof record['proposedAt'] === 'string' ? record['proposedAt'] : '',
      'qualification update proposal proposedAt',
    ),
  };
  screenFieldNames(view, 'qualificationUpdateProposal');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as QualificationUpdateProposal;
}

/** The digest-free view of a proposal (what the digest commits to). */
export function qualificationUpdateProposalView(
  proposal: QualificationUpdateProposal,
): QualificationUpdateProposalView {
  const { digest: _digest, ...view } = proposal;
  return deepFreeze({ ...view }) as QualificationUpdateProposalView;
}

/** The A007 claim-candidate tuple shape the proposal feeds (C003 parity). */
export function toQualificationClaimCandidate(
  proposal: QualificationUpdateProposalView,
  proficiency: string,
): {
  readonly expertId: string;
  readonly tenant: string;
  readonly capability: { readonly kind: string; readonly id: string; readonly version: string; readonly digest: string };
  readonly proficiency: string;
  readonly evidence: readonly string[];
  readonly declaredAt: string;
} {
  return Object.freeze({
    expertId: proposal.expertId,
    tenant: proposal.tenant,
    capability: { ...proposal.capability },
    proficiency,
    evidence: Object.freeze([...proposal.evidence]),
    declaredAt: proposal.proposedAt,
  });
}

/** Stable key for a capability ref (re-export convenience for consumers). */
export { capabilityNodeRefViewKey };
