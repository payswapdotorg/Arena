/**
 * Hygiene suite (Work Order C001 adapters layer) — provider neutrality,
 * typed surface, and the adapter law: this package's non-test sources
 * import ONLY node: builtins and relative modules (pure structural
 * ports; never domain/service internals). The deny-list lives only in
 * this test file, mirroring the sibling hygiene suites.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as escalationAdapters from './index.js';

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

describe('adapters hygiene — provider neutrality + structural-port purity', () => {
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

  it('non-test sources import only node: builtins and relative modules (adapter law)', () => {
    const importPattern = /(?:import|export)\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
    for (const file of listSourceFiles(join(PACKAGE_ROOT, 'src'))) {
      const source = readFileSync(file, 'utf-8');
      let match: RegExpExecArray | null;
      while ((match = importPattern.exec(source)) !== null) {
        const spec = match[1]!;
        const workspaceImport = spec.startsWith('@arena/');
        expect(workspaceImport, `${file} imports workspace package ${spec} — adapters stay on structural ports`).toBe(false);
      }
    }
  });

  it('exports a coherent public surface', () => {
    expect(typeof escalationAdapters.WebhookDeliveryAdapter).toBe('function');
    expect(typeof escalationAdapters.hmacSha256WebhookSigner).toBe('function');
    expect(typeof escalationAdapters.verifyWebhookSignature).toBe('function');
    expect(typeof escalationAdapters.McpStdioTransport).toBe('function');
    expect(escalationAdapters.DEFAULT_WEBHOOK_BACKOFF.maxAttempts).toBe(5);
    expect(escalationAdapters.WEBHOOK_HEADER_NAMES.eventId).toBe('x-arena-event-id');
    expect(escalationAdapters.MCP_TRANSPORT_ERROR_CODES.PARSE_ERROR).toBe(-32700);
  });
});
