/**
 * The seeded reference corpus for the Arena control console (Work Order
 * A018, gate 5) — JavaScript edition.
 *
 * WHY .mjs: @arena/web's manifest is frozen (it declares only
 * @arena/protocol-core) while this module must instantiate SEVEN further
 * workspace packages (@arena/control-ui, five domain packages, the
 * job-orchestrator service and the two model-substrate reference
 * adapters). The app-level tsconfig builds every non-test .ts under src/
 * with rootDir=src, and TypeScript refuses to emit a compiled-in module
 * graph that reaches outside that root — so the corpus builder ships as
 * plain JavaScript (ESM, Node built-ins + workspace sources only), loaded
 * by main.mjs after the .js→.ts resolution shim is registered and typed
 * at the test boundary via corpus.d.mts. The module is a 1:1 port of the
 * reviewed TypeScript implementation; every export is pinned byte-for-
 * byte by the golden suites in console.test.ts.
 *
 * WHAT IT BUILDS (all through the domain packages' PUBLIC entry files):
 *
 *   - ≥2 capability cases — @arena/capability-case (createCapabilityCase,
 *     the append-only lifecycle, CaseRegistry admission + tenant-scoped
 *     reads);
 *   - ≥2 agent bodies — @arena/agent-body (createBodyVersion, with a
 *     lineage parent on one body);
 *   - ≥2 cognitive substrates — registered through the model-substrate
 *     REFERENCE ADAPTERS (@arena/adapter-neutral-mock and
 *     @arena/adapter-offline-stub, the A016 reference implementations)
 *     into a SubstrateRegistry;
 *   - ≥2 durable jobs — driven through the job-orchestrator REFERENCE
 *     FLOW (JobOrchestrator + ManualClock + InMemoryJobStore +
 *     InMemoryEventSink, injected deterministic envelope ids);
 *   - ≥1 environment run with trajectory entries —
 *     @arena/environment-protocol (createEnvironmentDefinition +
 *     toRunAddress) plus the console trajectory steps pinned to the run
 *     address (the A011 trajectory package is not merged at this base).
 *
 * Determinism: every timestamp is a fixed constant, every digest fixture
 * is a fixed 64-hex string, the orchestrator clock is a ManualClock and
 * envelope ids come from an injected UUID-shaped counter — building the
 * corpus twice yields byte-identical records, so the golden HTML
 * snapshots in the test suites are stable (gate 6).
 */

import {
  createBodyVersion,
} from '../../../../packages/agent-body/src/index.ts';
import {
  activateCase,
  createCapabilityCase,
  createCaseRegistry,
  listCases,
  registerCase,
  recordTransition,
  submitCase,
  triageCase,
} from '../../../../packages/capability-case/src/index.ts';
import {
  createEnvironmentDefinition,
  toRunAddress,
} from '../../../../packages/environment-protocol/src/index.ts';
import { createJobDefinition } from '../../../../packages/job-protocol/src/index.ts';
import { createSubstrateRegistry } from '../../../../packages/model-substrate/src/index.ts';
import {
  toCorrelationId,
  toIdempotencyKey,
} from '../../../../packages/protocol-core/src/index.ts';
import { freezeCorpus } from '../../../../packages/control-ui/src/index.ts';
import { createNeutralMockAdapter } from '../../../../adapters/models/adapter-neutral-mock/src/index.ts';
import { createOfflineStubAdapter } from '../../../../adapters/models/adapter-offline-stub/src/index.ts';
import {
  InMemoryEventSink,
  InMemoryJobStore,
  JobOrchestrator,
  ManualClock,
} from '../../../../services/job-orchestrator/src/index.ts';

// ---------------------------------------------------------------------------
// Deterministic seed constants (fixed — the corpus is byte-stable)
// ---------------------------------------------------------------------------

/** The demo tenant every seeded record lives in. */
export const SEED_TENANT = 'demo';

/** Fixed 64-hex digest fixtures used for content-addressed refs. */
export const SEED_DIGESTS = Object.freeze({
  capability: 'aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11',
  domain: 'bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22',
  evidenceTrajectory:
    'cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33',
  competency: 'dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44',
  environmentImage:
    'ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55',
  bodyParent: 'ff66ff66ff66ff66ff66ff66ff66ff66ff66ff66ff66ff66ff66ff66ff66ff66',
  snapshot: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  trajectory: 'fedcbafedcbafedcbafedcbafedcbafedcbafedcbafedcbafedcbafedcba0000',
  evidenceOne: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
  evidenceTwo: '0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff',
});

