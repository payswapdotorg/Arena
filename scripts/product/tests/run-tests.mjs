#!/usr/bin/env node
/**
 * The standalone test runner for scripts/product (Work Order B016).
 *
 *   node scripts/product/tests/run-tests.mjs
 *
 * Self-contained: zero external dependencies — it drives Node's built-in
 * test runner (node --test) over this directory and reports the totals.
 * Requires the workspace to be installed (`node scripts/product/install.mjs`)
 * because the store/seed/reset suites drive the REAL @arena/persistence
 * and @arena/demo modules through the TypeScript source shim.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

const testFiles = readdirSync(TESTS_DIR)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

if (testFiles.length === 0) {
  process.stderr.write('[arena-product-tests] no *.test.mjs files found — nothing to run\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`[arena-product-tests] running ${String(testFiles.length)} suite(s) via node --test:\n`);
  for (const name of testFiles) {
    process.stdout.write(`  - ${name}\n`);
  }
  const result = spawnSync(
    process.execPath,
    ['--test', ...testFiles.map((name) => join(TESTS_DIR, name))],
    { cwd: join(TESTS_DIR, '..', '..', '..'), stdio: 'inherit' },
  );
  process.exitCode = result.status ?? 1;
}
