/**
 * Hygiene suite (Work Order C022) — provider neutrality, typed surface,
 * no wall-clock reads in non-test sources, and the test-support module
 * stays internal.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as capabilityLearning from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

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

describe('hygiene — provider neutrality + typed surface + determinism discipline', () => {
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

  it('non-test sources never read the wall clock (deterministic compilation)', () => {
    const files = listSourceFiles(join(PACKAGE_ROOT, 'src'));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source.includes('Date.now()'), `${file} must not call Date.now()`).toBe(false);
      expect(source.includes('new Date()'), `${file} must not construct an unseeded Date`).toBe(false);
    }
  });

  it('the package never imports another service (boundary rule B2)', () => {
    const files = listSourceFiles(join(PACKAGE_ROOT, 'src'));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(
        /from\s+['"]@arena\/[a-z-]*service/.test(source),
        `${file} must not import a service package`,
      ).toBe(false);
      expect(
        /from\s+['"]\.\.\/\.\.\/services\//.test(source),
        `${file} must not import from services/`,
      ).toBe(false);
    }
  });

  it('the public index does NOT export the test-support fixtures', async () => {
    const exported = Object.keys(capabilityLearning);
    expect(exported).not.toContain('makeCandidate');
    expect(exported).not.toContain('makeRunRecord');
    expect(exported).not.toContain('makeCandidateInput');
    expect(exported).not.toContain('test-support');
  });

  it('exports the closed vocabularies (parity surface)', () => {
    expect(capabilityLearning.CANDIDATE_SOURCE_KINDS.length).toBe(6);
    expect(capabilityLearning.COMPILE_BLOCK_REASONS.length).toBe(3);
    expect(capabilityLearning.ADOPTION_GATE_VERDICTS.length).toBe(3);
    expect(capabilityLearning.PROPOSAL_DESTINATIONS.length).toBe(3);
    expect(capabilityLearning.CAPABILITY_LEARNING_PROTOCOL_VERSION).toBe(1);
  });
});
