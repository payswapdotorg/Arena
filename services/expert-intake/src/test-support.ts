/**
 * Test support for @arena/expert-intake-service (Work Order C003) — the
 * A006/A007 port FAKES (in-memory, deterministic) and a scripted happy-path
 * interview runner over the service. Mirrors the sibling reference
 * services' test-support discipline.
 */

import { createHash } from 'node:crypto';
import type {
  QualificationClaimCandidateData,
  QualificationClaimPort,
  QualificationClaimReceipt,
  RegistryProposalData,
  ExpertRegistryProposalPort,
  RegistryProposalReceipt,
} from './ports.js';
import { ExpertIntakeService } from './fabric.js';
import type { InterviewItem } from '@arena/expert-intake';

export function fakeDigest(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

export function capabilityRef(kind: string, id: string, version = '1.0.0') {
  return Object.freeze({ kind, id, version, digest: fakeDigest(`${kind}:${id}:${version}`) });
}

export const TENANT = 'acme' as const;
export const OTHER_TENANT = 'globex' as const;
export const EXPERT_ID = 'expert-alice-01' as const;

export const CATALOG_SEED = Object.freeze({
  competencyRefs: Object.freeze([capabilityRef('capability', 'financial-audit'), capabilityRef('skill', 'regression-analysis')]),
  toolRefs: Object.freeze([capabilityRef('tool', 'ledger-cli')]),
  domainRef: capabilityRef('domain', 'finance'),
  demandLocales: Object.freeze(['en-US']),
});

/** The in-memory A006 registry port fake (records every proposal). */
export class FakeRegistryProposalPort implements ExpertRegistryProposalPort {
  readonly proposals: RegistryProposalData[] = [];
  failMode: 'none' | 'throw' | 'reject' = 'none';

  async submitRegistryProposal(proposal: RegistryProposalData): Promise<RegistryProposalReceipt> {
    if (this.failMode === 'throw') throw new Error('A006 registry port unavailable');
    if (this.failMode === 'reject') {
      return { accepted: false, reasons: ['registry-side validation rejected the proposal'] };
    }
    this.proposals.push(proposal);
    return { accepted: true, profileRef: fakeDigest(`registry-profile:${proposal.expertId}`) };
  }
}

/** The in-memory A007 qualification claim port fake (records every candidate). */
export class FakeQualificationClaimPort implements QualificationClaimPort {
  readonly claims: QualificationClaimCandidateData[] = [];
  failMode: 'none' | 'throw' | 'reject' = 'none';

  async submitClaimCandidate(claim: QualificationClaimCandidateData): Promise<QualificationClaimReceipt> {
    if (this.failMode === 'throw') throw new Error('A007 qualification port unavailable');
    if (this.failMode === 'reject') {
      return { accepted: false, reasons: ['claim candidate rejected pending evidence'] };
    }
    this.claims.push(claim);
    return { accepted: true, claimRef: fakeDigest(`claim:${claim.expertId}:${claim.capability.id}`) };
  }
}

export interface ServiceFixture {
  readonly service: ExpertIntakeService;
  readonly registry: FakeRegistryProposalPort;
  readonly qualification: FakeQualificationClaimPort;
}

export function createServiceFixture(): ServiceFixture {
  const registry = new FakeRegistryProposalPort();
  const qualification = new FakeQualificationClaimPort();
  const service = new ExpertIntakeService({ registry, qualification });
  return { service, registry, qualification };
}

/** The default happy-path answer for one interview item. */
export function defaultAnswer(item: InterviewItem): Record<string, unknown> {
  switch (item.expected.answerKind) {
    case 'proficiency-selection':
      return { answerKind: 'proficiency-selection', proficiency: 'proficient' };
    case 'locale-declaration':
      return { answerKind: 'locale-declaration', locales: ['en-US'] };
    case 'jurisdiction-declaration':
      return { answerKind: 'jurisdiction-declaration', jurisdictions: [{ jurisdictionVersion: 1, country: 'US' }] };
    case 'years-experience':
      return { answerKind: 'years-experience', years: 7 };
    case 'evidence-pointer':
      return {
        answerKind: 'evidence-pointer',
        evidenceKind: 'work-product-ref',
        evidenceDigest: fakeDigest(`evidence:${item.itemId}`),
        description: 'audit work product reference',
      };
    case 'scenario-response':
      return { answerKind: 'scenario-response', response: 'I would re-run the ledger reconciliation and report the delta.' };
    case 'availability-window':
      return {
        answerKind: 'availability-window',
        windows: [{ windowVersion: 1, recurrence: 'weekly', dayOfWeek: 2, startUtc: '09:00', endUtc: '17:00' }],
      };
    case 'privacy-consent':
      return { answerKind: 'privacy-consent', consentGranted: true, transcriptRetentionConsent: true };
    default:
      throw new Error(`no default answer for ${item.itemId}`);
  }
}

/**
 * Run a complete happy-path interview through the SERVICE: start → ask all
 * → answer all → submit → assess, returning the assessment result.
 */
export async function runServiceInterview(
  fixture: ServiceFixture,
  sessionId = 'intake-svc-01',
  tenant: string = TENANT,
): Promise<ReturnType<ExpertIntakeService['assessInterview']>> {
  const { service } = fixture;
  await service.startInterview(
    {
      sessionId,
      tenant,
      expertId: EXPERT_ID,
      catalogSeed: CATALOG_SEED,
      selectionSeed: 'seed-svc',
      privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
    },
    { correlationId: 'corr-start', idempotencyKey: `key-start-${sessionId}`, at: '2026-10-07T12:00:00.000Z' },
  );
  for (;;) {
    const asked = await service
      .askNextQuestionAt(sessionId, tenant, { correlationId: 'corr-ask', at: '2026-10-07T12:01:00.000Z' })
      .catch(() => null);
    if (asked === null) break; // catalog exhausted — every item asked
    await service.recordAnswer(sessionId, tenant, asked.item.itemId, defaultAnswer(asked.item), {
      correlationId: 'corr-answer',
      at: '2026-10-07T12:02:00.000Z',
    });
  }
  await service.submitInterview(sessionId, tenant, {
    correlationId: 'corr-submit',
    idempotencyKey: `key-submit-${sessionId}`,
    at: '2026-10-07T12:03:00.000Z',
  });
  return service.assessInterview(sessionId, tenant, {
    correlationId: 'corr-assess',
    idempotencyKey: `key-assess-${sessionId}`,
    at: '2026-10-07T12:04:00.000Z',
  });
}
