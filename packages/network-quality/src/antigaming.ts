/**
 * The ANTI-GAMING CONTROLS (Work Order C020; issue #126) — typed finding
 * detection over the C013 voting data and the engagement/availability
 * signals (AE1.0 guardrails enforced NETWORK-WIDE, not only at the
 * competition door).
 *
 * The C013 guardrails (packages/adversarial-evaluation/src/guardrails.ts)
 * are PRE-ADMISSION filters: a violating judgment is denied at the door.
 * The C020 anti-gaming controls are the NETWORK-QUALITY layer over the
 * same surfaces: DENIED attempts and POST-ADMISSION patterns both become
 * TYPED FINDINGS on the expert's dimensional reputation -- evidence with
 * refs and machine-readable reasons, PROPOSING actions into the owning
 * surfaces. Controls never silently adjust scores.
 *
 * Structural mirrors of the C013 public read surface (the house
 * data-in-seam convention -- the reference service pulls them from the
 * injected dep ports; the real C013 fabric implements the ports):
 *
 *   - VotingParticipant  -- the principal-cluster identity vocabulary;
 *   - VotingSubmission   -- the submission/author axis;
 *   - VotingJudgment     -- the judgment stream (votes + challenges);
 *   - DeniedJudgmentAttempt -- a guardrail-denied judgment attempt (the
 *     C013 seam surfaces denials with their violation codes).
 */

import { NETWORK_QUALITY_ERROR_CODES, NetworkQualityError } from './errors.js';
import {
  deepFreeze,
  expectNonNegativeInteger,
  expectPositiveInteger,
  toNetworkQualityParty,
  toNetworkQualityTimestamp,
} from './shared.js';
import { createFinding } from './finding.js';
import type { CreateFindingInput, FindingRecord } from './finding.js';
import { isFindingSeverity } from './vocabulary.js';
import type { FindingSeverity } from './vocabulary.js';

/** Wire version of the anti-gaming control shapes. */
export const ANTI_GAMING_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Structural mirrors of the C013 public read surface
// ---------------------------------------------------------------------------

/** The C013 CompetitionParticipant voting-legs (structural mirror). */
export interface VotingParticipant {
  readonly expertRef: string;
  readonly tenant: string;
  /** One human controlling multiple expert accounts (sybil axis). */
  readonly principalClusterRef: string;
  readonly joinedAt: string;
}

/** The C013 CompetitionSubmission voting-legs (structural mirror). */
export interface VotingSubmission {
  readonly submissionId: string;
  readonly competitionId: string;
  readonly authorExpertRef: string;
  readonly submittedAt: string;
}

/** The C013 JudgmentRecord voting-legs (structural mirror). */
export interface VotingJudgment {
  readonly judgmentId: string;
  readonly competitionId: string;
  readonly submissionId: string;
  readonly expertRef: string;
  readonly type: string;
  readonly recordedAt: string;
}

/**
 * A guardrail-DENIED judgment attempt surfaced by the C013 seam with its
 * violation codes (byte-equal to GUARDRAIL_VIOLATION_CODES).
 */
export interface DeniedJudgmentAttempt {
  readonly judgmentId: string;
  readonly competitionId: string;
  readonly submissionId: string;
  readonly expertRef: string;
  readonly type: string;
  /** The closed C013 guardrail violation codes the attempt was denied for. */
  readonly violationCodes: readonly string[];
  readonly recordedAt: string;
}

// ---------------------------------------------------------------------------
// The versioned anti-gaming policy
// ---------------------------------------------------------------------------

export interface AntiGamingPolicy {
  readonly policyVersion: 1;
  /** Distinct principal clusters voting one direction on one submission
   *  within the brigading window that constitute a brigading pattern. */
  readonly brigadingClusterThreshold: number;
  /** The brigading detection window (epoch ms). */
  readonly brigadingWindowMs: number;
  /** Max judgments per expert per rate-limit window (C013 mirror). */
  readonly maxJudgmentsPerExpertPerWindow: number;
  readonly rateLimitWindowMs: number;
  /** Max concurrent engagements before capacity gaming is flagged. */
  readonly maxConcurrentEngagements: number;
}

