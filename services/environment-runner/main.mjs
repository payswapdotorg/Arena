#!/usr/bin/env node
/**
 * Demo entry for the A010 reference environment runner (Work Order
 * gate 10: a typed programmatic API + this main.mjs demo entry is the
 * required surface; REST/HTTP layers are NOT).
 *
 * Drives ONE deterministic end-to-end run against a real A009
 * EnvironmentDefinition:
 *   register environment → submit run (admitted) → start → advance ×3
 *   → checkpoint → advance → restore → complete → cleanup,
 * followed by two negative probes (over-quota admission rejection and
 * a cross-tenant reference) and a full observability dump.
 *
 * Everything is deterministic: a ManualClock, counter-based
 * idempotency keys and an LCG-derived envelope-id factory (no
 * Math.random anywhere).
 *
 * Run:
 *   cd services/environment-runner && pnpm demo     (or: node main.mjs)
 *
 * The entry self-bootstraps `node --experimental-strip-types` and a
 * 20-line .js→.ts resolve hook (ts-source-hooks.mjs) so the REAL
 * workspace packages run straight from their TypeScript sources — no
 * build step, zero new dependencies.
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
  process.env.ARENA_A010_DEMO !== 'respawned'
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
    { stdio: 'inherit', env: { ...process.env, ARENA_A010_DEMO: 'respawned' } },
  );
  process.exit(result.status ?? 1);
}

const { register } = await import('node:module');
register('./ts-source-hooks.mjs', import.meta.url);

const { createEnvironmentDefinition } = await import('@arena/environment-protocol');
const { newCorrelationId, toIdempotencyKey } = await import('@arena/protocol-core');
const {
  SeededLcg,
  makeSubmitRunCommand,
  makeStartRunCommand,
  makeAdvanceRunCommand,
  makeCheckpointRunCommand,
  makeRestoreRunCommand,
  makeCompleteRunCommand,
  makeCleanupRunCommand,
} = await import('@arena/environment-runtime');
const {
  EnvironmentRunner,
  InMemoryEnvironmentRegistry,
  InMemoryEventSink,
  InMemoryRunRecordStore,
  ManualClock,
} = await import('./src/index.js');

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const START_MS = Date.parse('2026-01-15T09:30:00.000Z');

/** Deterministic envelope-id factory (LCG-driven UUIDv4 shapes). */
function lcgEnvelopeIds(seed) {
  const rng = new SeededLcg(seed);
  return () => {
    const hex = (n) => n.toString(16).padStart(8, '0').slice(-8);
    const s =
      hex(rng.nextUint32()) +
      hex(rng.nextUint32()) +
      hex(rng.nextUint32()) +
      hex(rng.nextUint32());
    const variant = (Number.parseInt(s.slice(16, 17), 16) & 0x3) | 0x8;
    return [
      s.slice(0, 8),
      s.slice(8, 12),
      '4' + s.slice(13, 16),
      variant.toString(16) + s.slice(17, 20),
      s.slice(20, 32),
    ].join('-');
  };
}

const clock = new ManualClock(START_MS);
const runner = new EnvironmentRunner({
  clock,
  environments: new InMemoryEnvironmentRegistry(),
  records: new InMemoryRunRecordStore(),
  sink: new InMemoryEventSink(),
  newEnvelopeId: lcgEnvelopeIds(20260115),
});

// Deterministic command contexts (counter-based idempotency keys).
let commandCounter = 0;
function commandContext() {
  commandCounter += 1;
  return {
    correlationId: newCorrelationId(),
    idempotencyKey: toIdempotencyKey(`demo-command-${commandCounter}`),
  };
}

// ---------------------------------------------------------------------------
// 1. Register a real A009 EnvironmentDefinition (content-addressed).
// ---------------------------------------------------------------------------

