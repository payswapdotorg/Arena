/**
 * Body-marketplace runtime composition (Work Order C014;
 * apps/web/src/body-marketplace). SERVER-ONLY surface.
 *
 * Two compositions feed the capability-body marketplace UX:
 *
 *   SESSION composition — the authenticated experience: a session probe
 *   resolves the tenant facts FIRST (fail closed — an unauthenticated
 *   visitor gets the auth-required experience, never an anonymous
 *   marketplace), then the tenant's listings are read through the REAL
 *   C014 service fabric (services/body-marketplace) over its injected
 *   ports. An honest EMPTY state when the tenant has no listings yet.
 *
 *   DEMO composition — the reserved demo tenant (deterministic corpus
 *   visibly labelled per the demo labelling contract; demo state is
 *   never customer state): one full learning-loop walk (pretraining run
 *   → forged BodyVersion → certification candidacy → release → listing
 *   publication → grant) plus one BLOCKED run (rights-free input) so
 *   the consequence exposure is demonstrated, not asserted.
 *
 * Workspace imports are RELATIVE (../../../../services/...) because
 * apps/web's package manifest is B001-owned and stays untouched (the
 * same posture as apps/web/src/marketplace and apps/web/src/developers).
 */

import { isDemoTenant } from '@arena/demo';
import {
  createBodyMarketplaceFabric,
} from '../../../../services/body-marketplace/src/index.js';
import type {
  BodyMarketplaceService,
  CapabilityBodyListing,
  PretrainingRunRecord,
} from '../../../../services/body-marketplace/src/index.js';

/** The session probe contract (the fail-closed auth boundary seam). */
export interface BodyMarketplaceSessionProbe {
  readonly cookieValue: () => Promise<string | null>;
  readonly validate: (cookieValue: string) => Promise<SessionFacts | null>;
}

/** The validated session facts (tenant from the session, never the client). */
export interface SessionFacts {
  readonly tenantId: string;
  readonly principalLabel: string;
  readonly roles: readonly string[];
}

export type SessionOutcome =
  | { readonly status: 'authenticated'; readonly facts: SessionFacts }
  | { readonly status: 'unauthenticated' };

/** Resolve the session (fail closed; typed outcome, never a bare null). */
export async function resolveBodyMarketplaceSession(
  probe: BodyMarketplaceSessionProbe,
): Promise<SessionOutcome> {
  const cookieValue = await probe.cookieValue();
  if (cookieValue === null) return { status: 'unauthenticated' };
  const facts = await probe.validate(cookieValue);
  if (facts === null) return { status: 'unauthenticated' };
  return { status: 'authenticated', facts };
}

/** The demo narrative timestamps (deterministic; no clock reads). */
export const DEMO_T0 = '2026-10-07T10:00:00.000Z';
export const DEMO_T1 = '2026-10-07T10:05:00.000Z';
export const DEMO_T2 = '2026-10-07T10:10:00.000Z';

/** The demo tenant id (the reserved demo namespace). */
export const DEMO_TENANT = 'arena-demo';

const EVIDENCE_DIGEST =
  'e111111111111111111111111111111111111111111111111111111111111111';
const CANDIDATE_ID = 'candidate-body-improvement-demo';

/** The deterministic demo corpus (one full learning-loop walk + one blocked run). */
export interface DemoBodyMarketplaceCorpus {
  readonly fabric: BodyMarketplaceService;
  readonly run: PretrainingRunRecord;
  readonly blockedRun: PretrainingRunRecord;
  readonly listing: CapabilityBodyListing;
}

/** The session-scoped projection the views render. */
export interface BodyMarketplaceProjection {
  readonly mode: 'demo' | 'session';
  readonly tenantId: string;
  readonly principalLabel: string;
  readonly listings: readonly CapabilityBodyListing[];
  readonly runs: readonly PretrainingRunRecord[];
  readonly certification: Readonly<Record<string, { state: string; strongestGrant: string | null }>>;
}