export const DEFAULT_ANTI_GAMING_POLICY: AntiGamingPolicy = Object.freeze({
  policyVersion: 1,
  brigadingClusterThreshold: 3,
  brigadingWindowMs: 60 * 60 * 1000,
  maxJudgmentsPerExpertPerWindow: 10,
  rateLimitWindowMs: 60 * 60 * 1000,
  maxConcurrentEngagements: 5,
});

export function validateAntiGamingPolicy(policy: AntiGamingPolicy): AntiGamingPolicy {
  expectPositiveInteger(policy.brigadingClusterThreshold, 'brigadingClusterThreshold', NETWORK_QUALITY_ERROR_CODES.INVALID_POLICY, 'anti-gaming policy');
  expectPositiveInteger(policy.maxJudgmentsPerExpertPerWindow, 'maxJudgmentsPerExpertPerWindow', NETWORK_QUALITY_ERROR_CODES.INVALID_POLICY, 'anti-gaming policy');
  expectPositiveInteger(policy.maxConcurrentEngagements, 'maxConcurrentEngagements', NETWORK_QUALITY_ERROR_CODES.INVALID_POLICY, 'anti-gaming policy');
  if (
    typeof policy.brigadingWindowMs !== 'number' ||
    !Number.isFinite(policy.brigadingWindowMs) ||
    policy.brigadingWindowMs <= 0
  ) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_POLICY, {
      message: 'anti-gaming policy: brigadingWindowMs must be a positive finite number of epoch milliseconds',
    });
  }
  if (
    typeof policy.rateLimitWindowMs !== 'number' ||
    !Number.isFinite(policy.rateLimitWindowMs) ||
    policy.rateLimitWindowMs <= 0
  ) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_POLICY, {
      message: 'anti-gaming policy: rateLimitWindowMs must be a positive finite number of epoch milliseconds',
    });
  }
  return deepFreeze({ ...policy });
}

// ---------------------------------------------------------------------------
// Control 1 -- SELF-VOTING ATTEMPTS (denied attempts + post-admission)
// ---------------------------------------------------------------------------

/**
 * Detect self-voting attempts: (a) guardrail-denied attempts carrying
 * 'self-voting-detected'; (b) post-admission votes whose caster is the
 * submission author (the pattern the admission filter should have
 * caught -- surfaced as a finding AND as a seam-bypass signal).
 */
