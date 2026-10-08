/**
 * Hygiene suite (Work Order C022) — provider neutrality, typed surface,
 * no wall-clock reads in non-test sources, test-support stays internal,
 * and no service imports (boundary rule B2).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as capabilityLearningService from './index.js';

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

describe('hygiene — provider neutrality + typed surface + boundary discipline', () => {
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

  it('the service reads time ONLY through the injected clock (no wall-clock reads)', () => {
    const files = listSourceFiles(join(PACKAGE_ROOT, 'src'));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source.includes('Date.now()'), `${file} must not call Date.now()`).toBe(false);
      expect(source.includes('new Date()'), `${file} must not construct an unseeded Date`).toBe(false);
    }
  });

  it('never imports another service package (boundary rule B2)', () => {
    const files = listSourceFiles(join(PACKAGE_ROOT, 'src'));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(
        /from\s+['"]@arena\/[a-z-]*service/.test(source),
        `${file} must not import a service package`,
      ).toBe(false);
      expect(
        /from\s+['"]@arena\/(learning-fabric|body-forge-fabric|capability-improvement-service)/.test(source),
        `${file} must not import a sibling service fabric`,
      ).toBe(false);
    }
  });

  it('the public index does NOT export the test-support fixtures', () => {
    const exported = Object.keys(capabilityLearningService);
    expect(exported).not.toContain('makeArm');
    expect(exported).not.toContain('makeCandidateInput');
    expect(exported).not.toContain('makeTrajectoryRecord');
  });

  it('exports the closed decision vocabulary (audit parity surface)', () => {
    expect(capabilityLearningService.COMPILER_DECISION_CODES.length).toBe(12);
    expect(capabilityLearningService.CAPABILITY_LEARNING_IMPLEMENTATION_VERSION).toBe('0.1.0');
  });
});
