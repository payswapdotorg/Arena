/**
 * The competitions demo corpus (Work Order C013; apps/web/src/
 * competitions): ONE deterministic competition that has run the full
 * AE1.0 chain — Problem → Solutions → Challenge → Proof → Response →
 * Community signal → Adjudication → Verified result — built from the
 * REAL domain constructors (never a parallel data model). Demo state is
 * never customer state; every number is deterministic.
 */

import {
  computeCommunitySignal,
  createJudgment,
  deriveCompetitionResult,
  createCompetition,
  transitionCompetition,
  DEFAULT_GUARDRAIL_POLICY,
} from '../../../../packages/adversarial-evaluation/src/index.js';
import type {
  CompetitionRecord,
  CompetitionResult,
  CommunitySignal,
  JudgmentRecord,
} from '../../../../packages/adversarial-evaluation/src/index.js';
import type { CompetitionParticipant, CompetitionSubmission } from '../../../../packages/adversarial-evaluation/src/index.js';

export const DEMO_COMPETITION_T0 = Date.parse('2026-10-06T14:00:00.000Z');

const COMPETITION_ID = 'cmp_a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SUBMISSION_A = 'sub_a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SUBMISSION_B = 'sub_b1b2c3d4e5f60718293a4b5c6d7e8f90';
const CHALLENGE_ID = 'cha_c1b2c3d4e5f60718293a4b5c6d7e8f90';

const DEMO_PARTICIPANTS: readonly CompetitionParticipant[] = [
  { expertRef: 'expert-alpha', tenant: 'arena-demo', principalClusterRef: 'cluster-alpha', qualified: true, declaredConflicts: [], joinedAt: '2026-10-06T14:00:00.000Z' },
  { expertRef: 'expert-beta', tenant: 'arena-demo', principalClusterRef: 'cluster-beta', qualified: true, declaredConflicts: [], joinedAt: '2026-10-06T14:00:00.000Z' },
  { expertRef: 'expert-gamma', tenant: 'arena-demo', principalClusterRef: 'cluster-gamma', qualified: true, declaredConflicts: [], joinedAt: '2026-10-06T14:00:00.000Z' },
  { expertRef: 'expert-delta', tenant: 'arena-demo', principalClusterRef: 'cluster-delta', qualified: true, declaredConflicts: [], joinedAt: '2026-10-06T14:00:00.000Z' },
];

const SUBMISSIONS: readonly CompetitionSubmission[] = [
  { submissionId: SUBMISSION_A, competitionId: COMPETITION_ID, authorExpertRef: 'expert-alpha', submittedAt: '2026-10-06T15:00:00.000Z' },
  { submissionId: SUBMISSION_B, competitionId: COMPETITION_ID, authorExpertRef: 'expert-beta', submittedAt: '2026-10-06T15:05:00.000Z' },
];

function judgment(
  judgmentId: string,
  expertRef: string,
  submissionId: string,
  type: JudgmentRecord['type'],
  claim: string,
  evidenceRef: string,
  supportsClaim: string,
  challengeId: string | null = null,
  recordedAt: string,
): JudgmentRecord {
  return createJudgment({
    judgmentId,
    competitionId: COMPETITION_ID,
    submissionId,
    challengeId,
    expertRef,
    type,
    claim,
    evidence: [{ kind: 'citation', evidenceRef, supportsClaim, note: null }],
    note: null,
    recordedAt: Date.parse(recordedAt),
    provenance: 'apps/web demo corpus',
  });
}