/** Fixed timeline (UTC) — every event in the corpus happens on it. */
export const SEED_TIMELINE = Object.freeze({
  caseACreated: '2026-10-01T09:00:00.000Z',
  caseASubmitted: '2026-10-01T09:30:00.000Z',
  caseATriaged: '2026-10-01T10:00:00.000Z',
  caseAActivated: '2026-10-01T10:30:00.000Z',
  caseBCreated: '2026-10-02T11:00:00.000Z',
  bodyForged: '2026-09-20T08:00:00.000Z',
  substrateRegistered: '2026-09-22T08:30:00.000Z',
  jobClockStart: '2026-10-03T09:00:00.000Z',
});

/** The seeded run id (the trajectory route's addressable id). */
export const SEED_RUN_ID = 'run-erp-close-0001';

/** The seeded job ids, in store insertion order. */
export const SEED_JOB_IDS = Object.freeze([
  'job-evaluate-0001',
  'job-verify-0001',
  'job-evaluate-0002',
]);

const ACTOR_INTAKE = Object.freeze({
  type: 'user',
  tenant: SEED_TENANT,
  principalId: 'case-intake',
});

const ACTOR_ORCHESTRATOR = Object.freeze({
  type: 'service',
  tenant: SEED_TENANT,
  principalId: 'console-seed',
});

// ---------------------------------------------------------------------------
// Capability cases (≥2)
// ---------------------------------------------------------------------------

