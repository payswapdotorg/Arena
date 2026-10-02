/**
 * Deterministic tests for the CLI helpers (Work Order B016).
 * Pure logic — parsing, failure formatting, entry-point guard.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryStream,
  formatActionableFailure,
  formatUsageError,
  parseFlags,
} from '../lib/cli.mjs';

test('parseFlags collects known boolean flags', () => {
  const parsed = parseFlags(['--yes', '--reseed'], { flags: ['yes', 'reseed', 'help'] });
  assert.equal(parsed.flags.has('yes'), true);
  assert.equal(parsed.flags.has('reseed'), true);
  assert.equal(parsed.flags.has('help'), false);
  assert.deepEqual(parsed.unknown, []);
  assert.deepEqual(parsed.positionals, []);
});

test('parseFlags reports unknown flags instead of accepting them silently', () => {
  const parsed = parseFlags(['--yes', '--nope', '-x'], { flags: ['yes'] });
  assert.deepEqual(parsed.unknown, ['--nope']);
  // short flags are positional (deliberately), long unknowns are usage errors
  assert.deepEqual(parsed.positionals, ['-x']);
});

test('parseFlags treats "--" as the end of flags', () => {
  const parsed = parseFlags(['--yes', '--', '--nope'], { flags: ['yes'] });
  assert.equal(parsed.flags.has('yes'), true);
  assert.deepEqual(parsed.unknown, []);
  assert.deepEqual(parsed.positionals, ['--nope']);
});

test('parseFlags handles an empty argv', () => {
  const parsed = parseFlags([], { flags: ['yes'] });
  assert.equal(parsed.flags.size, 0);
  assert.deepEqual(parsed.positionals, []);
  assert.deepEqual(parsed.unknown, []);
});

test('formatActionableFailure always pairs a reason with a next action', () => {
  const text = formatActionableFailure({
    command: 'seed',
    reason: 'the workspace is not installed yet (no node_modules)',
    next: 'run: node scripts/product/install.mjs',
  });
  assert.match(text, /\[arena-seed\] FAILED: .*no node_modules/);
  assert.match(text, /next: run: node scripts\/product\/install\.mjs/);
});

test('formatUsageError names the unknown flag and the help hint', () => {
  const text = formatUsageError({
    command: 'reset',
    unknown: ['--nope'],
    helpHint: 'node scripts/product/reset.mjs --help',
  });
  assert.match(text, /unknown flag --nope/);
  assert.match(text, /--help/);
});

test('createMemoryStream accumulates written text', () => {
  const stream = createMemoryStream();
  stream.write('a');
  stream.write('b\n');
  assert.equal(stream.text, 'ab\n');
});
