/**
 * Test support for the adversarial-evaluation service tests (Work Order
 * C013): a fully-wired reference fabric + deterministic ids + command
 * builders.
 */

import { AdversarialEvaluationService } from './service.js';
import { createReferenceFabric } from './fabric.js';
import type { ReferenceDirectoryInput } from './fabric.js';
import type { CommandReceipt } from './service.js';
import { newCompetitionId, newCompetitionSubmissionId, newJudgmentId, newChallengeId } from '@arena/adversarial-evaluation';

export const T0 = Date.parse('2026-10-07T09:00:00.000Z');

export const REFERENCE_PARTICIPANTS: readonly ReferenceDirectoryInput[] = [
  { expertRef: 'expert-alpha', tenant: 'tenant-test', principalClusterRef: 'cluster-alpha', qualified: true },
  { expertRef: 'expert-beta', tenant: 'tenant-test', principalClusterRef: 'cluster-beta', qualified: true },
  { expertRef: 'expert-gamma', tenant: 'tenant-test', principalClusterRef: 'cluster-gamma', qualified: true },
  { expertRef: 'expert-delta', tenant: 'tenant-test', principalClusterRef: 'cluster-delta', qualified: true },
  // A puppet account of cluster-beta (duplicate-account protection target).
  { expertRef: 'expert-beta-puppet', tenant: 'tenant-test', principalClusterRef: 'cluster-beta', qualified: true },
  // An unqualified participant (qualification-aware visibility target).
  { expertRef: 'expert-unqualified', tenant: 'tenant-test', principalClusterRef: 'cluster-unq', qualified: false },
];

export interface TestHarness {
  readonly service: AdversarialEvaluationService;
  readonly competitionId: string;
  /** Advance the injected clock and return the new epoch ms. */
  readonly tick: () => number;
}

export function createTestHarness(participants: readonly ReferenceDirectoryInput[] = REFERENCE_PARTICIPANTS): TestHarness {
  const fabric = createReferenceFabric({ at: T0, participants });
  const service = new AdversarialEvaluationService({
    clock: fabric.clock,
    store: fabric.store,
    directory: fabric.directory,
    evaluator: fabric.evaluator,
    verifier: fabric.verifier,
    finalAdjudication: fabric.finalAdjudication,
    calibration: fabric.calibration,
    events: fabric.events,
    research: fabric.research,
    jobLog: fabric.jobLog,
  });
  let step = 0;
  return {
    service,
    competitionId: newCompetitionId(),
    tick: () => {
      step += 1;
      fabric.clock.advance(60_000);
      return T0 + step * 60_000;
    },
  };
}

export const TASK = {
  taskId: 'task-boq-takeoff',
  title: 'Quantity takeoff for structural steel package',
  statement:
    'Produce a quantity takeoff for the structural steel package of the described warehouse, with a reproducible method and cited drawings.',
  requiredSkills: ['structural-steel-takeoff', 'cost-estimation'],
} as const;

let commandCounter = 0;
export function nextCommandId(): string {
  commandCounter += 1;
  return `cmd-${commandCounter.toString().padStart(4, '0')}`;
}

export const newSubmissionId = newCompetitionSubmissionId;
export const newJudgementId = newJudgmentId;
export const newChallengeRef = newChallengeId;
export { newCompetitionSubmissionId, newJudgmentId, newChallengeId };

export type { CommandReceipt };