async function seedCases() {
  let registry = createCaseRegistry();

  // Case A: the full intake journey draft → submitted → triaged → active.
  const caseADraft = await createCapabilityCase({
    identity: { tenant: SEED_TENANT, caseId: 'case-review-invoices' },
    version: '1.0.0',
    source: { type: 'user', tenant: SEED_TENANT, principalId: 'analyst-1' },
    problemStatement:
      'The invoicing agent fails to reconcile credit notes against partially paid invoices.',
    targetCapability: {
      kind: 'capability',
      id: 'invoice-reconciliation',
      version: '1.2.0',
      digest: SEED_DIGESTS.capability,
    },
    domain: {
      kind: 'domain',
      id: 'accounts-payable',
      version: '1.0.0',
      digest: SEED_DIGESTS.domain,
    },
    context:
      'Production tenant workload; monthly close; the ERP export lists partial payments without netting open credit notes.',
    observedFailure: {
      summary:
        'The agent marked a partially paid invoice as fully settled, ignoring an open credit note.',
      observedAt: SEED_TIMELINE.caseACreated,
      reproduction:
        'Run the monthly close with one partially paid invoice and one open credit note.',
    },
    evidence: [
      {
        digest: SEED_DIGESTS.evidenceTrajectory,
        description: 'Trajectory export of the failing close run (2026-09-30).',
      },
    ],
    unknowns: ['Whether the ERP ever nets credit notes on export'],
    desiredOutcome:
      'The agent nets credit notes against partially paid invoices and explains the netting in its close summary.',
    expertRequirements: {
      competencies: [
        {
          kind: 'expert-competency',
          id: 'accounts-payable-reconciliation',
          version: '1.0.0',
          digest: SEED_DIGESTS.competency,
        },
      ],
      qualifications: ['certified-accountant'],
    },
    environmentRequirements: {
      environments: [
        {
          namespace: SEED_TENANT,
          name: 'erp-close-sandbox',
          version: '1.4.0',
          digest: SEED_DIGESTS.environmentImage,
        },
      ],
      constraints: ['No live ERP writes'],
    },
    taskRequirements: {
      objectives: ['Reconcile credit notes against partially paid invoices'],
      constraints: ['Use only the ERP export snapshot'],
      allowedTools: [
        {
          namespace: SEED_TENANT,
          name: 'erp-export-reader',
          version: '1.0.0',
          digest: SEED_DIGESTS.capability,
        },
      ],
      forbiddenShortcuts: ['Assume full settlement without checking credit notes'],
      successConditions: ['Netted total matches the ERP expected balance'],
      evidenceCriteria: ['Annotated trajectory with the netting decision'],
      difficulty: 'standard',
    },
    evaluationRequirements: {
      evaluators: [
        {
          kind: 'evaluator',
          id: 'reconciliation-accuracy',
          version: '1.0.0',
          digest: SEED_DIGESTS.domain,
        },
      ],
      criteria: ['Netting accuracy >= 99% on the evaluation set'],
    },
    verificationRequirements: {
      verifiers: [
        {
          kind: 'verifier',
          id: 'erp-balance-check',
          version: '1.0.0',
          digest: SEED_DIGESTS.evidenceTrajectory,
        },
      ],
      evidenceStandards: ['Balance proof exported from the sandbox ERP'],
    },
    currentBody: {
      tenant: SEED_TENANT,
      name: 'invoicing-agent',
      version: '3.2.1',
      digest: SEED_DIGESTS.bodyParent,
    },
    currentSubstrate: {
      adapterId: 'neutral-mock',
      modelFamily: 'reasoning-family',
      modelId: 'large-reasoner',
      modelRevision: 'rev-2',
      contentDigest: SEED_DIGESTS.evidenceOne,
    },
    provenance: { recordDigest: SEED_DIGESTS.capability },
    priority: 'high',
    risk: 'moderate',
    createdAt: SEED_TIMELINE.caseACreated,
  });
  registry = registerCase(registry, caseADraft);

  const caseASubmitted = await submitCase(caseADraft, {
    at: SEED_TIMELINE.caseASubmitted,
    actor: ACTOR_INTAKE,
  });
  registry = recordTransition(registry, caseASubmitted);

  const caseATriaged = await triageCase(caseASubmitted, {
    at: SEED_TIMELINE.caseATriaged,
    actor: ACTOR_INTAKE,
    note: 'Reconciliation gap reproduced in the sandbox; high customer impact during monthly close.',
  });
  registry = recordTransition(registry, caseATriaged);

  const caseAActive = await activateCase(caseATriaged, {
    at: SEED_TIMELINE.caseAActivated,
    actor: ACTOR_INTAKE,
  });
  registry = recordTransition(registry, caseAActive);

  // Case B: a fresh draft (a different domain, no body bound yet).
  const caseBDraft = await createCapabilityCase({
    identity: { tenant: SEED_TENANT, caseId: 'case-load-review-latency' },
    version: '1.0.0',
    source: { type: 'user', tenant: SEED_TENANT, principalId: 'engineer-2' },
    problemStatement:
      'The structural review agent exceeds the response-time budget on multi-span load analysis tasks.',
    targetCapability: {
      kind: 'capability',
      id: 'load-analysis',
      version: '2.0.0',
      digest: SEED_DIGESTS.domain,
    },
    domain: {
      kind: 'domain',
      id: 'structural-engineering',
      version: '1.1.0',
      digest: SEED_DIGESTS.competency,
    },
    context:
      'Tenant workload: preliminary load reviews on medium-rise buildings; analysis inputs arrive as CAD exports.',
    observedFailure: {
      summary:
        'Median review latency is 4x the budget on three-span arrangements; single-span cases stay within budget.',
      observedAt: SEED_TIMELINE.caseBCreated,
      reproduction:
        'Submit a three-span load analysis task from the standard benchmark pack and measure wall-clock time.',
    },
    evidence: [
      {
        digest: SEED_DIGESTS.evidenceTwo,
        description: 'Latency measurements over the benchmark pack (2026-10-01).',
      },
    ],
    unknowns: [
      'Whether the latency comes from planning depth or from tool-call serialization',
    ],
    desiredOutcome:
      'Multi-span load reviews complete within the response-time budget with unchanged verification outcomes.',
    expertRequirements: {
      competencies: [
        {
          kind: 'expert-competency',
          id: 'structural-load-analysis',
          version: '1.0.0',
          digest: SEED_DIGESTS.competency,
        },
      ],
      qualifications: ['licensed-structural-engineer'],
    },
    environmentRequirements: {
      environments: [
        {
          namespace: SEED_TENANT,
          name: 'cad-tools-sandbox',
          version: '2.1.0',
          digest: SEED_DIGESTS.environmentImage,
        },
      ],
      constraints: ['Read-only CAD tool access'],
    },
    taskRequirements: {
      objectives: ['Deliver multi-span load analyses within the latency budget'],
      constraints: ['Use the standard benchmark pack'],
      allowedTools: [
        {
          namespace: SEED_TENANT,
          name: 'fe-solver',
          version: '3.0.0',
          digest: SEED_DIGESTS.capability,
        },
      ],
      forbiddenShortcuts: ['Skip the code-compliance cross-check'],
      successConditions: ['Wall-clock time within budget on every benchmark case'],
      evidenceCriteria: ['Per-case timing table with verifier sign-off'],
      difficulty: 'exploratory',
    },
    evaluationRequirements: {
      evaluators: [
        {
          kind: 'evaluator',
          id: 'review-latency',
          version: '1.0.0',
          digest: SEED_DIGESTS.domain,
        },
      ],
      criteria: ['All benchmark cases within budget'],
    },
    verificationRequirements: {
      verifiers: [
        {
          kind: 'verifier',
          id: 'compliance-cross-check',
          version: '1.0.0',
          digest: SEED_DIGESTS.evidenceTrajectory,
        },
      ],
      evidenceStandards: ['Signed timing table attached to the trajectory'],
    },
    provenance: { recordDigest: SEED_DIGESTS.domain },
    priority: 'normal',
    risk: 'low',
    createdAt: SEED_TIMELINE.caseBCreated,
  });
  registry = registerCase(registry, caseBDraft);

  // Tenant-scoped read through the registry's public query API.
  return listCases(registry, { tenant: SEED_TENANT });
}