const DEMO_JUDGMENTS: readonly JudgmentRecord[] = [
  // The CHALLENGE (concrete claim + evidence) against submission B.
  judgment(
    'jdg_1a1b1c1d1e1f10111213141516171819',
    'expert-gamma',
    SUBMISSION_B,
    'challenge',
    'the moment-splice connection count omits 6 bays on drawing S-304',
    'drawings/S-304-revision-B',
    'revision B schedules 94 connections; the takeoff lists 88',
    CHALLENGE_ID,
    '2026-10-06T16:00:00.000Z',
  ),
  // The author's RESPONSE (proof) + the challenge verdicts.
  judgment(
    'jdg_2a1b1c1d1e1f10111213141516171819',
    'expert-beta',
    SUBMISSION_B,
    'needs_more_evidence',
    'the addendum S-304-A addresses the 6 bays; requesting its verification',
    'drawings/S-304-addendum-A',
    'addendum A adds the 6 splice connections',
    null,
    '2026-10-06T16:30:00.000Z',
  ),
  judgment(
    'jdg_3a1b1c1d1e1f10111213141516171819',
    'expert-delta',
    SUBMISSION_B,
    'reject_challenge',
    'the challenge is superseded by addendum A',
    'drawings/S-304-addendum-A',
    'addendum A confirms 94 connections',
    CHALLENGE_ID,
    '2026-10-06T17:00:00.000Z',
  ),
  // The qualified solution votes (shared voters induce the contests).
  judgment(
    'jdg_4a1b1c1d1e1f10111213141516171819',
    'expert-gamma',
    SUBMISSION_A,
    'upvote_with_proof',
    'the takeoff method is reproducible within 2%',
    'runs/reproduce-gamma',
    'independent reproduction within tolerance',
    null,
    '2026-10-06T18:00:00.000Z',
  ),
  judgment(
    'jdg_5a1b1c1d1e1f10111213141516171819',
    'expert-gamma',
    SUBMISSION_B,
    'downvote_with_proof',
    'the connection count did not reproduce without the addendum',
    'runs/reproduce-gamma-b',
    'reproduction failed on revision B alone',
    null,
    '2026-10-06T18:01:00.000Z',
  ),
  judgment(
    'jdg_6a1b1c1d1e1f10111213141516171819',
    'expert-delta',
    SUBMISSION_A,
    'upvote_with_proof',
    'the quantity basis reconciles with the draw schedule',
    'runs/reconcile-delta',
    'reconciliation within 1.5%',
    null,
    '2026-10-06T18:02:00.000Z',
  ),
  judgment(
    'jdg_7a1b1c1d1e1f10111213141516171819',
    'expert-delta',
    SUBMISSION_B,
    'downvote_with_proof',
    'the quantity basis did not reconcile on revision B',
    'runs/reconcile-delta-b',
    '6 bays unreconciled pre-addendum',
    null,
    '2026-10-06T18:03:00.000Z',
  ),
  judgment(
    'jdg_8a1b1c1d1e1f10111213141516171819',
    'expert-beta',
    SUBMISSION_A,
    'downvote_with_proof',
    'the waste factor is asserted without provenance',
    'runs/waste-factor-review',
    'the 3% waste factor cites no regional basis',
    null,
    '2026-10-06T18:04:00.000Z',
  ),
];

function buildDemoCompetition(): CompetitionRecord {
  let record = createCompetition({
    competitionId: COMPETITION_ID,
    tenantId: 'arena-demo',
    task: {
      taskId: 'task-boq-takeoff',
      title: 'Quantity takeoff — structural steel package (warehouse W-12)',
      statement:
        'Produce a reproducible quantity takeoff for the structural steel package of warehouse W-12, citing drawings, method and waste factors. Qualified experts compete: independent solutions, evidence-carrying challenges, qualification-aware voting, evidence-weighted adjudication.',
      requiredSkills: ['structural-steel-takeoff', 'cost-estimation'],
    },
    now: DEMO_COMPETITION_T0,
  });
  const steps: readonly {
    readonly target: Parameters<typeof transitionCompetition>[1]['target'];
    readonly reason: string | null;
    readonly at: number;
  }[] = [
    { target: 'soliciting', reason: 'solicitation opened to the qualified pool', at: DEMO_COMPETITION_T0 + 60_000 },
    { target: 'submitted', reason: 'first independent solution recorded', at: DEMO_COMPETITION_T0 + 3_600_000 },
    { target: 'challenge', reason: 'first evidence-carrying challenge issued', at: DEMO_COMPETITION_T0 + 7_200_000 },
    { target: 'response', reason: 'challenge verdict judgments recorded', at: DEMO_COMPETITION_T0 + 10_800_000 },
    { target: 'voting', reason: 'solution vote judgments recorded', at: DEMO_COMPETITION_T0 + 14_400_000 },
    { target: 'adjudication', reason: 'adjudication started', at: DEMO_COMPETITION_T0 + 18_000_000 },
    { target: 'verified_result', reason: 'adjudication derived verified_result', at: DEMO_COMPETITION_T0 + 18_060_000 },
  ];
  for (const step of steps) {
    record = transitionCompetition(record, { target: step.target, reason: step.reason, now: step.at });
  }
  return record;
}

