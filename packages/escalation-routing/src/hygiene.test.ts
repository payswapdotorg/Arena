/**
 * Hygiene suite (Work Order C002) — provider neutrality, no `any` leaks,
 * coherent public surface. Mirrors the sibling hygiene suites.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as escalationRouting from './index.js';

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

describe('package hygiene — provider neutrality + typed surface', () => {
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
    expect(typeof escalationRouting.compileDemandProfile).toBe('function');
    expect(typeof escalationRouting.routeEscalation).toBe('function');
    expect(typeof escalationRouting.createRoutingCandidate).toBe('function');
    expect(typeof escalationRouting.appendRoutingDecision).toBe('function');
    expect(typeof escalationRouting.verifyRoutingDecisionChain).toBe('function');
    expect(escalationRouting.ELIMINATION_REASONS).toContain('blocked-by-coi');
    expect(escalationRouting.ELIMINATION_REASONS).toContain('blocked-by-privacy');
    expect(escalationRouting.ROUTING_OUTCOMES).toContain('matched');
    expect(escalationRouting.UNDER_SPECIFIED_REASONS).toContain('capability-need-unresolved');
    expect(escalationRouting.NOT_DERIVABLE_REASONS).toContain('graph-missing');
    expect(escalationRouting.ESCALATION_ROUTING_VERSION).toBe(1);
  });
});