// ---------------------------------------------------------------------------
// Agent bodies (≥2)
// ---------------------------------------------------------------------------

async function seedBodies() {
  const rights = Object.freeze({
    license: 'Proprietary',
    commercialUse: 'requires-license',
    redistribution: 'tenant-only',
    customerData: 'derived',
    professionalLimitations: ['final-signoff-requires-human-review'],
  });

  // Body A: the invoicing agent, forged on top of a prior version.
  const invoicingAgent = await createBodyVersion({
    body: { tenant: SEED_TENANT, name: 'invoicing-agent' },
    version: '3.2.1',
    mission: 'Deliver auditable invoice reconciliation during the monthly close.',
    role: 'senior-invoicing-reviewer',
    domainScope: ['accounts-payable', 'invoice-reconciliation'],
    capabilities: ['invoice-reconciliation', 'credit-note-netting'],
    skills: [
      {
        namespace: SEED_TENANT,
        name: 'skill-credit-note-netting',
        version: '1.3.0',
        digest: SEED_DIGESTS.capability,
      },
    ],
    knowledge: [
      {
        namespace: SEED_TENANT,
        name: 'knowledge-erp-export-schema',
        version: '2.0.0',
        digest: SEED_DIGESTS.domain,
      },
    ],
    tools: [
      {
        namespace: SEED_TENANT,
        name: 'erp-export-reader',
        version: '1.0.0',
        digest: SEED_DIGESTS.competency,
      },
    ],
    procedures: [
      {
        namespace: SEED_TENANT,
        name: 'proc-monthly-close',
        version: '1.1.0',
        digest: SEED_DIGESTS.evidenceTrajectory,
      },
    ],
    memoryPolicy: { policyId: 'memory-close-outcomes', statements: ['persist task outcomes only'] },
    planningPolicy: { policyId: 'plan-before-close', statements: ['plan before acting'] },
    escalation: {
      rules: [
        {
          condition: 'settlement-mismatch-above-tolerance',
          target: { type: 'expert', tenant: SEED_TENANT, principalId: 'expert-accountant-1' },
        },
      ],
    },
    authorityBoundaries: ['may-propose-netting', 'never-signs-off-final-close'],
    safetyPolicy: { policyId: 'safety-close', statements: ['never-write-live-erp'] },
    evaluationSuites: [
      {
        namespace: SEED_TENANT,
        name: 'eval-reconciliation-accuracy',
        version: '1.0.0',
        digest: SEED_DIGESTS.domain,
      },
    ],
    verificationSuites: [
      {
        namespace: SEED_TENANT,
        name: 'verif-balance-proof',
        version: '1.0.0',
        digest: SEED_DIGESTS.evidenceTrajectory,
      },
    ],
    environmentRequirements: [
      {
        namespace: SEED_TENANT,
        name: 'erp-close-sandbox',
        version: '1.4.0',
        digest: SEED_DIGESTS.environmentImage,
      },
    ],
    substrateCompatibility: {
      requiredModalities: ['text-input', 'text-output', 'structured-input'],
      requiredToolCalling: 'function-calling',
      contextRequirements: { minContextUnits: 100000 },
      requiredEvaluationSuites: [
        {
          namespace: SEED_TENANT,
          name: 'eval-reconciliation-accuracy',
          version: '1.0.0',
          digest: SEED_DIGESTS.domain,
        },
      ],
      prohibitedConditions: ['deprecated'],
    },
    provenance: {
      creator: { type: 'agent-body', tenant: SEED_TENANT, principalId: 'body-forge-1' },
      createdAt: SEED_TIMELINE.bodyForged,
      rights,
      records: [],
    },
    lineage: {
      parents: [
        {
          tenant: SEED_TENANT,
          name: 'invoicing-agent',
          version: '3.2.0',
          digest: SEED_DIGESTS.bodyParent,
        },
      ],
    },
  });

  // Body B: the structural review agent, first forged version.
  const structuralEngineer = await createBodyVersion({
    body: { tenant: SEED_TENANT, name: 'structural-review-agent' },
    version: '1.2.0',
    mission: 'Deliver structural engineering reviews with auditable provenance.',
    role: 'senior-structural-reviewer',
    domainScope: ['structural-engineering', 'code-compliance'],
    capabilities: ['load-analysis', 'code-compliance-review'],
    skills: [
      {
        namespace: SEED_TENANT,
        name: 'skill-load-analysis',
        version: '2.0.0',
        digest: SEED_DIGESTS.capability,
      },
    ],
    knowledge: [
      {
        namespace: SEED_TENANT,
        name: 'knowledge-building-codes',
        version: '1.1.0',
        digest: SEED_DIGESTS.domain,
      },
    ],
    tools: [
      {
        namespace: SEED_TENANT,
        name: 'fe-solver',
        version: '3.0.0',
        digest: SEED_DIGESTS.competency,
      },
    ],
    procedures: [
      {
        namespace: SEED_TENANT,
        name: 'proc-review-flow',
        version: '1.0.0',
        digest: SEED_DIGESTS.evidenceTrajectory,
      },
    ],
    memoryPolicy: { policyId: 'memory-review-outcomes', statements: ['persist task outcomes only'] },
    planningPolicy: { policyId: 'plan-review-first', statements: ['plan before acting'] },
    escalation: {
      rules: [
        {
          condition: 'loads-beyond-comfort-table',
          target: { type: 'expert', tenant: SEED_TENANT, principalId: 'expert-reviewer-9' },
        },
      ],
    },
    authorityBoundaries: ['may-approve-loads-below-limit', 'never-signs-off-final-drawings'],
    safetyPolicy: { policyId: 'safety-loads', statements: ['refuse-unsafe-load-approvals'] },
    evaluationSuites: [
      {
        namespace: SEED_TENANT,
        name: 'eval-review-latency',
        version: '1.0.0',
        digest: SEED_DIGESTS.domain,
      },
    ],
    verificationSuites: [
      {
        namespace: SEED_TENANT,
        name: 'verif-compliance-cross-check',
        version: '1.0.0',
        digest: SEED_DIGESTS.evidenceTrajectory,
      },
    ],
    environmentRequirements: [
      {
        namespace: SEED_TENANT,
        name: 'cad-tools-sandbox',
        version: '2.1.0',
        digest: SEED_DIGESTS.environmentImage,
      },
    ],
    substrateCompatibility: {
      requiredModalities: ['text-input', 'text-output'],
      requiredToolCalling: 'json-schema',
      contextRequirements: { minContextUnits: 32000 },
      requiredEvaluationSuites: [
        {
          namespace: SEED_TENANT,
          name: 'eval-review-latency',
          version: '1.0.0',
          digest: SEED_DIGESTS.domain,
        },
      ],
      prohibitedConditions: ['deprecated'],
    },
    provenance: {
      creator: { type: 'agent-body', tenant: SEED_TENANT, principalId: 'body-forge-1' },
      createdAt: SEED_TIMELINE.bodyForged,
      rights,
      records: [],
    },
    lineage: { parents: [] },
  });

  return [invoicingAgent, structuralEngineer];
}

