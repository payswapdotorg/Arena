/**
 * The reset command's logic (Work Order B016).
 *
 * Reset is TOTAL and EXPLICIT:
 *
 *   - a confirmation gate — `--yes`, or typing exactly `reset` at the
 *     interactive prompt; a non-interactive session without `--yes`
 *     aborts BEFORE anything is deleted;
 *   - a total wipe of local state — the local fake persistence store AND
 *     the regenerable caches (see local-state.mjs's buildWipePlan) —
 *     never source, never node_modules, never the lockfile;
 *   - an optional re-seed (`--reseed`) straight back into deterministic
 *     demo mode.
 *
 * The wipe plan is PRINTED before confirmation, so the operator always
 * sees exactly what will be removed and what is protected.
 *
 * Plain .mjs — zero external dependencies.
 */

import { rmSync } from 'node:fs';

import {
  RESET_PROTECTED_NOTE,
  buildWipePlan,
} from './local-state.mjs';
import { runSeed } from './seed-logic.mjs';

/** The exact word an interactive reset confirmation requires. */
export const RESET_CONFIRM_WORD = 'reset';

/**
 * Resolve the confirmation gate.
 *
 * @param {{ assumeYes: boolean, isTTY: boolean }} input
 * @returns {{ kind: 'proceed', via: string } | { kind: 'prompt', confirmWord: string } | { kind: 'abort', reason: string, next: string }}
 */
export function resolveResetConfirmation(input) {
  if (input.assumeYes) {
    return { kind: 'proceed', via: '--yes' };
  }
  if (!input.isTTY) {
    return {
      kind: 'abort',
      reason: 'non-interactive session — the total wipe requires explicit confirmation',
      next: 'review the wipe plan above, then re-run with --yes',
    };
  }
  return { kind: 'prompt', confirmWord: RESET_CONFIRM_WORD };
}

/**
 * Evaluate the interactive confirmation answer (exact, case-sensitive).
 *
 * @param {string} answer
 * @returns {{ kind: 'proceed', via: string } | { kind: 'abort', reason: string, next: string }}
 */
export function evaluateResetAnswer(answer) {
  if (String(answer).trim() === RESET_CONFIRM_WORD) {
    return { kind: 'proceed', via: 'typed confirmation' };
  }
  return {
    kind: 'abort',
    reason: 'confirmation input did not match',
    next: 'aborting — nothing was deleted (re-run and type exactly "reset", or pass --yes)',
  };
}

/**
 * Execute the wipe: remove every target that still exists.
 *
 * @param {{ path: string, label: string }[]} plan
 * @param {{ rm?: (path: string) => void, exists?: (path: string) => boolean }} [fsProbes]
 * @returns {string[]} the paths actually removed.
 */
export function executeWipe(plan, fsProbes = {}) {
  const rm = fsProbes.rm ?? ((path) => rmSync(path, { recursive: true, force: true }));
  const exists = fsProbes.exists ?? (() => true);
  const removed = [];
  for (const target of plan) {
    if (exists(target.path)) {
      rm(target.path);
      removed.push(target.path);
    }
  }
  return removed;
}

/**
 * Run the reset workflow.
 *
 * @param {{
 *   repoRoot: string,
 *   stateDir: string,
 *   assumeYes: boolean,
 *   reseed: boolean,
 *   isTTY: boolean,
 *   readLine?: () => Promise<string>,
 *   out: { write(chunk: string): boolean },
 *   err: { write(chunk: string): boolean },
 *   loadModules?: () => Promise<{ demo: Record<string, any>, persistence: Record<string, any> }>,
 * }} options
 * @returns {Promise<number>} process exit code.
 */
export async function runReset(options) {
  const { out, err } = options;
  const write = (text) => {
    out.write(`${text}\n`);
  };
  const writeErr = (text) => {
    err.write(`${text}\n`);
  };

  const plan = buildWipePlan({ repoRoot: options.repoRoot, stateDir: options.stateDir });

  write('[arena-reset] reset scope — LOCAL STATE ONLY (source is never touched):');
  if (plan.length === 0) {
    write('[arena-reset]   (nothing to wipe: no local state or caches found)');
  } else {
    for (const target of plan) {
      write(`[arena-reset]   ${target.path}  — ${target.label}`);
    }
  }
  write(`[arena-reset] ${RESET_PROTECTED_NOTE}`);

  const confirmation = resolveResetConfirmation({ assumeYes: options.assumeYes, isTTY: options.isTTY });
  if (confirmation.kind === 'abort') {
    writeErr(`[arena-reset] ABORTED: ${confirmation.reason}`);
    writeErr(`[arena-reset]   next: ${confirmation.next}`);
    return 1;
  }
  if (confirmation.kind === 'prompt') {
    out.write(`[arena-reset] confirm the total wipe: type exactly "${confirmation.confirmWord}" and press enter: `);
    const answer = await (options.readLine?.() ?? '');
    const evaluated = evaluateResetAnswer(String(answer));
    if (evaluated.kind === 'abort') {
      writeErr(`[arena-reset] ABORTED: ${evaluated.reason}`);
      writeErr(`[arena-reset]   next: ${evaluated.next}`);
      return 1;
    }
    write(`[arena-reset] confirmed (${evaluated.via}).`);
  } else {
    write(`[arena-reset] confirmed (${confirmation.via}).`);
  }

  const removed = executeWipe(plan);
  if (removed.length === 0) {
    write('[arena-reset] wiped: nothing existed to remove (local state was already clean)');
  } else {
    write(`[arena-reset] wiped ${String(removed.length)} path(s):`);
    for (const path of removed) {
      write(`[arena-reset]   ${path}`);
    }
  }

  if (options.reseed) {
    if (options.loadModules === undefined) {
      writeErr('[arena-reset] FAILED: --reseed was requested but no module loader was provided');
      return 1;
    }
    write('[arena-reset] re-seeding the deterministic demo corpus…');
    const modules = await options.loadModules();
    const result = await runSeed({
      demo: modules.demo,
      persistence: modules.persistence,
      stateDir: options.stateDir,
      out,
    });
    if (result.exitCode !== 0) {
      return result.exitCode;
    }
    write('[arena-reset] done — local state wiped and re-seeded to the identical corpus hash.');
    return 0;
  }

  write('[arena-reset] done — local state cleared. Source, dependencies and git history are untouched.');
  write('[arena-reset] next: node scripts/product/seed.mjs (re-seed the demo corpus)');
  return 0;
}
