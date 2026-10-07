/**
 * Deterministic port FAKES for the expert-calibration reference service
 * tests (Work Order C004) — the C003 intake gap source, the A017
 * workbench assignment port and the A007 qualification proposal port.
 * Scripted, inspectable, fail-on-demand; no randomness, no clocks.
 */

import type {
  ExpertQualificationPort,
  IntakeGapSourcePort,
  QualificationProposalReceipt,
  QualificationWindowState,
  WorkbenchAssignmentPort,
  WorkbenchAssignmentReceipt,
} from './ports.js';
import type { WorkbenchAssignmentData } from './ports.js';

/** The C003 intake gap-source fake (scripted gap lists). */
export class FakeIntakeGapSource implements IntakeGapSourcePort {
  readonly sessions = new Map<string, { readonly gaps: readonly { reason: string; itemId: string; routingInput: string }[]; readonly tenant: string }>();
  /** When set, every call fails (PORT_FAILURE path). */
  failNext = false;

  seed(sessionId: string, tenant: string, gaps: readonly { reason: string; itemId: string; routingInput: string }[]): void {
    this.sessions.set(sessionId, { gaps, tenant });
  }

  async getIntakeGaps(
    sessionId: string,
    tenant: string,
  ): Promise<{ readonly gaps: readonly { reason: string; itemId: string; routingInput: string }[] } | null> {
    if (this.failNext) throw new Error('intake gap source unavailable');
    const stored = this.sessions.get(sessionId);
    if (stored === undefined || stored.tenant !== tenant) return null;
    return { gaps: stored.gaps };
  }
}

/** The A017 workbench assignment fake (records dispatches; can reject). */
export class FakeWorkbenchAssignmentPort implements WorkbenchAssignmentPort {
  readonly dispatched: WorkbenchAssignmentData[] = [];
  rejectAll = false;
  failNext = false;

  async dispatchPreTrainingAssignment(
    assignment: WorkbenchAssignmentData,
  ): Promise<WorkbenchAssignmentReceipt> {
    if (this.failNext) throw new Error('workbench unavailable');
    if (this.rejectAll) {
      return { accepted: false, reasons: ['workbench queue full'] };
    }
    this.dispatched.push(assignment);
    return { accepted: true, taskRef: `wb-task-${assignment.assignmentId}` };
  }
}

/** The A007 qualification proposal fake (records proposals; can reject). */
export class FakeExpertQualificationPort implements ExpertQualificationPort {
  readonly updateProposals: {
    readonly tenant: string;
    readonly expertId: string;
    readonly kind: string;
    readonly trackDigest: string;
    readonly proposalDigest: string;
    readonly proposedAt: string;
  }[] = [];
  readonly requalificationProposals: {
    readonly tenant: string;
    readonly expertId: string;
    readonly trigger: string;
    readonly proposedStatus: string;
    readonly proposalDigest: string;
  }[] = [];
  readonly windows = new Map<string, QualificationWindowState>();
  rejectUpdates = false;
  rejectRequalifications = false;
  failNext = false;

  seedWindow(tenant: string, expertId: string, capabilityId: string, window: QualificationWindowState): void {
    this.windows.set(`${tenant}|${expertId}|${capabilityId}`, window);
  }

  async submitQualificationUpdateProposal(proposal: {
    readonly tenant: string;
    readonly expertId: string;
    readonly kind: string;
    readonly trackDigest: string;
    readonly proposalDigest: string;
    readonly proposedAt: string;
  }): Promise<QualificationProposalReceipt> {
    if (this.failNext) throw new Error('qualification port unavailable');
    if (this.rejectUpdates) return { accepted: false, reasons: ['evidence insufficient'] };
    this.updateProposals.push(proposal);
    return { accepted: true, recordRef: `a007-claim-${proposal.proposalDigest.slice(0, 8)}` };
  }

  async submitRequalificationProposal(proposal: {
    readonly tenant: string;
    readonly expertId: string;
    readonly trigger: string;
    readonly proposedStatus: string;
    readonly proposalDigest: string;
  }): Promise<QualificationProposalReceipt> {
    if (this.failNext) throw new Error('qualification port unavailable');
    if (this.rejectRequalifications) return { accepted: false, reasons: ['no prior qualified record'] };
    this.requalificationProposals.push(proposal);
    return { accepted: true, recordRef: `a007-record-${proposal.proposalDigest.slice(0, 8)}` };
  }

  async getQualificationWindow(input: {
    readonly tenant: string;
    readonly expertId: string;
    readonly capabilityId: string;
  }): Promise<QualificationWindowState | null> {
    if (this.failNext) throw new Error('qualification port unavailable');
    return this.windows.get(`${input.tenant}|${input.expertId}|${input.capabilityId}`) ?? null;
  }
}

/** Fixed capability ref for service tests (A004 view). */
export const SERVICE_CAPABILITY = Object.freeze({
  kind: 'capability',
  id: 'tax-audit-review',
  version: '1.0.0',
  digest: 'a'.repeat(64),
});

/** Fixed ms-precision UTC timestamps. */
export const S0 = '2026-10-01T00:00:00.000Z';
export const S1 = '2026-10-02T00:00:00.000Z';
export const S2 = '2026-10-03T00:00:00.000Z';
export const S3 = '2026-10-04T00:00:00.000Z';
export const S_EXPIRED = '2027-06-01T00:00:00.000Z';

/** A valid program input for the service tests. */
export const SERVICE_PROGRAM_INPUT = {
  programId: 'calprog-tax-audit-1',
  tenant: 'tenant-a',
  capability: { ...SERVICE_CAPABILITY },
  probes: [
    {
      probeId: 'probe-prediction-1',
      capability: { ...SERVICE_CAPABILITY },
      evaluator: {
        evaluatorType: 'rubric-evaluator',
        evaluatorVersion: '1.0.0',
        criteriaDigest: 'd'.repeat(64),
      },
      verifier: {
        verifierId: 'verifier-tax-audit',
        verifierVersion: '1.0.0',
        criteriaDigest: 'e'.repeat(64),
        minimumEvidence: { evidenceKind: 'work-product-ref', minimumCount: 2 },
      },
    },
  ],
  driftPolicy: { minimumSample: 3, tolerance: 0.1, freshnessWindowDays: 90 },
  requalificationPolicy: {
    freshnessWindowDays: 90,
    validityWindowDays: 180,
    triggers: ['time-window-elapsed', 'drift-verdict', 'domain-pack-change', 'dispute-raised'],
  },
  seed: 'seed-tax-audit-1',
  createdBy: 'tl-arena',
  createdAt: S0,
} as const;