export async function detectSelfVotingAttempts(
  input: {
    readonly tenant: string;
    readonly participants: readonly VotingParticipant[];
    readonly submissions: readonly VotingSubmission[];
    readonly judgments: readonly VotingJudgment[];
    readonly deniedAttempts: readonly DeniedJudgmentAttempt[];
    readonly detectedAt: string;
  },
): Promise<readonly FindingRecord[]> {
  const findings: FindingRecord[] = [];
  const authorOf = new Map<string, string>();
  for (const submission of input.submissions) {
    authorOf.set(submission.submissionId, submission.authorExpertRef);
  }
  const voteTypes = new Set(['upvote_with_proof', 'downvote_with_proof']);
  const tenantOf = new Map<string, string>();
  for (const participant of input.participants) {
    tenantOf.set(participant.expertRef, participant.tenant);
  }

  // (a) denied attempts
  const deniedByExpert = new Map<string, DeniedJudgmentAttempt[]>();
  for (const attempt of input.deniedAttempts) {
    if (!attempt.violationCodes.includes('self-voting-detected')) continue;
    const list = deniedByExpert.get(attempt.expertRef) ?? [];
    list.push(attempt);
    deniedByExpert.set(attempt.expertRef, list);
  }
  for (const [expertRef, attempts] of deniedByExpert) {
    const firstAttempt = attempts[0];
    if (firstAttempt === undefined) continue;
    const severity: FindingSeverity = attempts.length >= 3 ? 'high' : attempts.length === 2 ? 'medium' : 'low';
    findings.push(
      await createFinding({
        findingId: `nq-selfvote-${expertRef}-${firstAttempt.competitionId}`,
        tenant: tenantOf.get(expertRef) ?? input.tenant,
        subjectParty: toNetworkQualityParty(expertRef, 'self-voting detection'),
        kind: 'self-voting-attempt',
        severity,
        evidence: attempts.map((attempt) => ({
          surface: 'adversarial-evaluation',
          refId: attempt.judgmentId,
          refDigest: null,
        })),
        reasons: attempts.map((attempt) => ({
          code: 'self-voting-denied',
          detail: `judgment ${attempt.judgmentId} on submission ${attempt.submissionId} was denied by the C013 guardrails: ${attempt.violationCodes.join('+')}`,
        })),
        observedAt: firstAttempt.recordedAt,
        detectedAt: input.detectedAt,
        summary: `expert ${expertRef} made ${attempts.length} denied self-voting attempt(s) in competition ${firstAttempt.competitionId}`,
      }),
    );
  }

  // (b) post-admission self-votes (seam-bypass signal)
  const postByExpert = new Map<string, VotingJudgment[]>();
  for (const judgment of input.judgments) {
    if (!voteTypes.has(judgment.type)) continue;
    const author = authorOf.get(judgment.submissionId);
    if (author === undefined || author !== judgment.expertRef) continue;
    const list = postByExpert.get(judgment.expertRef) ?? [];
    list.push(judgment);
    postByExpert.set(judgment.expertRef, list);
  }
  for (const [expertRef, judgments] of postByExpert) {
    const firstJudgment = judgments[0];
    if (firstJudgment === undefined) continue;
    findings.push(
      await createFinding({
        findingId: `nq-selfvote-admitted-${expertRef}-${firstJudgment.competitionId}`,
        tenant: tenantOf.get(expertRef) ?? input.tenant,
        subjectParty: toNetworkQualityParty(expertRef, 'self-voting detection'),
        kind: 'self-voting-attempt',
        severity: 'high',
        evidence: judgments.map((judgment) => ({
          surface: 'adversarial-evaluation',
          refId: judgment.judgmentId,
          refDigest: null,
        })),
        reasons: judgments.map((judgment) => ({
          code: 'self-voting-admitted',
          detail: `judgment ${judgment.judgmentId} on submission ${judgment.submissionId} was cast by the submission author AFTER admission -- a guardrail seam bypass`,
        })),
        proposals: [
          {
            proposalKind: 'requalification-trigger-proposal',
            targetSurface: 'expert-calibration',
            payload: { expertRef, trigger: 'self-voting-seam-bypass', count: judgments.length },
          },
        ],
        observedAt: firstJudgment.recordedAt,
        detectedAt: input.detectedAt,
        summary: `expert ${expertRef} cast ${judgments.length} admitted self-vote(s) in competition ${firstJudgment.competitionId} -- admission-filter bypass`,
      }),
    );
  }
  return Object.freeze(findings);
}

// ---------------------------------------------------------------------------
// Control 2 -- DUPLICATE-ACCOUNT / SYBIL SIGNALS (vote inflation)
// ---------------------------------------------------------------------------

/**
 * Detect duplicate-account vote inflation: a second (or further) expert
 * account from a principal cluster that already voted the same
 * submission. Each additional account is one sybil finding; the cluster
 * is named in the reasons.
 */
export async function detectDuplicateAccountSignals(
  input: {
    readonly tenant: string;
    readonly participants: readonly VotingParticipant[];
    readonly judgments: readonly VotingJudgment[];
    readonly detectedAt: string;
  },
): Promise<readonly FindingRecord[]> {
  const clusterOf = new Map<string, string>();
  const tenantOf = new Map<string, string>();
  for (const participant of input.participants) {
    clusterOf.set(participant.expertRef, participant.principalClusterRef);
    tenantOf.set(participant.expertRef, participant.tenant);
  }
  const voteTypes = new Set(['upvote_with_proof', 'downvote_with_proof']);
  const seen = new Map<string, VotingJudgment[]>();
  for (const judgment of input.judgments) {
    if (!voteTypes.has(judgment.type)) continue;
    const cluster = clusterOf.get(judgment.expertRef);
    if (cluster === undefined) continue;
    const key = `${cluster}:${judgment.submissionId}`;
    const list = seen.get(key) ?? [];
    list.push(judgment);
    seen.set(key, list);
  }
  const findings: FindingRecord[] = [];
  for (const [key, judgments] of seen) {
    if (judgments.length < 2) continue;
    const [cluster, submissionId] = key.split(':');
    // The FIRST vote is the legitimate one; every later account inflates.
    const inflating = judgments.slice(1);
    for (const judgment of inflating) {
      findings.push(
        await createFinding({
          findingId: `nq-sybil-${judgment.judgmentId}`,
          tenant: tenantOf.get(judgment.expertRef) ?? input.tenant,
          subjectParty: toNetworkQualityParty(judgment.expertRef, 'sybil detection'),
          kind: 'duplicate-account-sybil',
          severity: judgments.length >= 3 ? 'critical' : 'high',
          evidence: judgments.map((entry) => ({
            surface: 'adversarial-evaluation',
            refId: entry.judgmentId,
            refDigest: null,
          })),
          reasons: [
            {
              code: 'duplicate-account-vote-inflation',
              detail: `principal cluster ${cluster} voted submission ${submissionId} via ${judgments.length} expert accounts (${judgments.map((entry) => entry.expertRef).join(', ')}) -- vote inflation`,
            },
          ],
          proposals: [
            {
              proposalKind: 'enforcement-action-proposal',
              targetSurface: 'network-quality',
              enforcementAction: 'INVESTIGATE',
              payload: { cluster, submissionId, accounts: judgments.map((entry) => entry.expertRef) },
            },
          ],
          observedAt: inflating[0]?.recordedAt ?? judgments[0]?.recordedAt ?? input.detectedAt,
          detectedAt: input.detectedAt,
          summary: `duplicate-account vote inflation by principal cluster ${cluster} on submission ${submissionId}`,
        }),
      );
    }
  }
  return Object.freeze(findings);
}

