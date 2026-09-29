/**
 * Hygiene suite (Work Order A020, fabric side):
 *
 *   1. The learning boundary (lock rule 6): run() leaves every input
 *      record bit-identical AND frozen; the engine exports no
 *      rewrite/mutation APIs (no update/delete paths on the ledger).
 *   2. Public-surface hygiene: the internal test-support module is
 *      not exported; the fabric's runtime dependency posture stays
 *      in-process (no network, no fs, no database imports).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestCanonical } from '@arena/protocol-core';
import * as fabric from './index.js';
import { ExperimentEngine } from './index.js';
import { CORR_ID, T7, makeArms, makeDescriptor } from './test-support.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const MUTATION_DENY = ['rewrite', 'mutate', 'replac', 'overwrit', 'updat', 'delet'];

describe('learning boundary hygiene (fabric side, lock rule 6)', () => {
  it('the fabric surface exports no rewrite/mutation APIs', () => {
    const exportNames = Object.keys(fabric);
    expect(exportNames).toContain('ExperimentEngine');
    expect(exportNames).toContain('ExperimentRegistry');
    for (const name of exportNames) {
      for (const token of MUTATION_DENY) {
        expect(name.toLowerCase()).not.toContain(token);
      }
    }
  });

  it('the engine class has no update/delete methods (append-only ledger)', () => {
    const methodNames = Object.getOwnPropertyNames(ExperimentEngine.prototype);
    expect(methodNames).toContain('run');
    expect(methodNames).toContain('append');
    for (const name of methodNames) {
      for (const token of ['rewrite', 'mutate', 'update', 'delete', 'replace']) {
        expect(name.toLowerCase()).not.toContain(token);
      }
    }
  });

  it('run() leaves every source record bit-identical (canonical digests)', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms();
    const sources = [
      ...arms.baseline.trajectories,
      ...arms.baseline.evaluations,
      ...arms.baseline.verifications,
      ...arms.intervention.trajectories,
      ...arms.intervention.evaluations,
      ...arms.intervention.verifications,
    ];
    const before = await Promise.all(sources.map((source) => digestCanonical(source)));
    await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-hygiene-0001',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    const after = await Promise.all(sources.map((source) => digestCanonical(source)));
    expect(after).toEqual(before);
  });

  it('the records emitted by the engine are frozen', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms();
    const record = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-hygiene-0002',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.baseline)).toBe(true);
    expect(Object.isFrozen(record.verdict)).toBe(true);
  });
});

describe('public-surface hygiene (fabric side)', () => {
  it('the internal test-support module is NOT exported', () => {
    const exportNames = Object.keys(fabric);
    expect(exportNames).not.toContain('makeArms');
    expect(exportNames).not.toContain('makeDescriptor');
    expect(exportNames).not.toContain('TestLcg');
  });

  it('no network/database/filesystem runtime imports in the non-test sources', () => {
    const sources = readdirSync(join(PACKAGE_ROOT, 'src'))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts')
      .map((name) => join(PACKAGE_ROOT, 'src', name));
    expect(sources.length).toBeGreaterThanOrEqual(3);
    for (const source of sources) {
      const text = readFileSync(source, 'utf-8');
      expect(text).not.toMatch(/from\s+['"]node:(?:net|http|https|fs|os|dns|tls|worker_threads)/);
      expect(text).not.toMatch(/from\s+['"](?:pg|mysql|redis|mongodb|sqlite)/);
    }
  });

  it('the package ships the two source modules + tests only', () => {
    expect(existsSync(join(PACKAGE_ROOT, 'src', 'engine.ts'))).toBe(true);
    expect(existsSync(join(PACKAGE_ROOT, 'src', 'registry.ts'))).toBe(true);
    expect(existsSync(join(PACKAGE_ROOT, 'src', 'index.ts'))).toBe(true);
  });
});
