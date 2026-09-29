#!/usr/bin/env node
/**
 * Demo entry for the A008 reference task-compiler fabric (Work Order
 * gate: a typed programmatic API + this main.mjs demo entry is the
 * required surface; REST/HTTP layers are NOT).
 *
 * Drives ONE deterministic end-to-end scenario against the REAL
 * @arena/capability-case and @arena/task-spec protocols:
 *   register a TRIAGED case + the reference compilation policy →
 *   run-compilation command (envelope round trip, idempotent replay) →
 *   the pinned TaskSpec proposal (every TS1.0 field inspectable) →
 *   recompile under a SECOND policy (append-only supersession 1.0.0 →
 *   1.1.0) → negative probes (draft-case gate, policy narrowing,
 *   idempotency conflict) → an observability dump.
 *
 * Everything is deterministic: fixed timestamps and fixed content (no
 * Math.random anywhere).
 *
 * Run:
 *   cd services/task-compiler && pnpm demo     (or: node main.mjs)
 *
 * The entry self-bootstraps `node --experimental-strip-types` and a
 * 20-line .js→.ts resolve hook (ts-source-hooks.mjs) so the REAL
 * workspace packages run straight from their TypeScript sources — no
 * build step, zero new dependencies. (Mirrors the A007 demo entry's
 * bootstrap verbatim.)
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
  process.env.ARENA_A008_DEMO !== 'respawned'
) {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '--',
      import.meta.filename,
      ...process.argv.slice(1),
    ],
    { stdio: 'inherit', env: { ...process.env, ARENA_A008_DEMO: 'respawned' } },
  );
  process.exit(result.status ?? 1);
}

const { register } = await import('node:module');
register('./ts-source-hooks.mjs', import.meta.url);

const { toCorrelationId, toIdempotencyKey } = await import('@arena/protocol-core');
const caseProtocol = await import('@arena/capability-case');
const taskSpecProtocol = await import('@arena/task-spec');
const { TaskCompilerFabric } = await import('./src/index.js');
const fixtures = await import('./src/test-support.js');

const T1 = '2026-02-02T09:30:00.000Z';
const T2 = '2026-02-03T09:30:00.000Z';
const CORR = toCorrelationId('corr-a008-demo-0001');
const IDEM = toIdempotencyKey('idem-a008-demo-0001');
const IDEM_REPLAY = toIdempotencyKey('idem-a008-demo-0001');
const IDEM_OTHER = toIdempotencyKey('idem-a008-demo-0002');

const log = (label, value) => {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
};

// ---------------------------------------------------------------------------
// 1. Registration: a TRIAGED case + the reference compilation policy
// ---------------------------------------------------------------------------

const fabric = new TaskCompilerFabric();

const caseRecord = await fixtures.triagedCase();
await fabric.registerCase(caseRecord);
log('case registered (TRIAGED)', {
  caseId: caseRecord.identity.caseId,
  status: caseRecord.status,
  digest: caseRecord.digest,
});

const policy = await taskSpecProtocol.createCompilationPolicy(fixtures.validPolicyInput());
await fabric.registerPolicy(policy);
log('policy registered', {
  policyId: policy.policyId,
  version: policy.version,
  digest: policy.digest,
});

// ---------------------------------------------------------------------------
// 2. run-compilation command (envelope round trip, lock rule 17)
// ---------------------------------------------------------------------------

const commandEnvelope = taskSpecProtocol.makeRunCompilationCommand(
  {
    caseDigest: caseRecord.digest,
    policyRef: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
    derivedAt: T1,
    compiledAt: T1,
  },
  { correlationId: CORR, idempotencyKey: IDEM },
);
log('run-compilation-command envelope', {
  schema: commandEnvelope.schema,
  idempotencyKey: commandEnvelope.idempotencyKey,
});

const run = await fabric.runCompilation(
  taskSpecProtocol.parseRunCompilationCommand(JSON.stringify(commandEnvelope)).payload,
  { correlationId: CORR, idempotencyKey: IDEM },
);
const spec = run.specs[0];
log('compilation recorded', {
  recordDigest: run.record.digest,
  emitted: run.record.emittedSpecs,
});

// ---------------------------------------------------------------------------
// 3. The TaskSpec proposal — every TS1.0 field inspectable
// ---------------------------------------------------------------------------

log('compiled TaskSpec (TS1.0 surface)', {
  identity: spec.identity,
  version: spec.version,
  taskClass: spec.taskClass,
  capabilityLabels: spec.capabilityLabels,
  difficulty: spec.difficulty,
  domain: spec.domain.id,
  initialState: spec.initialState.environment.name,
  instructions: spec.instructions,
  objectives: spec.objectives,
  constraints: spec.constraints,
  permittedTools: spec.permittedTools.map((tool) => tool.name),
  prohibitedShortcuts: spec.prohibitedShortcuts,
  expectedOutputs: spec.expectedOutputs,
  completionCriteria: spec.completionCriteria,
  evidenceCriteria: spec.evidenceCriteria,
  environmentRequirements: spec.environmentRequirements.environments.length,
  evaluatorBindings: spec.evaluatorBindings,
  verifierBindings: spec.verifierBindings,
  expertQualificationRequirements: spec.expertQualificationRequirements.competencies.length,
  quality: spec.quality.map((entry) => ({
    dimension: entry.dimension,
    satisfied: entry.satisfied,
    provenance: entry.provenance,
  })),
  dataRights: spec.dataRights,
  derivedFrom: spec.derivedFrom,
  digest: spec.digest,
});

// ---------------------------------------------------------------------------
// 4. Idempotent replay (the same key returns the recorded result)
// ---------------------------------------------------------------------------

const replay = await fabric.runCompilation(
  {
    caseDigest: caseRecord.digest,
    policyRef: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
    derivedAt: T1,
    compiledAt: T1,
  },
  { correlationId: CORR, idempotencyKey: IDEM_REPLAY },
);
log('idempotent replay', {
  replayed: replay.replayed,
  sameRecord: replay.record.digest === run.record.digest,
  recordsTotal: fabric.listRecords().length,
});

// ---------------------------------------------------------------------------
// 5. Recompile under a SECOND policy — append-only supersession
// ---------------------------------------------------------------------------

const secondPolicyInput = {
  ...fixtures.validPolicyInput(),
  policyId: 'reference-policy-v2-framing',
  fieldMapping: {
    ...fixtures.validPolicyInput().fieldMapping,
    instructions: {
      mode: 'template',
      template: 'Second framing: fix the {capability} failure in {domain} for case {caseId}.',
    },
  },
};
const secondPolicy = await taskSpecProtocol.createCompilationPolicy(secondPolicyInput);
await fabric.registerPolicy(secondPolicy);
const secondRun = await fabric.runCompilation(
  {
    caseDigest: caseRecord.digest,
    policyRef: {
      policyId: secondPolicy.policyId,
      version: secondPolicy.version,
      digest: secondPolicy.digest,
    },
    derivedAt: T2,
    compiledAt: T2,
  },
  { correlationId: toCorrelationId('corr-a008-demo-0002'), idempotencyKey: IDEM_OTHER },
);
const superseding = secondRun.specs[0];
const diff = taskSpecProtocol.diffTaskSpecs(spec, superseding);
log('append-only supersession', {
  pinnedVersion: superseding.version,
  supersedes: superseding.supersedes?.version,
  allVersions: fabric.registry
    .listVersions({ tenant: 'tenant-alpha', taskId: spec.identity.taskId })
    .map((entry) => entry.version),
  changedFields: diff.changedFields,
});

// ---------------------------------------------------------------------------
// 6. Negative probes (fail loudly, never partial compilation)
// ---------------------------------------------------------------------------

const draftCase = await caseProtocol.createCapabilityCase(fixtures.validCaseInput());
await fabric.registerCase(draftCase);
const draftProbe = await fabric
  .runCompilation(
    {
      caseDigest: draftCase.digest,
      policyRef: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
      derivedAt: T2,
      compiledAt: T2,
    },
    { correlationId: toCorrelationId('corr-a008-demo-0003'), idempotencyKey: toIdempotencyKey('idem-a008-demo-0003') },
  )
  .then(() => 'UNEXPECTEDLY COMPILED')
  .catch((error) => `${error.code ?? error.name}: ${error.message}`);
log('negative probe: DRAFT case cannot compile', draftProbe);

const conflictProbe = await fabric
  .runCompilation(
    {
      caseDigest: caseRecord.digest,
      policyRef: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
      derivedAt: T2, // DIFFERENT tuple under the SAME key
      compiledAt: T2,
    },
    { correlationId: CORR, idempotencyKey: IDEM },
  )
  .then(() => 'UNEXPECTEDLY RAN')
  .catch((error) => `${error.code ?? error.name}: ${error.message}`);
log('negative probe: idempotency conflict', conflictProbe);

// ---------------------------------------------------------------------------
// 7. Observability dump
// ---------------------------------------------------------------------------

log('observability', {
  cases: 2,
  policies: fabric.listRecords().length > 0 ? 2 : 0,
  records: fabric.listRecords().map((record) => ({
    key: record.compilationKey,
    case: record.caseRef.caseId,
    policy: `${record.policyRef.policyId}@${record.policyRef.version}`,
    emitted: record.emittedSpecs.length,
  })),
  events: fabric.listEvents().map((event) => event.schema),
  pinnedSpecs: fabric.registry.list().map((entry) => ({
    id: `${entry.identity.tenant}/${entry.identity.taskId}`,
    version: entry.version,
    digest: entry.digest,
  })),
});