// ---------------------------------------------------------------------------
// Control 3 -- COORDINATED BRIGADING
// ---------------------------------------------------------------------------

/**
 * Detect coordinated-brigading patterns: >= brigadingClusterThreshold
 * DISTINCT principal clusters casting the SAME-DIRECTION votes on ONE
 * submission inside the brigading window. Detection is threshold-flagged
 * and evidence-carrying -- NEVER silently absorbed, and never a silent
 * adjustment of the vote aggregate.
 */
export async function detectCoordinatedBrigading(
  input: {
    readonly tenant: string;
    readonly participants: readonly VotingParticipant[];
    readonly submissions: readonly VotingSubmission[];
    readonly judgments: readonly VotingJudgment[];
    readonly policy: AntiGamingPolicy;
    readonly detectedAt: string;
  },
): Promise<readonly FindingRecord[]> {
  const policy = validateAntiGamingPolicy(input.policy);
  const clusterOf = new Map<string, string>();
  for (const participant of input.participants) {
    clusterOf.set(participant.expertRef, participant.principalClusterRef);
  }
  const submissionOf = new Map<string, VotingSubmission>();
  for (const submission of input.submissions) {
    submissionOf.set(submission.submissionId, submission);
  }
  const directionOf = (type: string): 'up' | 'down' | null =>
    type === 'upvote_with_proof' ? 'up' : type === 'downvote_with_proof' ? 'down' : null;

  // bucket: submissionId -> direction -> judgment[]
  const buckets = new Map<string, Map<string, VotingJudgment[]>>();
  for (const judgment of input.judgments) {
    const direction = directionOf(judgment.type);
    if (direction === null) continue;
    let byDirection = buckets.get(judgment.submissionId);
    if (byDirection === undefined) {
      byDirection = new Map<string, VotingJudgment[]>();
      buckets.set(judgment.submissionId, byDirection);
    }
    const list = byDirection.get(direction) ?? [];
    list.push(judgment);
    byDirection.set(direction, list);
  }

  const findings: FindingRecord[] = [];
  for (const [submissionId, byDirection] of buckets) {
    for (const [direction, judgments] of byDirection) {
      if (judgments.length < policy.brigadingClusterThreshold) continue;
      // slide a window over judgment time; find any window with >=
      // threshold DISTINCT clusters
      const sorted = [...judgments].sort(
        (left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt),
      );
      let start = 0;
      for (let end = 0; end < sorted.length; end += 1) {
        const endJudgment = sorted[end];
        if (endJudgment === undefined) continue;
        const endMs = Date.parse(endJudgment.recordedAt);
        while (start <= end && Date.parse(sorted[start]?.recordedAt ?? endJudgment.recordedAt) < endMs - policy.brigadingWindowMs) {
          start += 1;
        }
        const windowJudgments = sorted.slice(start, end + 1);
        const clusters = new Set<string>();
        for (const judgment of windowJudgments) {
          const cluster = clusterOf.get(judgment.expertRef);
          if (cluster !== undefined) clusters.add(cluster);
        }
        if (clusters.size < policy.brigadingClusterThreshold) continue;
        const submission = submissionOf.get(submissionId);
        const author = submission?.authorExpertRef ?? 'unknown';
        const firstWindowJudgment = windowJudgments[0];
        if (firstWindowJudgment === undefined) continue;
        // Brigading direction relative to the author: an upvote brigade
        // boosts the author; a downvote brigade suppresses them.
        const severity: FindingSeverity = clusters.size >= policy.brigadingClusterThreshold * 2 ? 'critical' : 'high';
        findings.push(
          await createFinding({
            findingId: `nq-brigade-${submissionId}-${direction}`,
            tenant: input.tenant,
            subjectParty: toNetworkQualityParty(author, 'brigading detection'),
            kind: 'coordinated-brigading',
            severity,
            evidence: windowJudgments.map((judgment) => ({
              surface: 'adversarial-evaluation',
              refId: judgment.judgmentId,
              refDigest: null,
            })),
            reasons: [
              {
                code: 'coordinated-brigading-pattern',
                detail: `${clusters.size} distinct principal clusters cast ${direction}-votes on submission ${submissionId} within ${policy.brigadingWindowMs}ms (${windowJudgments.map((entry) => entry.expertRef).join(', ')})`,
              },
            ],
            proposals: [
              {
                proposalKind: 'profile-evidence-proposal',
                targetSurface: 'expert-performance',
                payload: {
                  submissionId,
                  direction,
                  clusters: clusters.size,
                  windowJudgments: windowJudgments.length,
                },
              },
            ],
            observedAt: firstWindowJudgment.recordedAt,
            detectedAt: input.detectedAt,
            summary: `coordinated ${direction}-vote brigading on submission ${submissionId}: ${clusters.size} clusters inside the window`,
          }),
        );
        break; // one finding per (submission, direction)
      }
    }
  }
  return Object.freeze(findings);
}

