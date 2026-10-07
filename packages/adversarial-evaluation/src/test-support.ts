/**
 * Test support for the adversarial-evaluation domain tests (Work Order
 * C013): deterministic fixture builders — fixed ids, fixed clock ticks,
 * no randomness inside fixtures.
 */

import { createJudgment } from './judgments.js';
import type { JudgmentRecord } from './judgments.js';
import { createCompetition } from './lifecycle.js';
import type { CompetitionRecord } from './lifecycle.js';
import type { CompetitionParticipant, CompetitionSubmission } from './guardrails.js';
import { DEFAULT_GUARDRAIL_POLICY } from './guardrails.js';
import { newCompetitionId, newCompetitionSubmissionId } from './shared.js';

export const T0 = Date.parse('2026-10-07T09:00:00.000Z');
export const T1 = T0 + 60_000;
export const T2 = T0 + 120_000;
export const T3 = T0 + 180_000;

export function fixtureCompetition(overrides: Partial<Parameters<typeof createCompetition>[0]> = {}): CompetitionRecord {
  return createCompetition({
    competitionId: newCompetitionId(),
    tenantId: 'tenant-test',
    task: {
      taskId: 'task-boq-takeoff',
      title: 'Quantity takeoff for structural steel package',
      statement:
        'Produce a quantity takeoff for the structural steel package of the described warehouse, with a reproducible method and cited drawings.',
      requiredSkills: ['structural-steel-takeoff', 'cost-estimation'],
    },
    now: T0,
    ...overrides,
  });
}

export function fixtureSubmission(
  competitionId: string,
  authorExpertRef: string,
): CompetitionSubmission {
  return {
    submissionId: newCompetitionSubmissionId(),
    competitionId,
    authorExpertRef,
    submittedAt: new Date(T1).toISOString(),
  };
}

export function fixtureParticipant(overrides: Partial<CompetitionParticipant> = {}): CompetitionParticipant {
  return {
    expertRef: 'expert-a',
    tenant: 'tenant-test',
    principalClusterRef: 'cluster-a',
    qualified: true,
    declaredConflicts: [],
    joinedAt: new Date(T0).toISOString(),
    ...overrides,
  };
}

export function fixtureJudgment(overrides: {
  readonly competitionId: string;
  readonly submissionId: string;
  readonly expertRef: string;
  readonly type: JudgmentRecord['type'];
  readonly challengeId?: string | null;
  readonly recordedAt?: number;
  readonly claim?: string;
}): JudgmentRecord {
  return createJudgment({
    judgmentId: `jdg_${hexOf(overrides.expertRef + overrides.type + overrides.submissionId)}`,
    competitionId: overrides.competitionId,
    submissionId: overrides.submissionId,
    challengeId: overrides.challengeId ?? null,
    expertRef: overrides.expertRef,
    type: overrides.type,
    claim: overrides.claim ?? 'the load-bearing beam count on drawing S-201 is understated by 12 members',
    evidence: [
      {
        kind: 'citation',
        evidenceRef: 'drawings/S-201-revision-C',
        supportsClaim: 'beam schedule revision C lists 88 members, not 100',
        note: null,
      },
    ],
    note: null,
    recordedAt: overrides.recordedAt ?? T2,
    provenance: 'test-fixture',
  });
}

function hexOf(seed: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').repeat(4).slice(0, 32);
}

export { DEFAULT_GUARDRAIL_POLICY };
