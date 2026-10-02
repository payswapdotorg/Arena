#!/usr/bin/env node
/**
 * `doctor` — local environment diagnosis (Work Order B016).
 *
 *   node scripts/product/doctor.mjs
 *
 * One PASS/WARN/FAIL verdict per item: Node engine range, exact pnpm
 * pin, corepack, free disk, install state, build outputs, the local
 * fake persistence store (including a byte-level comparison against the
 * deterministic demo corpus, through the SAME workspace modules), and
 * the web dev port. Every non-pass carries an actionable "next:".
 *
 * Exit code: 1 iff at least one item FAILED (warnings do not fail).
 *
 * Plain .mjs, zero external dependencies. Runnable standalone.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { join } from 'node:path';

import {
  formatUsageError,
  guardPipeErrors,
  isMainEntryPoint,
  parseFlags,
} from './lib/cli.mjs';
import { resolveRepoRoot } from './lib/paths.mjs';
import { resolveStateDir, statePaths } from './lib/local-state.mjs';
import { readStoreSnapshot } from './lib/local-store.mjs';
import {
  doctorExitCode,
  renderDoctorReport,
  runDoctorChecks,
} from './lib/doctor-logic.mjs';
import { loadArenaModules } from './lib/workspace.mjs';

export const HELP_TEXT = `arena doctor — local environment diagnosis (B016)

usage:
  node scripts/product/doctor.mjs

what it checks (pass / warn / fail per item):
  node        running Node version against the engines pin
  pnpm        resolved pnpm against the exact packageManager pin
  corepack    availability (the pnpm pin relies on it)
  disk        free disk space for a local install
  install     workspace install state (node_modules)
  build       workspace build outputs (packages/*/dist)
  store       the local fake persistence store: present, parseable, and
              byte-identical to the deterministic demo corpus
  web         whether the web dev server is listening on the demo port

exit code: 1 iff at least one item FAILED (warnings do not fail).

related:
  docs/getting-started/troubleshooting.md maps common failures to this output.
`;

/** The web dev server port (apps/web: next dev on :3000). */
const WEB_PORT = 3000;

function readRootManifest(repoRoot) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

function commandVersion(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf-8' });
  if (result.status !== 0 || typeof result.stdout !== 'string') return null;
  const trimmed = result.stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function probeWebPort(port, timeoutMs = 500) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePromise(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Run the doctor command.
 *
 * @param {readonly string[]} argv
 * @param {{ out: { write(chunk: string): boolean }, err: { write(chunk: string): boolean } }} io
 * @returns {Promise<number>} exit code
 */
export async function run(argv, io) {
  const parsed = parseFlags(argv, { flags: ['help'] });
  if (parsed.flags.has('help')) {
    io.out.write(HELP_TEXT);
    return 0;
  }
  if (parsed.unknown.length > 0) {
    io.err.write(`${formatUsageError({ command: 'doctor', unknown: parsed.unknown, helpHint: 'node scripts/product/doctor.mjs --help' })}\n`);
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const manifest = readRootManifest(repoRoot);
  const stateDir = resolveStateDir({ repoRoot });
  const storePath = statePaths(stateDir).storeFile;

  // The corpus comparison runs through the SAME workspace modules; when
  // they cannot load (fresh clone, broken install) doctor degrades
  // honestly instead of guessing.
  let corpusRecords = null;
  let canonicalEqual = null;
  let demoTenantId = null;
  try {
    const modules = await loadArenaModules();
    corpusRecords = [...modules.demo.buildDemoCorpus()];
    canonicalEqual = modules.persistence.canonicalEqual;
    demoTenantId = modules.demo.DEMO_TENANT_ID;
  } catch {
    corpusRecords = null;
  }

  let diskFreeBytes = null;
  try {
    const { statfs } = await import('node:fs/promises');
    const stats = await statfs(repoRoot);
    diskFreeBytes = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    diskFreeBytes = null;
  }

  const results = runDoctorChecks({
    nodeVersion: () => process.version,
    enginesText: () => (manifest === null ? null : manifest.engines?.node ?? null),
    packageManagerPin: () => (manifest === null ? null : manifest.packageManager ?? null),
    pnpmVersion: () => commandVersion('pnpm'),
    corepackVersion: () => commandVersion('corepack'),
    diskFreeBytes: () => diskFreeBytes,
    installPresent: () => existsSync(join(repoRoot, 'node_modules')),
    buildPresent: () =>
      existsSync(join(repoRoot, 'packages', 'demo', 'dist', 'index.js')) &&
      existsSync(join(repoRoot, 'packages', 'persistence', 'dist', 'index.js')),
    storeSnapshot: () => readStoreSnapshot(storePath),
    corpusRecords: () => corpusRecords,
    canonicalEqual,
    demoTenantId: () => demoTenantId,
    webPortOpen: () => probeWebPort(WEB_PORT),
    webPortUrl: () => `http://localhost:${String(WEB_PORT)}`,
  });

  for (const line of renderDoctorReport(results)) {
    io.out.write(`${line}\n`);
  }
  return doctorExitCode(results);
}

if (isMainEntryPoint(import.meta.url)) {
  guardPipeErrors(process.stdout);
  guardPipeErrors(process.stderr);
  run(process.argv.slice(2), { out: process.stdout, err: process.stderr })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`[arena-doctor] FAILED: ${String(error instanceof Error ? error.message : error)}\n`);
      process.exitCode = 1;
    });
}
