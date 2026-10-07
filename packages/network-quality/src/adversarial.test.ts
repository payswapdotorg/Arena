/**
 * ADVERSARIAL MINIMUM battery (Work Order C020) — the five mandated
 * adversarial cases:
 *
 *   1. sybil/duplicate-account vote inflation attempt — detected;
 *   2. coordinated-brigading simulation — detected or threshold-flagged,
 *      never silently absorbed;
 *   3. a reviewer adjudicating their own dispute — COI exclusion;
 *   4. a silent score-adjustment attempt — must FAIL CLOSED;
 *   5. provenance tampering on reputation evidence — digest mismatch.
 */

import { describe, expect, it } from 'vitest';
import {
  detectDuplicateAccountSignals,
  detectCoordinatedBrigading,
  detectSelfVotingAttempts,
  openDispute,
  transitionDispute,
  createReputationRecord,
  verifyReputationRecordDigest,
  createFinding,
  silentlyAdjustReputation,
  silentlyDropEnforcementTarget,
  buildNetworkQualityScore,
  mapFindingToConductFlag,
  NETWORK_QUALITY_ERROR_CODES,
} from './index.js';

const AT = '2026-10-01T12:00:00.000Z';
const DETECTED_AT = '2026-10-05T00:00:00.000Z';
const DIGEST_A = 'a'.repeat(64);

function t(minutes: number): string {
  return new Date(Date.parse(AT) + minutes * 60 * 1000).toISOString();
}

describe('adversarial 1 — sybil / duplicate-account vote inflation attempt', () => {
  it('one human controlling four accounts cannot inflate a vote undetected', async () => {
    // four expert accounts, ONE principal cluster, all voting sub-9 up
    const participants = ['expert-a', 'expert-b', 'expert-c', 'expert-d'].map((expertRef) => ({
      expertRef,
      tenant: 'tenant-1',
      principalClusterRef: 'puppet-master',
      joinedAt: AT,
    }));
    const judgments = participants.map((participant, index) => ({
      judgmentId: `judg-p${index}`,
      competitionId: 'comp-9',
      submissionId: 'sub-9',
      expertRef: participant.expertRef,
      type: 'upvote_with_proof',
      recordedAt: t(index * 3),
    }));
    const findings = await detectDuplicateAccountSignals({
      tenant: 'tenant-1',
      participants,
      judgments,
      detectedAt: DETECTED_AT,
    });
    // the first account is the legitimate vote; the three puppets inflate
    expect(findings).toHaveLength(3);
    expect(findings.every((finding) => finding.kind === 'duplicate-account-sybil')).toBe(true);
    expect(findings.every((finding) => finding.severity === 'critical')).toBe(true);
    expect(findings.every((finding) => finding.reasons[0]?.detail.includes('puppet-master'))).toBe(
      true,
    );
    // every puppet finding proposes an INVESTIGATE enforcement action
    expect(
      findings.every(
        (finding) => finding.proposals[0]?.enforcementAction === 'INVESTIGATE',
      ),
    ).toBe(true);
    // and nothing was silently adjusted: each finding is a proposal, not a write
    expect(
      findings.every((finding) => finding.proposals.length > 0 && finding.digest.length === 64),
    ).toBe(true);
  });

  it('the sybil pattern also books dimensional conduct-flag evidence (append-only)', async () => {
    const finding = await createFinding({
      findingId: 'nq-adv-sybil',
      tenant: 'tenant-1',
      subjectParty: 'expert-b',
      kind: 'duplicate-account-sybil',
      severity: 'high',
      evidence: [{ surface: 'adversarial-evaluation', refId: 'judg-p1', refDigest: null }],
      reasons: [
        { code: 'duplicate-account-vote-inflation', detail: 'cluster puppet-master inflated sub-9' },
      ],
      observedAt: AT,
      detectedAt: DETECTED_AT,
      summary: 'sybil inflation',
    });
    const input = mapFindingToConductFlag({
      recordId: 'nq-adv-rep-1',
      recordedAt: DETECTED_AT,
      finding: {
        tenant: 'tenant-1',
        subjectParty: 'expert-b',
        digest: finding.digest,
        observedAt: AT,
        evidenceSurface: 'adversarial-evaluation',
        kind: 'duplicate-account-sybil',
        severity: 'high',
        domain: 'software',
      },
    });
    const record = await createReputationRecord(input);
    expect(record.family).toBe('conduct-flag');
    expect(record.outcome).toBe('flag-raised');
  });
});

