/**
 * Hygiene suite (Work Order C007; architecture-lock rules 10, 23):
 *
 *   1. Public-surface hygiene — no `any` type leaks in the non-test
 *      sources (type-position scan).
 *   2. Provider-leakage hygiene — no model/provider or runtime tokens
 *      in the package's non-test sources.
 *
 * The deny-list lives only in this test file (the checker must not be
 * part of the scanned surface), mirroring the sibling hygiene suites.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as intervention from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Model/provider and runtime tokens (case-insensitive substring). */
const DENY_LIST = [
  'openai',
  'anthropic',
  'claude',
  'gemini',
  'gpt-',
  'docker',
  'podman',
  'firecracker',
  'containerd',
  'gvisor',
  'qemu',
  'vmware',
  'vercel',
  'neon',
  'upstash',
  'r2 bucket',
  'apify',
];

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) continue;
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path);
  }
  return files;
}

describe('hygiene — provider neutrality + typed surface', () => {
  it('non-test sources contain no provider/runtime tokens', () => {
    const files = listSourceFiles(join(PACKAGE_ROOT, 'src'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const lower = source.toLowerCase();
      for (const token of DENY_LIST) {
        expect(lower.includes(token), `${file} must not contain '${token}'`).toBe(false);
      }
    }
  });

  it('non-test sources contain no `any` type positions', () => {
    const files = listSourceFiles(join(PACKAGE_ROOT, 'src'));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(/:\s*any\b/.test(source), `${file} must not use ': any'`).toBe(false);
      expect(/as\s+any\b/.test(source), `${file} must not use 'as any'`).toBe(false);
    }
  });

  it('no wall-clock reads in non-test sources (lock rule 17)', () => {
    const files = listSourceFiles(join(PACKAGE_ROOT, 'src'));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source.includes('Date.now()'), `${file} must not read the wall clock`).toBe(false);
    }
  });

  it('exports the documented public surface', () => {
    expect(typeof intervention.createInterventionResult).toBe('function');
    expect(typeof intervention.checkModeAuthorization).toBe('function');
    expect(typeof intervention.checkModeTransition).toBe('function');
    expect(typeof intervention.buildInterventionTrajectory).toBe('function');
    expect(typeof intervention.assertNoPrivateReasoning).toBe('function');
    expect(typeof intervention.assertNoLiveWorldMutation).toBe('function');
    expect(typeof intervention.InterventionError).toBe('function');
    expect(intervention.INTERVENTION_MODE_TABLE.solve.sessionMode).toBe('takeover');
  });
});
