#!/usr/bin/env node
/**
 * Demo entry for the A013 reference verifier fabric (Work Order gate:
 * a typed programmatic API + this main.mjs demo entry is the required
 * surface; REST/HTTP layers are NOT).
 *
 * Drives ONE deterministic end-to-end scenario against the REAL
 * @arena/verification protocol and REAL A002 MaterialArtifacts:
 *   build a constraint-report artifact + a balance-proof artifact with
 *   lineage → register a constraint_check verifier + an
 *   evidence_provenance_validation verifier → wire the envelope round
 *   trip (run-verification-command → fabric.verify →
 *   verification-recorded-event) → run verifications → replay the same
 *   run idempotently → negative probes (unknown verifier, tampered
 *   evidence, missing evidence, idempotency conflict, rogue
 *   quantitative hook member) → queries (by digest, by verifier, by
 *   correlation id, by outcome, by time range) and an observability
 *   dump.
 *
 * Everything is deterministic: fixed timestamps and fixed content (no
 * Math.random anywhere).
 *
 * Run:
 *   cd services/verification && pnpm demo     (or: node main.mjs)
 *
 * The entry self-bootstraps `node --experimental-strip-types` and a
 * 20-line .js→.ts resolve hook (ts-source-hooks.mjs) so the REAL
 * workspace packages run straight from their TypeScript sources — no
 * build step, zero new dependencies. (Mirrors the A012 demo
 * entry's bootstrap verbatim.)
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
  process.env.ARENA_A013_DEMO !== 'respawned'
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
    { stdio: 'inherit', env: { ...process.env, ARENA_A013_DEMO: 'respawned' } },
  );
  process.exit(result.status ?? 1);
}

const { register } = await import('node:module');
register('./ts-source-hooks.mjs', import.meta.url);

const { createVerificationFabric } = await import('./src/index.js');
const { makeConstraintCheckVerifier, makeEvidenceProvenanceValidationVerifier } = await import('./src/index.js');
const verification = await import('@arena/verification');
const artifactProtocol = await import('@arena/artifact-protocol');
const { toCorrelationId, toIdempotencyKey } = await import('@arena/protocol-core');
const { makeRunVerificationCommand, makeVerificationRecordedEvent } = verification;

const T0 = '2026-03-02T09:00:00.000Z';
const T1 = '2026-03-02T09:00:01.000Z';
const T2 = '2026-03-02T09:00:02.000Z';
const T3 = '2026-03-02T09:00:03.000Z';

const CORR = toCorrelationId('corr-a013-demo-0001');
const IDEM = toIdempotencyKey('idem-a013-demo-0001');

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

/** A recording probe: asserts the run RECORDS the expected outcome/cause (not a rejection). */
async function recordedProbe(label, expectedOutcome, expectedCause, fn) {
  try {
    const outcome = await fn();
    if (outcome.outcome !== expectedOutcome || outcome.unknownCause?.reason !== expectedCause) {
      console.log(
        `  [NEGATIVE MISS] ${label} — expected ${expectedOutcome}/${expectedCause}, got ${outcome.outcome}/${outcome.unknownCause?.reason ?? '-'}`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `  [ok] ${label} → recorded outcome=${outcome.outcome}, cause=${outcome.unknownCause.reason}`,
      );
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : 'no-code';
    console.log(`  [UNEXPECTED REJECTION] ${label} → ${code}: ${error instanceof Error ? error.message.slice(0, 110) : String(error)}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// 1. REAL evidence: A002 MaterialArtifacts (constraint report + balance
//    proof with lineage to the ERP export snapshot)
// ---------------------------------------------------------------------------

section('1. real evidence (A002 MaterialArtifacts with lineage)');

const erpExport = await artifactProtocol.createMaterialArtifact({
  identity: { namespace: 'tenant-a', name: 'erp-export-snapshot', version: '1.4.0' },
  content: { export: 'erp-close-2026-03', invoices: 42, creditNotes: 1 },
});
const constraintReport = await artifactProtocol.createMaterialArtifact({
  identity: { namespace: 'tenant-a', name: 'reconciliation-test-report', version: '1.0.0' },
  content: {
    constraints: [
      { requirementId: 'requirement-001', satisfied: true, detail: 'reconciliation suite 12/12 green' },
    ],
  },
});
const balanceProof = await artifactProtocol.createMaterialArtifact({
  identity: { namespace: 'tenant-a', name: 'balance-proof', version: '1.0.0' },
  refs: [
    {
      namespace: erpExport.identity.namespace,
      name: erpExport.identity.name,
      version: erpExport.identity.version,
      digest: erpExport.digest,
    },
  ],
  content: {
    netted: 1180.4,
    expected: 1180.4,
    constraints: [
      { requirementId: 'requirement-002', satisfied: true, detail: 'netted total matches the ERP expected balance' },
    ],
  },
});
console.log(`  erp export digest : ${erpExport.digest}`);
console.log(`  report digest     : ${constraintReport.digest}`);
console.log(`  balance digest    : ${balanceProof.digest} (lineage → erp export)`);

// ---------------------------------------------------------------------------
// 2. Register the two reference verifiers
// ---------------------------------------------------------------------------

section('2. registry: two reference verifiers (constraint_check, evidence_provenance_validation)');

const fabric = createVerificationFabric();

const constraintDescriptor = await verification.createVerifierDescriptor({
  verifierId: 'verifier-reconciliation-constraints',
  version: '1.0.0',
  method: 'constraint_check',
  requiredEvidence: [
    {
      requirementId: 'requirement-001',
      evidenceKind: 'test-report',
      claim: 'the reconciliation test suite passes against the pinned environment',
      artifact: null,
      requiredProducer: null,
    },
    {
      requirementId: 'requirement-002',
      evidenceKind: 'balance-proof',
      claim: 'the netted total matches the ERP expected balance',
      artifact: null,
      requiredProducer: 'erp-close-sandbox',
    },
  ],
  outcomeSemantics: {
    pass: 'both the constraint report and the balance proof are verified and satisfied',
    fail: 'verified evidence contradicts the reconciliation requirements',
    unknown: 'at least one requirement cannot be decided (missing, unverifiable or inconclusive)',
  },
  reproducibility: { policy: 'deterministic', seed: null, parameters: null },
  inputSchema: { namespace: 'verification', name: 'run-verification-command', version: '1.0.0' },
  outputSchema: { namespace: 'verification', name: 'verification-record', version: '1.0.0' },
  provenance: { authoredBy: 'arena-reference-fabric', submittedAt: T0, notes: 'A013 demo' },
});
const provenanceDescriptor = await verification.createVerifierDescriptor({
  verifierId: 'verifier-evidence-provenance',
  version: '1.0.0',
  method: 'evidence_provenance_validation',
  requiredEvidence: [
    {
      requirementId: 'requirement-001',
      evidenceKind: 'balance-proof',
      claim: 'the balance proof carries auditable provenance from the sandbox ERP',
      artifact: null,
      requiredProducer: 'erp-close-sandbox',
    },
  ],
  outcomeSemantics: {
    pass: 'the balance proof is produced by the pinned principal with resolvable lineage',
    fail: 'the balance provenance contradicts the pin',
    unknown: 'the provenance cannot be decided (missing, unverifiable or lineage-free)',
  },
  reproducibility: { policy: 'deterministic', seed: null, parameters: null },
  inputSchema: { namespace: 'verification', name: 'run-verification-command', version: '1.0.0' },
  outputSchema: { namespace: 'verification', name: 'verification-record', version: '1.0.0' },
  provenance: { authoredBy: 'arena-reference-fabric', submittedAt: T0, notes: 'A013 demo' },
});

fabric.registry.registerVerifier(constraintDescriptor, makeConstraintCheckVerifier());
fabric.registry.registerVerifier(provenanceDescriptor, makeEvidenceProvenanceValidationVerifier());
fabric.putArtifact(erpExport);
fabric.putArtifact(constraintReport);
fabric.putArtifact(balanceProof);
console.log(`  constraint_check            : ${constraintDescriptor.digest}`);
console.log(`  evidence_provenance_valid...: ${provenanceDescriptor.digest}`);
console.log(`  registry: ${fabric.registry.listVerifiers().length} verifiers, ${fabric.listArtifacts().length} artifacts`);

const evidenceBundle = [
  {
    evidenceKind: 'test-report',
    artifact: {
      namespace: constraintReport.identity.namespace,
      name: constraintReport.identity.name,
      version: constraintReport.identity.version,
      digest: constraintReport.digest,
    },
    provenance: { producedBy: 'arena-reference-fabric', producedAt: T0, notes: 'CI run' },
  },
  {
    evidenceKind: 'balance-proof',
    artifact: {
      namespace: balanceProof.identity.namespace,
      name: balanceProof.identity.name,
      version: balanceProof.identity.version,
      digest: balanceProof.digest,
    },
    provenance: { producedBy: 'erp-close-sandbox', producedAt: T1, notes: null },
  },
];

// ---------------------------------------------------------------------------
// 3. Envelope round trip: command → verify → event
// ---------------------------------------------------------------------------

section('3. envelope wiring: run-verification-command → verify → verification-recorded-event');

const command = makeRunVerificationCommand(
  { verifierRef: constraintDescriptor.digest, evidence: evidenceBundle },
  { correlationId: CORR, idempotencyKey: IDEM },
);
console.log(`  command schema   : ${command.schema}`);
console.log(`  command idem key : ${command.idempotencyKey}`);

const record = await fabric.verify(constraintDescriptor.digest, evidenceBundle, {
  correlationId: command.correlationId,
  idempotencyKey: command.idempotencyKey,
  startedAt: T1,
  finishedAt: T2,
});
const event = makeVerificationRecordedEvent(
  { record },
  { correlationId: CORR, idempotencyKey: IDEM },
);
console.log(`  event schema     : ${event.schema}`);
console.log(`  event carries    : record ${event.payload.record.digest}`);

// ---------------------------------------------------------------------------
// 4. The outcome: evidence support + derived pass/fail/unknown
// ---------------------------------------------------------------------------

section('4. the outcome (pass | fail | unknown ONLY — lock rule 7)');

console.log(`  record digest    : ${record.digest}`);
for (const entry of record.evidenceSupport) {
  console.log(
    `  requirement ${entry.requirementId}: ${entry.status} evidence=${entry.evidenceDigest?.slice(0, 12) ?? '-'} notes=${(entry.notes ?? '').slice(0, 58)}`,
  );
}
console.log(`  outcome          : ${record.outcome}`);
console.log(`  unknown cause    : ${record.unknownCause === null ? 'null (decided)' : `${record.unknownCause.reason} — ${record.unknownCause.detail}`}`);
console.log(`  correlation id   : ${record.correlationId}`);
console.log(`  idempotency key  : ${record.idempotencyKey}`);
console.log(`  input digest     : ${record.inputDigest}`);
console.log(`  frozen           : ${Object.isFrozen(record)}`);

// ---------------------------------------------------------------------------
// 5. Idempotent replay + the provenance verifier
// ---------------------------------------------------------------------------

section('5. idempotent replay + the provenance-validation verifier');

const replayed = await fabric.verify(constraintDescriptor.digest, evidenceBundle, {
  correlationId: command.correlationId,
  idempotencyKey: command.idempotencyKey,
  startedAt: T1,
  finishedAt: T2,
});
console.log(`  idempotent replay: ${replayed.digest === record.digest ? 'SAME record (no-op)' : 'DIVERGED!'}`);

const provenanceRecord = await fabric.verify(
  provenanceDescriptor.digest,
  [evidenceBundle[1]],
  {
    correlationId: toCorrelationId('corr-a013-demo-0002'),
    idempotencyKey: toIdempotencyKey('idem-a013-demo-0002'),
    startedAt: T2,
    finishedAt: T3,
  },
);
console.log(`  provenance record: ${provenanceRecord.digest}`);
console.log(`  provenance outcome: ${provenanceRecord.outcome} (${provenanceRecord.evidenceSupport[0].status})`);

// ---------------------------------------------------------------------------
// 6. Negative probes
// ---------------------------------------------------------------------------

section('6. negative probes (fail-closed fabric)');

await probe('unknown verifier digest', () =>
  fabric.verify('0'.repeat(64), evidenceBundle, {
    correlationId: CORR,
    idempotencyKey: toIdempotencyKey('idem-probe-1'),
  }),
);
await recordedProbe('tampered evidence (present-unverified → unknown)', 'unknown', 'unverifiable-provenance', async () => {
  const tampered = {
    ...constraintReport,
    content: { constraints: [{ requirementId: 'requirement-001', satisfied: true, detail: 'FORGED' }] },
  };
  const tamperingFabric = createVerificationFabric();
  tamperingFabric.registry.registerVerifier(constraintDescriptor, makeConstraintCheckVerifier());
  tamperingFabric.putArtifact(tampered);
  tamperingFabric.putArtifact(balanceProof);
  return tamperingFabric.verify(constraintDescriptor.digest, evidenceBundle, {
    correlationId: CORR,
    idempotencyKey: IDEM,
    startedAt: T1,
    finishedAt: T2,
  });
});
await recordedProbe('missing evidence (unknown / missing-evidence, never fail-by-default)', 'unknown', 'missing-evidence', async () => {
  const missingFabric = createVerificationFabric();
  missingFabric.registry.registerVerifier(constraintDescriptor, makeConstraintCheckVerifier());
  missingFabric.putArtifact(constraintReport);
  missingFabric.putArtifact(balanceProof);
  return missingFabric.verify(constraintDescriptor.digest, [evidenceBundle[0]], {
    correlationId: CORR,
    idempotencyKey: toIdempotencyKey('idem-probe-3'),
    startedAt: T1,
    finishedAt: T2,
  });
});
await probe('idempotency conflict (same key, different evidence)', () =>
  fabric.verify(constraintDescriptor.digest, [evidenceBundle[0]], {
    correlationId: command.correlationId,
    idempotencyKey: command.idempotencyKey,
  }),
);
await probe('unknown method in descriptor (closed enum)', () =>
  verification.createVerifierDescriptor({
    verifierId: 'verifier-bad-method',
    version: '1.0.0',
    method: 'vibe-check',
    requiredEvidence: [
      { requirementId: 'requirement-001', evidenceKind: 'test-report', claim: 'x', artifact: null, requiredProducer: null },
    ],
    outcomeSemantics: { pass: 'p', fail: 'f', unknown: 'u' },
    reproducibility: { policy: 'deterministic', seed: null, parameters: null },
    inputSchema: { namespace: 'verification', name: 'run-verification-command', version: '1.0.0' },
    outputSchema: { namespace: 'verification', name: 'verification-record', version: '1.0.0' },
    provenance: { authoredBy: 'arena-reference-fabric', submittedAt: T0, notes: null },
  }),
);
await probe('rogue hook member (quantitative output rejected by construction)', async () => {
  const rogueFabric = createVerificationFabric();
  rogueFabric.registry.registerVerifier(constraintDescriptor, () => [
    { requirementId: 'requirement-001', verdict: 'supported', notes: null, score: 0.87 },
  ]);
  rogueFabric.putArtifact(constraintReport);
  rogueFabric.putArtifact(balanceProof);
  await rogueFabric.verify(constraintDescriptor.digest, evidenceBundle, {
    correlationId: CORR,
    idempotencyKey: toIdempotencyKey('idem-probe-6'),
  });
});
await probe('identity conflict (same id+version, different bytes)', async () => {
  const mutated = await verification.createVerifierDescriptor({
    verifierId: constraintDescriptor.verifierId,
    version: constraintDescriptor.version,
    method: 'constraint_check',
    requiredEvidence: constraintDescriptor.requiredEvidence.map((entry) => ({
      requirementId: entry.requirementId,
      evidenceKind: entry.evidenceKind,
      claim: entry.claim,
      artifact: entry.artifact === null ? null : { ...entry.artifact },
      requiredProducer: entry.requiredProducer,
    })),
    outcomeSemantics: { ...constraintDescriptor.outcomeSemantics, pass: 'mutated declaration' },
    reproducibility: { ...constraintDescriptor.reproducibility },
    inputSchema: { ...constraintDescriptor.inputSchema },
    outputSchema: { ...constraintDescriptor.outputSchema },
    provenance: { ...constraintDescriptor.provenance },
  });
  fabric.registry.registerVerifier(mutated, makeConstraintCheckVerifier());
});

// ---------------------------------------------------------------------------
// 7. Queries + observability
// ---------------------------------------------------------------------------

section('7. queries (by digest / verifier / correlation / outcome / time range) + observability');

console.log(`  records by verifier (constraints): ${fabric.listRecordsByVerifier(constraintDescriptor.digest).length}`);
console.log(`  records by verifier (provenance) : ${fabric.listRecordsByVerifier(provenanceDescriptor.digest).length}`);
console.log(`  records by correlation CORR      : ${fabric.listRecordsByCorrelation(CORR).length}`);
console.log(`  records outcome=pass             : ${fabric.listRecordsByOutcome('pass').length}`);
console.log(`  records in [T1, T2]              : ${fabric.listRecordsByTimeRange({ from: T1, to: T2 }).length}`);
console.log(`  ledger size                      : ${fabric.listRecords().length}`);
console.log(`  lookup by record digest          : ${fabric.getRecord(record.digest) !== undefined ? 'found' : 'MISSING!'}`);

section('observability dump');
for (const r of fabric.listRecords()) {
  console.log(
    `  ${r.digest.slice(0, 12)}… verifier=${r.provenance.executedBy} outcome=${r.outcome} cause=${r.unknownCause?.reason ?? '-'} finished=${r.finishedAt}`,
  );
}

line();
console.log(
  `A013 demo complete — ${fabric.listRecords().length} record(s), all probes closed, zero external runtime dependencies.`,
);
line();
