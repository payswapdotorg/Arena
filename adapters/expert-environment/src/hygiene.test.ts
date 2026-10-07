/**
 * Hygiene suite (Work Order C006; architecture-lock rules 10, 23) — the
 * adapter surface must stay provider-neutral (no model/provider or
 * runtime tokens in non-test sources) and typed (no `any` leaks).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as expertEnvironment from './index.js';

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
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const token of DENY_LIST) {
        expect(text.includes(token), `${file} must not contain '${token}'`).toBe(false);
      }
    }
  });

  it('non-test sources contain no `any` type leaks', () => {
    const files = listSourceFiles(join(PACKAGE_ROOT, 'src'));
    const anyPattern = /(?::|\bas\b|\()\s*any\b/;
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
        expect(anyPattern.test(line), `${file}:${index + 1} must not use the any type`).toBe(false);
      });
    }
  });

  it('package surface exports the materializer + source builder', () => {
    expect(typeof expertEnvironment.ExpertEnvironmentMaterializer).toBe('function');
    expect(typeof expertEnvironment.executionCapsuleSourceFromDefinition).toBe('function');
  });
});
