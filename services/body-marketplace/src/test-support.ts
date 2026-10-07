/**
 * Shared test fixtures for @arena/body-marketplace-service (NOT part of
 * the public surface — hygiene.test.ts asserts it is not exported).
 *
 * Deterministic fixtures: a C009-accepted intervention-evidence view, a
 * C008 improvement-candidate view, a rights-cleared pretraining request
 * and the §12 composition material, plus in-memory C009/C008 ports.
 */

import type {
  ImprovementCandidateView,
  PretrainingRequestInput,
  ValidatedInterventionEvidenceView,
} from './pretraining.js';
import type { PretrainingCompositionInput } from './fabric.js';
import type { ImprovementCandidatePort, ValidatedEvidencePort } from './ports.js';

export const T0 = '2026-10-07T10:00:00.000Z';
export const T1 = '2026-10-07T10:05:00.000Z';
export const T2 = '2026-10-07T10:10:00.000Z';

export const TENANT = 'acme';
export const BODY_NAME = 'ledger-reconciler';

const EVIDENCE_DIGEST =
  'e111111111111111111111111111111111111111111111111111111111111111';
const CANDIDATE_ID = 'candidate-body-improvement-1';

/** A C009-ACCEPTED intervention evidence view (the admissible training input). */
export function makeAcceptedEvidence(
  overrides: Partial<ValidatedInterventionEvidenceView> = {},
): ValidatedInterventionEvidenceView {
  return {
    verdictId: 'verdict-0001',
    requestId: 'escalation-0001',
    tenantId: TENANT,
    verdict: 'accepted',
    adjudicatedAt: T0,
    evidenceDigests: [EVIDENCE_DIGEST],
    digest: EVIDENCE_DIGEST,
    ...overrides,
  };
}

/** A C008 body-improvement candidate view. */
export function makeCandidate(
  overrides: Partial<ImprovementCandidateView> = {},
): ImprovementCandidateView {
  return {
    candidateId: CANDIDATE_ID,
    kind: 'body-improvement',
    tenantId: TENANT,
    summary: 'Reconciliation checklist improvements from intervention escalation-0001',
    evidenceOfUse: [EVIDENCE_DIGEST],
    proposedAt: T0,
    ...overrides,
  };
}

/** The in-memory C009 seam over a set of evidence views. */
export function makeEvidencePort(
  entries: readonly ValidatedInterventionEvidenceView[],
): ValidatedEvidencePort {
  const byDigest = new Map(entries.map((entry) => [entry.digest, entry]));
  return {
    resolve: async (digest, tenantId) => {
      const found = byDigest.get(digest);
      if (found === undefined || found.tenantId !== tenantId) return undefined;
      return found;
    },
  };
}

/** The in-memory C008 seam over a set of candidate views. */
export function makeCandidatePort(
  entries: readonly ImprovementCandidateView[],
): ImprovementCandidatePort {
  const byId = new Map(entries.map((entry) => [entry.candidateId, entry]));
  return {
    resolve: async (candidateId, tenantId) => {
      const found = byId.get(candidateId);
      if (found === undefined || found.tenantId !== tenantId) return undefined;
      return found;
    },
  };
}