describe('adversarial 2 — coordinated-brigading simulation (detected, never silently absorbed)', () => {
  it('a 4-cluster downvote brigade within the window is detected and evidenced', async () => {
    const participants = ['expert-1', 'expert-2', 'expert-3', 'expert-4', 'expert-5'].map(
      (expertRef, index) => ({
        expertRef,
        tenant: 'tenant-1',
        principalClusterRef: `cluster-${index}`,
        joinedAt: AT,
      }),
    );
    const judgments = participants.slice(1).map((participant, index) => ({
      judgmentId: `judg-brig${index}`,
      competitionId: 'comp-9',
      submissionId: 'sub-9',
      expertRef: participant.expertRef,
      type: 'downvote_with_proof',
      recordedAt: t(index * 7),
    }));
    const findings = await detectCoordinatedBrigading({
      tenant: 'tenant-1',
      participants,
      submissions: [
        { submissionId: 'sub-9', competitionId: 'comp-9', authorExpertRef: 'expert-1', submittedAt: AT },
      ],
      judgments,
      policy: {
        policyVersion: 1,
        brigadingClusterThreshold: 3,
        brigadingWindowMs: 60 * 60 * 1000,
        maxJudgmentsPerExpertPerWindow: 10,
        rateLimitWindowMs: 60 * 60 * 1000,
        maxConcurrentEngagements: 5,
      },
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.kind).toBe('coordinated-brigading');
    expect(finding?.evidence.length).toBeGreaterThanOrEqual(3);
    expect(finding?.reasons[0]?.detail).toContain('3 distinct principal clusters');
    // never silently absorbed: the finding carries a profile-evidence proposal
    expect(finding?.proposals[0]?.proposalKind).toBe('profile-evidence-proposal');
  });

  it('a below-threshold pattern is honestly below threshold (no fabrication)', async () => {
    const participants = ['expert-1', 'expert-2'].map((expertRef, index) => ({
      expertRef,
      tenant: 'tenant-1',
      principalClusterRef: `cluster-${index}`,
      joinedAt: AT,
    }));
    const findings = await detectCoordinatedBrigading({
      tenant: 'tenant-1',
      participants,
      submissions: [
        { submissionId: 'sub-9', competitionId: 'comp-9', authorExpertRef: 'expert-1', submittedAt: AT },
      ],
      judgments: [
        {
          judgmentId: 'judg-quiet',
          competitionId: 'comp-9',
          submissionId: 'sub-9',
          expertRef: 'expert-2',
          type: 'downvote_with_proof',
          recordedAt: AT,
        },
      ],
      policy: {
        policyVersion: 1,
        brigadingClusterThreshold: 3,
        brigadingWindowMs: 60 * 60 * 1000,
        maxJudgmentsPerExpertPerWindow: 10,
        rateLimitWindowMs: 60 * 60 * 1000,
        maxConcurrentEngagements: 5,
      },
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(0);
  });
});

describe('adversarial 3 — a reviewer adjudicating their own dispute (COI exclusion)', () => {
  it('the respondent reviewer is excluded before any review happens', async () => {
    const dispute = await openDispute({
      disputeId: 'nq-adv-dispute-1',
      tenant: 'tenant-1',
      complainantParty: 'expert-1',
      respondentParty: 'expert-2',
      subjects: [{ kind: 'validation-verdict', refId: 'av_1', refDigest: null }],
      summary: 'respondent tries to adjudicate their own dispute',
      at: AT,
    });
    // the respondent attempts to assign THEMSELVES as reviewer
    await expect(
      transitionDispute(dispute, {
        to: 'UNDER_REVIEW',
        reasons: ['reviewer-assigned'],
        reviewerParty: 'expert-2',
        at: t(60),
      }),
    ).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.REVIEWER_COI_CONFLICT,
    });
    // the dispute stays OPEN — nothing was mutated
    expect(dispute.state).toBe('OPEN');
    // and they cannot resolve it either
    await expect(
      transitionDispute(dispute, {
        to: 'UNDER_REVIEW',
        reasons: ['reviewer-assigned'],
        reviewerParty: 'expert-1',
        at: t(60),
      }),
    ).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.REVIEWER_COI_CONFLICT,
    });
  });
});