// ---------------------------------------------------------------------------
// Control 4 -- RATE-LIMIT BREACHES
// ---------------------------------------------------------------------------

/**
 * Detect rate-limit breaches: an expert whose judgment count inside the
 * trailing window meets or exceeds the policy limit (the C013 door
 * denies the NEXT one; the network-quality finding records the PATTERN).
 */
export async function detectRateLimitBreaches(
  input: {
    readonly tenant: string;
    readonly participants: readonly VotingParticipant[];
    readonly judgments: readonly VotingJudgment[];
    readonly policy: AntiGamingPolicy;
    readonly detectedAt: string;
  },
): Promise<readonly FindingRecord[]> {
  const policy = validateAntiGamingPolicy(input.policy);
  const tenantOf = new Map<string, string>();
  for (const participant of input.participants) {
    tenantOf.set(participant.expertRef, participant.tenant);
  }
  const byExpert = new Map<string, VotingJudgment[]>();
  for (const judgment of input.judgments) {
    const list = byExpert.get(judgment.expertRef) ?? [];
    list.push(judgment);
    byExpert.set(judgment.expertRef, list);
  }
  const findings: FindingRecord[] = [];
  for (const [expertRef, judgments] of byExpert) {
    const sorted = [...judgments].sort(
      (left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt),
    );
    let worst = 0;
    let worstStart = 0;
    for (let end = 0; end < sorted.length; end += 1) {
      const endJudgment = sorted[end];
      if (endJudgment === undefined) continue;
      const endMs = Date.parse(endJudgment.recordedAt);
      let start = end;
      while (start > 0 && Date.parse(sorted[start - 1]?.recordedAt ?? endJudgment.recordedAt) > endMs - policy.rateLimitWindowMs) {
        start -= 1;
      }
      const inWindow = end - start + 1;
      if (inWindow > worst) {
        worst = inWindow;
        worstStart = start;
      }
    }
    if (worst < policy.maxJudgmentsPerExpertPerWindow) continue;
    const windowJudgments = sorted.slice(worstStart, worstStart + worst);
    const firstWindowJudgment = windowJudgments[0];
    if (firstWindowJudgment === undefined) continue;
    findings.push(
      await createFinding({
        findingId: `nq-ratelimit-${expertRef}`,
        tenant: tenantOf.get(expertRef) ?? input.tenant,
        subjectParty: toNetworkQualityParty(expertRef, 'rate-limit detection'),
        kind: 'rate-limit-breach',
        severity: worst >= policy.maxJudgmentsPerExpertPerWindow * 2 ? 'high' : 'medium',
        evidence: windowJudgments.map((judgment) => ({
          surface: 'adversarial-evaluation',
          refId: judgment.judgmentId,
          refDigest: null,
        })),
        reasons: [
          {
            code: 'rate-limit-breach-pattern',
            detail: `expert ${expertRef} cast ${worst} judgments within ${policy.rateLimitWindowMs}ms (max ${policy.maxJudgmentsPerExpertPerWindow}) -- rapid-fire pattern`,
          },
        ],
        observedAt: firstWindowJudgment.recordedAt,
        detectedAt: input.detectedAt,
        summary: `expert ${expertRef} sustained a ${worst}-judgment burst inside the rate-limit window`,
      }),
    );
  }
  return Object.freeze(findings);
}

