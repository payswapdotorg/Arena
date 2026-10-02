#!/usr/bin/env node
/**
 * `seed` — the deterministic demo seed (Work Order B016).
 *
 *   node scripts/product/seed.mjs
 *
 * Seeds the B006 deterministic demo corpus into the LOCAL fake
 * persistence store (`.arena-local/store/control-plane.json` by default;
 * `ARENA_LOCAL_STATE_DIR` overrides) — through the SAME ports the
 * application uses: the B002 ControlPlaneRepository port implemented by
 * the file-backed local fake, driven by the B006 DemoStore. There is no
 * bespoke seeding path.
 *
 * Idempotent: re-running creates nothing new (the report shows exactly
 * what was created and what was already present). The printed corpus
 * hash summary is identical on every machine.
 *
 * Plain .mjs, zero external dependencies. Runnable standalone.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  formatActionableFailure,
  formatUsageError,
  guardPipeErrors,
  isMainEntryPoint,
  parseFlags,
} from './lib/cli.mjs';
import { resolveRepoRoot } from './lib/paths.mjs';
import { resolveStateDir } from './lib/local-state.mjs';
import { checkNodeVersion } from './lib/prereqs.mjs';
import { runSeed } from './lib/seed-logic.mjs';
import { loadArenaModules } from './lib/workspace.mjs';

export const HELP_TEXT = `arena seed — deterministic demo corpus into the local fake store (B016)

usage:
  node scripts/product/seed.mjs

what it does:
  seeds the B006 deterministic demo corpus (5 records under the reserved
  demo tenant arena-demo) into the local fake persistence store, through
  the B002 ControlPlaneRepository port — the same port the app uses.

  idempotent: re-running creates nothing new; the corpus hash is
  identical on every machine.

environment:
  ARENA_LOCAL_STATE_DIR  override the local state directory
                         (default: <repo>/.arena-local)

truth:
  demo state is NOT customer state. the store is a local fake — zero
  providers, zero credentials, no billing. reset wipes it totally.

related:
  node scripts/product/reset.mjs   total wipe of local state
  node scripts/product/doctor.mjs  environment diagnosis
`;

/**
 * Run the seed command.
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
    io.err.write(`${formatUsageError({ command: 'seed', unknown: parsed.unknown, helpHint: 'node scripts/product/seed.mjs --help' })}\n`);
    return 2;
  }

  const fail = (reason, next) => {
    io.err.write(`${formatActionableFailure({ command: 'seed', reason, next })}\n`);
  };

  const repoRoot = resolveRepoRoot();

  // Honest early checks — fail with actionable messages, never a stack trace.
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
  } catch {
    fail(`could not read the root package.json (looked in ${repoRoot})`, 'run from inside the Arena repository');
    return 1;
  }
  const nodeCheck = checkNodeVersion(process.version, manifest.engines?.node ?? '');
  if (nodeCheck.status === 'fail') {
    fail(nodeCheck.summary, nodeCheck.next);
    return 1;
  }
  if (!existsSync(join(repoRoot, 'node_modules'))) {
    fail('the workspace is not installed yet (no node_modules)', 'run: node scripts/product/install.mjs');
    return 1;
  }

  const stateDir = resolveStateDir({ repoRoot });
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

  try {
    const result = await runSeed({
      demo: modules.demo,
      persistence: modules.persistence,
      stateDir,
      out: io.out,
    });
    return result.exitCode;
  } catch (error) {
    fail(
      String(error instanceof Error ? error.message : error),
      'run: node scripts/product/doctor.mjs for a full diagnosis (a corrupt store tells you to reset first)',
    );
    return 1;
  }
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
          command: 'seed',
          reason: String(error instanceof Error ? error.message : error),
          next: 'run: node scripts/product/doctor.mjs for a full diagnosis',
        })}\n`,
      );
      process.exitCode = 1;
    });
}