const definition = await createEnvironmentDefinition({
  identity: { namespace: 'tenant-a', name: 'engineering-sandbox' },
  version: '1.2.0',
  image: { imageKind: 'content-addressed-image', digest: DIGEST_A, buildDigest: null },
  initialState: {
    snapshot: { snapshotId: 'snapshot-initial', digest: DIGEST_B },
    snapshotSupport: 'supported',
  },
  seedPolicy: {
    reproducibility: {
      mode: 'nondeterministic',
      capture: {
        seed: 'the run seed drives the LCG step derivation',
        versions: 'environment-runtime 1.0.0',
        externalInputs: 'none - the reference simulation is closed',
        timingContext: 'injected manual clock',
      },
      note: 'seeded LCG reference simulation',
    },
    seed: 'demo-seed-42',
    seedAlgorithm: 'lcg-32',
    reseedPolicy: 'forbidden',
  },
  actionSurface: { actions: [{ actionId: 'compile', description: 'compile the workload' }] },
  observationSurface: {
    observations: [{ observationId: 'build-log', channel: 'stdout', description: 'build log' }],
  },
  resourceLimits: { cpuMillis: 4000, memoryMiB: 1024, wallClockSeconds: 30 },
  networkPolicy: {
    egress: 'default-deny',
    allows: [{ host: 'packages.example.org', port: 443, protocol: 'https' }],
  },
  filesystemPolicy: {
    writeMode: 'declared-mounts-only',
    mounts: [
      { mountPath: '/workspace', access: 'read-write', source: 'workspace' },
      { mountPath: '/run/secrets', access: 'read-only', source: 'initial-state' },
    ],
  },
  secretPolicy: {
    isolation: 'isolation-boundary',
    injectionPoints: [
      {
        secretId: 'registry-credentials',
        mountPath: '/run/secrets/registry',
        mechanism: 'file-mount',
      },
    ],
  },
  timeLimits: { startupSeconds: 10, cleanupGraceSeconds: 5, deadlineBehavior: 'hard-stop' },
  resetSemantics: { mode: 'recreate', checkpoint: null, cleanup: 'retain-evidence' },
  checkpointSemantics: { supported: true, triggers: ['manual'], retention: 10 },
  evidenceOutputs: {
    outputs: [
      {
        outputId: 'trajectory',
        kind: 'trajectory',
        addressing: 'content-addressed',
        description: 'the run event stream',
      },
    ],
  },
  evaluationHooks: {
    evaluators: [
      {
        hookId: 'evaluator-trajectory',
        role: 'evaluator',
        phase: 'post-run',
        invocationSchema: 'arena:schema/environment-runtime/run-result@1.0.0',
      },
    ],
    verifiers: [
      {
        hookId: 'verifier-evidence',
        role: 'verifier',
        phase: 'on-evidence',
        invocationSchema: 'arena:schema/environment-runtime/run-result@1.0.0',
      },
    ],
  },
});
await runner.registerEnvironment(definition);
console.log(
  `[demo] registered environment ${definition.identity.namespace}/${definition.identity.name}@${definition.version}`,
);
console.log(`[demo] environment digest: ${definition.digest}`);

// ---------------------------------------------------------------------------
// 2. Submit an admitted run (isolation envelope fits the bounds).
// ---------------------------------------------------------------------------

const declaration = {
  runKey: 'run-000042',
  tenantId: 'tenant-a',
  environment: {
    namespace: definition.identity.namespace,
    name: definition.identity.name,
    version: definition.version,
    digest: definition.digest,
  },
  jobRef: 'job-7f3a2b',
  taskVersion: { taskId: 'task-build-website', version: '2.1.0' },
  initialSnapshotDigest: DIGEST_B,
  seed: 'demo-seed-42',
  resourceEnvelope: { cpuMillis: 2000, memoryMiB: 512, wallClockSeconds: 20 },
  networkEnvelope: {
    egress: 'default-deny',
    allows: [{ host: 'packages.example.org', port: 443, protocol: 'https' }],
  },
  filesystemEnvelope: {
    writeMode: 'declared-mounts-only',
    mounts: [{ mountPath: '/workspace/src', access: 'read-write', source: 'workspace' }],
  },
  secretEnvelope: {
    isolation: 'isolation-boundary',
    injectionPoints: [
      {
        secretId: 'registry-credentials',
        mountPath: '/run/secrets/registry',
        mechanism: 'file-mount',
      },
    ],
  },
};

const submitCtx = commandContext();
const submitted = await runner.submitRun(makeSubmitRunCommand({ declaration }, submitCtx));
console.log(
  `[demo] submitted run ${submitted.record.runId} (digest ${submitted.record.digest.slice(0, 16)}…)`,
);
console.log(
  `[demo] admission: admitted=${submitted.decision.admitted} violations=${submitted.decision.violations.length}`,
);

// Idempotent re-submission returns the SAME record (lock rule 17).
const resubmitted = await runner.submitRun(
  makeSubmitRunCommand({ declaration }, submitCtx),
);
console.log(
  `[demo] idempotent re-submission returns the same record: ${resubmitted.record.digest === submitted.record.digest}`,
);

// ---------------------------------------------------------------------------
// 3. Drive the lifecycle deterministically.
// ---------------------------------------------------------------------------

const lifecycleCtx = () => ({
  correlationId: submitCtx.correlationId,
  idempotencyKey: toIdempotencyKey('demo-run-lifecycle'),
});
const target = () => ({ runId: 'tenant-a/run-000042', tenantId: 'tenant-a' });

let state = await runner.startRun(makeStartRunCommand(target(), lifecycleCtx()));
console.log(`[demo] started → ${state.status} (worldStep=${state.worldStep})`);

