/**
 * Hygiene suite for @arena/marketplace-artifacts-fabric (Work Order
 * A032): purity (no fs/network/process/env/random in non-test sources),
 * boundary discipline (no service imports — B2), closed vocabulary
 * reuse, no explicit any, test-support not exported, battery wiring.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as index from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const SERVICE_IMPORT_DENY = [
  '@arena/artifact-service',
  '@arena/api-fabric',
  '@arena/verification-fabric',
  '@arena/evaluation-fabric',
  '@arena/body-registry-fabric',
  '@arena/security-service',
  '@arena/certification-fabric',
];

const PURITY_DENY = [
  'node:fs',
  'fetch(',
  'process.env',
  'Math.random',
  'Date.now',
  'new Date(',
  'sqlite',
  'postgres',
  'createConnection',
];

function collectSources(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSources(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

describe('hygiene: layering (B2) and purity', () => {
  it('the fabric never imports another service (services communicate via versioned contracts)', () => {
    const sources = collectSources(join(PACKAGE_ROOT, 'src'));
    expect(sources.length).toBeGreaterThan(8);
    for (const source of sources) {
      const text = readFileSync(source, 'utf-8');
      for (const denied of SERVICE_IMPORT_DENY) {
        expect(text.includes(denied)).toBe(false);
      }
    }
  });

  it('non-test sources are pure: no fs/network/env/random/now/db vocabulary', () => {
    const sources = collectSources(join(PACKAGE_ROOT, 'src'));
    for (const source of sources) {
      const text = readFileSync(source, 'utf-8');
      for (const denied of PURITY_DENY) {
        expect(text.includes(denied), `${source} contains ${denied}`).toBe(false);
      }
    }
  });

  it('no explicit any annotations in non-test sources', () => {
    const sources = collectSources(join(PACKAGE_ROOT, 'src'));
    for (const source of sources) {
      const text = readFileSync(source, 'utf-8');
      expect(text.match(/:\s*any\b/g) ?? []).toHaveLength(0);
    }
  });

  it('test-support fixtures are NOT exported from the package surface', () => {
    for (const fixtureExport of [
      'seedMarketplaceFabric',
      'makeOfferCandidate',
      'makeEvidenceArtifact',
      'TestLcg',
      'makeEvidencedSubjectFor',
    ]) {
      expect((index as Record<string, unknown>)[fixtureExport]).toBeUndefined();
    }
  });

  it('the core service exports exist and no mutation API is exposed', () => {
    expect(index.MarketplaceArtifactsFabric).toBeDefined();
    expect(index.MarketplaceArtifactsService).toBeDefined();
    expect(index.createMarketplaceArtifactsFabric).toBeDefined();
    expect(index.createMarketplaceArtifactsService).toBeDefined();
    for (const forbidden of ['deleteOffer', 'updateOffer', 'clear', 'mutateRecord']) {
      expect(index.MarketplaceArtifactsFabric.prototype).not.toHaveProperty(forbidden);
    }
  });

  it('closed vocabularies are frozen', () => {
    expect(Object.isFrozen(index.MARKETPLACE_QUERY_KINDS)).toBe(true);
    expect(Object.isFrozen(index.MARKETPLACE_OFFER_KINDS)).toBe(true);
    expect(Object.isFrozen(index.MARKETPLACE_ARTIFACT_KINDS)).toBe(true);
    expect(Object.isFrozen(index.MARKETPLACE_REVIEW_RATINGS)).toBe(true);
    expect(Object.isFrozen(index.MARKETPLACE_REVIEW_VERDICTS)).toBe(true);
    expect(Object.isFrozen(index.MARKETPLACE_GATE_REJECTION_REASONS)).toBe(true);
    expect(Object.isFrozen(index.MARKETPLACE_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(index.MARKETPLACE_SCHEMAS)).toBe(true);
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
    expect(readme.toLowerCase()).toContain('a032');
  });
});
