#!/usr/bin/env node
/**
 * Demo entry for the A012 reference evaluator fabric (Work Order gate 6:
 * a typed programmatic API + this main.mjs demo entry is the required
 * surface; REST/HTTP layers are NOT).
 *
 * Drives ONE deterministic end-to-end scenario against the REAL
 * @arena/evaluation protocol and REAL A005/A011 judged objects:
 *   build a real CapabilityCase + TrajectoryRecord → register criteria
 *   and two evaluators (deterministic-test + rubric) → wire the gate-5
 *   envelope round trip (run-evaluation-command → fabric.evaluate →
 *   evaluation-recorded-event) → run seeded evaluations → replay the
 *   same run idempotently → negative probes (unknown evaluator, seeded
 *   evaluator without a seed, input-contract violation, idempotency
 *   conflict) → queries (by digest, by case, by trajectory, by time
 *   range) and an observability dump.
 *
 * Everything is deterministic: fixed timestamps, fixed digests and
 * seeded derivations (no Math.random anywhere).
 *
 * Run:
 *   cd services/evaluation && pnpm demo     (or: node main.mjs)
 *
 * The entry self-bootstraps `node --experimental-strip-types` and a
 * 20-line .js→.ts resolve hook (ts-source-hooks.mjs) so the REAL
 * workspace packages run straight from their TypeScript sources — no
 * build step, zero new dependencies. (Mirrors
 * services/trajectory-store's main.mjs verbatim.)
 */

// ---------------------------------------------------------------------------
// Bootstrap: run under `node --experimental-strip-types` with the
// workspace's .js→.ts source-remap hook registered (zero dependencies —
// the workspace exports TypeScript sources, so this is what lets the
// demo run the REAL packages straight from src/). Relaunch once with
// the flag when invoked plainly (`node main.mjs` / `pnpm demo`).
// ---------------------------------------------------------------------------

if (
  !process.execArgv.some((arg) => arg.includes('strip-types')) &&
  process.env.ARENA_A012_DEMO !== 'respawned'
) {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '--',
      import.meta.filename,
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit', env: { ...process.env, ARENA_A012_DEMO: 'respawned' } },
  );
  process.exit(result.status ?? 1);
}

const { register } = await import('node:module');
register('./ts-source-hooks.mjs', import.meta.url);

const { createEvaluationFabric } = await import('./src/index.js');
const { makeDeterministicTestEvaluator, makeRubricEvaluator } = await import('./src/index.js');
const evaluation = await import('@arena/evaluation');
const { createCapabilityCase } = await import('@arena/capability-case');
const { appendTrajectoryEntry, openTrajectory } = await import('@arena/trajectory');
const { makeRunEvaluationCommand, makeEvaluationRecordedEvent } = evaluation;
const { toCorrelationId, toIdempotencyKey } = await import('@arena/protocol-core');

const T0 = '2026-03-01T12:00:00.000Z';
const T1 = '2026-03-01T12:00:01.000Z';
const T2 = '2026-03-01T12:00:02.000Z';
const T3 = '2026-03-01T12:00:03.000Z';

const CORR = toCorrelationId('corr-a012-demo-0001');
const IDEM = toIdempotencyKey('idem-a012-demo-0001');

