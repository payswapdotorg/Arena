/**
 * Hygiene suite (Work Order C001; architecture-lock rules 10, 23):
 *
 *   1. Public-surface hygiene — no `any` type leaks in the non-test
 *      sources (type-position scan).
 *   2. Provider-leakage hygiene — no provider-specific strings or
 *      credential-shaped words in the package's non-test sources, the
 *      contract generator, or the committed generated contracts.
 *
 * The deny-list lives only in this test file (the checker must not be part
 * of the scanned surface), mirroring the A002/A015 hygiene suites.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as escalation from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/** Model/provider names and credential-shaped words (case-insensitive). */
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
    const path = join(dir, entry.name);
    if (entry.isDirectory()) continue;
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path);
  }
  return files;
}

describe('hygiene — provider neutrality + typed surface', () => {
  it('non-test sources contain no provider/credential strings', () => {
    const files = [
      ...listSourceFiles(join(PACKAGE_ROOT, 'src')),
      join(PACKAGE_ROOT, 'scripts', 'generate-contracts.mjs'),
    ];
    const contractDir = join(REPO_ROOT, 'contracts', 'escalation');
    const contractFiles = existsSync(contractDir)
      ? readdirSync(contractDir)
          .filter((name) => name.endsWith('.json'))
          .map((name) => join(contractDir, name))
      : [];
    for (const file of [...files, ...contractFiles]) {
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
    expect(typeof escalation.createEscalationRequest).toBe('function');
    expect(typeof escalation.createEscalationRecord).toBe('function');
    expect(typeof escalation.checkEscalationTransition).toBe('function');
    expect(typeof escalation.applyEscalationTransition).toBe('function');
    expect(typeof escalation.createEscalationResult).toBe('function');
    expect(typeof escalation.createEscalationWebhookEvent).toBe('function');
    expect(typeof escalation.resolveEscalationIdempotency).toBe('function');
    expect(escalation.ESCALATION_STATES.length).toBe(18);
    expect(escalation.ESCALATION_WEBHOOK_EVENT_TYPES.length).toBe(13);
    expect(escalation.ESCALATION_RESULT_KINDS.length).toBe(11);
    expect(statSync(join(PACKAGE_ROOT, 'scripts', 'generate-contracts.mjs')).isFile()).toBe(true);
  });
});
