/**
 * Hygiene suite (Work Order C003, service) — provider neutrality, no
 * `any` leaks, coherent public surface. Mirrors the sibling suites.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as expertIntakeService from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const DENY_PATTERNS = [
  /\bopenai\b/i,
  /\banthropic\b/i,
  /\bclaude\b/i,
  /\bgemini\b/i,
  /\bgpt-[34]\b/i,
  /\bapi[_-]?key\b/i,
  /\bsecret\b/i,
  /\bpassword\b/i,
  /\bbearer\b/i,
];

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(join(dir, entry.name));
  }
  return files;
}

describe('service hygiene — provider neutrality + typed surface', () => {
  it('non-test sources contain no provider/credential-string patterns', () => {
    for (const file of listSourceFiles(join(PACKAGE_ROOT, 'src'))) {
      const source = readFileSync(file, 'utf-8');
      for (const pattern of DENY_PATTERNS) {
        expect(pattern.test(source), `${file} matches deny-list pattern ${pattern}`).toBe(false);
      }
    }
  });

  it('non-test sources leak no `any` type positions', () => {
    for (const file of listSourceFiles(join(PACKAGE_ROOT, 'src'))) {
      const source = readFileSync(file, 'utf-8');
      const anyTypePositions = source.match(/:\s*any\b/g) ?? [];
      expect(anyTypePositions, `${file} contains bare any type positions`).toHaveLength(0);
    }
  });

  it('exposes the documented public surface', () => {
    expect(typeof expertIntakeService.ExpertIntakeService).toBe('function');
    expect(typeof expertIntakeService.createExpertIntakeService).toBe('function');
    expect(typeof expertIntakeService.FakeRegistryProposalPort).toBe('function');
    expect(typeof expertIntakeService.FakeQualificationClaimPort).toBe('function');
    expect(typeof expertIntakeService.createServiceFixture).toBe('function');
  });
});