// ---------------------------------------------------------------------------
// Cognitive substrates (≥2, via the model-substrate reference adapters)
// ---------------------------------------------------------------------------

async function seedSubstrates() {
  const registry = createSubstrateRegistry();

  // Reference adapter 1: @arena/adapter-neutral-mock (A016).
  const neutralMock = await createNeutralMockAdapter({
    clock: () => SEED_TIMELINE.substrateRegistered,
  });
  const reasonerSubstrate = await neutralMock.registerSubstrate({
    modelFamily: 'reasoning-family',
    modelId: 'large-reasoner',
    modelRevision: 'rev-2',
    modalityProfile: ['text-input', 'text-output', 'structured-input'],
    toolCallingProfile: 'function-calling',
    contextLimits: { maxContextUnits: 200000, maxOutputUnits: 32000 },
    conditions: ['stable'],
  });
  await registry.register({
    substrateId: 'substrate-reasoner-general',
    substrate: reasonerSubstrate,
    adapterDescriptor: neutralMock.descriptor,
    registeredAt: SEED_TIMELINE.substrateRegistered,
  });

  // Reference adapter 2: @arena/adapter-offline-stub (A016, fixed catalog).
  const offlineStub = await createOfflineStubAdapter({
    clock: () => SEED_TIMELINE.substrateRegistered,
  });
  const offlineSubstrate = await offlineStub.registerSubstrate({
    modelFamily: 'offline-reasoner',
    modelId: 'offline-stub-1',
    modelRevision: 'r1',
    modalityProfile: ['text-input', 'text-output'],
    toolCallingProfile: 'text-protocol',
    contextLimits: { maxContextUnits: 8192, maxOutputUnits: 4096 },
    conditions: ['stable'],
  });
  await registry.register({
    substrateId: 'substrate-offline-baseline',
    substrate: offlineSubstrate,
    adapterDescriptor: offlineStub.descriptor,
    registeredAt: SEED_TIMELINE.substrateRegistered,
  });

  return registry.list();
}