for (let step = 0; step < 3; step += 1) {
  clock.advance(1000);
  state = await runner.advanceRun(makeAdvanceRunCommand(target(), lifecycleCtx()));
  console.log(
    `[demo] advanced → step=${state.worldStep} elapsed=${state.worldElapsedMs}ms (${state.status})`,
  );
}

const { checkpoint } = await runner.checkpointRun(
  makeCheckpointRunCommand(target(), lifecycleCtx()),
);
console.log(
  `[demo] checkpoint #${checkpoint.sequence} @ step ${checkpoint.stepIndex} (snapshot ${checkpoint.snapshotDigest.slice(0, 16)}…)`,
);

clock.advance(1000);
state = await runner.advanceRun(makeAdvanceRunCommand(target(), lifecycleCtx()));
console.log(`[demo] advanced → step=${state.worldStep} elapsed=${state.worldElapsedMs}ms`);

state = await runner.restoreRun(
  makeRestoreRunCommand(
    {
      ...target(),
      checkpoint: {
        runId: 'tenant-a/run-000042',
        sequence: checkpoint.sequence,
        snapshotDigest: checkpoint.snapshotDigest,
      },
    },
    lifecycleCtx(),
  ),
);
console.log(
  `[demo] restored to checkpoint #${checkpoint.sequence} → worldStep=${state.worldStep} (the seed re-derives the same steps)`,
);

clock.advance(1000);
state = await runner.advanceRun(makeAdvanceRunCommand(target(), lifecycleCtx()));
console.log(`[demo] re-advanced after restore → step=${state.worldStep}`);

const { state: completed, result } = await runner.completeRun(
  makeCompleteRunCommand(target(), lifecycleCtx()),
);
console.log(`[demo] completed → ${completed.status}`);
console.log(`[demo] RunResult digest: ${result.digest.slice(0, 16)}…`);
console.log(
  `[demo] RunAddress: task=${result.runAddress.taskVersion.taskId}@${result.runAddress.taskVersion.version} trajectory=${result.runAddress.trajectoryDigest.slice(0, 16)}… evidence=${result.runAddress.evidenceDigests.length} digests`,
);

state = await runner.cleanupRun(makeCleanupRunCommand(target(), lifecycleCtx()));
console.log(`[demo] cleaned → ${state.status} (terminal, nothing may follow)`);

// ---------------------------------------------------------------------------
// 4. Negative probes: over-quota admission + cross-tenant reference.
// ---------------------------------------------------------------------------

try {
  await runner.submitRun(
    makeSubmitRunCommand(
      {
        declaration: {
          ...declaration,
          runKey: 'run-000099',
          resourceEnvelope: { cpuMillis: 9999, memoryMiB: 512, wallClockSeconds: 20 },
        },
      },
      commandContext(),
    ),
  );
  console.log('[demo] UNEXPECTED: over-quota run was admitted');
} catch (error) {
  console.log(`[demo] over-quota submission rejected: ${error.code ?? error.message}`);
}

try {
  await runner.getRun('tenant-a/run-000042', 'tenant-b');
  console.log('[demo] UNEXPECTED: cross-tenant read succeeded');
} catch (error) {
  console.log(`[demo] cross-tenant reference rejected: ${error.code ?? error.message}`);
}

// ---------------------------------------------------------------------------
// 5. Observability dump (R33): the append-only EnvironmentEventLog.
// ---------------------------------------------------------------------------

const log = await runner.eventLog();
console.log(`\n[demo] EnvironmentEventLog: ${log.entries.length} events`);
for (const envelope of log.entries) {
  const payload = envelope.payload;
  const detail =
    payload.kind === 'state-transitioned'
      ? `${payload.from} → ${payload.to} (${payload.lifecycleEvent})`
      : payload.kind === 'workload-progressed'
        ? `step ${payload.step} @ ${payload.simulatedElapsedMs}ms`
        : payload.kind === 'admission-decided'
          ? `admitted=${payload.admitted}`
          : payload.kind === 'checkpoint-recorded'
            ? `checkpoint #${payload.checkpointSequence} @ step ${payload.stepIndex}`
            : payload.kind === 'checkpoint-restored'
              ? `restored #${payload.checkpointSequence} → step ${payload.restoredStepIndex}`
              : payload.kind === 'run-result-produced'
                ? `result ${payload.resultDigest.slice(0, 12)}… (${payload.evidenceDigests.length} evidence digests)`
                : `record ${payload.recordDigest.slice(0, 12)}…`;
  console.log(
    `  #${String(payload.sequence).padStart(2, '0')} [${payload.runId}] ${payload.kind.padEnd(22)} ${detail}`,
  );
}
console.log('\n[demo] done — deterministic run of the A010 reference environment runner.');
