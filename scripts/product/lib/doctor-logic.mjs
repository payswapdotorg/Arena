/**
 * The doctor command's logic (Work Order B016).
 *
 * Environment diagnosis with a pass/warn/fail verdict PER ITEM: Node
 * engine range, the exact pnpm pin, corepack, disk, install state, build
 * outputs, the local fake persistence store (including a full comparison
 * against the deterministic demo corpus — through the SAME workspace
 * modules, never a parallel implementation), and the web dev port.
 *
 * All probes are INJECTED (the doctor.mjs entry wires the real fs/net/
 * spawn probes; the tests inject fakes), so the diagnosis logic here is
 * pure and deterministic.
 *
 * Exit code: 1 iff at least one check FAILED (warnings do not fail the
 * command — doctor reports, it does not gate).
 *
 * Plain .mjs — zero external dependencies.
 */

import {
  checkDiskFree,
  checkNodeVersion,
  checkPnpmVersion,
} from './prereqs.mjs';

/**
 * @typedef {{ id: string, status: 'pass' | 'warn' | 'fail', summary: string, detail?: string, next?: string }} DoctorResult
 */

/**
 * Run every doctor check over injected probes.
 *
 * @param {{
 *   nodeVersion: () => string,
 *   enginesText: () => string | null,
 *   packageManagerPin: () => string | null,
 *   pnpmVersion: () => string | null,
 *   corepackVersion: () => string | null,
 *   diskFreeBytes: () => number | null,
 *   installPresent: () => boolean,
 *   buildPresent: () => boolean,
 *   storeSnapshot: () => Record<string, any>,
 *   corpusRecords: () => Record<string, any>[] | null,
 *   canonicalEqual: ((left: unknown, right: unknown) => boolean) | null,
 *   demoTenantId: () => string | null,
 *   webPortOpen: () => boolean | null,
 *   webPortUrl: () => string,
 * }} probes
 * @returns {DoctorResult[]}
 */
export function runDoctorChecks(probes) {
  /** @type {DoctorResult[]} */
  const results = [];

  // --- Node engine range -------------------------------------------------
  const enginesText = probes.enginesText();
  if (enginesText === null) {
    results.push({
      id: 'node',
      status: 'fail',
      summary: 'root package.json is unreadable (engines.node missing)',
      next: 'run from inside the repository, or restore package.json, then re-run',
    });
  } else {
    results.push({ id: 'node', ...checkNodeVersion(probes.nodeVersion(), enginesText) });
  }

  // --- pnpm exact pin ----------------------------------------------------
  const pin = probes.packageManagerPin();
  if (pin === null) {
    results.push({
      id: 'pnpm',
      status: 'fail',
      summary: 'root package.json is unreadable (packageManager missing)',
      next: 'run from inside the repository, or restore package.json, then re-run',
    });
  } else {
    results.push({ id: 'pnpm', ...checkPnpmVersion(probes.pnpmVersion(), pin) });
  }

  // --- corepack ------------------------------------------------------------
  const corepackVersion = probes.corepackVersion();
  results.push(
    corepackVersion === null
      ? {
          id: 'corepack',
          status: 'warn',
          summary: 'corepack not found on PATH',
          detail: 'Node 22 bundles corepack; without it the pnpm pin relies on a manual install',
          next: 'run `corepack enable` if pnpm version issues appear',
        }
      : { id: 'corepack', status: 'pass', summary: `corepack ${corepackVersion} available` },
  );

  // --- disk ---------------------------------------------------------------
  results.push({ id: 'disk', ...checkDiskFree(probes.diskFreeBytes()) });

  // --- install state ------------------------------------------------------
  results.push(
    probes.installPresent()
      ? { id: 'install', status: 'pass', summary: 'workspace installed (node_modules present)' }
      : {
          id: 'install',
          status: 'fail',
          summary: 'workspace is not installed (no node_modules)',
          next: 'run: node scripts/product/install.mjs',
        },
  );

  // --- build outputs ------------------------------------------------------
  results.push(
    probes.buildPresent()
      ? { id: 'build', status: 'pass', summary: 'workspace build outputs present (packages/*/dist)' }
      : {
          id: 'build',
          status: 'warn',
          summary: 'workspace build outputs are missing',
          detail: 'local demo mode runs from TypeScript sources, so nothing is broken — but hosted/ publishing flows expect dist/',
          next: 'run: node scripts/product/install.mjs (its build step produces dist/)',
        },
  );

  // --- local fake persistence store --------------------------------------
  results.push(...checkStore(probes));

  // --- web dev port -------------------------------------------------------
  const webPortOpen = probes.webPortOpen();
  results.push(
    webPortOpen === null
      ? {
          id: 'web',
          status: 'warn',
          summary: `could not probe ${probes.webPortUrl()}`,
          next: `open ${probes.webPortUrl()} in a browser to check manually`,
        }
      : webPortOpen
        ? { id: 'web', status: 'pass', summary: `web dev server listening on ${probes.webPortUrl()}` }
        : {
            id: 'web',
            status: 'warn',
            summary: `web dev server is not listening on ${probes.webPortUrl()}`,
            next: 'run: pnpm --filter @arena/web dev',
          },
  );

  return results;
}

