/**
 * Hygiene suite (Work Order C002 services layer) — no provider-specific
 * strings or credential-shaped words in the service's non-test sources;
 * no `any` type leaks; coherent public surface. The deny-list lives
 * only in this test file, mirroring the sibling hygiene suites.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as escalationRoutingService from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const DENY_LIST = [
  'openai',
  'anthropic',
  'claude',
  'gemini',
  'gpt',
  'api[_-]?key',
  'secret',
  'token',
  'credential',
  'password',
  'bearer',
  'authorization',
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

describe('services hygiene — provider neutrality + typed surface', () => {
  it('non-test sources contain no provider/credential strings', () => {
    for (const file of listSourceFiles(join(PACKAGE_ROOT, 'src'))) {
      const source = readFileSync(file, 'utf-8');
      for (const pattern of DENY_LIST) {
        const matcher = new RegExp(pattern, 'i');
        expect(matcher.test(source), `${file} matches deny-list pattern /${pattern}/i`).toBe(false);
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

  it('exports a coherent public surface', () => {
    expect(typeof escalationRoutingService.EscalationRoutingService).toBe('function');
    expect(typeof escalationRoutingService.portDecisionOf).toBe('function');
    expect(typeof escalationRoutingService.InMemoryRoutingDecisionLog).toBe('function');
    expect(typeof escalationRoutingService.InMemoryRoutingJobStore).toBe('function');
    expect(escalationRoutingService.ROUTING_NO_MATCH_REASONS).toContain('no-qualified-expert');
    expect(escalationRoutingService.ROUTING_JOB_MAX_ATTEMPTS).toBe(3);
  });
});
