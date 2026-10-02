/**
 * Minimal CLI helpers for the product scripts (Work Order B016).
 *
 * Zero-dependency flag parsing (the product commands take boolean flags
 * only — no option values to mis-parse), actionable failure formatting
 * (NEVER a deep stack trace — the B016 product truth), and the
 * main-entry-point guard so test code can import command modules without
 * triggering their CLI behaviour.
 *
 * Plain .mjs — zero external dependencies.
 */

import { pathToFileURL } from 'node:url';

/**
 * Parse boolean flags out of an argv-style array.
 *
 * `--` ends flag parsing; everything after it is positional. A flag may
 * appear multiple times (last presence still just "true"). Anything
 * starting with `-` that is not in the known set is reported as unknown
 * (usage error), never silently accepted.
 *
 * @param {readonly string[]} argv
 * @param {{ flags: readonly string[] }} spec — known boolean flag names, WITH their `--` prefix omitted? No: include the name without dashes (e.g. 'yes').
 * @returns {{ flags: Set<string>, positionals: string[], unknown: string[] }}
 */
export function parseFlags(argv, spec) {
  const known = new Set(spec.flags);
  const flags = new Set();
  const positionals = [];
  const unknown = [];
  let positionalOnly = false;
  for (const raw of argv) {
    if (positionalOnly) {
      positionals.push(raw);
      continue;
    }
    if (raw === '--') {
      positionalOnly = true;
      continue;
    }
    if (raw.startsWith('--')) {
      const name = raw.slice(2);
      if (known.has(name)) {
        flags.add(name);
      } else {
        unknown.push(raw);
      }
      continue;
    }
    positionals.push(raw);
  }
  return { flags, positionals, unknown };
}

/**
 * Format an actionable failure: one-line reason, one-line next action.
 * This is the ONLY failure format the product commands print — the
 * product truth "fail early with actionable messages, never a deep stack
 * trace".
 *
 * @param {{ command: string, reason: string, next?: string }} failure
 * @returns {string} the full multi-line failure text (no trailing newline)
 */
export function formatActionableFailure(failure) {
  const lines = [`[arena-${failure.command}] FAILED: ${failure.reason}`];
  if (failure.next !== undefined && failure.next.length > 0) {
    lines.push(`  next: ${failure.next}`);
  }
  return lines.join('\n');
}

/**
 * Render an unknown-flag usage error.
 *
 * @param {{ command: string, unknown: readonly string[], helpHint: string }} input
 * @returns {string} the usage-error text (no trailing newline)
 */
export function formatUsageError(input) {
  return [
    `[arena-${input.command}] usage error: unknown flag ${input.unknown.join(' ')}`,
    `  next: ${input.helpHint}`,
  ].join('\n');
}

/**
 * True iff the CALLING module is the process entry point (the A018
 * console pattern) — lets tests import command modules safely. Pass the
 * caller's own `import.meta.url` (the check compares it against
 * process.argv[1], which Node resolves to an absolute path).
 *
 * @param {string} moduleUrl — the caller's import.meta.url.
 * @returns {boolean}
 */
export function isMainEntryPoint(moduleUrl) {
  const entry = process.argv[1];
  if (typeof entry !== 'string') return false;
  return moduleUrl === pathToFileURL(entry).href;
}

/**
 * Tolerate downstream pipe closure (e.g. `… | head`): exit quietly with
 * the current exit code instead of crashing with an unhandled EPIPE.
 *
 * @param {NodeJS.WriteStream} stream — process.stdout or process.stderr.
 */
export function guardPipeErrors(stream) {
  if (stream === null || stream === undefined || typeof stream.on !== 'function') return;
  stream.on('error', (error) => {
    if (error && error.code === 'EPIPE') {
      process.exit(process.exitCode ?? 0);
    }
    throw error;
  });
}

/**
 * A tiny in-memory text stream for tests (duck-types process.stdout's
 * write(chunk) enough for the command output paths).
 */
export function createMemoryStream() {
  /** @type {string[]} */
  const chunks = [];
  return {
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    get text() {
      return chunks.join('');
    },
  };
}
