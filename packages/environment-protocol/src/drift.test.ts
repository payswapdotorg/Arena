/**
 * Contract drift suite — runs the A009 generator's --check against the
 * committed contracts and verifies that every drift class (tampered,
 * missing, extra) FAILS the check, exactly like the governance G9 fixtures
 * do for the A001 generator and like the A002 drift suite does for the
 * artifact generator.
 *
 * The governance G9 check auto-discovers this package-level generator
 * (scripts/governance-check.py globs every package generator under
 * packages/<name>/scripts), so this suite is the in-package tripwire
 * reachable from `pnpm test`.
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

function runCheck(againstDir: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [GENERATOR, '--check', '--against', againstDir], {
      encoding: 'utf-8',
    });
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
  const dir = mkdtempSync(join(tmpdir(), 'arena-environment-drift-'));
  cpSync(join(REPO_ROOT, 'contracts', 'environment'), join(dir, 'contracts', 'environment'), {
    recursive: true,
  });
  return dir;
}

describe('contract drift (A009 generator, governance-style)', () => {
  it('committed contracts match the generator (clean check)', () => {
    const result = runCheck(REPO_ROOT);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('drift check clean');
    expect(result.stdout).toContain('26 contract file(s)');
  });

  it('tampering with a committed contract FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      const target = join(dir, 'contracts', 'environment', 'network-policy.v1.json');
      const tampered = JSON.parse(readFileSync(target, 'utf-8')) as Record<string, unknown>;
      tampered['title'] = 'Hand-edited title (drift)';
      writeFileSync(target, `${JSON.stringify(tampered, null, 2)}\n`, 'utf-8');
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('DRIFT DETECTED');
      expect(result.stderr).toContain(
        'drifted generated contract: contracts/environment/network-policy.v1.json',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deleting a committed contract FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      rmSync(join(dir, 'contracts', 'environment', 'seed-policy.v1.json'));
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'missing generated contract: contracts/environment/seed-policy.v1.json',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adding an unexpected extra contract file FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      writeFileSync(
        join(dir, 'contracts', 'environment', 'rogue.v1.json'),
        '{"$comment": "not generated"}\n',
        'utf-8',
      );
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'unexpected extra contract file: contracts/environment/rogue.v1.json',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
