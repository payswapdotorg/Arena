#!/usr/bin/env node
/**
 * Demo entry for the A023 reference certification fabric (Work Order
 * gate: a typed programmatic API + this main.mjs demo entry is the
 * required surface; REST/HTTP layers are NOT).
 *
 * Drives ONE deterministic end-to-end scenario against the REAL
 * @arena/certification protocol and REAL guard-valid sibling evidence:
 *   register a CertificationSuite (verification + evaluation +
 *   compatibility stages) → put A013/A012/A022 evidence into the
 *   stores → wire the envelope round trip (run-certification-command →
 *   fabric.certify → certification-recorded-event) → run the
 *   certification → replay the run idempotently → supersede it with a
 *   recertification → revoke it → negative probes (unknown suite,
 *   unresolvable evidence, idempotency conflict, cross-tenant
 *   compatibility evidence) → queries + observability dump.
 *
 * Everything is deterministic: fixed timestamps and fixed content (no
 * Math.random anywhere).
 *
 * Run:
 *   cd services/certification && pnpm demo     (or: node main.mjs)
 *
 * The entry self-bootstraps `node --experimental-strip-types` and the
 * 20-line .js→.ts resolve hook (ts-source-hooks.mjs) so the REAL
 * workspace packages run straight from their TypeScript sources — no
 * build step, zero new dependencies. (Mirrors the A012/A013 demo
 * entries' bootstrap verbatim.)
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
  process.env.ARENA_A023_DEMO !== 'respawned'
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
    { stdio: 'inherit', env: { ...process.env, ARENA_A023_DEMO: 'respawned' } },
  );
  process.exit(result.status ?? 1);
}

const { register } = await import('node:module');
register('./ts-source-hooks.mjs', import.meta.url);

const { CertificationFabric, CertificationService } = await import('./src/index.js');
const certification = await import('@arena/certification');
const { toCorrelationId, toIdempotencyKey } = await import('@arena/protocol-core');

const T0 = '2026-09-29T10:00:00.000Z';
const T1 = '2026-09-29T10:05:00.000Z';
const T2 = '2026-09-29T10:10:00.000Z';
const T3 = '2026-09-29T10:15:00.000Z';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const DIGEST_D = 'd'.repeat(64);
const DIGEST_E = 'e'.repeat(64);

const CORR = toCorrelationId('corr-a023-demo-0001');
const IDEM = toIdempotencyKey('idem-a023-demo-0001');

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
    console.log(
      `  [ok] ${label} → ${code}: ${error instanceof Error ? error.message.slice(0, 110) : String(error)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 1. The suite (composition of evaluation + verification + compatibility)
// ---------------------------------------------------------------------------

section('1. register the CertificationSuite (content-addressed, stage-composed)');

const schema = { namespace: 'certification', name: 'certification-record', version: '1.0.0' };
const suite = await certification.createCertificationSuite({
  suiteId: 'structural-certification',
  version: '2.1.0',
  levelGrant: 'CERTIFIED',
  stages: [
    {
      stageId: 'verify-constraints',
      kind: 'verification',
      evaluatorRef: null,
      criteriaRef: null,
      verifierRef: DIGEST_C,
      requiredTestSuites: [],
      datasetRef: null,
      environmentRequirement: null,
      runtimeRequirement: null,
    },
    {
      stageId: 'judge-design',
      kind: 'evaluation',
      evaluatorRef: DIGEST_B,
      criteriaRef: DIGEST_C,
      verifierRef: null,
      requiredTestSuites: [],
      datasetRef: null,
      environmentRequirement: null,
      runtimeRequirement: null,
    },
    {
      stageId: 'body-substrate',
      kind: 'compatibility',
      evaluatorRef: null,
      criteriaRef: null,
      verifierRef: null,
      requiredTestSuites: [],
      datasetRef: null,
      environmentRequirement: null,
      runtimeRequirement: null,
    },
  ],
  constraints: [],
  limitations: null,
  supersedes: null,
  inputSchema: schema,
  outputSchema: schema,
  provenance: { authoredBy: 'arena-architect', submittedAt: T0, notes: null },
});
console.log(`  suite ${suite.suiteId}@${suite.version} digest=${suite.digest.slice(0, 16)}…`);
console.log(`  stages: ${suite.stages.map((stage) => `${stage.stageId}(${stage.kind})`).join(' → ')}`);

const fabric = new CertificationFabric();
fabric.registry.registerSuite(suite);
console.log('  registered (idempotent by digest)');

// ---------------------------------------------------------------------------
// 2. The subject (the composition under test — all five scope components)
// ---------------------------------------------------------------------------

section('2. build the composition under test (B/V × M × E × R)');

const subject = certification.createCertificationSubject({
  bodyVersionRef: {
    tenant: 'acme',
    name: 'structural-engineer-body',
    version: '1.4.0',
    digest: DIGEST_A,
  },
  substrateRef: { substrateId: 'substrate-x', substrateVersion: '6.0.1', digest: DIGEST_B },
  environmentRef: {
    environmentId: 'structural-env',
    environmentVersion: '3.2.0',
    constraints: ['offline', 'sandboxed-tools'],
  },
  runtimeProfile: {
    runtimeId: 'arena-runtime',
    runtimeVersion: '2.1.0',
    configuration: { timeoutMs: 30000 },
  },
  possessionRef: null,
  tenantId: 'tenant-acme',
  workspaceId: 'ws-main',
});
console.log(`  subject key: ${certification.certificationSubjectKey(subject)}`);

// ---------------------------------------------------------------------------
// 3. Evidence (guard-valid A013/A012/A022 records)
// ---------------------------------------------------------------------------

section('3. put sibling-protocol evidence into the stores');

const verificationRecord = {
  recordVersion: 1,
  verifierRef: DIGEST_C,
  evidence: [
    {
      evidenceKind: 'constraint-report',
      artifact: { namespace: 'acme', name: 'constraint-report', version: '1.0.0', digest: DIGEST_D },
      provenance: { producedBy: 'arena-runner', producedAt: T0, notes: null },
    },
  ],
  evidenceSupport: [
    { requirementId: 'req-1', status: 'present-supported', evidenceDigest: DIGEST_D, notes: null },
  ],
  outcome: 'pass',
  unknownCause: null,
  correlationId: 'corr-verification-demo',
  idempotencyKey: 'idem-verification-demo',
  inputDigest: DIGEST_E,
  startedAt: T0,
  finishedAt: T1,
  provenance: { executedBy: 'constraint-verifier', recordedAt: T1, notes: null },
  digest: DIGEST_A,
};
const evaluationRecord = {
  recordVersion: 1,
  evaluatorRef: DIGEST_B,
  caseRef: DIGEST_D,
  trajectoryRef: DIGEST_E,
  criteriaRef: DIGEST_C,
  seed: null,
  verdicts: [{ criterionId: 'criterion-1', score: 0.95, judgment: null, notes: null }],
  aggregate: { score: 0.95, outcome: 'meets-criteria' },
  confidence: 0.9,
  limitations: null,
  startedAt: T0,
  finishedAt: T1,
  provenance: { executedBy: 'reference-evaluator', recordedAt: T1, notes: null },
  digest: DIGEST_B,
};
const compatibilityRecord = {
  recordVersion: 1,
  recordDigest: DIGEST_C,
  bodyVersionRef: `acme/structural-engineer-body@1.4.0#${DIGEST_A}`,
  substrateRef: `substrate-x@6.0.1#${DIGEST_B}`,
  evaluatedAt: T1,
  verdict: 'compatible',
  reasons: [],
  details: {},
  tenantId: 'tenant-acme',
  workspaceId: 'ws-main',
};

const evidenceRefs = [
  fabric.putVerificationRecord(verificationRecord),
  fabric.putEvaluationRecord(evaluationRecord),
  fabric.putCompatibilityRecord(compatibilityRecord),
];
console.log(`  evidence stored: ${JSON.stringify(fabric.evidenceCounts())}`);

// ---------------------------------------------------------------------------
// 4. The envelope round trip: command → certify → event
// ---------------------------------------------------------------------------

section('4. run the certification through the envelope round trip');

const service = new CertificationService({ fabric });
const command = service.makeCommand(
  suite.digest,
  subject,
  evidenceRefs,
  CORR,
  IDEM,
);
const outcome = await service.handleRunCertificationCommand(JSON.stringify(command));
const record = outcome.record;
console.log(`  verdict: ${record.verdict}   level: ${record.grantedLevel}`);
console.log(`  record digest: ${record.digest.slice(0, 16)}…`);
console.log(`  statement: ${record.statement.text.slice(0, 160)}…`);

const consumed = service.readRecordedEvent(outcome.serializedEvent);
console.log(`  consumer strict-parsed the event: record ${consumed.digest === record.digest ? 'matches' : 'MISMATCH'}`);

// ---------------------------------------------------------------------------
// 5. Idempotent replay
// ---------------------------------------------------------------------------

section('5. replay the same run idempotently');

const replay = await fabric.certify(suite.digest, subject, evidenceRefs, {
  correlationId: CORR,
  idempotencyKey: IDEM,
  startedAt: T0,
  finishedAt: T1,
});
console.log(`  replay digest identical: ${replay.digest === record.digest}`);

// ---------------------------------------------------------------------------
// 6. Supersession (recertification) + revocation
// ---------------------------------------------------------------------------

section('6. supersede (recertify), then revoke');

const second = await fabric.certify(suite.digest, subject, evidenceRefs, {
  correlationId: toCorrelationId('corr-a023-demo-0002'),
  idempotencyKey: toIdempotencyKey('idem-a023-demo-0002'),
  startedAt: T2,
  finishedAt: T3,
  supersedes: record.digest,
});
console.log(`  first record status: ${fabric.effectiveStatus(record.digest)}`);
console.log(`  current certification: ${fabric.currentCertification(subject)?.digest.slice(0, 16)}…`);

await fabric.revoke(second.digest, 'suite deprecated upstream', {
  correlationId: 'corr-a023-demo-0003',
  idempotencyKey: 'idem-a023-demo-0003',
  startedAt: T3,
});
console.log(`  second record status: ${fabric.effectiveStatus(second.digest)}`);
console.log(`  current certification after revocation: ${fabric.currentCertification(subject) ?? '(none — the claim is history)'}`);

// ---------------------------------------------------------------------------
// 7. Negative probes (fail-closed everywhere)
// ---------------------------------------------------------------------------

section('7. negative probes');

await probe('unknown suite digest', () =>
  fabric.certify('f'.repeat(64), subject, evidenceRefs, {
    correlationId: 'corr-neg-1',
    idempotencyKey: 'idem-neg-1',
  }),
);
await probe('unresolvable evidence ref (never silently ignored)', () =>
  fabric.certify(suite.digest, subject, ['0'.repeat(64)], {
    correlationId: 'corr-neg-2',
    idempotencyKey: 'idem-neg-2',
  }),
);
await probe('idempotency conflict (same key, different tuple)', () =>
  fabric.certify(suite.digest, subject, evidenceRefs.slice(0, 1), {
    correlationId: CORR,
    idempotencyKey: IDEM,
  }),
);
{
  const fabricLocal = new CertificationFabric();
  fabricLocal.registry.registerSuite(suite);
  fabricLocal.putVerificationRecord(verificationRecord);
  fabricLocal.putEvaluationRecord(evaluationRecord);
  fabricLocal.putCompatibilityRecord({ ...compatibilityRecord, tenantId: 'tenant-evil' });
  const result = await fabricLocal.certify(suite.digest, subject, [
    DIGEST_A,
    DIGEST_B,
    DIGEST_C,
  ], {
    correlationId: 'corr-neg-4',
    idempotencyKey: 'idem-neg-4',
  });
  if (result.verdict === 'satisfied') {
    console.log('  [NEGATIVE MISS] cross-tenant compatibility evidence certified!');
    process.exitCode = 1;
  } else {
    console.log(
      `  [ok] cross-tenant compatibility evidence cannot certify → fail-closed verdict ${result.verdict}, cause ${result.unknownCause?.reason}`,
    );
  }
}
await probe('invalid evidence rejected by the stores', () =>
  fabric.putVerificationRecord({ junk: true }),
);

// ---------------------------------------------------------------------------
// 8. Observability dump
// ---------------------------------------------------------------------------

section('8. observability');

console.log(`  ledger: ${fabric.listRecords().length} record(s)`);
for (const entry of fabric.listRecords()) {
  const status = fabric.effectiveStatus(entry.digest) ?? 'n/a';
  console.log(
    `    ${entry.kind.padEnd(18)} ${entry.digest.slice(0, 12)}… verdict=${String(entry.verdict)} status=${status}`,
  );
}
console.log(`  by tenant (tenant-acme): ${fabric.listRecordsByTenant('tenant-acme').length}`);
console.log(`  by suite: ${fabric.listRecordsBySuite(suite.digest).length}`);
console.log('\nDONE — A023 reference certification fabric demo complete.');
