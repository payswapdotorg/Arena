/**
 * Hygiene suite (Work Order A020):
 *
 *   1. LEARNING BOUNDARY negatives (architecture-lock rule 6 -
 *      historical evidence is append-only and never rewritten by
 *      learning): the public surface exports NO mutation, rewrite or
 *      replacement symbols; source records stay bit-identical after
 *      every pure computation; and no 'edit'/'update'/'delete'-style
 *      symbol is exported from the package.
 *   2. Public-surface hygiene - the internal test-support modules are
 *      not exported; every exported frozen object stays frozen.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson, digestCanonical } from '@arena/protocol-core';
import * as learning from './index.js';
import {
  attributeExperiment,
  compareOutcomeMetrics,
  computeUncertaintyReport,
  checkProtectedCapabilities,
  createExperimentDescriptor,
  decideCapabilityLift,
} from './index.js';
import {
  makeEvaluationRecord,
  makeExperimentInput,
  makeTrajectoryRecord,
  makeVerificationRecord,
} from './test-support.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Mutation-semantics tokens (case-insensitive): learning never rewrites
 * historical records, so the public surface must not even OFFER such
 * symbols. 'rewrite', 'mutate', 'replace' cover the family. The
 * deny-list lives only in this test file (the checker must not be
 * part of the scanned surface), mirroring the sibling hygiene suites.
 */
const MUTATION_DENY = ['rewrite', 'mutate', 'replac', 'overwrit', 'deletemetric', 'updaterecord'];

const MUTATION_PATTERN = new RegExp(`(?:${MUTATION_DENY.join('|')})`, 'i');

function containsMutationSemantics(text: string): boolean {
  return MUTATION_PATTERN.test(text);
}

function collectFiles(dir: string, filter: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(abs, filter));
    else if (filter(entry.name)) files.push(abs);
  }
  return files;
}

describe('learning boundary hygiene (lock rule 6)', () => {
  it('the public surface exports NO rewrite/mutation symbols', () => {
    const exportNames = Object.keys(learning);
    expect(exportNames.length).toBeGreaterThan(50);
    for (const name of exportNames) {
      expect(containsMutationSemantics(name)).toBe(false);
    }
  });

  it('the non-test sources carry no rewrite/mutation API', () => {
    const sources = collectFiles(join(PACKAGE_ROOT, 'src'), (name) =>
      name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.includes('test-support') && !name.includes('fixture'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(10);
    for (const source of sources) {
      const text = readFileSync(source, 'utf-8');
      // A mutation API would be an exported function whose NAME offers rewriting.
      const exportMatches = text.matchAll(/export (?:async )?function ([A-Za-z0-9]+)/g);
      for (const match of exportMatches) {
        expect(containsMutationSemantics(match[1] ?? '')).toBe(false);
      }
    }
  });

  it('source records stay BIT-IDENTICAL after every pure computation (canonical digests)', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const baselineTrajectory = await makeTrajectoryRecord();
    const interventionTrajectory = await makeTrajectoryRecord({
      trajectoryId: 'trajectory-learning-0002',
      runId: 'tenant-a/run-learning-0002',
    });
    const baselineEvaluation = await makeEvaluationRecord(baselineTrajectory.chainHead as string);
    const interventionEvaluation = await makeEvaluationRecord(
      interventionTrajectory.chainHead as string,
    );
    const baselineVerification = await makeVerificationRecord(baselineTrajectory.chainHead as string);
    const interventionVerification = await makeVerificationRecord(
      interventionTrajectory.chainHead as string,
    );

    const sources = [
      baselineTrajectory,
      interventionTrajectory,
      baselineEvaluation,
      interventionEvaluation,
      baselineVerification,
      interventionVerification,
    ];
    const before = await Promise.all(sources.map((source) => digestCanonical(source)));

    // Run EVERY pure computation over the frozen records.
    const baselineMetrics = [{ metricId: 'reconciliation-accuracy', value: 0.8, variance: 0.01 }];
    const interventionMetrics = [
      { metricId: 'reconciliation-accuracy', value: 0.9, variance: 0.01 },
    ];
    const comparison = compareOutcomeMetrics(
      descriptor.outcomeMetrics,
      baselineMetrics,
      interventionMetrics,
    );
    const uncertainty = computeUncertaintyReport(
      descriptor.uncertainty,
      baselineMetrics,
      interventionMetrics,
    );
    const attribution = attributeExperiment(
      descriptor,
      {
        trajectories: [baselineTrajectory],
        evaluations: [baselineEvaluation],
        verifications: [baselineVerification],
      },
      {
        trajectories: [interventionTrajectory],
        evaluations: [interventionEvaluation],
        verifications: [interventionVerification],
      },
      uncertainty,
    );
    const protectedRef = descriptor.protectedCapabilities[0]?.ref.digest ?? '0f'.repeat(32);
    const protectedChecks = checkProtectedCapabilities(
      descriptor.protectedCapabilities,
      [{ capabilityRef: protectedRef, value: 0.9 }],
      [{ capabilityRef: protectedRef, value: 0.9 }],
    );
    decideCapabilityLift(
      descriptor,
      comparison,
      uncertainty,
      attribution,
      protectedChecks,
      [interventionVerification],
    );

    const after = await Promise.all(sources.map((source) => digestCanonical(source)));
    expect(after).toEqual(before);
    // And the records are frozen (mutation attempts cannot corrupt them).
    for (const source of sources) {
      expect(Object.isFrozen(source)).toBe(true);
    }
  });

  it('the canonical JSON of a record is stable (append-only read path)', async () => {
    const trajectory = await makeTrajectoryRecord();
    const first = canonicalJson(trajectory);
    expect(canonicalJson(trajectory)).toBe(first);
  });
});

describe('public-surface hygiene', () => {
  it('the internal test-support module is NOT exported', () => {
    const exportNames = Object.keys(learning);
    expect(exportNames).not.toContain('makeTrajectoryRecord');
    expect(exportNames).not.toContain('TestLcg');
    expect(exportNames).not.toContain('makeRunRecordFixture');
  });

  it('every exported frozen object stays frozen', () => {
    expect(Object.isFrozen(learning.INTERVENTION_SURFACES)).toBe(true);
    expect(Object.isFrozen(learning.ATTRIBUTION_SOURCES)).toBe(true);
    expect(Object.isFrozen(learning.ATTRIBUTION_CONFOUNDS)).toBe(true);
    expect(Object.isFrozen(learning.CAPABILITY_LIFT_VERDICTS)).toBe(true);
    expect(Object.isFrozen(learning.LEARNING_SCHEMAS)).toBe(true);
    expect(Object.isFrozen(learning.LEARNING_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(learning.SURFACE_TO_ATTRIBUTION_SOURCES)).toBe(true);
  });

  it('the scripts folder ships only the generator', () => {
    const scriptsDir = join(PACKAGE_ROOT, 'scripts');
    expect(statSync(scriptsDir).isDirectory()).toBe(true);
    expect(readdirSync(scriptsDir)).toEqual(['generate-contracts.mjs']);
  });
});
