#!/usr/bin/env node
/**
 * `reset` — total, explicit local reset (Work Order B016).
 *
 *   node scripts/product/reset.mjs [--yes] [--reseed]
 *
 * Reset is TOTAL and EXPLICIT:
 *
 *   - confirmation gate: `--yes`, or typing exactly `reset` at the
 *     interactive prompt. A non-interactive session without `--yes`
 *     aborts BEFORE deleting anything;
 *   - wipes ALL local state: the local fake persistence store
 *     (`.arena-local/`) AND the regenerable caches (.turbo, coverage,
 *     per-package dist, per-app .next …). It NEVER touches source,
 *     node_modules, pnpm-lock.yaml or git history;
 *   - `--reseed` re-seeds the deterministic demo corpus immediately
 *     after the wipe (back to the identical corpus hash).
 *
 * Plain .mjs, zero external dependencies. Runnable standalone.
 */

import {
  formatActionableFailure,
  formatUsageError,
  guardPipeErrors,
  isMainEntryPoint,
  parseFlags,
} from './lib/cli.mjs';
import { resolveRepoRoot } from './lib/paths.mjs';
import { resolveStateDir } from './lib/local-state.mjs';
import { runReset } from './lib/reset-logic.mjs';
import { loadArenaModules } from './lib/workspace.mjs';

export const HELP_TEXT = `arena reset — total wipe of LOCAL state (B016)

usage:
  node scripts/product/reset.mjs [--yes] [--reseed]

flags:
  --yes      confirm the total wipe non-interactively (review the plan first!)
  --reseed   re-seed the deterministic demo corpus right after the wipe

what it wipes (only what exists):
  the local fake persistence store (<repo>/.arena-local — or $ARENA_LOCAL_STATE_DIR)
  regenerable caches: .turbo, coverage, packages/*/dist, apps/*/.next …

what it NEVER touches:
  source tree, node_modules, pnpm-lock.yaml, git history

confirmation:
  interactive sessions type exactly "reset" at the prompt;
  non-interactive sessions must pass --yes — otherwise reset aborts
  before deleting anything.

related:
  node scripts/product/seed.mjs   deterministic demo corpus into the local store
  node scripts/product/doctor.mjs environment diagnosis
`;

/** Read one line from stdin (the interactive confirmation). */
function createStdinReadLine() {
  return () =>
    new Promise((resolvePromise) => {
      const stdin = process.stdin;
      stdin.setEncoding('utf-8');
      let data = '';
      const finish = () => {
        stdin.off('data', onData);
        stdin.off('end', onEnd);
        stdin.pause();
        resolvePromise(data);
      };
      const onData = (chunk) => {
        data += chunk;
        if (data.includes('\n')) finish();
      };
      const onEnd = () => finish();
      stdin.on('data', onData);
      stdin.on('end', onEnd);
      stdin.resume();
    });
}

/**
 * Run the reset command.
 *
 * @param {readonly string[]} argv
 * @param {{ out: { write(chunk: string): boolean }, err: { write(chunk: string): boolean }, isTTY?: boolean, readLine?: () => Promise<string> }} io
 * @returns {Promise<number>} exit code
 */
export async function run(argv, io) {
  const parsed = parseFlags(argv, { flags: ['help', 'yes', 'reseed'] });
  if (parsed.flags.has('help')) {
    io.out.write(HELP_TEXT);
    return 0;
  }
  if (parsed.unknown.length > 0) {
    io.err.write(`${formatUsageError({ command: 'reset', unknown: parsed.unknown, helpHint: 'node scripts/product/reset.mjs --help' })}\n`);
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const stateDir = resolveStateDir({ repoRoot });
  const isTTY = io.isTTY ?? Boolean(process.stdout.isTTY && process.stdin.isTTY);
  const readLine = io.readLine ?? createStdinReadLine();

  try {
    return await runReset({
      repoRoot,
      stateDir,
      assumeYes: parsed.flags.has('yes'),
      reseed: parsed.flags.has('reseed'),
      isTTY,
      readLine,
      out: io.out,
      err: io.err,
      loadModules: loadArenaModules,
    });
  } catch (error) {
    io.err.write(
      `${formatActionableFailure({
        command: 'reset',
        reason: String(error instanceof Error ? error.message : error),
        next: 'run: node scripts/product/doctor.mjs for a full diagnosis',
      })}\n`,
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
          command: 'reset',
          reason: String(error instanceof Error ? error.message : error),
          next: 'run: node scripts/product/doctor.mjs for a full diagnosis',
        })}\n`,
      );
      process.exitCode = 1;
    });
}