function acceptedEvidence() {
  return {
    verdictId: 'verdict-demo-0001',
    requestId: 'escalation-demo-0001',
    tenantId: DEMO_TENANT,
    verdict: 'accepted',
    adjudicatedAt: DEMO_T0,
    evidenceDigests: [EVIDENCE_DIGEST],
    digest: EVIDENCE_DIGEST,
  };
}

function improvementCandidate() {
  return {
    candidateId: CANDIDATE_ID,
    kind: 'body-improvement' as const,
    tenantId: DEMO_TENANT,
    summary: 'Checklist improvements captured from the intervention',
    evidenceOfUse: [EVIDENCE_DIGEST],
    proposedAt: DEMO_T0,
  };
}

function demoComposition() {
  return {
    mission: 'Reconcile demo ledgers accurately and auditably.',
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

/** Build the deterministic demo corpus over the REAL service fabric. */
export async function buildDemoBodyMarketplaceCorpus(): Promise<DemoBodyMarketplaceCorpus> {
  const fabric = createBodyMarketplaceFabric({
    evidence: {
      resolve: async (digest, tenantId) => {
        const evidence = acceptedEvidence();
        return evidence.digest === digest && evidence.tenantId === tenantId ? evidence : undefined;
      },
    },
    candidates: {
      resolve: async (candidateId, tenantId) => {
        const candidate = improvementCandidate();
        return candidate.candidateId === candidateId && candidate.tenantId === tenantId
          ? candidate
          : undefined;
      },
    },
  });
  const request = {
    requestId: 'pretrain-demo-0001',
    tenantId: DEMO_TENANT,
    capabilityNeed: {
      summary: 'Improve cross-currency reconciliation accuracy',
      domainScope: ['finance', 'reconciliation'],
    },
    targetBody: { tenant: DEMO_TENANT, name: 'ledger-reconciler' },
    targetVersion: '1.1.0',
    inputs: [
      {
        kind: 'validated-intervention-evidence' as const,
        refId: EVIDENCE_DIGEST,
        source: {
          interventionId: 'intervention-demo-0001',
          requestId: 'escalation-demo-0001',
          sessionId: 'session-demo-0001',
          signalId: 'signal-demo-0001',
        },
        rights: {
          license: 'CC-BY-4.0',
          trainingUse: 'permitted' as const,
          scope: 'tenant-scoped reconciliation training',
          attribution: 'expert-demo-42',
        },
        scope: 'ledger reconciliation',
        evidenceOfUse: [EVIDENCE_DIGEST],
      },
      {
        kind: 'body-improvement-candidate' as const,
        refId: CANDIDATE_ID,
        source: {
          interventionId: 'intervention-demo-0001',
          requestId: 'escalation-demo-0001',
          sessionId: 'session-demo-0001',
          signalId: 'signal-demo-0001',
        },
        rights: {
          license: 'Proprietary-tenant',
          trainingUse: 'permitted' as const,
          scope: 'tenant-scoped composition improvement',
          attribution: null,
        },
        scope: 'checklist composition',
        evidenceOfUse: [EVIDENCE_DIGEST],
      },
    ],
    commission: {
      commissionId: 'commission-demo-0001',
      customer: 'customer-demo',
      scope: 'cross-currency reconciliation capability',
    },
    requestedAt: DEMO_T0,
    requestedBy: { type: 'user', tenant: DEMO_TENANT, principalId: 'author-demo' },
  };
  const run = await fabric.requestPretraining({
    request,
    composition: demoComposition(),
    baseBodyVersionRef: null,
    releaseChannel: 'candidate',
    runId: 'run-demo-0001',
    idempotencyKey: 'idem-run-demo-0001',
    correlationId: 'corr-run-demo-0001',
  });
  // The blocked run: a rights-free input (trainingUse 'forbidden') —
  // the consequence-exposure fixture.
  const blockedRun = await fabric.requestPretraining({
    request: {
      ...request,
      requestId: 'pretrain-demo-0002',
      inputs: [
        {
          ...request.inputs[0]!,
          rights: { ...request.inputs[0]!.rights, trainingUse: 'forbidden' as const },
        },
      ],
    },
    composition: demoComposition(),
    baseBodyVersionRef: null,
    releaseChannel: 'candidate',
    runId: 'run-demo-0002',
    idempotencyKey: 'idem-run-demo-0002',
    correlationId: 'corr-run-demo-0002',
  });
  const listing = await fabric.createListing({
    listingId: 'listing-demo-0001',
    tenantId: DEMO_TENANT,
    releaseDigest: run.releaseDigest as string,
    title: 'Ledger Reconciler (pretrained)',
    summary: 'Cross-currency reconciliation capability body, pretrained on validated interventions',
    capabilityEvidenceRefs: [EVIDENCE_DIGEST, CANDIDATE_ID],
    pretrainingRunId: run.runId,
    rights: {
      license: 'Proprietary',
      commercialUse: 'requires-license',
      redistribution: 'tenant-only',
      customerData: 'derived',
      professionalLimitations: ['not a licensed accounting system'],
    },
    substrateCompatibility: {
      requiredModalities: ['text-input', 'text-output'],
      requiredToolCalling: 'json-schema',
      contextRequirements: { minContextUnits: 32768 },
    },
    pricing: { amountMinorUnits: 2500000, currency: 'usd', model: 'per-possession' },
    createdBy: { type: 'user', tenant: DEMO_TENANT, principalId: 'publisher-demo' },
    createdAt: DEMO_T1,
    idempotencyKey: 'idem-listing-demo-0001',
    correlationId: 'corr-listing-demo-0001',
  });
  const published = await fabric.transitionListing({
    listingId: listing.listingId,
    tenantId: DEMO_TENANT,
    to: 'published',
    reason: 'demo marketplace launch',
    actor: { type: 'user', tenant: DEMO_TENANT, principalId: 'publisher-demo' },
    at: DEMO_T2,
    releasePublication: {
      publisher: { type: 'service', tenant: DEMO_TENANT, principalId: 'arena-body-marketplace' },
      rights: listing.rights,
      publishedAt: DEMO_T2,
    },
    idempotencyKey: 'idem-publish-demo-0001',
    correlationId: 'corr-publish-demo-0001',
  });
  return { fabric, run, blockedRun, listing: published };
}

/** The process-local demo corpus (one per process; deterministic). */
let demoCorpus: Promise<DemoBodyMarketplaceCorpus> | undefined;

/** Get (or lazily build) the process-local demo corpus. */
export function getDemoBodyMarketplaceContext(): Promise<DemoBodyMarketplaceCorpus> {
  demoCorpus ??= buildDemoBodyMarketplaceCorpus();
  return demoCorpus;
}

/** Reset the demo corpus (tests). */
export function resetDemoBodyMarketplaceContext(): void {
  demoCorpus = undefined;
}

/** Project the tenant's marketplace surface (listings + runs + postures). */
export async function projectBodyMarketplace(
  facts: SessionFacts,
  options: { readonly demo?: DemoBodyMarketplaceCorpus } = {},
): Promise<BodyMarketplaceProjection> {
  const demo = isDemoTenant(facts.tenantId);
  if (demo) {
    const corpus = options.demo ?? (await getDemoBodyMarketplaceContext());
    const listings = corpus.fabric.listListings(facts.tenantId);
    const certification: Record<string, { state: string; strongestGrant: string | null }> = {};
    for (const listing of listings) {
      const posture = await corpus.fabric.deriveCertificationPosture(listing);
      certification[listing.listingId] = {
        state: posture.state,
        strongestGrant: posture.state === 'record-backed' ? posture.strongestGrant : null,
      };
    }
    return {
      mode: 'demo',
      tenantId: facts.tenantId,
      principalLabel: facts.principalLabel,
      listings,
      runs: [corpus.run, corpus.blockedRun],
      certification,
    };
  }
  // Non-demo session: the session fabric has no listings yet — the
  // honest EMPTY state (register your first capability body).
  return {
    mode: 'session',
    tenantId: facts.tenantId,
    principalLabel: facts.principalLabel,
    listings: [],
    runs: [],
    certification: {},
  };
}