/** A rights-cleared pretraining request (one evidence + one candidate input). */
export function makePretrainingRequest(
  overrides: {
    readonly inputs?: PretrainingRequestInput['inputs'];
    readonly targetVersion?: string;
    readonly tenantId?: string;
  } = {},
): PretrainingRequestInput {
  return {
    requestId: 'pretrain-request-0001',
    tenantId: overrides.tenantId ?? TENANT,
    capabilityNeed: {
      summary: 'Improve ledger reconciliation accuracy on cross-currency entries',
      domainScope: ['finance', 'reconciliation'],
    },
    targetBody: { tenant: overrides.tenantId ?? TENANT, name: BODY_NAME },
    targetVersion: overrides.targetVersion ?? '1.1.0',
    inputs:
      overrides.inputs === undefined
        ? [
            {
              kind: 'validated-intervention-evidence',
              refId: EVIDENCE_DIGEST,
              source: {
                interventionId: 'intervention-0001',
                requestId: 'escalation-0001',
                sessionId: 'session-0001',
                signalId: 'signal-0001',
              },
              rights: {
                license: 'CC-BY-4.0',
                trainingUse: 'permitted',
                scope: 'tenant-scoped reconciliation training',
                attribution: 'expert-42',
              },
              scope: 'ledger reconciliation',
              evidenceOfUse: [EVIDENCE_DIGEST],
            },
            {
              kind: 'body-improvement-candidate',
              refId: CANDIDATE_ID,
              source: {
                interventionId: 'intervention-0001',
                requestId: 'escalation-0001',
                sessionId: 'session-0001',
                signalId: 'signal-0001',
              },
              rights: {
                license: 'Proprietary-tenant',
                trainingUse: 'permitted',
                scope: 'tenant-scoped composition improvement',
                attribution: null,
              },
              scope: 'checklist composition',
              evidenceOfUse: [EVIDENCE_DIGEST],
            },
          ]
        : overrides.inputs,
    commission: {
      commissionId: 'commission-0001',
      customer: 'customer-alpha',
      scope: 'cross-currency reconciliation capability',
    },
    requestedAt: T0,
    requestedBy: { type: 'user', tenant: TENANT, principalId: 'author-01' },
  };
}

/** The §12 composition material for the fixture request. */
export function makeComposition(): PretrainingCompositionInput {
  return {
    mission: 'Reconcile financial ledgers accurately and auditably.',
    role: 'senior-reconciliation-specialist',
    domainScope: ['finance', 'reconciliation'],
    capabilities: [
      {
        kind: 'capability',
        id: 'capability-reconciliation',
        version: '1.2.0',
        digest: 'f333333333333333333333333333333333333333333333333333333333333333',
      },
    ],
    skills: [
      {
        namespace: 'arena-skills',
        name: 'ledger-reconciliation-checklist',
        version: '1.1.0',
        digest: 'a111111111111111111111111111111111111111111111111111111111111111',
      },
    ],
    knowledge: [
      {
        namespace: 'arena-knowledge',
        name: 'gaap-basics',
        version: '2.0.0',
        digest: 'b222222222222222222222222222222222222222222222222222222222222222',
      },
    ],
    tools: [
      {
        namespace: 'arena-tools',
        name: 'ledger-query-api',
        version: '1.1.0',
        digest: 'c333333333333333333333333333333333333333333333333333333333333333',
      },
    ],
    procedures: [
      {
        namespace: 'arena-procedures',
        name: 'month-end-close-flow',
        version: '1.0.0',
        digest: 'd444444444444444444444444444444444444444444444444444444444444444',
      },
    ],
    evaluationSuites: [
      {
        namespace: 'arena-evaluation',
        name: 'reconciliation-accuracy-suite',
        version: '1.0.0',
        digest: 'e555555555555555555555555555555555555555555555555555555555555555',
      },
    ],
    verificationSuites: [
      {
        namespace: 'arena-verification',
        name: 'evidence-provenance-suite',
        version: '1.0.0',
        digest: 'f666666666666666666666666666666666666666666666666666666666666666',
      },
    ],
    environmentRequirements: [
      {
        namespace: 'arena-environments',
        name: 'erp-close-sandbox',
        version: '1.1.0',
        digest: 'b222222222222222222222222222222222222222222222222222222222222222',
      },
    ],
    substrateCompatibility: {
      requiredModalities: ['text-input', 'text-output'],
      requiredToolCalling: 'json-schema',
      contextRequirements: { minContextUnits: 32768 },
    },
    rights: {
      license: 'Proprietary',
      commercialUse: 'requires-license',
      redistribution: 'tenant-only',
      customerData: 'derived',
      professionalLimitations: ['not a licensed accounting system'],
    },
  };
}

export { EVIDENCE_DIGEST, CANDIDATE_ID };