// ---------------------------------------------------------------------------
// Durable jobs (≥2, through the job-orchestrator reference flow)
// ---------------------------------------------------------------------------

async function seedJobs() {
  const clock = new ManualClock(Date.parse(SEED_TIMELINE.jobClockStart));
  const store = new InMemoryJobStore();
  const sink = new InMemoryEventSink();
  // Deterministic envelope ids (UUID-shaped, per the core envelope wire
  // pattern): the whole flow is byte-reproducible.
  let envelopeCounter = 0;
  const newEnvelopeId = () => {
    envelopeCounter += 1;
    return `00000000-0000-4000-8000-${String(envelopeCounter).padStart(12, '0')}`;
  };
  const orchestrator = new JobOrchestrator({ clock, store, sink, newEnvelopeId });

  const evaluationDefinition = await createJobDefinition({
    kind: { namespace: SEED_TENANT, name: 'evaluate-capability', version: '1.0.0' },
    inputSchema: 'arena:schema/demo/evaluation-run@1.0.0',
    correlationAddress: 'demo/evaluation',
    idempotency: { scope: 'demo-evaluation' },
    timeout: { timeoutMs: 600000 },
    retry: {
      maxAttempts: 3,
      backoffScheduleMs: [1000, 5000],
      retryableErrorClasses: ['transient', 'timeout'],
    },
    priority: 'high',
  });

  const verificationDefinition = await createJobDefinition({
    kind: { namespace: SEED_TENANT, name: 'verify-evidence', version: '1.0.0' },
    inputSchema: 'arena:schema/demo/verification-check@1.0.0',
    correlationAddress: 'demo/verification',
    idempotency: { scope: 'demo-verification' },
    timeout: { timeoutMs: 120000 },
    retry: { maxAttempts: 1 },
    priority: 'normal',
  });

  // Job 1: the full happy path — queued → running → progress → succeeded.
  await orchestrator.submit({
    definition: evaluationDefinition,
    input: { caseId: 'case-review-invoices', capabilityId: 'invoice-reconciliation' },
    correlationId: toCorrelationId('console-seed-eval-0001'),
    idempotencyKey: toIdempotencyKey('console-seed-eval-0001'),
    jobId: SEED_JOB_IDS[0],
    actor: ACTOR_ORCHESTRATOR,
  });
  clock.advance(60_000);
  await orchestrator.claim({ jobId: SEED_JOB_IDS[0], actor: ACTOR_ORCHESTRATOR });
  clock.advance(120_000);
  await orchestrator.progress({
    jobId: SEED_JOB_IDS[0],
    percent: 50,
    note: 'mid-run checkpoint: netting rules replayed',
    actor: ACTOR_ORCHESTRATOR,
  });
  clock.advance(180_000);
  await orchestrator.complete({
    jobId: SEED_JOB_IDS[0],
    result: {
      summary: 'Reconciliation evaluation passed on the seeded close set.',
      nettingAccuracy: 0.997,
      casesEvaluated: 48,
    },
    actor: ACTOR_ORCHESTRATOR,
  });

  // Job 2: the failure path — queued → running → failed (terminal).
  await orchestrator.submit({
    definition: verificationDefinition,
    input: { caseId: 'case-review-invoices', evidenceDigest: SEED_DIGESTS.evidenceTrajectory },
    correlationId: toCorrelationId('console-seed-verify-0001'),
    idempotencyKey: toIdempotencyKey('console-seed-verify-0001'),
    jobId: SEED_JOB_IDS[1],
    actor: ACTOR_ORCHESTRATOR,
  });
  clock.advance(30_000);
  await orchestrator.claim({ jobId: SEED_JOB_IDS[1], actor: ACTOR_ORCHESTRATOR });
  clock.advance(45_000);
  await orchestrator.fail({
    jobId: SEED_JOB_IDS[1],
    errorClass: 'verification-mismatch',
    message: 'balance proof does not match the netted total on invoice INV-2291',
    actor: ACTOR_ORCHESTRATOR,
  });

  // Job 3: freshly submitted, still queued.
  await orchestrator.submit({
    definition: evaluationDefinition,
    input: { caseId: 'case-load-review-latency', capabilityId: 'load-analysis' },
    correlationId: toCorrelationId('console-seed-eval-0002'),
    idempotencyKey: toIdempotencyKey('console-seed-eval-0002'),
    jobId: SEED_JOB_IDS[2],
    actor: ACTOR_ORCHESTRATOR,
  });

  return store.list();
}

