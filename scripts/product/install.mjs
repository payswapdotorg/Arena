#!/usr/bin/env node
/**
 * `install` — the local install workflow (Work Order B016).
 *
 *   node scripts/product/install.mjs
 *
 * What it does, in order, failing EARLY with an actionable message
 * (never a deep stack trace) at every step:
 *
 *   1. prerequisite check — Node in the engines range, pnpm on PATH at
 *      the exact packageManager pin, corepack available (info), enough
 *      free disk (2 GiB recommended);
 *   2. `pnpm install` (workspace dependencies, engine-strict);
 *   3. `pnpm build` (turbo — workspace build outputs);
 *   4. verify — the workspace modules load and the deterministic demo
 *      corpus seeds in-memory to its stable hash, and the expected
 *      build outputs exist.
 *
 * Local mode needs NO provider accounts and NO credentials — that
 * posture is documented in docs/getting-started/local-mode.md.
 *
 * Plain .mjs, zero external dependencies. Runnable standalone (no root
 * package.json wiring required).
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import {
  formatActionableFailure,
  formatUsageError,
  guardPipeErrors,
  isMainEntryPoint,
  parseFlags,
} from './lib/cli.mjs';
import { resolveRepoRoot } from './lib/paths.mjs';
import {
  checkDiskFree,
  checkNodeVersion,
  checkPnpmVersion,
} from './lib/prereqs.mjs';
import { loadArenaModules } from './lib/workspace.mjs';

export const HELP_TEXT = `arena install — local install workflow (B016)

usage:
  node scripts/product/install.mjs

what it does:
  1. checks prerequisites (Node in the engines range, exact pnpm pin, disk space)
  2. runs \`pnpm install\`  (workspace dependencies)
  3. runs \`pnpm build\`    (workspace build outputs)
  4. verifies the workspace loads and the demo corpus seeds deterministically

local mode requires NO provider accounts and NO credentials.

related:
  node scripts/product/seed.mjs    deterministic demo corpus into the local store
  node scripts/product/doctor.mjs  environment diagnosis
  node scripts/product/reset.mjs   total wipe of local state
`;

function readRootManifest(repoRoot) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

function spawnOut(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  return result.status;
}

/** Probe free disk space (bytes) under a path; null when unavailable. */
async function probeDiskFree(path) {
  try {
    const { statfs } = await import('node:fs/promises');
    const stats = await statfs(path);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

/**
 * Run the install command.
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
    io.err.write(`${formatUsageError({ command: 'install', unknown: parsed.unknown, helpHint: 'node scripts/product/install.mjs --help' })}\n`);
    return 2;
  }

  const write = (text) => {
    io.out.write(`${text}\n`);
  };
  const fail = (reason, next) => {
    io.err.write(`${formatActionableFailure({ command: 'install', reason, next })}\n`);
  };
  const repoRoot = resolveRepoRoot();

  // --- 1) prerequisites ---------------------------------------------------
  write('[arena-install] step 1/4: checking prerequisites…');
  const manifest = readRootManifest(repoRoot);
  if (manifest === null) {
    fail('could not read the root package.json', `run from inside the Arena repository (looked in ${repoRoot})`);
    return 1;
  }
  const enginesText = manifest.engines?.node;
  const packageManagerPin = manifest.packageManager;
  if (typeof enginesText !== 'string' || typeof packageManagerPin !== 'string') {
    fail('root package.json is missing engines.node or packageManager', 'restore the repository root manifest and re-run');
    return 1;
  }

  const nodeCheck = checkNodeVersion(process.version, enginesText);
  write(`[arena-install]   ${nodeCheck.status.toUpperCase()}  ${nodeCheck.summary}`);
  if (nodeCheck.status === 'fail') {
    fail(nodeCheck.summary, nodeCheck.next);
    return 1;
  }

  const pnpmProbe = spawnSync('pnpm', ['--version'], { encoding: 'utf-8' });
  const pnpmCheck = checkPnpmVersion(
    pnpmProbe.status === 0 && typeof pnpmProbe.stdout === 'string' ? pnpmProbe.stdout.trim() : null,
    packageManagerPin,
  );
  write(`[arena-install]   ${pnpmCheck.status.toUpperCase()}  ${pnpmCheck.summary}`);
  if (pnpmCheck.status === 'fail') {
    fail(pnpmCheck.summary, pnpmCheck.next);
    return 1;
  }

  const corepackProbe = spawnSync('corepack', ['--version'], { encoding: 'utf-8' });
  if (corepackProbe.status === 0 && typeof corepackProbe.stdout === 'string') {
    write(`[arena-install]   INFO  corepack ${corepackProbe.stdout.trim()} available`);
  } else {
    write('[arena-install]   WARN  corepack not found on PATH (pnpm already resolves — fine unless the pin drifts)');
  }

  const diskFree = await probeDiskFree(repoRoot);
  const diskCheck = checkDiskFree(diskFree);
  write(`[arena-install]   ${diskCheck.status.toUpperCase()}  ${diskCheck.summary}`);
  if (diskCheck.status === 'fail') {
    fail(diskCheck.summary, diskCheck.next);
    return 1;
  }

  // --- 2) dependencies ----------------------------------------------------
  write('[arena-install] step 2/4: pnpm install (workspace dependencies)…');
  if (spawnOut('pnpm', ['install'], repoRoot) !== 0) {
    fail('pnpm install exited non-zero (see its output above)', 'fix the reported issue(s) and re-run: node scripts/product/install.mjs');
    return 1;
  }

  // --- 3) build -----------------------------------------------------------
  write('[arena-install] step 3/4: pnpm build (workspace build outputs)…');
  if (spawnOut('pnpm', ['build'], repoRoot) !== 0) {
    fail('pnpm build exited non-zero (see its output above)', 'fix the reported compile error(s) and re-run: node scripts/product/install.mjs');
    return 1;
  }

  // --- 4) verify ----------------------------------------------------------
  write('[arena-install] step 4/4: verifying the workspace…');
  const expectedOutputs = [
    join(repoRoot, 'packages', 'demo', 'dist', 'index.js'),
    join(repoRoot, 'packages', 'persistence', 'dist', 'index.js'),
  ];
  for (const output of expectedOutputs) {
    if (!existsSync(output)) {
      fail(`expected build output is missing: ${output}`, 're-run: node scripts/product/install.mjs (the build step should produce it)');
      return 1;
    }
  }
  write('[arena-install]   PASS  build outputs present (packages/demo, packages/persistence)');

  let modules;
  try {
    modules = await loadArenaModules();
  } catch (error) {
    fail(
      `the workspace modules could not be loaded (${String(error instanceof Error ? error.message : error)})`,
      'run: node scripts/product/doctor.mjs for a full diagnosis',
    );
    return 1;
  }
  const store = modules.demo.createInMemoryDemoStore();
  const report = await store.seed();
  write(
    `[arena-install]   PASS  deterministic demo corpus verified: ${String(report.seeded.length)} records · tenant ${modules.demo.DEMO_TENANT_ID} · hash summary ${modules.demo.demoCorpusHashSummary(report.corpusHash)}`,
  );

  write('[arena-install] done — Arena is installed and verified (local mode: zero providers, zero credentials).');
  write('[arena-install] next: node scripts/product/seed.mjs (deterministic demo corpus into the local store)');
  write('[arena-install] next: pnpm --filter @arena/web dev → http://localhost:3000/demo');
  return 0;
}

if (isMainEntryPoint(import.meta.url)) {
  guardPipeErrors(process.stdout);
  guardPipeErrors(process.stderr);
  run(process.argv.slice(2), { out: process.stdout, err: process.stderr })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        `${formatActionableFailure({
          command: 'install',
          reason: String(error instanceof Error ? error.message : error),
          next: 'run: node scripts/product/doctor.mjs for a full diagnosis',
        })}\n`,
      );
      process.exitCode = 1;
    });
}
