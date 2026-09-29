/**
 * Hygiene tests for the service (Work Order A024) — append-only
 * discipline, closed surface, no mutation APIs, README disclosure.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as fabric from './index.js';

const SERVICE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Sibling registry write APIs the service must never call. */
const WRITE_API_DENY = ['registerbodyversion', 'appendtrajectoryentry'];

const FORBIDDEN_EXPORTS = [
  'updateRelease',
  'deleteRelease',
  'mutateRelease',
  'unpublishRelease',
  'deletePublication',
  'rewriteLedger',
];

function collectFiles(dir: string, filter: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...collectFiles(path, filter));
    } else if (filter(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

describe('hygiene — service discipline', () => {
  it('no source file calls sibling registry write APIs', () => {
    const sources = collectFiles(join(SERVICE_ROOT, 'src'), (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const token of WRITE_API_DENY) {
        expect(text, `${file} must not call ${token}`).not.toContain(token);
      }
    }
  });

  it('no mutation APIs exist on the service surface', () => {
    for (const name of FORBIDDEN_EXPORTS) {
      expect(fabric, `surface must not export ${name}`).not.toHaveProperty(name);
    }
  });

  it('the service surface exposes the reference fabric + envelope facade', () => {
    expect(Object.keys(fabric)).toContain('BodyRegistryService');
    expect(Object.keys(fabric)).toContain('BodyRegistryEnvelopeService');
    expect(Object.keys(fabric)).toContain('ensureBodyRegistryError');
  });

  it('the internal test-support module is NOT exported', () => {
    expect(Object.keys(fabric)).not.toContain('makeScenario');
    expect(Object.keys(fabric)).not.toContain('PUBLISHER');
  });

  it('no explicit `any` in non-test sources', () => {
    const sources = collectFiles(join(SERVICE_ROOT, 'src'), (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      expect(text.match(/:\s*any\b/g) ?? [], `${file} must not use explicit any`).toHaveLength(0);
    }
  });

  it('README exists and discloses the reference-fabric posture', () => {
    const readme = join(SERVICE_ROOT, 'README.md');
    expect(existsSync(readme)).toBe(true);
    const text = readFileSync(readme, 'utf8');
    expect(text.toLowerCase()).toContain('release');
    expect(text.toLowerCase()).toContain('fabric');
  });
});
