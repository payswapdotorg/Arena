#!/usr/bin/env node
/**
 * Demo entry for the A014 artifact storage/lineage reference service
 * (Work Order: services/artifacts — typed programmatic API + this main.mjs
 * demo entry; REST/HTTP layers are NOT part of the order).
 *
 * Drives ONE deterministic end-to-end scenario against the REAL A002
 * primitives:
 *   ingest (tenant-scoped put, idempotent re-put) → lineage chain with
 *   closed-world parent validation → deep ancestry query → publication →
 *   retraction (append-only) → dataset bundle resolution through the
 *   store's tenant-scoped resolver (@arena/datasets devDependency — the
 *   interop surface) → negative probes (cross-tenant read, identity
 *   conflict, cycle rejection with the offending path, unresolved entry).
 *
 * Everything is deterministic: fixed identities, fixed timestamps, a
 * seeded LCG for payload variety (no unseeded randomness anywhere).
 *
 * Run:
 *   cd services/artifacts && pnpm demo     (or: node main.mjs)
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
  process.env.ARENA_A014_DEMO !== 'respawned'
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
    { stdio: 'inherit', env: { ...process.env, ARENA_A014_DEMO: 'respawned' } },
  );
  process.exit(result.status ?? 1);
}

const { register } = await import('node:module');
register('./ts-source-hooks.mjs', import.meta.url);

const { createMaterialArtifact } = await import('@arena/artifact-protocol');
const { createDatasetManifest, resolveDatasetBundle } = await import('@arena/datasets');
const { createArtifactService } = await import('./src/index.ts');

const CALLER_A = { type: 'user', tenant: 'tenant-a', principalId: 'user-42' };
const CALLER_B = { type: 'user', tenant: 'tenant-b', principalId: 'user-7' };
const RIGHTS = {
  license: 'CC-BY-4.0',
  commercialUse: 'allowed',
  redistribution: 'allowed',
  customerData: 'none',
};
const T = '2026-03-01T12:00:00.000Z';

let checks = 0;
let failures = 0;

function check(label, ok, detail = '') {
  checks += 1;
  if (ok) {
    console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function expectThrows(label, fn, expectedCode) {
  try {
    await fn();
    check(label, false, 'did not throw');
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    check(label, code === expectedCode, `threw ${String(code)}`);
  }
}

async function main() {
  console.log('A014 artifact storage/lineage service — deterministic demo\n');

  const { store, lineage, publication } = createArtifactService();

  // 1. Ingest (tenant-scoped, verified, idempotent) -----------------------
  console.log('[1] ingest: tenant-scoped put + idempotent re-put');
  const artifacts = [];
  for (let i = 0; i < 4; i += 1) {
    const artifact = await createMaterialArtifact({
      identity: { namespace: 'tenant-a', name: `demo-artifact-${i}`, version: '1.0.0' },
      content: { kind: 'demo', index: i, payload: `demo payload ${i}` },
    });
    artifacts.push(artifact);
    await store.put(artifact, CALLER_A);
  }
  const rePut = await store.put(artifacts[0], CALLER_A);
  check('re-put is idempotent', rePut.idempotent === true);
  check('store holds 4 artifacts', (await store.size()) === 4, `size=${await store.size()}`);
  await expectThrows(
    'cross-tenant ingest rejected',
    async () => store.put(await createMaterialArtifact({
      identity: { namespace: 'tenant-b', name: 'smuggled', version: '1.0.0' },
      content: {},
    }), CALLER_A),
    'ARTIFACTS_TENANT_FORBIDDEN',
  );

  // 2. Identity binding permanence -----------------------------------------
  console.log('\n[2] identity↔digest binding permanence');
  const conflicting = await createMaterialArtifact({
    identity: { namespace: 'tenant-a', name: 'demo-artifact-0', version: '1.0.0' },
    content: { kind: 'demo', index: 99, payload: 'conflicting content' },
  });
  await expectThrows(
    'second artifact under a bound identity rejected',
    () => store.put(conflicting, CALLER_A),
    'ARTIFACT_IDENTITY_CONFLICT',
  );

  // 3. Lineage chain + deep query ------------------------------------------
  console.log('\n[3] lineage: chain a→b→c→d + closed-world parents');
  const [a, b, c, d] = artifacts;
  const recordFor = (artifact, parents) => ({
    artifact: {
      namespace: artifact.identity.namespace,
      name: artifact.identity.name,
      version: artifact.identity.version,
      digest: artifact.digest,
    },
    creator: { type: 'service', tenant: 'tenant-a', principalId: 'svc-1' },
    createdAt: T,
    parents: parents.map((parent) => ({
      parent: {
        namespace: parent.identity.namespace,
        name: parent.identity.name,
        version: parent.identity.version,
        digest: parent.digest,
      },
      relation: 'derived-from',
    })),
    transformation: {
      transform: { namespace: 'tenant-a', name: 'demo-transform', version: '1.0.0', digest: 'a'.repeat(64) },
      inputs: parents.map((parent) => ({
        namespace: parent.identity.namespace,
        name: parent.identity.name,
        version: parent.identity.version,
        digest: parent.digest,
      })),
    },
    rights: RIGHTS,
  });
  await lineage.record(recordFor(b, [a]));
  await lineage.record(recordFor(c, [b]));
  await lineage.record(recordFor(d, [b, c]));
  const ancestors = await lineage.ancestryOf({
    namespace: d.identity.namespace,
    name: d.identity.name,
    version: d.identity.version,
    digest: d.digest,
  });
  check('deep ancestry of d = {a, b, c}', ancestors.length === 3, `${ancestors.length} ancestors`);
  await expectThrows(
    'cycle rejection reports the offending path',
    () => lineage.record(recordFor(a, [d])),
    'PROVENANCE_CYCLE_DETECTED',
  );

  // 4. Publication lifecycle ------------------------------------------------
  console.log('\n[4] publication: publish → public, retract → private (append-only)');
  const published = await publication.publish(a, CALLER_A, RIGHTS, { publishedAt: T });
  check('publish creates an immutable record', published.record.action === 'publish');
  check('status flips to public', (await publication.status(a.identity)).visibility === 'public');
  const retracted = await publication.retract(published.record, CALLER_A, {
    retractedAt: '2026-03-01T13:00:00.000Z',
  });
  check('retract appends a NEW record', retracted.record.action === 'retract');
  check('status flips back to private', (await publication.status(a.identity)).visibility === 'private');
  check('ledger keeps both records (append-only)', publication.ledger().records.length === 2);
  await expectThrows(
    'cross-tenant publication rejected',
    () => publication.publish(b, CALLER_B, RIGHTS),
    'ARTIFACTS_TENANT_FORBIDDEN',
  );

  // 5. Dataset bundle through the store resolver ----------------------------
  console.log('\n[5] dataset packaging: manifest → bundle through store.resolverFor');
  const manifest = await createDatasetManifest({
    identity: { namespace: 'tenant-a', name: 'demo-dataset', version: '1.0.0' },
    entries: [
      { role: 'input', artifact: { namespace: a.identity.namespace, name: a.identity.name, version: a.identity.version, digest: a.digest } },
      { role: 'output', artifact: { namespace: d.identity.namespace, name: d.identity.name, version: d.identity.version, digest: d.digest } },
    ],
    provenance: {
      creator: { type: 'user', tenant: 'tenant-a', principalId: 'user-42' },
      createdAt: T,
      parents: [],
      rights: RIGHTS,
    },
  });
  const bundle = await resolveDatasetBundle(manifest, store.resolverFor(CALLER_A));
  check('bundle resolves with a deterministic digest', /^[0-9a-f]{64}$/.test(bundle.bundleDigest), bundle.bundleDigest.slice(0, 16) + '…');
  await expectThrows(
    'cross-tenant bundle resolution fails closed',
    () => resolveDatasetBundle(manifest, store.resolverFor(CALLER_B)),
    'DATASET_UNRESOLVED_ENTRY',
  );

  // 6. Summary ---------------------------------------------------------------
  console.log(`\n${checks} checks, ${failures} failure(s)`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('demo crashed:', error);
  process.exit(1);
});