// ---------------------------------------------------------------------------
// Environment run + trajectory (≥1 run with trajectory entries)
// ---------------------------------------------------------------------------

async function seedEnvironmentRun() {
  const definition = await createEnvironmentDefinition({
    identity: { namespace: SEED_TENANT, name: 'erp-close-sandbox' },
    version: '1.4.0',
    image: {
      imageKind: 'content-addressed-image',
      digest: SEED_DIGESTS.environmentImage,
      buildDigest: null,
    },
    initialState: {
      snapshot: { snapshotId: 'snapshot-close-2026-09', digest: SEED_DIGESTS.snapshot },
      snapshotSupport: 'supported',
    },
    seedPolicy: {
      reproducibility: { mode: 'deterministic', capture: null, note: null },
      seed: null,
      seedAlgorithm: null,
      reseedPolicy: 'forbidden',
      note: null,
    },
    actionSurface: {
      actions: [
        { actionId: 'read-export', description: 'Read one ERP export record.' },
        { actionId: 'propose-netting', description: 'Propose a credit-note netting decision.' },
        { actionId: 'submit-summary', description: null },
      ],
      tools: [{ toolId: 'erp-export-reader', description: null }],
    },
    observationSurface: {
      observations: [
        { observationId: 'obs-stdout', channel: 'stdout', description: null },
        { observationId: 'obs-balance-file', channel: 'files', description: null },
      ],
    },
    resourceLimits: { cpuMillis: 2000, memoryMiB: 2048, wallClockSeconds: 5400 },
    networkPolicy: { egress: 'default-deny' },
    filesystemPolicy: {
      writeMode: 'declared-mounts-only',
      mounts: [
        { mountPath: '/workspace', access: 'read-write', source: 'workspace' },
        { mountPath: '/task-inputs', access: 'read-only', source: 'initial-state' },
        { mountPath: '/evidence', access: 'read-write', source: 'evidence' },
      ],
    },
    secretPolicy: { isolation: 'isolation-boundary' },
    timeLimits: { startupSeconds: 60, cleanupGraceSeconds: 30, deadlineBehavior: 'grace-then-stop' },
    resetSemantics: { mode: 'recreate', checkpoint: null, cleanup: 'destroy' },
    checkpointSemantics: { supported: false, triggers: [], retention: null },
    evidenceOutputs: {
      outputs: [
        {
          outputId: 'ev-trajectory',
          kind: 'trajectory',
          addressing: 'content-addressed',
          description: null,
        },
        {
          outputId: 'ev-balance-proof',
          kind: 'artifacts',
          addressing: 'content-addressed',
          description: null,
        },
      ],
    },
    evaluationHooks: {
      evaluators: [
        {
          hookId: 'eval-reconciliation-accuracy',
          role: 'evaluator',
          phase: 'post-run',
          invocationSchema: 'arena:schema/demo/evaluation-run@1.0.0',
          description: null,
        },
      ],
      verifiers: [
        {
          hookId: 'verif-balance-proof',
          role: 'verifier',
          phase: 'on-evidence',
          invocationSchema: 'arena:schema/demo/verification-check@1.0.0',
          description: null,
        },
      ],
    },
  });

  const address = toRunAddress({
    taskVersion: { taskId: 'task-reconcile-invoices', version: '1.0.0' },
    environmentVersion: {
      namespace: SEED_TENANT,
      name: 'erp-close-sandbox',
      version: '1.4.0',
      digest: definition.digest,
    },
    runId: SEED_RUN_ID,
    initialSnapshotDigest: SEED_DIGESTS.snapshot,
    trajectoryDigest: SEED_DIGESTS.trajectory,
    evidenceDigests: [SEED_DIGESTS.evidenceOne, SEED_DIGESTS.evidenceTwo],
  });

  return { definition, address };
}

