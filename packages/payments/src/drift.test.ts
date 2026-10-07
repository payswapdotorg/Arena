/**
 * Contract drift suite — runs the C010 generator's --check against the
 * committed contracts and verifies that every drift class (tampered,
 * missing, extra) FAILS the check, exactly like the C001/A015/A025
 * drift suites and the governance G9 fixtures.
 *
 * The package-level generator is ALSO wired into the repo-wide
 * governance G9 entry point (scripts/governance-check.py runs every
 * package-level generator under packages with a --check), so
 * `pnpm run check` covers packages/payments/contracts drift centrally.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');
const GENERATOR = join(PACKAGE_ROOT, 'scripts', 'generate-contracts.mjs');
const CONTRACT_DIR = join(PACKAGE_ROOT, 'contracts');

function runCheck(againstDir: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      [GENERATOR, '--check', '--against', againstDir],
      { encoding: 'utf-8' },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

function tempCloneOfContracts(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arena-payments-drift-'));
  cpSync(CONTRACT_DIR, join(dir, 'packages', 'payments', 'contracts'), {
    recursive: true,
  });
  return dir;
}

describe('contract drift (C010 generator, governance-style)', () => {
  it('committed contracts match the generator (clean check)', () => {
    const result = runCheck(REPO_ROOT);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('drift check clean');
    expect(result.stdout).toContain('7 contract file(s)');
  });

  it('tampered contract fails the check', () => {
    const dir = tempCloneOfContracts();
    try {
      const target = join(dir, 'packages', 'payments', 'contracts', 'money.v1.json');
      const tampered = JSON.parse(readFileSync(target, 'utf-8')) as Record<string, unknown>;
      tampered['description'] = 'floats are fine actually';
      writeFileSync(target, `${JSON.stringify(tampered, null, 2)}\n`);
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('drifted generated contract: packages/payments/contracts/money.v1.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('missing contract fails the check', () => {
    const dir = tempCloneOfContracts();
    try {
      rmSync(join(dir, 'packages', 'payments', 'contracts', 'fee-split.v1.json'));
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('missing generated contract: packages/payments/contracts/fee-split.v1.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('extra contract file fails the check', () => {
    const dir = tempCloneOfContracts();
    try {
      writeFileSync(
        join(dir, 'packages', 'payments', 'contracts', 'rogue.v1.json'),
        '{}\n',
      );
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('unexpected extra contract file: packages/payments/contracts/rogue.v1.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
