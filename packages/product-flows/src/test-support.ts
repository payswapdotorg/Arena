/**
 * Shared fixtures for the @arena/product-flows suites (Work Order B008).
 * NOT exported from the package index (the @arena/capability-case
 * convention). Everything deterministic: fixed digests, fixed timestamps,
 * fixed ids.
 */

import type { StartCaseInput } from './runtime.js';

export const T0 = '2026-10-01T09:00:00.000Z';
export const T1 = '2026-10-01T10:00:00.000Z';
export const T2 = '2026-10-01T11:00:00.000Z';
export const T3 = '2026-10-01T12:00:00.000Z';
export const T4 = '2026-10-01T13:00:00.000Z';
export const T5 = '2026-10-01T14:00:00.000Z';
export const T6 = '2026-10-01T15:00:00.000Z';

export const DIGESTS = Object.freeze({
  capability: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  domain: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  evidenceOne: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  evidenceTwo: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  evidenceThree: 'e111111111111111111111111111111111111111111111111111111111111111',
  competency: '1212121212121212121212121212121212121212121212121212121212121212',
  environment: '3434343434343434343434343434343434343434343434343434343434343434',
  tool: '5656565656565656565656565656565656565656565656565656565656565656',
  evaluator: '7878787878787878787878787878787878787878787878787878787878787878',
  verifier: '9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a',
  provenance: 'bc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1dbc1d',
  body: 'de1ede1ede1ede1ede1ede1ede1ede1ede1ede1ede1ede1ede1ede1ede1ede1e',
} as const);

export const TENANT = 'tenant-flows' as const;
export const CASE_ID = 'case-refund-timeout' as const;

export const ACTOR = Object.freeze({
  type: 'user',
  tenant: TENANT,
  principalId: 'flow-operator-1',
} as const);

/** The canonical valid guided-flow start input every test starts from. */
export function validStartInput(): StartCaseInput {
  return {
    identity: { tenant: TENANT, caseId: CASE_ID },
    version: '1.0.0',
    source: { type: 'user', tenant: TENANT, principalId: 'analyst-1' },
    problemStatement:
      'The payments agent lets refund retries storm under load instead of backing off, producing flaky refund timeouts.',
    targetCapability: {
      kind: 'capability',
      id: 'refund-retry-reliability',
      version: '1.1.0',
      digest: DIGESTS.capability,
    },
    domain: { kind: 'domain', id: 'payments', version: '1.0.0', digest: DIGESTS.domain },
    context:
      'Production tenant workload; monthly refund batch; retries use a fixed interval with no jitter.',
    observedFailure: {
      summary:
        'Refund retries cluster into storms during the monthly batch, producing flaky timeouts on the refunds adapter.',
      observedAt: T0,
      reproduction:
        'Run the monthly refund batch with one flaky downstream and a fixed retry interval.',
    },
    evidence: [
      {
        digest: DIGESTS.evidenceOne,
        description: 'Trajectory export of the failing refund batch run.',
      },
    ],
    unknowns: ['Whether the downstream honors Retry-After at all'],
    desiredOutcome:
      'The agent retries refunds with jittered exponential backoff and caps retries, eliminating the storms.',
    expertRequirements: {
      competencies: [
        {
          kind: 'expert-competency',
          id: 'payments-reliability',
          version: '1.0.0',
          digest: DIGESTS.competency,
        },
      ],
      qualifications: ['payments-reliability-reviewer'],
    },
    environmentRequirements: {
      environments: [
        {
          namespace: TENANT,
          name: 'payments-batch-sandbox',
          version: '1.2.0',
          digest: DIGESTS.environment,
        },
      ],
      constraints: ['No live payments writes'],
    },
    taskRequirements: {
      objectives: ['Eliminate refund retry storms under load'],
      constraints: ['Use only the sandbox payments export'],
      allowedTools: [
        { namespace: TENANT, name: 'payments-export-reader', version: '1.0.0', digest: DIGESTS.tool },
      ],
      forbiddenShortcuts: ['Assume the downstream is healthy without probing'],
      successConditions: ['No timeout under the batch replay'],
      evidenceCriteria: ['Annotated trajectory with the backoff decisions'],
      difficulty: 'standard',
    },
    evaluationRequirements: {
      evaluators: [
        { kind: 'evaluator', id: 'retry-storm-accuracy', version: '1.0.0', digest: DIGESTS.evaluator },
      ],
      criteria: ['Zero timeout storms across the replayed batch'],
    },
    verificationRequirements: {
      verifiers: [
        { kind: 'verifier', id: 'payments-balance-check', version: '1.0.0', digest: DIGESTS.verifier },
      ],
      evidenceStandards: ['Balance proof exported from the sandbox'],
    },
    currentBody: {
      tenant: TENANT,
      name: 'payments-agent',
      version: '2.4.0',
      digest: DIGESTS.body,
    },
    provenance: { recordDigest: DIGESTS.provenance },
    priority: 'high',
    risk: 'moderate',
    createdAt: T0,
  };
}
