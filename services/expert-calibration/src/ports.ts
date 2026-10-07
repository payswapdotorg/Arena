/**
 * The injected PORTS of the expert-calibration reference service (Work
 * Order C004; spec/service-boundaries.md).
 *
 * The service NEVER writes into another surface's state: every handoff
 * goes through the PUBLIC ports declared here. The ports are
 * data-in/receipt-out seams — the real C003/A007/A015/A017 fabrics
 * implement them; tests inject fakes.
 *
 *   - IntakeGapSourcePort      — the C003 seam: the typed intake gap-list
 *     the pre-training track derives from;
 *   - WorkbenchAssignmentPort  — the A017 seam: pre-training assignments
 *     are EXECUTED through the workbench surface;
 *   - ExpertQualificationPort  — the A007 seam: qualification-update and
 *     requalification PROPOSALS (never writes) + the qualification
 *     window read the requalification check and the routing read surface
 *     evaluate.
 *
 * CALIBRATION IS DATA, NEVER AN ACCESS GRANT (lock rules 9/35): there is
 * deliberately NO port method that grants, implies or records a
 * permission. A calibration output consumed as an access grant has no
 * code path here at all (and fails closed in the domain package).
 */

import type { CapabilityNodeRefView } from '@arena/expert-qualification';

// ---------------------------------------------------------------------------
// The C003 seam (intake gap source)
// ---------------------------------------------------------------------------

/** One C003 intake gap (structural mirror of @arena/expert-intake IntakeGap). */
export interface IntakeGapData {
  readonly reason: string;
  readonly itemId: string;
  readonly routingInput: string;
}

/** The C003 public port the pre-training track derives its gap-list from. */
export interface IntakeGapSourcePort {
  /** Returns the typed gap list for a SUBMITTED intake session (null when unknown). */
  getIntakeGaps(
    sessionId: string,
    tenant: string,
  ): Promise<{ readonly gaps: readonly IntakeGapData[] } | null>;
}

// ---------------------------------------------------------------------------
// The A017 seam (workbench assignment execution)
// ---------------------------------------------------------------------------

/** One pre-training assignment dispatched to the A017 workbench surface. */
export interface WorkbenchAssignmentData {
  readonly trackId: string;
  readonly assignmentId: string;
  readonly focus: string;
  readonly workbenchTask: {
    readonly taskKind: 'calibration-pre-training';
    readonly route: string;
    readonly payloadDigest: string;
  };
}

/** The A017 port's receipt (data about the dispatch outcome). */
export interface WorkbenchAssignmentReceipt {
  readonly accepted: boolean;
  /** Reference to the workbench-side task, when accepted. */
  readonly taskRef?: string;
  readonly reasons?: readonly string[];
}

/**
 * The A017 public port pre-training assignments are dispatched against.
 * Implementations own task lifecycle — an accepted assignment is work
 * QUEUED on the workbench surface, never a qualification and never an
 * access grant.
 */
export interface WorkbenchAssignmentPort {
  dispatchPreTrainingAssignment(
    assignment: WorkbenchAssignmentData,
  ): Promise<WorkbenchAssignmentReceipt>;
}

// ---------------------------------------------------------------------------
// The A007 seam (qualification proposals + window read)
// ---------------------------------------------------------------------------

// Type parity with the real A007 surface (the @arena/expert-intake-service
// convention): the capability refs handed to A007 are CapabilityNodeRefViews
// — structurally identical to the domain package's refs, so the seam stays
// data-in/receipt-out while the TYPES come from the consuming protocol.

/** The qualification-update proposal data handed to A007 (pure data). */
export interface QualificationUpdateProposalData {
  readonly tenant: string;
  readonly expertId: string;
  readonly kind: 'pre-training-completed';
  readonly trackDigest: string;
  readonly proposalDigest: string;
  readonly capability: CapabilityNodeRefView;
  readonly evidence: readonly string[];
  readonly proposedAt: string;
}

/** The requalification proposal data handed to A007 (pure data). */
export interface RequalificationProposalData {
  readonly tenant: string;
  readonly expertId: string;
  readonly proposalDigest: string;
  readonly capability: CapabilityNodeRefView;
  readonly trigger: string;
  readonly proposedStatus: string;
  readonly priorRecordDigest: string | null;
  readonly verdictDigest: string | null;
  readonly rationale: string;
  readonly proposedAt: string;
}

/** The A007 ports' receipts (data about the proposal outcomes). */
export interface QualificationProposalReceipt {
  readonly accepted: boolean;
  /** Digest/ref of the A007-side record, when accepted. */
  readonly recordRef?: string;
  readonly reasons?: readonly string[];
}

/** The A007 qualification window read (requalification + routing inputs). */
export interface QualificationWindowState {
  readonly validFrom: string;
  readonly validUntil: string;
  readonly recordDigest: string | null;
}

/**
 * The A007 public port calibration PROPOSES into. Implementations own
 * qualification records and status transitions — an accepted proposal is
 * a PROPOSAL awaiting A007 evaluation, never a qualification record this
 * service wrote, and never an access grant.
 */
export interface ExpertQualificationPort {
  submitQualificationUpdateProposal(
    proposal: QualificationUpdateProposalData,
  ): Promise<QualificationProposalReceipt>;
  submitRequalificationProposal(
    proposal: RequalificationProposalData,
  ): Promise<QualificationProposalReceipt>;
  /** The qualification window currently in force for (expert, capability) (null when none). */
  getQualificationWindow(input: {
    readonly tenant: string;
    readonly expertId: string;
    readonly capabilityId: string;
  }): Promise<QualificationWindowState | null>;
}
