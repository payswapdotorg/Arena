/**
 * Anti-gaming control tests (Work Order C020): self-voting attempts,
 * duplicate-account/sybil vote inflation, coordinated brigading,
 * rate-limit breaches and capacity gaming — all as TYPED findings that
 * PROPOSE, never silently adjust.
 */

import { describe, expect, it } from 'vitest';
import {
  detectSelfVotingAttempts,
  detectDuplicateAccountSignals,
  detectCoordinatedBrigading,
  detectRateLimitBreaches,
  detectCapacityGaming,
  DEFAULT_ANTI_GAMING_POLICY,
  validateAntiGamingPolicy,
  NETWORK_QUALITY_ERROR_CODES,
  verifyFindingDigest,
} from './index.js';

const DETECTED_AT = '2026-10-05T00:00:00.000Z';
const AT = '2026-10-01T12:00:00.000Z';

function t(minutes: number): string {
  return new Date(Date.parse(AT) + minutes * 60 * 1000).toISOString();
}

const PARTICIPANTS = [
  { expertRef: 'expert-1', tenant: 'tenant-1', principalClusterRef: 'cluster-a', joinedAt: AT },
  { expertRef: 'expert-2', tenant: 'tenant-1', principalClusterRef: 'cluster-b', joinedAt: AT },
  { expertRef: 'expert-3', tenant: 'tenant-1', principalClusterRef: 'cluster-c', joinedAt: AT },
  { expertRef: 'expert-4', tenant: 'tenant-1', principalClusterRef: 'cluster-d', joinedAt: AT },
];

const SUBMISSIONS = [
  {
    submissionId: 'sub-1',
    competitionId: 'comp-1',
    authorExpertRef: 'expert-1',
    submittedAt: AT,
  },
];

