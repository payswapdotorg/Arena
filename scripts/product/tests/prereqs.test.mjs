/**
 * Deterministic tests for the prerequisite checks (Work Order B016).
 * Pure logic — no fs, no spawns.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkDiskFree,
  checkNodeVersion,
  checkPnpmVersion,
  formatBytes,
  parseEnginesRange,
  parseNodeVersion,
} from '../lib/prereqs.mjs';

test('parseNodeVersion accepts v-prefixed, bare and short forms', () => {
  assert.deepEqual(parseNodeVersion('v22.21.1'), { major: 22, minor: 21, patch: 1 });
  assert.deepEqual(parseNodeVersion('22.9.0'), { major: 22, minor: 9, patch: 0 });
  assert.deepEqual(parseNodeVersion('v22'), { major: 22, minor: 0, patch: 0 });
  assert.equal(parseNodeVersion('not-a-version'), null);
  assert.equal(parseNodeVersion(22), null);
});

test('parseEnginesRange accepts the bounded pin shape only', () => {
  assert.deepEqual(parseEnginesRange('>=22 <23'), {
    minMajor: 22,
    minMinor: 0,
    maxMajorExclusive: 23,
    maxMinorExclusive: 0,
  });
  assert.deepEqual(parseEnginesRange('>=22.18 <23'), {
    minMajor: 22,
    minMinor: 18,
    maxMajorExclusive: 23,
    maxMinorExclusive: 0,
  });
  assert.equal(parseEnginesRange('>=20'), null);
  assert.equal(parseEnginesRange('^22'), null);
  assert.equal(parseEnginesRange(''), null);
});

test('checkNodeVersion passes inside the range and fails outside with an actionable next', () => {
  const pass = checkNodeVersion('v22.21.1', '>=22 <23');
  assert.equal(pass.status, 'pass');
  assert.match(pass.summary, /satisfies engines/);

  const low = checkNodeVersion('v21.9.9', '>=22 <23');
  assert.equal(low.status, 'fail');
  assert.match(low.next, /nvm install 22|nodejs\.org/);

  const high = checkNodeVersion('v23.0.0', '>=22 <23');
  assert.equal(high.status, 'fail');
  assert.match(high.summary, /OUTSIDE the supported range/);

  const minorFloor = checkNodeVersion('v22.17.0', '>=22.18 <23');
  assert.equal(minorFloor.status, 'fail');
});

test('checkNodeVersion fails loudly on an unrecognized engines range (never guesses)', () => {
  const result = checkNodeVersion('v22.21.1', '>=20');
  assert.equal(result.status, 'fail');
  assert.match(result.summary, /unrecognized engines\.node range/);
});

test('checkPnpmVersion enforces the exact pin with a corepack next action', () => {
  assert.equal(checkPnpmVersion('10.34.5', 'pnpm@10.34.5').status, 'pass');

  const wrong = checkPnpmVersion('10.34.4', 'pnpm@10.34.5');
  assert.equal(wrong.status, 'fail');
  assert.match(wrong.next, /corepack prepare pnpm@10\.34\.5 --activate/);

  const missing = checkPnpmVersion(null, 'pnpm@10.34.5');
  assert.equal(missing.status, 'fail');
  assert.match(missing.next, /corepack enable/);
});

test('checkDiskFree formats and enforces the floor', () => {
  const pass = checkDiskFree(3 * 1024 * 1024 * 1024);
  assert.equal(pass.status, 'pass');
  assert.match(pass.summary, /3\.0 GiB free/);

  const fail = checkDiskFree(512 * 1024 * 1024);
  assert.equal(fail.status, 'fail');
  assert.match(fail.next, /free up disk space/);

  assert.equal(checkDiskFree(null).status, 'fail');
});

test('formatBytes is deterministic', () => {
  assert.equal(formatBytes(2 * 1024 * 1024 * 1024), '2.0 GiB');
  assert.equal(formatBytes(512 * 1024 * 1024), '512.0 MiB');
  assert.equal(formatBytes(2048), '2 KiB');
});
