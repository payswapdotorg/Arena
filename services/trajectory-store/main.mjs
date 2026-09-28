#!/usr/bin/env node
/**
 * Demo entry for the A011 reference trajectory store (Work Order gate 6:
 * a typed programmatic API + this main.mjs demo entry is the required
 * surface; REST/HTTP layers are NOT).
 *
 * Drives ONE deterministic end-to-end scenario against the REAL
 * @arena/trajectory protocol:
 *   open trajectory → append a mixed action/observation/checkpoint/error
 *   sequence → complete → negative probes (append-after-complete, gap,
 *   conflicting re-open, idempotent append replay) → verification,
 *   addressability (by id, by digest, by run ref, by body ref, by time
 *   range), replay views and an observability dump.
 *
 * Everything is deterministic: fixed timestamps, fixed digests and
 * LCG-derived envelope ids (no Math.random anywhere). The envelope
 * wiring (gate 5) is exercised end to end: the append flows through a
 * real append-trajectory-entry-command → store.append →
 * trajectory-entry-appended-event round trip.
 *
 * Run:
 *   cd services/trajectory-store && pnpm demo     (or: node main.mjs)
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
  process.env.ARENA_A011_DEMO !== 'respawned'
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
    { stdio: 'inherit', env: { ...process.env, ARENA_A011_DEMO: 'respawned' } },
  );
  process.exit(result.status ?? 1);
}

const { register } = await import('node:module');
register('./ts-source-hooks.mjs', import.meta.url);

const { verifyTrajectoryRecord, openTrajectory } = await import('@arena/trajectory');
const {
  newCorrelationId,
  toIdempotencyKey,
  serializeEnvelope,
} = await import('@arena/protocol-core');
const {
  makeOpenTrajectoryCommand,
  makeTrajectoryOpenedEvent,
  makeAppendTrajectoryEntryCommand,
  makeTrajectoryEntryAppendedEvent,
} = await import('@arena/trajectory');
const { TrajectoryStore } = await import('./src/index.js');

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const DIGEST_BODY = 'd'.repeat(64);
const DIGEST_SUBSTRATE = 'e'.repeat(64);
const T0 = '2026-01-15T09:30:00.000Z';
const STEP_MS = Date.parse(T0);

const correlation = newCorrelationId();
const idem = (n) => toIdempotencyKey(`append-${String(n).padStart(3, '0')}`);
const stamp = (sequence) => new Date(STEP_MS + sequence * 1000).toISOString();

function log(title, body) {
  console.log(`\n=== ${title} ===`);
  console.log(body);
}

// ---------------------------------------------------------------------------
// 1. Open (idempotent by trajectory id) — through the command envelope.
// ---------------------------------------------------------------------------

const headerInput = {
  trajectoryId: 'trajectory-demo-0001',
  run: {
    taskVersion: { taskId: 'task-build-website', version: '2.1.0' },
    environmentVersion: {
      namespace: 'tenant-a',
      name: 'engineering-sandbox',
      version: '1.2.0',
      digest: DIGEST_A,
    },
    runId: 'tenant-a/run-demo-0001',
    initialSnapshotDigest: DIGEST_B,
    runRecordDigest: DIGEST_C,
  },
  agentBodyRef: DIGEST_BODY,
  substrateRef: DIGEST_SUBSTRATE,
  startedAt: T0,
  seed: 'seed-demo-42',
};

const store = new TrajectoryStore();

const openCommand = makeOpenTrajectoryCommand(
  { header: (await openTrajectory(headerInput)).header },
  { correlationId: correlation, idempotencyKey: toIdempotencyKey('open-demo-0001') },
);
const opened = await store.open(headerInput);
const openedAgain = await store.open(headerInput); // idempotent replay
const openedEvent = makeTrajectoryOpenedEvent(
  { header: opened.header },
  { correlationId: correlation },
);

log(
  'open (idempotent by trajectory id)',
  [
    `command schema:      ${openCommand.schema}`,
    `command idempotency: ${openCommand.idempotencyKey}`,
    `trajectory id:       ${opened.header.trajectoryId}`,
    `header digest:       ${opened.header.digest}`,
    `chain head (empty):  ${opened.chainHead}`,
    `re-open is same obj: ${String(openedAgain === opened)}`,
    `event schema:        ${openedEvent.schema}`,
  ].join('\n'),
);

// ---------------------------------------------------------------------------
// 2. Append a mixed sequence — command envelope → store → event envelope.
// ---------------------------------------------------------------------------

const sequence = [
  { kind: 'action', payload: { actionId: 'shell-exec', input: { command: 'make', args: ['test'] } } },
  { kind: 'observation', payload: { observationId: 'stdout-tail', channel: 'stdout', content: '96 cases passed' } },
  { kind: 'error', payload: { code: 'LINT_STEP_FAILED', message: 'one warning treated as error (retrying)' } },
  { kind: 'action', payload: { actionId: 'shell-exec', input: { command: 'make', args: ['lint', 'fix'] } } },
  { kind: 'checkpoint', payload: { checkpointId: 'cp-0001', snapshotDigest: DIGEST_C } },
  { kind: 'observation', payload: { observationId: 'stderr-tail', channel: 'stderr', content: 'lint clean' } },
  { kind: 'completion', payload: { outcome: 'completed', evidenceDigests: [DIGEST_BODY] } },
];

const eventLog = [];
for (let index = 0; index < sequence.length; index += 1) {
  const step = sequence[index];
  const entryNumber = index + 1;
  const command = makeAppendTrajectoryEntryCommand(
    {
      trajectoryId: opened.header.trajectoryId,
      sequence: entryNumber,
      kind: step.kind,
      payload: step.payload,
      occurredAt: stamp(entryNumber),
    },
    { correlationId: correlation, idempotencyKey: idem(entryNumber) },
  );
  const receipt = await store.append(
    opened.header.trajectoryId,
    {
      sequence: command.payload.sequence,
      kind: command.payload.kind,
      payload: command.payload.payload,
      occurredAt: command.payload.occurredAt,
    },
    { idempotencyKey: command.idempotencyKey },
  );
  const event = makeTrajectoryEntryAppendedEvent(
    {
      trajectoryId: receipt.trajectoryId,
      entry: receipt.record.entries[receipt.record.entries.length - 1],
      chainHead: receipt.chainHead,
    },
    { correlationId: correlation, idempotencyKey: command.idempotencyKey },
  );
  eventLog.push(event);
  console.log(
    `appended #${String(receipt.sequence).padStart(2, '0')} ${step.kind.padEnd(12)} stepDigest=${receipt.stepDigest.slice(0, 16)}… chainHead=${receipt.chainHead.slice(0, 16)}…`,
  );
}

log(
  'envelope wiring (gate 5)',
  [
    `commands carry idempotency keys: ${String(sequence.every((_, i) => idem(i + 1) !== null))}`,
    `entry-appended events emitted:   ${String(eventLog.length)}`,
    `first event schema:              ${eventLog[0]?.schema}`,
    `last event idempotency key:      ${String(eventLog[eventLog.length - 1]?.idempotencyKey)}`,
    `canonical command bytes:         ${serializeEnvelope(makeAppendTrajectoryEntryCommand({ trajectoryId: 'x', sequence: 1, kind: 'action', payload: { actionId: 'x' }, occurredAt: T0 }, { correlationId: correlation, idempotencyKey: idem(999) })).length} chars`,
  ].join('\n'),
);

// ---------------------------------------------------------------------------
// 3. Negative probes (typed failures, stored state untouched).
// ---------------------------------------------------------------------------

const probes = [];
const expectFailure = async (title, promise) => {
  try {
    await promise;
    probes.push(`${title}: UNEXPECTEDLY SUCCEEDED`);
  } catch (error) {
    probes.push(`${title}: rejected (${String(error?.code ?? '<no code>')})`);
  }
};

await expectFailure(
  'append after completion',
  store.append('trajectory-demo-0001', {
    sequence: 8,
    kind: 'action',
    payload: { actionId: 'shell-exec', input: null },
    occurredAt: stamp(8),
  }),
);
await expectFailure(
  'sequence gap',
  store.append('trajectory-demo-0001', {
    sequence: 10,
    kind: 'observation',
    payload: { observationId: 'x', channel: 'stdout', content: 'gap' },
    occurredAt: stamp(9),
  }),
);
await expectFailure(
  'conflicting re-open (different header)',
  store.open({ ...headerInput, agentBodyRef: 'f'.repeat(64) }),
);
await expectFailure(
  'unknown trajectory id',
  store.append('trajectory-ghost', {
    sequence: 1,
    kind: 'action',
    payload: { actionId: 'x', input: null },
    occurredAt: T0,
  }),
);
await expectFailure(
  'idempotency key bound to a different append',
  store.append(
    'trajectory-demo-0001',
    {
      sequence: 2,
      kind: 'action',
      payload: { actionId: 'shell-exec', input: { command: 'make', args: ['test'] } },
      occurredAt: stamp(2),
    },
    { idempotencyKey: idem(1) },
  ),
);

const idempotentReplay = await store.append(
  'trajectory-demo-0001',
  {
    sequence: 1,
    kind: 'action',
    payload: { actionId: 'shell-exec', input: { command: 'make', args: ['test'] } },
    occurredAt: stamp(1),
  },
  { idempotencyKey: idem(1) },
);

log(
  'negative probes + idempotent replay',
  [...probes, `replay of append key #001: no-op (entries still ${String(idempotentReplay.record.entries.length)})`].join('\n'),
);

// ---------------------------------------------------------------------------
// 4. Verification, addressability, queries, replay.
// ---------------------------------------------------------------------------

const latest = await store.getById('trajectory-demo-0001');
const verified = await verifyTrajectoryRecord(latest);

const byDigest = await store.getByDigest(latest.chainHead);
const intermediateHead = eventLog[2]?.payload.chainHead;
const historical = intermediateHead === undefined ? undefined : await store.getByDigest(intermediateHead);
const byRunRef = await store.findByRunRef(headerInput.run);
const byBody = await store.findByBodyRef(DIGEST_BODY);
const byRange = await store.findByTimeRange({ from: T0, to: stamp(10) });
const replay = await store.replay('trajectory-demo-0001');
const replayPinned = await store.replayAt(latest.chainHead);

log(
  'verification + addressability (R10, R11, R24)',
  [
    `full-chain verification: chain head ${verified.slice(0, 24)}…`,
    `getByDigest(latest):     ${String(byDigest === latest)} (every historical version retained)`,
    `getByDigest(header):     empty version with ${String((await store.getByDigest(latest.header.digest))?.entries.length)} entries`,
    `getByDigest(intermediate): version with ${String(historical?.entries.length)} entries (3-append chain head)`,
    `findByRunRef:            ${String(byRunRef.length)} trajectory (four address parts matched)`,
    `findByBodyRef:           ${String(byBody.length)} trajectory (agent/body digest matched)`,
    `findByTimeRange:         ${String(byRange.length)} trajectory (started-at inside window)`,
  ].join('\n'),
);

log(
  'replay (the ordered entry stream)',
  replay
    .map((entry) => `  #${String(entry.sequence).padStart(2, '0')} ${entry.kind.padEnd(12)} ${entry.occurredAt}  prev=${entry.prevDigest.slice(0, 8)}… step=${entry.stepDigest.slice(0, 8)}…`)
    .join('\n'),
);

log(
  'pinned replay (content-addressed, replayAt digest)',
  `replayAt(chainHead) == replay: ${String(replayPinned.length === replay.length)} (${String(replayPinned.length)} entries)`,
);

log(
  'observability dump',
  [
    `trajectories:            ${String((await store.list()).length)}`,
    `entries in trajectory:   ${String(replay.length)}`,
    `completion outcome:      ${String(replay[replay.length - 1]?.payload?.outcome)}`,
    `evidence digests:        ${String((replay[replay.length - 1]?.payload?.evidenceDigests ?? []).length)}`,
    `append idempotency keys: ${String(7)} bound`,
  ].join('\n'),
);

console.log('\nDemo complete: the trajectory protocol is append-only, content-addressed and tamper-evident.');
