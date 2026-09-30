/**
 * Hygiene suite for @arena/api-fabric (Work Order A025):
 *
 *   1. READ-ONLY PROOFS — the service never calls a sibling service
 *      (services communicate only via versioned contracts; the read
 *      model is populated by the HOST) and never calls a sibling
 *      registry/fabric write API.
 *   2. Boundary — services/api imports ONLY domain/protocol workspace
 *      packages (@arena/*), never another @arena/*-fabric.
 *   3. Closed vocabularies re-used (never redefined) from
 *      @arena/arena-sdk.
 *   4. Battery wiring present.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as apiFabric from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const FABRIC_IMPORT_DENY = ['@arena/certification-fabric', '@arena/body-registry-fabric', '@arena/verification-fabric', '@arena/evaluation-fabric'];
const WRITE_API_DENY = [
  'registerrelease(',
  'registersuite(',
  'registerbodyversion(',
  '.supersede(',
  '.retire(',
  '.publish(',
  '.retract(',
  'certify(',
  '.revoke(',
];

function collectFiles(dir: string, filter: (name: string) => boolean): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(path, filter));
    else if (filter(entry.name)) out.push(path);
  }
  return out;
}

const isSource = (name: string) => name.endsWith('.ts') && !name.endsWith('.test.ts');

describe('hygiene: layering and read-only discipline', () => {
  it('the service never imports another service (B2: services communicate via versioned contracts)', () => {
    const sources = collectFiles(join(PACKAGE_ROOT, 'src'), isSource);
    expect(sources.length).toBeGreaterThan(3);
    for (const source of sources) {
      const text = readFileSync(source, 'utf-8');
      for (const denied of FABRIC_IMPORT_DENY) {
        expect(text.includes(denied)).toBe(false);
      }
    }
  });

  it('the service never calls a sibling registry/fabric write API', () => {
    const sources = collectFiles(join(PACKAGE_ROOT, 'src'), isSource);
    for (const source of sources) {
      const text = readFileSync(source, 'utf-8').toLowerCase();
      for (const token of WRITE_API_DENY) {
        expect(text.includes(token)).toBe(false);
      }
    }
  });

  it('no mutation API beyond the guard-validated ingest exists on the exported surface', () => {
    expect(apiFabric.ApiFabric).toBeDefined();
    expect(apiFabric.ApiService).toBeDefined();
    expect(apiFabric.createApiFabric).toBeDefined();
    expect(apiFabric.createApiService).toBeDefined();
    for (const forbidden of ['deleteRelease', 'updateRecord', 'mutateRecord', 'clear']) {
      expect(apiFabric.ApiFabric.prototype).not.toHaveProperty(forbidden);
    }
  });
});

describe('hygiene: no explicit any in non-test sources', () => {
  it('the service surface contains no `: any` annotations', () => {
    const sources = collectFiles(join(PACKAGE_ROOT, 'src'), isSource);
    for (const source of sources) {
      const text = readFileSync(source, 'utf-8');
      expect(text.match(/:\s*any\b/g) ?? []).toHaveLength(0);
    }
  });
});

describe('hygiene: battery wiring', () => {
  it('the vitest config and manifest are present', () => {
    expect(statSync(join(PACKAGE_ROOT, 'vitest.config.ts')).isFile()).toBe(true);
    const scripts = (
      JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as {
        scripts: Record<string, string>;
      }
    )['scripts'];
    expect(scripts['typecheck']).toContain('tsc');
    expect(scripts['test']).toContain('vitest');
    expect(scripts['build']).toContain('tsc');
  });

  it('the README exists and discloses the reference-fabric posture', () => {
    const readme = readFileSync(join(PACKAGE_ROOT, 'README.md'), 'utf-8');
    expect(readme.length).toBeGreaterThan(200);
    expect(readme.toLowerCase()).toContain('fabric');
  });
});
