/**
 * Contract drift suite (Work Order A008) — runs the A008 generator's
 * --check against the committed contracts and verifies that every drift
 * class (tampered, missing, extra) FAILS the check, exactly like the
 * governance G9 fixtures do for the sibling generators.
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

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');
const GENERATOR = join(PACKAGE_ROOT, 'scripts', 'generate-contracts.mjs');

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
  const dir = mkdtempSync(join(tmpdir(), 'arena-task-spec-drift-'));
  cpSync(join(REPO_ROOT, 'contracts', 'task'), join(dir, 'contracts', 'task'), {
    recursive: true,
  });
  return dir;
}

describe('contract drift (A008 generator, governance-style)', () => {
  it('committed contracts match the generator (clean check)', () => {
    const result = runCheck(REPO_ROOT);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('drift check clean');
    expect(result.stdout).toContain('8 contract file(s)');
  });

  it('tampering with a committed contract FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      const target = join(dir, 'contracts', 'task', 'task-spec.v1.json');
      const tampered = JSON.parse(readFileSync(target, 'utf-8')) as Record<string, unknown>;
      tampered['title'] = 'Hand-edited title (drift)';
      writeFileSync(target, `${JSON.stringify(tampered, null, 2)}\n`, 'utf-8');
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('DRIFT DETECTED');
      expect(result.stderr).toContain(
        'drifted generated contract: contracts/task/task-spec.v1.json',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deleting a committed contract FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      rmSync(join(dir, 'contracts', 'task', 'compilation-policy.v1.json'));
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'missing generated contract: contracts/task/compilation-policy.v1.json',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adding an unexpected extra contract file FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      writeFileSync(
        join(dir, 'contracts', 'task', 'rogue.v1.json'),
        '{"$comment": "not generated"}\n',
        'utf-8',
      );
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'unexpected extra contract file: contracts/task/rogue.v1.json',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