/** The store check(s): absent / corrupt / healthy / corpus divergence. */
function checkStore(probes) {
  /** @type {DoctorResult[]} */
  const results = [];
  const snapshot = probes.storeSnapshot();
  if (snapshot.status === 'absent') {
    results.push({
      id: 'store',
      status: 'warn',
      summary: 'local fake persistence store is not seeded',
      detail: 'optional: the web demo route composes its own in-process demo store; the CLI store serves scripts and inspection',
      next: 'run: node scripts/product/seed.mjs',
    });
    return results;
  }
  if (snapshot.status === 'corrupt') {
    results.push({
      id: 'store',
      status: 'fail',
      summary: `local fake persistence store is CORRUPT: ${snapshot.reason}`,
      next: 'run: node scripts/product/reset.mjs --yes, then node scripts/product/seed.mjs',
    });
    return results;
  }

  const demoTenantId = probes.demoTenantId();
  const tenantNote =
    demoTenantId === null
      ? `${String(snapshot.recordCount)} record(s)`
      : `${String(snapshot.recordCount)} record(s) · tenants ${JSON.stringify(snapshot.tenantCounts)}`;
  const nonDemoTenants = Object.keys(snapshot.tenantCounts).filter(
    (tenant) => demoTenantId !== null && tenant !== demoTenantId,
  );
  if (nonDemoTenants.length > 0) {
    results.push({
      id: 'store-tenants',
      status: 'warn',
      summary: `store holds records OUTSIDE the demo tenant (${nonDemoTenants.join(', ')})`,
      detail: 'the CLI store is a local fake intended for demo/state experiments — non-demo tenants are unexpected here',
      next: 'if unintentional: node scripts/product/reset.mjs --yes, then node scripts/product/seed.mjs',
    });
  }

  const corpusRecords = probes.corpusRecords();
  const canonicalEqual = probes.canonicalEqual;
  if (corpusRecords === null || canonicalEqual === null) {
    results.push({
      id: 'store',
      status: 'warn',
      summary: `store present and parseable (${tenantNote}), but the demo corpus could not be loaded for comparison`,
      next: 'run: node scripts/product/install.mjs (workspace modules unavailable)',
    });
    return results;
  }

  const divergence = [];
  for (const corpusRecord of corpusRecords) {
    const stored = snapshot.records.get(corpusRecord.recordId);
    if (stored === undefined) {
      divergence.push(`missing ${corpusRecord.recordId}`);
      continue;
    }
    const identical =
      stored.tenantId === corpusRecord.tenantId &&
      stored.kind === corpusRecord.kind &&
      stored.version === corpusRecord.version &&
      stored.revision === corpusRecord.revision &&
      stored.createdAt === corpusRecord.createdAt &&
      stored.updatedAt === corpusRecord.updatedAt &&
      canonicalEqual(stored.data, corpusRecord.data);
    if (!identical) {
      divergence.push(`diverged ${corpusRecord.recordId}`);
    }
  }
  if (divergence.length === 0) {
    results.push({
      id: 'store',
      status: 'pass',
      summary: `local fake persistence store healthy: ${tenantNote} — demo corpus present and byte-identical (deterministic)`,
    });
  } else {
    results.push({
      id: 'store',
      status: 'warn',
      summary: `store diverges from the deterministic demo corpus (${divergence.join('; ')})`,
      next: 'run: node scripts/product/reset.mjs --yes --reseed (back to the identical corpus hash)',
    });
  }
  return results;
}

/**
 * Render the doctor report.
 *
 * @param {DoctorResult[]} results
 * @returns {string[]} output lines (without trailing newlines).
 */
export function renderDoctorReport(results) {
  const lines = ['[arena-doctor] Arena local environment diagnosis:'];
  for (const result of results) {
    lines.push(`  ${result.status.toUpperCase().padEnd(4)}  ${result.id}: ${result.summary}`);
    if (result.detail !== undefined) lines.push(`        ${result.detail}`);
    if (result.next !== undefined) lines.push(`        next: ${result.next}`);
  }
  const pass = results.filter((r) => r.status === 'pass').length;
  const warn = results.filter((r) => r.status === 'warn').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  lines.push(`[arena-doctor] verdict: ${String(pass)} pass · ${String(warn)} warn · ${String(fail)} fail`);
  return lines;
}

/**
 * The doctor exit code: 1 iff at least one check failed.
 *
 * @param {DoctorResult[]} results
 * @returns {number}
 */
export function doctorExitCode(results) {
  return results.some((result) => result.status === 'fail') ? 1 : 0;
}