/** The trajectory steps of the seeded run (console reference data). */
export function seedTrajectorySteps() {
  return [
    {
      sequence: 1,
      at: '2026-10-03T09:01:00.000Z',
      actor: 'demo/invoicing-agent@3.2.1',
      action: 'read-export: invoices/2026-09/partial-payments.csv (48 records)',
      observation: 'Two partially paid invoices with open credit notes detected.',
    },
    {
      sequence: 2,
      at: '2026-10-03T09:04:00.000Z',
      actor: 'demo/invoicing-agent@3.2.1',
      action: 'propose-netting: INV-2291 + credit note CN-0117',
      observation: 'Netting proposal recorded; expected balance matches the ERP export.',
      evidenceDigest: SEED_DIGESTS.evidenceOne,
    },
    {
      sequence: 3,
      at: '2026-10-03T09:07:00.000Z',
      actor: 'demo/invoicing-agent@3.2.1',
      action: 'propose-netting: INV-2302 + credit note CN-0119',
      observation: 'Netting proposal recorded; expected balance matches the ERP export.',
    },
    {
      sequence: 4,
      at: '2026-10-03T09:10:00.000Z',
      actor: 'demo/invoicing-agent@3.2.1',
      action: 'submit-summary: monthly close netting summary',
      observation: 'Summary submitted with 48 evaluated records and 2 netting decisions.',
      evidenceDigest: SEED_DIGESTS.evidenceTwo,
    },
  ];
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

/**
 * Build the seeded reference corpus (deterministic: two builds are
 * byte-identical). The returned corpus is DEEP-FROZEN via
 * @arena/control-ui's freezeCorpus — the console can never mutate domain
 * state through it (gate 7).
 *
 * @returns {Promise<import('../../../../packages/control-ui/src/index.ts').ConsoleCorpus>} the frozen corpus
 */
export async function buildConsoleCorpus() {
  const [cases, bodies, substrates, jobs, run] = await Promise.all([
    seedCases(),
    seedBodies(),
    seedSubstrates(),
    seedJobs(),
    seedEnvironmentRun(),
  ]);

  const steps = seedTrajectorySteps();
  const corpus = {
    cases,
    bodies,
    substrates,
    jobs,
    runs: [run],
    trajectories: { [run.address.runId]: steps },
  };
  return freezeCorpus(corpus);
}
