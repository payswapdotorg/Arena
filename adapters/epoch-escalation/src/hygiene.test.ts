/**
 * Hygiene suite (Work Order C019; architecture-lock rules 10, 23, 36):
 *
 *   1. Provider/credential-leakage hygiene — no provider-specific
 *      strings or credential-shaped words in the non-test sources.
 *   2. Typed-surface hygiene — no `any` type positions.
 *   3. Boundary hygiene — the package imports ONLY domain/protocol
 *      packages (never services, never other adapters — boundary rules
 *      B3/B4), and exports NO Epoch write-back surface.
 *   4. Coherent public surface (the C019 contract anchors).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as epochEscalation from './index.js';

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

describe('hygiene — provider neutrality + typed + bounded surface', () => {
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

  it('imports ONLY domain/protocol packages — never services, never other adapters', () => {
    for (const file of listSourceFiles(join(PACKAGE_ROOT, 'src'))) {
      const source = readFileSync(file, 'utf-8');
      const imports = [
        ...source.matchAll(/from\s+['"](@arena\/[a-z0-9-]+)['"]/g),
        ...source.matchAll(/import\s+['"](@arena\/[a-z0-9-]+)['"]/g),
      ].map((match) => match[1]);
      for (const specifier of imports) {
        // Resolve by PACKAGE NAME (a directory name alone is ambiguous:
        // adapters/escalation publishes @arena/escalation-adapters).
        const roots = ['packages', 'services', 'adapters', 'bodies', 'environments', 'apps'];
        const candidates = roots
          .flatMap((root) => readdirSync(join(REPO_ROOT, root)).map((entry) => join(REPO_ROOT, root, entry)))
          .filter((dir) => {
            const manifest = join(dir, 'package.json');
            if (!existsSync(manifest)) return false;
            try {
              return JSON.parse(readFileSync(manifest, 'utf-8'))['name'] === specifier;
            } catch {
              return false;
            }
          });
        expect(candidates, `${file} imports ${specifier} which resolves nowhere`).toHaveLength(1);
        const resolved = candidates[0] ?? '';
        expect(
          resolved.startsWith(join(REPO_ROOT, 'packages')),
          `${file} imports ${specifier} outside the domain/protocol package layer (boundary rules B3/B4)`,
        ).toBe(true);
      }
    }
  });

  it('exports NO Epoch write-back surface (structural unrepresentability)', () => {
    const surface = Object.keys(epochEscalation);
    // No function whose name suggests writing into Epoch stores — the
    // only write-named exports are the fail-closed denial surface and
    // its structural guard (a predicate, never a mutation).
    const writeish = surface.filter((name) => /write|mutate|apply|upsert|patch|execute/i.test(name));
    expect(writeish.sort()).toEqual(['attemptEpochAuthoritativeWrite', 'isEpochAuthoritativeWriteAttempt']);
    // ...and that single entry point ALWAYS fails closed (authority.test).
    expect(() =>
      epochEscalation.attemptEpochAuthoritativeWrite({
        attemptKind: 'epoch-authoritative-write-attempt',
        store: 'world-model',
      }),
    ).toThrowError(epochEscalation.EpochEscalationError);
    // No exported type surface accepts an Epoch store handle: the public
    // factories take triggers/postures/records/events only.
    expect(typeof epochEscalation.buildEscalationRequest).toBe('function');
    expect(typeof epochEscalation.epochDeliveryFromRecord).toBe('function');
    expect(typeof epochEscalation.consumeEpochWebhook).toBe('function');
  });

  it('exports a coherent public surface (C019 contract anchors)', () => {
    expect(epochEscalation.EPOCH_ESCALATION_ADAPTER_PROTOCOL_VERSION).toBe('EPI1.0+ES1.0');
    expect(epochEscalation.EPOCH_ESCALATION_AUTHORITY_BOUNDARY.clauses).toHaveLength(6);
    expect(epochEscalation.EPOCH_TRIGGER_TYPES).toHaveLength(3);
    expect(epochEscalation.EPOCH_ESCALATION_MODES).toHaveLength(8);
    expect(epochEscalation.EPOCH_DELIVERY_REF_KINDS).toHaveLength(5);
    expect(epochEscalation.EPOCH_WEBHOOK_REJECTION_REASONS).toHaveLength(10);
    expect(epochEscalation.SUPPORTED_EPOCH_ESCALATION_ERROR_CODES).toHaveLength(10);
    expect(statSync(join(PACKAGE_ROOT, 'package.json')).isFile()).toBe(true);
  });
});
