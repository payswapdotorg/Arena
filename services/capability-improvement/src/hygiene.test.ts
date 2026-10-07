/**
 * Hygiene suite (Work Order C008) — the service surface must stay
 * provider-neutral (no model/provider or runtime tokens in non-test
 * sources) and typed (no `any` leaks), and must never import another
 * service's internals (boundary rule B2 — checked repo-wide by the
 * boundary checker; asserted structurally here for the port surface).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as capabilityImprovement from './index.js';

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

describe('hygiene — provider neutrality + typed surface + no service imports', () => {
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

  it('non-test sources never import another service (boundary rule B2)', () => {
    const files = listSourceFiles(join(PACKAGE_ROOT, 'src'));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const matches = source.match(/import\s[^;]*from\s+'@arena\/[a-z0-9-]*(?:-service)?(?:\/[a-z0-9./-]+)?';/g) ?? [];
      for (const match of matches) {
        expect(match, `${file} must not import another service`).not.toMatch(
          /@arena\/[a-z0-9-]*-service(?!-capability-improvement)/,
        );
      }
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
    expect(typeof capabilityImprovement.CapabilityImprovementService).toBe('function');
    expect(typeof capabilityImprovement.InMemoryInterventionOutcomePort).toBe('function');
    expect(typeof capabilityImprovement.InMemoryToolGapSignalLedger).toBe('function');
    expect(typeof capabilityImprovement.InMemoryKnowledgeLatticeLedger).toBe('function');
    expect(typeof capabilityImprovement.InMemoryDispositionAuditSink).toBe('function');
    expect(capabilityImprovement.DISPOSITION_DECISION_CODES).toContain('signal_captured');
    expect(capabilityImprovement.DISPOSITION_DECISION_CODES).toContain('promotion_denied');
    expect(capabilityImprovement.DISPOSITION_DECISION_CODES).toContain('learning_candidate_proposed');
    expect(typeof capabilityImprovement.CapabilityImprovementError).toBe('function');
  });
});