const DEMO_RESULT: CompetitionResult = deriveCompetitionResult({
  competitionId: COMPETITION_ID,
  tenantId: 'arena-demo',
  solutions: [
    {
      submissionId: SUBMISSION_A,
      authorExpertRef: 'expert-alpha',
      votes: [
        { expertRef: 'expert-gamma', direction: 'up', evidenceQuality: 0.9, calibrationWeight: 0.8 },
        { expertRef: 'expert-delta', direction: 'up', evidenceQuality: 0.9, calibrationWeight: 0.8 },
        { expertRef: 'expert-beta', direction: 'down', evidenceQuality: 0.6, calibrationWeight: 0.7 },
      ],
      challenges: [],
      verifierOutcome: { outcome: 'pass', recordDigest: 'a013-demo-digest-a' },
      evaluatorOutcome: { outcome: 'meets-criteria', recordDigest: 'a012-demo-digest-a' },
    },
    {
      submissionId: SUBMISSION_B,
      authorExpertRef: 'expert-beta',
      votes: [
        { expertRef: 'expert-gamma', direction: 'down', evidenceQuality: 0.8, calibrationWeight: 0.8 },
        { expertRef: 'expert-delta', direction: 'down', evidenceQuality: 0.8, calibrationWeight: 0.8 },
      ],
      challenges: [
        { challengeId: CHALLENGE_ID, validity: 'rejected', evidenceQuality: 0.7 },
      ],
      verifierOutcome: { outcome: 'pass', recordDigest: 'a013-demo-digest-b' },
      evaluatorOutcome: { outcome: 'meets-criteria', recordDigest: 'a012-demo-digest-b' },
    },
  ],
  agreementPatterns: [
    { expertRef: 'expert-gamma', agreements: 11, disagreements: 3 },
    { expertRef: 'expert-delta', agreements: 9, disagreements: 2 },
    { expertRef: 'expert-beta', agreements: 7, disagreements: 4 },
  ],
  policy: DEFAULT_GUARDRAIL_POLICY,
  now: DEMO_COMPETITION_T0 + 18_060_000,
  resultId: 'crs_d1b2c3d4e5f60718293a4b5c6d7e8f90',
});

function signalOf(submissionId: string): CommunitySignal {
  return computeCommunitySignal({
    competitionId: COMPETITION_ID,
    submissionId,
    judgments: DEMO_JUDGMENTS,
    participants: DEMO_PARTICIPANTS,
    submissions: SUBMISSIONS,
    policy: DEFAULT_GUARDRAIL_POLICY,
    now: DEMO_COMPETITION_T0 + 18_060_000,
  });
}

/** The deterministic demo competition aggregate (frozen; never customer state). */
export interface DemoCompetitionCorpus {
  readonly competition: CompetitionRecord;
  readonly submissions: readonly CompetitionSubmission[];
  readonly judgments: readonly JudgmentRecord[];
  readonly participants: readonly CompetitionParticipant[];
  readonly signals: readonly CommunitySignal[];
  readonly result: CompetitionResult;
}

export function buildDemoCompetitionsCorpus(): DemoCompetitionCorpus {
  return Object.freeze({
    competition: buildDemoCompetition(),
    submissions: Object.freeze(SUBMISSIONS),
    judgments: Object.freeze(DEMO_JUDGMENTS),
    participants: Object.freeze(DEMO_PARTICIPANTS),
    signals: Object.freeze([signalOf(SUBMISSION_A), signalOf(SUBMISSION_B)]),
    result: DEMO_RESULT,
  });
}

export const DEMO_COMPETITION_IDS = Object.freeze([COMPETITION_ID] as const);