// ---------------------------------------------------------------------------
// Control 5 -- CAPACITY GAMING (engagement/availability signals)
// ---------------------------------------------------------------------------

/** The C011 engagement-signal legs (structural mirror). */
export interface EngagementSignal {
  readonly expertRef: string;
  readonly tenant: string;
  /** The number of engagements the expert held concurrently. */
  readonly concurrentEngagements: number;
  /** Engagements accepted while over the declared availability window. */
  readonly acceptedBeyondAvailability: number;
  readonly observedAt: string;
  readonly signalDigest: string;
}

/**
 * Detect capacity gaming: an expert accepting engagements beyond declared
 * availability or holding concurrency beyond the policy ceiling -- the
 * SLA-gaming pattern (C011 availability signals, consumed).
 */
export async function detectCapacityGaming(
  input: {
    readonly signals: readonly EngagementSignal[];
    readonly policy: AntiGamingPolicy;
    readonly detectedAt: string;
  },
): Promise<readonly FindingRecord[]> {
  const policy = validateAntiGamingPolicy(input.policy);
  const findings: FindingRecord[] = [];
  for (const signal of input.signals) {
    expectNonNegativeInteger(
      signal.concurrentEngagements,
      'concurrentEngagements',
      NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
      'capacity-gaming detection',
    );
    expectNonNegativeInteger(
      signal.acceptedBeyondAvailability,
      'acceptedBeyondAvailability',
      NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
      'capacity-gaming detection',
    );
    toNetworkQualityTimestamp(signal.observedAt, 'capacity-gaming observedAt');
    const overConcurrency = signal.concurrentEngagements > policy.maxConcurrentEngagements;
    const overAvailability = signal.acceptedBeyondAvailability > 0;
    if (!overConcurrency && !overAvailability) continue;
    const severity: FindingSeverity = overConcurrency && overAvailability ? 'high' : 'medium';
    const reasons: { code: string; detail: string }[] = [];
    if (overConcurrency) {
      reasons.push({
        code: 'concurrency-beyond-ceiling',
        detail: `expert ${signal.expertRef} held ${signal.concurrentEngagements} concurrent engagements (ceiling ${policy.maxConcurrentEngagements})`,
      });
    }
    if (overAvailability) {
      reasons.push({
        code: 'accepted-beyond-availability',
        detail: `expert ${signal.expertRef} accepted ${signal.acceptedBeyondAvailability} engagements beyond their declared availability window`,
      });
    }
    findings.push(
      await createFinding({
        findingId: `nq-capacity-${signal.expertRef}-${signal.signalDigest.slice(0, 16)}`,
        tenant: signal.tenant,
        subjectParty: toNetworkQualityParty(signal.expertRef, 'capacity-gaming detection'),
        kind: 'capacity-gaming',
        severity,
        evidence: [
          {
            surface: 'expert-engagement',
            refId: signal.signalDigest,
            refDigest: signal.signalDigest,
          },
        ],
        reasons,
        observedAt: signal.observedAt,
        detectedAt: input.detectedAt,
        summary: `expert ${signal.expertRef} gamed capacity/availability signals (${reasons.map((reason) => reason.code).join('+')})`,
      }),
    );
  }
  return Object.freeze(findings);
}

/** Severity validator re-export for control callers. */
export function toFindingSeverity(value: string): FindingSeverity {
  if (!isFindingSeverity(value)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: `unknown finding severity: ${JSON.stringify(value)}`,
    });
  }
  return value;
}

export type { CreateFindingInput };