describe('adversarial 4 — a silent score-adjustment attempt (must fail closed)', () => {
  it('silentlyAdjustReputation has no code path', () => {
    expect(() => silentlyAdjustReputation()).toThrowError(
      expect.objectContaining({
        code: NETWORK_QUALITY_ERROR_CODES.SILENT_ADJUSTMENT_REJECTED,
      }),
    );
  });

  it('silentlyDropEnforcementTarget has no code path', () => {
    expect(() => silentlyDropEnforcementTarget()).toThrowError(
      expect.objectContaining({
        code: NETWORK_QUALITY_ERROR_CODES.SILENT_ADJUSTMENT_REJECTED,
      }),
    );
  });

  it('a global score cannot be constructed to launder the adjustment into', () => {
    expect(() => buildNetworkQualityScore()).toThrowError(
      expect.objectContaining({
        code: NETWORK_QUALITY_ERROR_CODES.GLOBAL_SCORE_REJECTED,
      }),
    );
  });

  it('a finding carrying an authority-shaped proposal payload key fails closed (masquerade)', async () => {
    await expect(
      createFinding({
        findingId: 'nq-adv-masquerade',
        tenant: 'tenant-1',
        subjectParty: 'expert-1',
        kind: 'capacity-gaming',
        severity: 'medium',
        evidence: [{ surface: 'expert-engagement', refId: DIGEST_A, refDigest: DIGEST_A }],
        reasons: [{ code: 'concurrency-beyond-ceiling', detail: '9 concurrent engagements' }],
        proposals: [
          {
            proposalKind: 'requalification-trigger-proposal',
            targetSurface: 'expert-calibration',
            payload: { accessGrant: 'admin' },
          },
        ],
        observedAt: AT,
        detectedAt: DETECTED_AT,
        summary: 'masquerade attempt',
      }),
    ).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.MASQUERADE_REJECTED,
    });
  });

  it('a finding with a fabricated score-adjustment proposal payload fails closed', async () => {
    await expect(
      createFinding({
        findingId: 'nq-adv-scoreadjust',
        tenant: 'tenant-1',
        subjectParty: 'expert-1',
        kind: 'rate-limit-breach',
        severity: 'medium',
        evidence: [{ surface: 'adversarial-evaluation', refId: 'judg-x', refDigest: null }],
        reasons: [{ code: 'rate-limit-breach-pattern', detail: 'burst' }],
        proposals: [
          {
            proposalKind: 'profile-evidence-proposal',
            targetSurface: 'expert-performance',
            payload: { overallScore: 0.42 },
          },
        ],
        observedAt: AT,
        detectedAt: DETECTED_AT,
        summary: 'score adjustment attempt',
      }),
    ).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.SILENT_ADJUSTMENT_REJECTED,
    });
  });
});

describe('adversarial 5 — provenance tampering on reputation evidence', () => {
  it('rewriting the outcome of a stored record breaks the digest chain', async () => {
    const record = await createReputationRecord({
      recordId: 'nq-adv-rep-tamper',
      tenant: 'tenant-1',
      expertId: 'expert-1',
      family: 'validation-outcome',
      outcome: 'rejected',
      applicability: { taskFamily: 'bug-fix-review' },
      sampleSize: 1,
      observedAt: AT,
      recordedAt: DETECTED_AT,
      source: { surface: 'escalation-validation', refDigest: DIGEST_A, locator: 'req-1' },
    });
    const tampered = { ...record, outcome: 'accepted' } as typeof record;
    await expect(verifyReputationRecordDigest(tampered)).resolves.toBe(false);
    await expect(verifyReputationRecordDigest(record)).resolves.toBe(true);
  });

  it('rewriting the provenance refDigest (evidence laundering) breaks the digest chain', async () => {
    const record = await createReputationRecord({
      recordId: 'nq-adv-rep-launder',
      tenant: 'tenant-1',
      expertId: 'expert-1',
      family: 'validation-outcome',
      outcome: 'accepted',
      applicability: { taskFamily: 'bug-fix-review' },
      sampleSize: 1,
      observedAt: AT,
      recordedAt: DETECTED_AT,
      source: { surface: 'escalation-validation', refDigest: DIGEST_A, locator: 'req-1' },
    });
    const laundered = {
      ...record,
      source: { ...record.source, refDigest: 'f'.repeat(64) },
    } as typeof record;
    await expect(verifyReputationRecordDigest(laundered)).resolves.toBe(false);
  });
});
