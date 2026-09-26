/**
 * Contract drift suite — runs the A002 generator's --check against the
 * committed contracts and verifies that every drift class (tampered, missing,
 * extra) FAILS the check, exactly like the governance G9 fixtures do for the
 * A001 generator.
 *
 * This is the drift tripwire reachable from inside A002's owned surfaces:
 * `pnpm test` runs it (and CI runs the full battery). Wiring the A002
 * manifest into the repo-wide `pnpm governance` G9 entry point
 * (scripts/generate-contracts.mjs) is a one-line Tech Lead reconciliation
 * because scripts/ is outside A002's owned surfaces — see the final report.
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
  const dir = mkdtempSync(join(tmpdir(), 'arena-artifact-drift-'));
  cpSync(join(REPO_ROOT, 'contracts', 'artifacts'), join(dir, 'contracts', 'artifacts'), {
    recursive: true,
  });
  return dir;
}

describe('contract drift (A002 generator, governance-style)', () => {
  it('committed contracts match the generator (clean check)', () => {
    const result = runCheck(REPO_ROOT);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('drift check clean');
    expect(result.stdout).toContain('22 contract file(s)');
  });

  it('tampering with a committed contract FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      const target = join(dir, 'contracts', 'artifacts', 'publication.v1.json');
      const tampered = JSON.parse(readFileSync(target, 'utf-8')) as Record<string, unknown>;
      tampered['title'] = 'Hand-edited title (drift)';
      writeFileSync(target, `${JSON.stringify(tampered, null, 2)}\n`, 'utf-8');
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('DRIFT DETECTED');
      expect(result.stderr).toContain('drifted generated contract: contracts/artifacts/publication.v1.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deleting a committed contract FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      rmSync(join(dir, 'contracts', 'artifacts', 'rights.v1.json'));
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('missing generated contract: contracts/artifacts/rights.v1.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adding an unexpected extra contract file FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      writeFileSync(
        join(dir, 'contracts', 'artifacts', 'rogue.v1.json'),
        '{"$comment": "not generated"}\n',
        'utf-8',
      );
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('unexpected extra contract file: contracts/artifacts/rogue.v1.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
