/**
 * Hygiene suite (Work Order C008) — provider neutrality (no model/provider
 * or runtime tokens in non-test sources), no `any` leaks, and the documented
 * public surface.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as knowledgeCapture from './index.js';

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
    expect(knowledgeCapture.KNOWLEDGE_SCOPE_KINDS).toContain('task');
    expect(knowledgeCapture.KNOWLEDGE_SCOPE_KINDS).toContain('jurisdiction');
    expect(typeof knowledgeCapture.createLatticeKnowledgeRecord).toBe('function');
    expect(typeof knowledgeCapture.promoteLatticeKnowledge).toBe('function');
    expect(typeof knowledgeCapture.checkKnowledgePromotion).toBe('function');
    expect(typeof knowledgeCapture.createKnowledgePatch).toBe('function');
    expect(typeof knowledgeCapture.parseScopeDeclaration).toBe('function');
    expect(typeof knowledgeCapture.KnowledgeCaptureError).toBe('function');
    expect(knowledgeCapture.KNOWLEDGE_PROMOTION_REASONS).toContain('wall_overgeneralization');
  });
});
