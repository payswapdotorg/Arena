/**
 * The competitions view models (Work Order C013; apps/web/src/
 * competitions): pure projections of the domain records into render
 * shapes. EVERY claim links its supporting evidence; the community
 * signal is projected with the DISCOVERY label (the shared state
 * vocabulary: a discovery signal is NOT a verified badge and the two
 * are never represented as equivalent).
 */

import type {
  CompetitionResult,
  CommunitySignal,
  CompetitionRecord,
  JudgmentRecord,
} from '../../../../packages/adversarial-evaluation/src/index.js';
import type { CompetitionSubmission } from '../../../../packages/adversarial-evaluation/src/index.js';
import type { DemoCompetitionCorpus } from './fixtures.js';

export interface CompetitionSummaryViewModel {
  readonly competitionId: string;
  readonly title: string;
  readonly state: string;
  readonly stateLabel: string;
  readonly solutionCount: number;
  readonly judgmentCount: number;
  readonly outcome: string | null;
  readonly winnerSubmissionId: string | null;
}

export interface EvidenceLinkViewModel {
  readonly evidenceRef: string;
  readonly supportsClaim: string;
  readonly kind: string;
}

export interface JudgmentViewModel {
  readonly judgmentId: string;
  readonly expertRef: string;
  readonly type: string;
  readonly claim: string;
  readonly evidence: readonly EvidenceLinkViewModel[];
  readonly recordedAt: string;
}

export interface SolutionViewModel {
  readonly submissionId: string;
  readonly authorExpertRef: string;
  readonly judgments: readonly JudgmentViewModel[];
  readonly signal: DiscoverySignalViewModel;
  readonly rankedVerdict: string | null;
  readonly btStrength: number;
}

/** The labelled discovery signal — NEVER a verdict (shared state vocabulary). */
export interface DiscoverySignalViewModel {
  readonly label: 'discovery-signal';
  readonly upvotes: number;
  readonly downvotes: number;
  readonly ratio: number | null;
  readonly totalVotes: number;
  readonly smallSample: boolean;
  readonly disclosure: string;
}

export interface CompetitionDetailViewModel {
  readonly competitionId: string;
  readonly title: string;
  readonly statement: string;
  readonly requiredSkills: readonly string[];
  readonly state: string;
  readonly solutions: readonly SolutionViewModel[];
  readonly result: {
    readonly outcome: string;
    readonly winnerSubmissionId: string | null;
    readonly formulaVersion: number;
    readonly reasons: readonly { readonly code: string; readonly detail: string }[];
    readonly limitations: readonly string[];
  } | null;
}

const STATE_LABELS: Readonly<Record<string, string>> = {
  open: 'Open',
  soliciting: 'Soliciting qualified experts',
  submitted: 'Solutions submitted',
  challenge: 'Challenge window',
  response: 'Response window',
  voting: 'Qualified voting',
  adjudication: 'Adjudication',
  verified_result: 'Verified result',
  abandoned: 'Abandoned',
  insufficient_participation: 'Insufficient participation',
};

export function competitionSummaryViewModel(
  competition: CompetitionRecord,
  judgmentCount: number,
  result: CompetitionResult | null,
): CompetitionSummaryViewModel {
  return {
    competitionId: competition.competitionId,
    title: competition.task.title,
    state: competition.state,
    stateLabel: STATE_LABELS[competition.state] ?? competition.state,
    solutionCount: 0,
    judgmentCount,
    outcome: result?.outcome ?? null,
    winnerSubmissionId: result?.winnerSubmissionId ?? null,
  };
}

export function discoverySignalViewModel(signal: CommunitySignal): DiscoverySignalViewModel {
  return {
    label: 'discovery-signal',
    upvotes: signal.upvotes,
    downvotes: signal.downvotes,
    ratio: signal.ratio,
    totalVotes: signal.totalVotes,
    smallSample: signal.smallSample,
    disclosure:
      'Discovery signal only — the raw upvote/downvote ratio cannot establish correctness or certification. It is excluded from adjudication inputs by construction.',
  };
}

export function competitionDetailViewModel(corpus: DemoCompetitionCorpus): CompetitionDetailViewModel {
  const { competition, submissions, judgments, signals, result } = corpus;
  const solutions: SolutionViewModel[] = submissions.map((submission: CompetitionSubmission) => {
    const own = judgments.filter((judgment: JudgmentRecord) => judgment.submissionId === submission.submissionId);
    const signal = signals.find((entry) => entry.submissionId === submission.submissionId);
    const ranked = result.rankedSolutions.find((entry) => entry.submissionId === submission.submissionId);
    return {
      submissionId: submission.submissionId,
      authorExpertRef: submission.authorExpertRef,
      judgments: own.map((judgment: JudgmentRecord) => ({
        judgmentId: judgment.judgmentId,
        expertRef: judgment.expertRef,
        type: judgment.type,
        claim: judgment.claim,
        evidence: judgment.evidence.map((item) => ({
          evidenceRef: item.evidenceRef,
          supportsClaim: item.supportsClaim,
          kind: item.kind,
        })),
        recordedAt: judgment.recordedAt,
      })),
      signal: discoverySignalViewModel(
        signal ?? {
          signalVersion: 1,
          competitionId: competition.competitionId,
          submissionId: submission.submissionId,
          label: 'discovery-signal',
          upvotes: 0,
          downvotes: 0,
          ratio: null,
          totalVotes: 0,
          distinctQualifiedVoters: 0,
          smallSample: true,
          computedAt: competition.updatedAt,
          limitations: [],
        },
      ),
      rankedVerdict: ranked?.verdict ?? null,
      btStrength: ranked?.btStrength ?? 0,
    };
  });
  return {
    competitionId: competition.competitionId,
    title: competition.task.title,
    statement: competition.task.statement,
    requiredSkills: competition.task.requiredSkills,
    state: competition.state,
    solutions,
    result: {
      outcome: result.outcome,
      winnerSubmissionId: result.winnerSubmissionId,
      formulaVersion: result.formulaVersion,
      reasons: result.reasons.map((reason) => ({ code: reason.code, detail: reason.detail })),
      limitations: result.limitations,
    },
  };
}
