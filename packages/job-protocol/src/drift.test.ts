/**
 * Contract drift suite — runs the A015 generator's --check against the
 * committed contracts and verifies that every drift class (tampered,
 * missing, extra) FAILS the check, exactly like the governance G9 fixtures
 * do for the A001 generator and like A002's drift suite.
 *
 * The package-level generator is ALSO wired into the repo-wide governance
 * G9 entry point (scripts/governance-check.py runs every package-level
 * generator under packages with a --check), so `pnpm check` covers
 * contracts/events drift centrally as well.
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
  const dir = mkdtempSync(join(tmpdir(), 'arena-events-drift-'));
  cpSync(join(REPO_ROOT, 'contracts', 'events'), join(dir, 'contracts', 'events'), {
    recursive: true,
  });
  return dir;
}

describe('contract drift (A015 generator, governance-style)', () => {
  it('committed contracts match the generator (clean check)', () => {
    const result = runCheck(REPO_ROOT);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('drift check clean');
    expect(result.stdout).toContain('14 contract file(s)');
  });

  it('tampering with a committed contract FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      const target = join(dir, 'contracts', 'events', 'job-record.v1.json');
      const tampered = JSON.parse(readFileSync(target, 'utf-8')) as Record<string, unknown>;
      tampered['title'] = 'Hand-edited title (drift)';
      writeFileSync(target, `${JSON.stringify(tampered, null, 2)}\n`, 'utf-8');
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('DRIFT DETECTED');
      expect(result.stderr).toContain(
        'drifted generated contract: contracts/events/job-record.v1.json',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deleting a committed contract FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      rmSync(join(dir, 'contracts', 'events', 'audit-record.v1.json'));
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'missing generated contract: contracts/events/audit-record.v1.json',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adding an unexpected extra contract file FAILS the check', () => {
    const dir = tempCloneOfContracts();
    try {
      writeFileSync(
        join(dir, 'contracts', 'events', 'rogue.v1.json'),
        '{"$comment": "not generated"}\n',
        'utf-8',
      );
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'unexpected extra contract file: contracts/events/rogue.v1.json',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the generator lists its manifest and refuses unknown flags', () => {
    const listing = execFileSync(process.execPath, [GENERATOR, '--list'], { encoding: 'utf-8' });
    expect(listing).toContain('job-protocol/job-definition -> contracts/events/job-definition.v1.json');
    expect(listing).toContain('job-protocol/schema-registry -> contracts/events/schema-registry.v1.json');
    let status = 0;
    try {
      execFileSync(process.execPath, [GENERATOR, '--bogus'], { encoding: 'utf-8' });
    } catch (error) {
      status = (error as { status?: number }).status ?? 1;
    }
    expect(status).toBe(2);
  });
});