function line() {
  console.log('='.repeat(72));
}
function section(title) {
  console.log(`\n${'-'.repeat(72)}\n${title}\n${'-'.repeat(72)}`);
}
async function probe(label, fn) {
  try {
    await fn();
    console.log(`  [NEGATIVE MISS] ${label} — expected a rejection!`);
    process.exitCode = 1;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : 'no-code';
    console.log(`  [ok] ${label} → ${code}: ${error instanceof Error ? error.message.slice(0, 110) : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// 1. REAL judged objects: A005 CapabilityCase + A011 TrajectoryRecord
// ---------------------------------------------------------------------------

section('1. real judged objects (A005 CapabilityCase + A011 TrajectoryRecord)');

const caseRecord = await createCapabilityCase({
  identity: { tenant: 'tenant-a', caseId: 'case-evaluation-demo' },
  version: '1.0.0',
  source: { type: 'user', tenant: 'tenant-a', principalId: 'analyst-1' },
  problemStatement:
    'The invoicing agent fails to reconcile credit notes against partially paid invoices.',
  targetCapability: {
    kind: 'capability',
    id: 'invoice-reconciliation',
    version: '1.2.0',
    digest: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
  },
  domain: {
    kind: 'domain',
    id: 'accounts-payable',
    version: '1.0.0',
    digest: 'b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
  },
  context: 'Production tenant workload; monthly close; ERP exports partial payments.',
  observedFailure: {
    summary:
      'Agent marked a partially paid invoice as fully settled, ignoring an open credit note.',
    observedAt: T0,
    reproduction: 'Run the monthly close with one partially paid invoice and one open credit note.',
  },
  evidence: [
    {
      digest: 'c1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      description: 'Trajectory export of the failing close run.',
    },
  ],
  unknowns: ['Whether the ERP ever nets credit notes on export'],
  desiredOutcome:
    'The agent nets credit notes against partially paid invoices and explains the netting.',
  expertRequirements: {
    competencies: [
      {
        kind: 'expert-competency',
        id: 'accounts-payable-reconciliation',
        version: '1.0.0',
        digest: 'd1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      },
    ],
    qualifications: ['certified-accountant'],
  },
  environmentRequirements: {
    environments: [
      {
        namespace: 'tenant-a',
        name: 'erp-close-sandbox',
        version: '1.4.0',
        digest: 'e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      },
    ],
    constraints: ['No live ERP writes'],
  },
  taskRequirements: {
    objectives: ['Reconcile credit notes against partially paid invoices'],
    constraints: ['Use only the ERP export snapshot'],
    allowedTools: [
      {
        namespace: 'tenant-a',
        name: 'erp-export-reader',
        version: '1.0.0',
        digest: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      },
    ],
    forbiddenShortcuts: ['Assume full settlement without checking credit notes'],
    successConditions: ['Netted total matches the ERP expected balance'],
    evidenceCriteria: ['Annotated trajectory with the netting decision'],
    difficulty: 'standard',
  },
  evaluationRequirements: {
    evaluators: [
      { kind: 'evaluator', id: 'reconciliation-accuracy', version: '1.0.0', digest: '4'.repeat(64) },
    ],
    criteria: ['Netting accuracy >= 99% on the evaluation set'],
  },
  verificationRequirements: {
    verifiers: [
      { kind: 'verifier', id: 'erp-balance-check', version: '1.0.0', digest: '5'.repeat(64) },
    ],
    evidenceStandards: ['Balance proof exported from the sandbox ERP'],
  },
  currentBody: { tenant: 'tenant-a', name: 'invoicing-agent', version: '3.2.1', digest: '4'.repeat(64) },
  currentSubstrate: {
    adapterId: 'neutral-adapter',
    modelFamily: 'reasoning-family',
    modelId: 'large-reasoner',
    modelRevision: 'rev-2',
    contentDigest: '5'.repeat(64),
  },
  provenance: { recordDigest: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2' },
  priority: 'high',
  risk: 'moderate',
  createdAt: T0,
});
console.log(`  case digest      : ${caseRecord.digest}`);

let trajectoryRecord = await openTrajectory({
  trajectoryId: 'trajectory-evaluation-demo',
  run: {
    taskVersion: { taskId: 'task-monthly-close', version: '2.1.0' },
    environmentVersion: {
      namespace: 'tenant-a',
      name: 'erp-close-sandbox',
      version: '1.4.0',
      digest: 'e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    },
    runId: 'tenant-a/run-evaluation-demo',
    initialSnapshotDigest: '2'.repeat(64),
    runRecordDigest: '3'.repeat(64),
  },
  agentBodyRef: '4'.repeat(64),
  substrateRef: '5'.repeat(64),
  startedAt: T0,
  seed: 'seed-1234',
});
trajectoryRecord = await appendTrajectoryEntry(trajectoryRecord, {
  sequence: 1,
  kind: 'action',
  payload: { actionId: 'read-erp-export', input: { command: 'net', args: ['credit-notes'] } },
  occurredAt: T0,
});
trajectoryRecord = await appendTrajectoryEntry(trajectoryRecord, {
  sequence: 2,
  kind: 'observation',
  payload: {
    observationId: 'stdout-tail',
    channel: 'stdout',
    content: 'netted 1 credit note against invoice INV-0042',
  },
  occurredAt: T1,
});
trajectoryRecord = await appendTrajectoryEntry(trajectoryRecord, {
  sequence: 3,
  kind: 'completion',
  payload: { outcome: 'completed', evidenceDigests: ['2'.repeat(64)] },
  occurredAt: T2,
});
console.log(`  trajectory digest: ${trajectoryRecord.chainHead} (3 entries, completed)`);

// ---------------------------------------------------------------------------
// 2. Register criteria + the two reference evaluators
// ---------------------------------------------------------------------------

section('2. registry: criteria + two reference evaluators (deterministic-test, rubric)');

const fabric = createEvaluationFabric();

const criteria = await evaluation.createEvaluationCriteria({
  criteriaId: 'criteria-invoice-reconciliation',
  version: '1.0.0',
  entries: [
    {
      criterionId: 'criterion-001',
      weight: 2,
      description: 'credit notes are netted against partially paid invoices',
      targetRef: caseRecord.digest,
    },
    {
      criterionId: 'criterion-002',
      weight: 1,
      description: 'the netting decision is explained in the summary',
      targetRef: trajectoryRecord.chainHead,
    },
    {
      criterionId: 'criterion-003',
      weight: 1,
      description: 'no live ERP writes occur during the run',
      targetRef: trajectoryRecord.chainHead,
    },
  ],
  aggregation: 'weighted-sum',
  thresholds: { passAt: 0.75 },
});
console.log(`  criteria digest  : ${criteria.digest} (${criteria.aggregation}, passAt ${criteria.thresholds.passAt})`);

const deterministicDescriptor = await evaluation.createEvaluatorDescriptor({
  evaluatorId: 'eval-reconciliation-accuracy',
  version: '1.0.0',
  kind: 'deterministic-test',
  inputs: {
    caseRef: caseRecord.digest,
    trajectoryRef: trajectoryRecord.chainHead,
    bodyRef: '4'.repeat(64),
    substrateRef: '5'.repeat(64),
  },
  criteriaRef: criteria.digest,
  outputSchema: { namespace: 'evaluation', name: 'evaluation-record', version: '1.0.0' },
  reproducibility: { deterministic: true, seeded: true, requiresHuman: false },
  confidence: 0.9,
  limitations: 'reference evaluator; judgments are seeded derivations, not human review',
  provenance: { authoredBy: 'arena-reference-fabric', submittedAt: T0, notes: 'A012 demo' },
});
const rubricDescriptor = await evaluation.createEvaluatorDescriptor({
  evaluatorId: 'eval-reconciliation-rubric',
  version: '1.0.0',
  kind: 'rubric',
  inputs: {
    caseRef: caseRecord.digest,
    trajectoryRef: trajectoryRecord.chainHead,
    bodyRef: null,
    substrateRef: null,
  },
  criteriaRef: criteria.digest,
  outputSchema: { namespace: 'evaluation', name: 'evaluation-record', version: '1.0.0' },
  reproducibility: { deterministic: true, seeded: true, requiresHuman: false },
  confidence: 0.8,
  limitations: 'reference rubric evaluator; levels are seeded derivations',
  provenance: { authoredBy: 'arena-reference-fabric', submittedAt: T0, notes: 'A012 demo' },
});

fabric.registry.registerCriteria(criteria);
fabric.registry.registerEvaluator(deterministicDescriptor, makeDeterministicTestEvaluator());
fabric.registry.registerEvaluator(rubricDescriptor, makeRubricEvaluator());
console.log(`  deterministic-test: ${deterministicDescriptor.digest}`);
console.log(`  rubric            : ${rubricDescriptor.digest}`);
console.log(`  registry: ${fabric.registry.listEvaluators().length} evaluators, ${fabric.registry.listCriteria().length} criteria`);

// ---------------------------------------------------------------------------
// 3. Gate-5 envelope round trip: command → evaluate → event
// ---------------------------------------------------------------------------

section('3. envelope wiring (gate 5): run-evaluation-command → evaluate → evaluation-recorded-event');

const command = makeRunEvaluationCommand(
  {
    evaluatorRef: deterministicDescriptor.digest,
    caseRef: caseRecord.digest,
    trajectoryRef: trajectoryRecord.chainHead,
    seed: 'seed-1234',
  },
  { correlationId: CORR, idempotencyKey: IDEM },
);
console.log(`  command schema   : ${command.schema}`);
console.log(`  command idem key : ${command.idempotencyKey}`);

const record = await fabric.evaluate(
  command.payload.evaluatorRef,
  caseRecord,
  trajectoryRecord,
  {
    seed: command.payload.seed,
    idempotencyKey: command.idempotencyKey,
    startedAt: T1,
    finishedAt: T2,
  },
);
const event = makeEvaluationRecordedEvent(
  { record },
  { correlationId: CORR, idempotencyKey: IDEM },
);
console.log(`  event schema     : ${event.schema}`);
console.log(`  event carries    : record ${event.payload.record.digest}`);

// ---------------------------------------------------------------------------
// 4. The judgment: verdicts + aggregate
// ---------------------------------------------------------------------------

section('4. the judgment (scores/judgments ONLY — lock rule 7)');

console.log(`  record digest    : ${record.digest}`);
for (const verdict of record.verdicts) {
  console.log(
    `  verdict ${verdict.criterionId}: score=${verdict.score} judgment=${verdict.judgment ?? '-'} notes=${(verdict.notes ?? '').slice(0, 60)}…`,
  );
}
console.log(
  `  aggregate        : score=${record.aggregate.score} outcome=${record.aggregate.outcome} (policy ${criteria.aggregation}, passAt ${criteria.thresholds.passAt})`,
);
console.log(`  confidence       : ${record.confidence}`);
console.log(`  frozen           : ${Object.isFrozen(record)}`);

// ---------------------------------------------------------------------------
// 5. Idempotent replay + rubric run
// ---------------------------------------------------------------------------

section('5. idempotent replay + the rubric evaluator');

const replayed = await fabric.evaluate(
  command.payload.evaluatorRef,
  caseRecord,
  trajectoryRecord,
  {
    seed: command.payload.seed,
    idempotencyKey: command.idempotencyKey,
    startedAt: T1,
    finishedAt: T2,
  },
);
console.log(`  idempotent replay: ${replayed.digest === record.digest ? 'SAME record (no-op)' : 'DIVERGED!'}`);

const rubricRecord = await fabric.evaluate(rubricDescriptor.digest, caseRecord, trajectoryRecord, {
  seed: 'seed-5678',
  startedAt: T2,
  finishedAt: T3,
});
console.log(`  rubric record    : ${rubricRecord.digest}`);
for (const verdict of rubricRecord.verdicts) {
  console.log(`  rubric ${verdict.criterionId}: score=${verdict.score} judgment=${verdict.judgment}`);
}
console.log(`  rubric aggregate : score=${rubricRecord.aggregate.score} outcome=${rubricRecord.aggregate.outcome}`);

// ---------------------------------------------------------------------------
// 6. Negative probes
// ---------------------------------------------------------------------------

section('6. negative probes (fail-closed fabric)');

await probe('unknown evaluator digest', () =>
  fabric.evaluate('0'.repeat(64), caseRecord, trajectoryRecord, { seed: 'seed-1234' }),
);
await probe('seeded evaluator without a seed', () =>
  fabric.evaluate(deterministicDescriptor.digest, caseRecord, trajectoryRecord, {
    startedAt: T1,
    finishedAt: T2,
  }),
);
await probe('structurally invalid case object', () =>
  fabric.evaluate(deterministicDescriptor.digest, { digest: 'x' }, trajectoryRecord, {
    seed: 'seed-1234',
  }),
);
await probe('idempotency conflict (same key, different seed)', () =>
  fabric.evaluate(deterministicDescriptor.digest, caseRecord, trajectoryRecord, {
    idempotencyKey: command.idempotencyKey,
    seed: 'seed-9999',
    startedAt: T1,
    finishedAt: T2,
  }),
);
await probe('unknown kind in descriptor (closed enum)', () =>
  evaluation.createEvaluatorDescriptor({
    evaluatorId: 'eval-bad-kind',
    version: '1.0.0',
    kind: 'heuristic',
    inputs: {
      caseRef: caseRecord.digest,
      trajectoryRef: trajectoryRecord.chainHead,
      bodyRef: null,
      substrateRef: null,
    },
    criteriaRef: criteria.digest,
    outputSchema: { namespace: 'evaluation', name: 'evaluation-record', version: '1.0.0' },
    reproducibility: { deterministic: true, seeded: true, requiresHuman: false },
    confidence: 0.9,
    limitations: 'x',
    provenance: { authoredBy: 'arena-reference-fabric', submittedAt: T0, notes: null },
  }),
);
await probe('identity conflict (same id+version, different bytes)', async () => {
  const mutated = await evaluation.createEvaluatorDescriptor({
    evaluatorId: deterministicDescriptor.evaluatorId,
    version: deterministicDescriptor.version,
    kind: 'deterministic-test',
    inputs: { ...deterministicDescriptor.inputs },
    criteriaRef: deterministicDescriptor.criteriaRef,
    outputSchema: { ...deterministicDescriptor.outputSchema },
    reproducibility: { ...deterministicDescriptor.reproducibility },
    confidence: 0.5,
    limitations: deterministicDescriptor.limitations,
    provenance: { ...deterministicDescriptor.provenance },
  });
  fabric.registry.registerEvaluator(mutated, makeDeterministicTestEvaluator());
});

// ---------------------------------------------------------------------------
// 7. Queries + observability
// ---------------------------------------------------------------------------

section('7. queries (by digest / case / trajectory / time range) + observability');

console.log(`  records by case         : ${fabric.listRecordsByCase(caseRecord.digest).length}`);
console.log(`  records by trajectory   : ${fabric.listRecordsByTrajectory(trajectoryRecord.chainHead).length}`);
console.log(`  records in [T1, T2]     : ${fabric.listRecordsByTimeRange({ from: T1, to: T2 }).length}`);
console.log(`  records in [T3, T3]     : ${fabric.listRecordsByTimeRange({ from: T3, to: T3 }).length}`);
console.log(`  ledger size             : ${fabric.listRecords().length}`);
console.log(`  lookup by record digest : ${fabric.getRecord(record.digest) !== undefined ? 'found' : 'MISSING!'}`);

section('observability dump');
for (const r of fabric.listRecords()) {
  console.log(
    `  ${r.digest.slice(0, 12)}… evaluator=${r.provenance.executedBy} outcome=${r.aggregate.outcome} score=${r.aggregate.score} seed=${r.seed ?? 'null'} finished=${r.finishedAt}`,
  );
}

line();
console.log(
  `A012 demo complete — ${fabric.listRecords().length} record(s), all probes closed, zero external runtime dependencies.`,
);
line();