describe('detectSelfVotingAttempts', () => {
  it('flags guardrail-denied self-voting attempts with typed reasons', async () => {
    const findings = await detectSelfVotingAttempts({
      tenant: 'tenant-1',
      participants: PARTICIPANTS,
      submissions: SUBMISSIONS,
      judgments: [],
      deniedAttempts: [
        {
          judgmentId: 'judg-1',
          competitionId: 'comp-1',
          submissionId: 'sub-1',
          expertRef: 'expert-1',
          type: 'upvote_with_proof',
          violationCodes: ['self-voting-detected'],
          recordedAt: AT,
        },
      ],
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.kind).toBe('self-voting-attempt');
    expect(finding?.severity).toBe('low');
    expect(finding?.reasons[0]?.code).toBe('self-voting-denied');
    expect(finding?.evidence[0]?.surface).toBe('adversarial-evaluation');
    await expect(verifyFindingDigest(finding!)).resolves.toBe(true);
  });

  it('flags post-admission self-votes as a seam bypass (high severity + requalification proposal)', async () => {
    const findings = await detectSelfVotingAttempts({
      tenant: 'tenant-1',
      participants: PARTICIPANTS,
      submissions: SUBMISSIONS,
      judgments: [
        {
          judgmentId: 'judg-2',
          competitionId: 'comp-1',
          submissionId: 'sub-1',
          expertRef: 'expert-1',
          type: 'upvote_with_proof',
          recordedAt: AT,
        },
      ],
      deniedAttempts: [],
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.severity).toBe('high');
    expect(finding?.reasons[0]?.code).toBe('self-voting-admitted');
    expect(finding?.proposals[0]?.proposalKind).toBe('requalification-trigger-proposal');
    expect(finding?.proposals[0]?.targetSurface).toBe('expert-calibration');
  });

  it('emits no finding for clean voting', async () => {
    const findings = await detectSelfVotingAttempts({
      tenant: 'tenant-1',
      participants: PARTICIPANTS,
      submissions: SUBMISSIONS,
      judgments: [
        {
          judgmentId: 'judg-3',
          competitionId: 'comp-1',
          submissionId: 'sub-1',
          expertRef: 'expert-2',
          type: 'downvote_with_proof',
          recordedAt: AT,
        },
      ],
      deniedAttempts: [],
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(0);
  });
});

describe('detectDuplicateAccountSignals (sybil vote inflation)', () => {
  it('flags a second account from the same principal cluster voting the same submission', async () => {
    const participants = [
      ...PARTICIPANTS,
      { expertRef: 'expert-9', tenant: 'tenant-1', principalClusterRef: 'cluster-b', joinedAt: AT },
    ];
    const findings = await detectDuplicateAccountSignals({
      tenant: 'tenant-1',
      participants,
      judgments: [
        {
          judgmentId: 'judg-10',
          competitionId: 'comp-1',
          submissionId: 'sub-1',
          expertRef: 'expert-2',
          type: 'upvote_with_proof',
          recordedAt: AT,
        },
        {
          judgmentId: 'judg-11',
          competitionId: 'comp-1',
          submissionId: 'sub-1',
          expertRef: 'expert-9',
          type: 'upvote_with_proof',
          recordedAt: t(5),
        },
      ],
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.kind).toBe('duplicate-account-sybil');
    expect(finding?.severity).toBe('high');
    expect(finding?.reasons[0]?.code).toBe('duplicate-account-vote-inflation');
    expect(finding?.reasons[0]?.detail).toContain('cluster-b');
    expect(finding?.proposals[0]?.enforcementAction).toBe('INVESTIGATE');
  });

  it('emits no finding when clusters are distinct', async () => {
    const findings = await detectDuplicateAccountSignals({
      tenant: 'tenant-1',
      participants: PARTICIPANTS,
      judgments: [
        {
          judgmentId: 'judg-12',
          competitionId: 'comp-1',
          submissionId: 'sub-1',
          expertRef: 'expert-2',
          type: 'upvote_with_proof',
          recordedAt: AT,
        },
        {
          judgmentId: 'judg-13',
          competitionId: 'comp-1',
          submissionId: 'sub-1',
          expertRef: 'expert-3',
          type: 'upvote_with_proof',
          recordedAt: t(5),
        },
      ],
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(0);
  });
});

describe('detectCoordinatedBrigading', () => {
  it('detects a same-direction multi-cluster burst inside the window', async () => {
    const findings = await detectCoordinatedBrigading({
      tenant: 'tenant-1',
      participants: PARTICIPANTS,
      submissions: SUBMISSIONS,
      judgments: [
        {
          judgmentId: 'judg-20',
          competitionId: 'comp-1',
          submissionId: 'sub-1',
          expertRef: 'expert-2',
          type: 'downvote_with_proof',
          recordedAt: t(0),
        },
        {
          judgmentId: 'judg-21',
          competitionId: 'comp-1',
          submissionId: 'sub-1',
          expertRef: 'expert-3',
          type: 'downvote_with_proof',
          recordedAt: t(10),
        },
        {
          judgmentId: 'judg-22',
          competitionId: 'comp-1',
          submissionId: 'sub-1',
          expertRef: 'expert-4',
          type: 'downvote_with_proof',
          recordedAt: t(20),
        },
      ],
      policy: { ...DEFAULT_ANTI_GAMING_POLICY },
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.kind).toBe('coordinated-brigading');
    expect(finding?.severity).toBe('high');
    expect(finding?.reasons[0]?.code).toBe('coordinated-brigading-pattern');
    expect(finding?.reasons[0]?.detail).toContain('3 distinct principal clusters');
    expect(finding?.proposals[0]?.proposalKind).toBe('profile-evidence-proposal');
  });

  it('emits no finding below the cluster threshold (never silently absorbed, honestly below threshold)', async () => {
    const findings = await detectCoordinatedBrigading({
      tenant: 'tenant-1',
      participants: PARTICIPANTS,
      submissions: SUBMISSIONS,
      judgments: [
        {
          judgmentId: 'judg-23',
          competitionId: 'comp-1',
          submissionId: 'sub-1',
          expertRef: 'expert-2',
          type: 'downvote_with_proof',
          recordedAt: t(0),
        },
        {
          judgmentId: 'judg-24',
          competitionId: 'comp-1',
          submissionId: 'sub-1',
          expertRef: 'expert-3',
          type: 'downvote_with_proof',
          recordedAt: t(10),
        },
      ],
      policy: { ...DEFAULT_ANTI_GAMING_POLICY },
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(0);
  });
});

describe('detectRateLimitBreaches', () => {
  it('flags a burst meeting the per-expert window limit', async () => {
    const judgments = Array.from({ length: 10 }, (_, index) => ({
      judgmentId: `judg-3${index}`,
      competitionId: 'comp-1',
      submissionId: `sub-${index % 3}`,
      expertRef: 'expert-2',
      type: 'upvote_with_proof',
      recordedAt: t(index * 5),
    }));
    const findings = await detectRateLimitBreaches({
      tenant: 'tenant-1',
      participants: PARTICIPANTS,
      judgments,
      policy: { ...DEFAULT_ANTI_GAMING_POLICY },
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.kind).toBe('rate-limit-breach');
    expect(finding?.reasons[0]?.code).toBe('rate-limit-breach-pattern');
    expect(finding?.reasons[0]?.detail).toContain('10 judgments');
  });
});

describe('detectCapacityGaming', () => {
  it('flags concurrency-beyond-ceiling and beyond-availability acceptance', async () => {
    const findings = await detectCapacityGaming({
      signals: [
        {
          expertRef: 'expert-5',
          tenant: 'tenant-1',
          concurrentEngagements: 9,
          acceptedBeyondAvailability: 2,
          observedAt: AT,
          signalDigest: 'e'.repeat(64),
        },
      ],
      policy: { ...DEFAULT_ANTI_GAMING_POLICY },
      detectedAt: DETECTED_AT,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.kind).toBe('capacity-gaming');
    expect(finding?.severity).toBe('high');
    expect(finding?.evidence[0]?.surface).toBe('expert-engagement');
    expect(finding?.reasons.map((reason) => reason.code).sort()).toEqual([
      'accepted-beyond-availability',
      'concurrency-beyond-ceiling',
    ]);
  });
});

describe('validateAntiGamingPolicy', () => {
  it('rejects non-positive thresholds (fail closed)', () => {
    expect(() =>
      validateAntiGamingPolicy({
        ...DEFAULT_ANTI_GAMING_POLICY,
        brigadingClusterThreshold: 0,
      }),
    ).toThrowError(
      expect.objectContaining({ code: NETWORK_QUALITY_ERROR_CODES.INVALID_POLICY }),
    );
  });
});
