/**
 * Dispute state machine tests (Work Order C020): the full lifecycle,
 * reviewer COI exclusion, illegal transitions, typed resolution outcomes
 * and audit-history retention.
 */

import { describe, expect, it } from 'vitest';
import {
  NETWORK_QUALITY_ERROR_CODES,
  openDispute,
  transitionDispute,
  verifyDisputeDigest,
  disputeIsTerminal,
  partyToDispute,
  assertReviewerNotPartyToDispute,
} from './index.js';

const AT = '2026-10-01T00:00:00.000Z';
const T1 = '2026-10-02T00:00:00.000Z';
const T2 = '2026-10-03T00:00:00.000Z';
const T3 = '2026-10-04T00:00:00.000Z';

const SUBJECTS = [
  { kind: 'validation-verdict', refId: 'av_abc123', refDigest: null },
  { kind: 'escalation-request', refId: 'req-1', refDigest: null },
];

async function opened() {
  return openDispute({
    disputeId: 'nq-dispute-001',
    tenant: 'tenant-1',
    complainantParty: 'expert-1',
    respondentParty: 'expert-2',
    subjects: SUBJECTS,
    summary: 'disputed validation verdict on request req-1',
    at: AT,
  });
}

describe('openDispute', () => {
  it('opens in OPEN with the intake audit entry', async () => {
    const dispute = await opened();
    expect(dispute.state).toBe('OPEN');
    expect(dispute.reviewerParty).toBeNull();
    expect(dispute.resolutionOutcome).toBeNull();
    expect(dispute.history).toHaveLength(1);
    expect(dispute.history[0]?.reasons).toEqual(['intake-accepted']);
    expect(dispute.subjects).toHaveLength(2);
    await expect(verifyDisputeDigest(dispute)).resolves.toBe(true);
  });

  it('rejects a self-dispute (complainant === respondent)', async () => {
    await expect(
      openDispute({
        disputeId: 'nq-dispute-002',
        tenant: 'tenant-1',
        complainantParty: 'expert-1',
        respondentParty: 'expert-1',
        subjects: SUBJECTS,
        summary: 'self dispute',
        at: AT,
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD });
  });

  it('rejects a dispute without owning-surface subject refs', async () => {
    await expect(
      openDispute({
        disputeId: 'nq-dispute-003',
        tenant: 'tenant-1',
        complainantParty: 'expert-1',
        respondentParty: 'expert-2',
        subjects: [],
        summary: 'no subjects',
        at: AT,
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD });
  });
});

describe('the dispute lifecycle', () => {
  it('OPEN -> UNDER_REVIEW -> RESOLVED with typed outcome + retained history', async () => {
    const dispute = await opened();
    const reviewed = await transitionDispute(dispute, {
      to: 'UNDER_REVIEW',
      reasons: ['reviewer-assigned'],
      reviewerParty: 'reviewer-1',
      at: T1,
    });
    expect(reviewed.state).toBe('UNDER_REVIEW');
    expect(reviewed.reviewerParty).toBe('reviewer-1');
    const resolved = await transitionDispute(reviewed, {
      to: 'RESOLVED',
      reasons: ['resolved-on-evidence'],
      reviewerParty: 'reviewer-1',
      resolutionOutcome: 'partially-upheld',
      at: T2,
    });
    expect(resolved.state).toBe('RESOLVED');
    expect(resolved.resolutionOutcome).toBe('partially-upheld');
    expect(resolved.history).toHaveLength(3);
    expect(resolved.history[0]?.to).toBe('OPEN');
    expect(resolved.history[1]?.to).toBe('UNDER_REVIEW');
    expect(resolved.history[2]?.to).toBe('RESOLVED');
    expect(disputeIsTerminal(resolved)).toBe(true);
    await expect(verifyDisputeDigest(resolved)).resolves.toBe(true);
    expect(partyToDispute('expert-1', resolved)).toBe(true);
    expect(partyToDispute('reviewer-1', resolved)).toBe(false);
  });

  it('OPEN -> ESCALATED -> UNDER_REVIEW -> RESOLVED (escalation path)', async () => {
    const dispute = await opened();
    const escalated = await transitionDispute(dispute, {
      to: 'ESCALATED',
      reasons: ['escalation-requested'],
      at: T1,
    });
    expect(escalated.state).toBe('ESCALATED');
    const reviewed = await transitionDispute(escalated, {
      to: 'UNDER_REVIEW',
      reasons: ['reviewer-assigned'],
      reviewerParty: 'reviewer-9',
      at: T2,
    });
    const resolved = await transitionDispute(reviewed, {
      to: 'RESOLVED',
      reasons: ['resolved-on-evidence'],
      reviewerParty: 'reviewer-9',
      resolutionOutcome: 'dismissed',
      at: T3,
    });
    expect(resolved.history).toHaveLength(4);
  });

  it('WITHDRAWN is terminal and reachable from OPEN', async () => {
    const dispute = await opened();
    const withdrawn = await transitionDispute(dispute, {
      to: 'WITHDRAWN',
      reasons: ['withdrawn-by-complainant'],
      at: T1,
    });
    expect(withdrawn.state).toBe('WITHDRAWN');
    expect(disputeIsTerminal(withdrawn)).toBe(true);
    await expect(
      transitionDispute(withdrawn, {
        to: 'UNDER_REVIEW',
        reasons: ['reviewer-assigned'],
        reviewerParty: 'reviewer-1',
        at: T2,
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION });
  });

  it('RESOLVED is terminal (no transition out)', async () => {
    const dispute = await opened();
    const reviewed = await transitionDispute(dispute, {
      to: 'UNDER_REVIEW',
      reasons: ['reviewer-assigned'],
      reviewerParty: 'reviewer-1',
      at: T1,
    });
    const resolved = await transitionDispute(reviewed, {
      to: 'RESOLVED',
      reasons: ['resolved-on-evidence'],
      reviewerParty: 'reviewer-1',
      resolutionOutcome: 'upheld',
      at: T2,
    });
    await expect(
      transitionDispute(resolved, {
        to: 'ESCALATED',
        reasons: ['escalation-requested'],
        at: T3,
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION });
  });

  it('RESOLVED without a typed outcome fails closed', async () => {
    const dispute = await opened();
    const reviewed = await transitionDispute(dispute, {
      to: 'UNDER_REVIEW',
      reasons: ['reviewer-assigned'],
      reviewerParty: 'reviewer-1',
      at: T1,
    });
    await expect(
      transitionDispute(reviewed, {
        to: 'RESOLVED',
        reasons: ['resolved-on-evidence'],
        reviewerParty: 'reviewer-1',
        at: T2,
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION });
  });

  it('a resolution outcome on a non-RESOLVED transition fails closed', async () => {
    const dispute = await opened();
    await expect(
      transitionDispute(dispute, {
        to: 'ESCALATED',
        reasons: ['escalation-requested'],
        resolutionOutcome: 'upheld',
        at: T1,
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION });
  });

  it('OPEN -> RESOLVED directly is illegal (review must happen first)', async () => {
    const dispute = await opened();
    await expect(
      transitionDispute(dispute, {
        to: 'RESOLVED',
        reasons: ['resolved-on-evidence'],
        reviewerParty: 'reviewer-1',
        resolutionOutcome: 'upheld',
        at: T1,
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION });
  });

  it('transitions without machine-readable reasons fail closed', async () => {
    const dispute = await opened();
    await expect(
      transitionDispute(dispute, { to: 'ESCALATED', reasons: [], at: T1 }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION });
    await expect(
      transitionDispute(dispute, {
        to: 'ESCALATED',
        reasons: ['not-a-reason' as never],
        at: T1,
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION });
  });

  it('backdated transitions fail closed', async () => {
    const dispute = await opened();
    await expect(
      transitionDispute(dispute, {
        to: 'ESCALATED',
        reasons: ['escalation-requested'],
        at: '2026-09-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.BACKDATED_RECORD });
  });
});

describe('the reviewer COI exclusion (a reviewer party to the dispute is excluded)', () => {
  it('the complainant cannot review the dispute', async () => {
    const dispute = await opened();
    await expect(
      transitionDispute(dispute, {
        to: 'UNDER_REVIEW',
        reasons: ['reviewer-assigned'],
        reviewerParty: 'expert-1',
        at: T1,
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.REVIEWER_COI_CONFLICT });
  });

  it('the respondent cannot review the dispute', async () => {
    const dispute = await opened();
    await expect(
      transitionDispute(dispute, {
        to: 'UNDER_REVIEW',
        reasons: ['reviewer-assigned'],
        reviewerParty: 'expert-2',
        at: T1,
      }),
    ).rejects.toMatchObject({ code: NETWORK_QUALITY_ERROR_CODES.REVIEWER_COI_CONFLICT });
  });

  it('a party reviewer cannot resolve either (structural guard)', async () => {
    const dispute = await opened();
    expect(() => assertReviewerNotPartyToDispute('expert-2', dispute)).toThrowError(
      expect.objectContaining({
        code: NETWORK_QUALITY_ERROR_CODES.REVIEWER_COI_CONFLICT,
      }),
    );
  });

  it('a neutral reviewer is admitted', async () => {
    const dispute = await opened();
    const reviewed = await transitionDispute(dispute, {
      to: 'UNDER_REVIEW',
      reasons: ['reviewer-assigned'],
      reviewerParty: 'reviewer-7',
      at: T1,
    });
    expect(reviewed.reviewerParty).toBe('reviewer-7');
    expect(() => assertReviewerNotPartyToDispute('reviewer-7', dispute)).not.toThrow();
  });
});

describe('audit-history tampering (append-only integrity)', () => {
  it('a truncated history fails digest verification', async () => {
    const dispute = await opened();
    const reviewed = await transitionDispute(dispute, {
      to: 'UNDER_REVIEW',
      reasons: ['reviewer-assigned'],
      reviewerParty: 'reviewer-1',
      at: T1,
    });
    const tampered = { ...reviewed, history: reviewed.history.slice(0, 1) } as typeof reviewed;
    await expect(verifyDisputeDigest(tampered)).resolves.toBe(false);
  });
});
