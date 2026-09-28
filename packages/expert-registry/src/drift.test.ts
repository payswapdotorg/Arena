/**
 * Contract drift suite (Work Order A006 gate 10) — runs the A006
 * generator's --check against the committed contracts and verifies that
 * every drift class (tampered, missing, extra) FAILS the check, exactly
 * like the governance G9 fixtures do for the A001/A002/A004/A005
 * generators.
 *
 * The package script `contracts:check` runs this directly, `pnpm test` runs
 * it as part of the battery, and the repo-wide governance G9 entry point
 * runs every package-level generator — so this drift tripwire is reachable
 * from three independent places without any root file edit.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(dirnameOf(import.meta.url), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');
const GENERATOR = join(PACKAGE_ROOT, 'scripts', 'generate-contracts.mjs');

function dirnameOf(moduleUrl: string): string {
  return fileURLToPath(new URL('.', moduleUrl));
}

function runCheck(againstDir: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      [GENERATOR, '--check', '--against', againstDir],
      {
        encoding: 'utf-8',
      },
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
  const dir = mkdtempSync(join(tmpdir(), 'arena-expert-contracts-drift-'));
  cpSync(
    join(REPO_ROOT, 'contracts', 'expert'),
    join(dir, 'contracts', 'expert'),
    { recursive: true },
  );
  return dir;
}

describe('contract drift (A006 generator, governance-style)', () => {
  it('committed contracts match the generator (clean check)', () => {
    const result = runCheck(REPO_ROOT);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('drift check clean');
    expect(result.stdout).toContain('41 contract file(s)');
  });

  it('tampering with a committed contract FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      const target = join(dir, 'contracts', 'expert', 'profile.v1.json');
      const tampered = JSON.parse(readFileSync(target, 'utf-8')) as Record<string, unknown>;
      tampered['title'] = 'Hand-edited title (drift)';
      writeFileSync(target, `${JSON.stringify(tampered, null, 2)}\n`, 'utf-8');
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('DRIFT DETECTED');
      expect(result.stderr).toContain(
        'drifted generated contract: contracts/expert/profile.v1.json',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deleting a committed contract FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      rmSync(join(dir, 'contracts', 'expert', 'evidence-ref.v1.json'));
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'missing generated contract: contracts/expert/evidence-ref.v1.json',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adding an unexpected extra contract file FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      writeFileSync(
        join(dir, 'contracts', 'expert', 'rogue.v1.json'),
        '{"$comment": "not generated"}\n',
        'utf-8',
      );
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'unexpected extra contract file: contracts/expert/rogue.v1.json',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
