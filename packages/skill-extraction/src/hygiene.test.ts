/**
 * Hygiene suite (Work Order A019):
 *
 *   1. READ-ONLY PROOFS (architecture-lock rule 6 — learning never
 *      rewrites historical evidence): mining and draft construction
 *      leave every source record bit-identical (canonical-form compare
 *      before/after) and still frozen; and the non-test sources never
 *      call the evidence tier's WRITE APIs (appendTrajectoryEntry,
 *      createEvaluationRecord, createVerificationRecord) — extraction
 *      reads trajectories and their validation records, it never
 *      writes them. The deny-list lives only in this test file.
 *   2. Closed vocabularies — decision reasons and schema names are
 *      closed sets; pattern sources equal the sibling packages'.
 *   3. Public-surface hygiene — no `any` in the public surface, the
 *      internal test-support module is not exported, exported objects
 *      are frozen.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import { CONTENT_DIGEST_PATTERN_SOURCE as TRAJECTORY_DIGEST_SOURCE } from '@arena/trajectory';
import { CONTENT_DIGEST_PATTERN_SOURCE as EVALUATION_DIGEST_SOURCE } from '@arena/evaluation';
import { CONTENT_DIGEST_PATTERN_SOURCE as VERIFICATION_DIGEST_SOURCE } from '@arena/verification';
import * as skillExtraction from './index.js';
import { buildSkillDraft } from './draft.js';
import { createExtractionPolicy } from './policy.js';
import {
  mineSkillCandidates,
  PATTERN_DECISION_REASONS,
  TRAJECTORY_DECISION_REASONS,
} from './candidate.js';
import type { MiningContext } from './candidate.js';
import { CORR_ID, makePolicyInput, makeValidatedRef, T7 } from './test-support.js';
import type { CorrelationId } from '@arena/protocol-core';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Evidence-tier WRITE APIs (case-insensitive tokens). The extraction
 * package must never call these — it is a READ-ONLY consumer of
 * trajectories and their validation records (lock rule 6).
 */
const WRITE_API_DENY = [
  'appendtrajectoryentry',
  'createevaluationrecord',
  'createverificationrecord',
  'creatematerialartifact',
];

function collectFiles(dir: string, filter: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(abs, filter));
    } else if (entry.isFile() && filter(entry.name)) {
      files.push(abs);
    }
  }
  return files;
}

describe('read-only proofs (lock rule 6 — learning never rewrites evidence)', () => {
  it('mining + draft construction leave every source record bit-identical and frozen', async () => {
    const ref = await makeValidatedRef();
    const before = [
      canonicalJson(ref.trajectory),
      ...ref.evaluations.map((record) => canonicalJson(record)),
      ...ref.verifications.map((record) => canonicalJson(record)),
    ];
    const policy = await createExtractionPolicy(makePolicyInput());
    const context: MiningContext = {
      correlationId: CORR_ID as CorrelationId,
      extractedAt: T7,
    };
    const mining = await mineSkillCandidates([ref], policy, context);
    const candidate = mining.candidates[0];
    expect(candidate).toBeDefined();
    const draft = await buildSkillDraft(candidate!, policy, [ref]);

    const after = [
      canonicalJson(ref.trajectory),
      ...ref.evaluations.map((record) => canonicalJson(record)),
      ...ref.verifications.map((record) => canonicalJson(record)),
    ];
    expect(after).toEqual(before);
    expect(Object.isFrozen(ref.trajectory)).toBe(true);
    expect(ref.evaluations.every((record) => Object.isFrozen(record))).toBe(true);
    expect(ref.verifications.every((record) => Object.isFrozen(record))).toBe(true);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(draft)).toBe(true);
    expect(Object.isFrozen(draft.skillNode)).toBe(true);
  });

  it('the non-test sources never call the evidence tier write APIs', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts',
    );
    expect(sources.length).toBeGreaterThanOrEqual(7);
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8').toLowerCase();
      for (const token of WRITE_API_DENY) {
        if (text.includes(token)) violations.push(`${file}: ${token}`);
      }
    }
    expect(violations, `evidence-tier write API usage in sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('test-support is quarantined: its builders are not re-exported by the public surface', () => {
    const surfaceKeys = Object.keys(skillExtraction);
    for (const builder of ['makeTrajectoryRecord', 'makeValidatedRef', 'makePolicyInput', 'TestLcg']) {
      expect(surfaceKeys).not.toContain(builder);
    }
  });
});

describe('closed vocabularies + pattern-source parity', () => {
  it('decision reasons are closed, non-empty and duplicate-free', () => {
    expect(new Set(TRAJECTORY_DECISION_REASONS).size).toBe(TRAJECTORY_DECISION_REASONS.length);
    expect(TRAJECTORY_DECISION_REASONS.length).toBeGreaterThan(4);
    expect(new Set(PATTERN_DECISION_REASONS).size).toBe(PATTERN_DECISION_REASONS.length);
    expect(PATTERN_DECISION_REASONS).toContain('accepted');
    expect(PATTERN_DECISION_REASONS).toContain('pattern-below-threshold');
  });

  it('the content-digest pattern source equals the sibling packages constants', () => {
    const own = skillExtraction.CONTENT_DIGEST_PATTERN_SOURCE;
    expect(own).toBe(TRAJECTORY_DIGEST_SOURCE);
    expect(own).toBe(EVALUATION_DIGEST_SOURCE);
    expect(own).toBe(VERIFICATION_DIGEST_SOURCE);
  });
});

describe('public-surface hygiene', () => {
  it('exports no `any`-typed symbols (spot audit of key factories)', () => {
    // The typed API surface is enforced by tsc --noEmit (strict); this
    // spot audit asserts the shape of the exported factories at runtime.
    expect(typeof skillExtraction.toValidatedTrajectoryRef).toBe('function');
    expect(typeof skillExtraction.createExtractionPolicy).toBe('function');
    expect(typeof skillExtraction.mineSkillCandidates).toBe('function');
    expect(typeof skillExtraction.buildSkillDraft).toBe('function');
    expect(Object.isFrozen(skillExtraction.TRAJECTORY_DECISION_REASONS)).toBe(true);
    expect(Object.isFrozen(skillExtraction.PATTERN_DECISION_REASONS)).toBe(true);
    expect(Object.isFrozen(skillExtraction.SKILL_EXTRACTION_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(skillExtraction.SKILL_EXTRACTION_SCHEMAS)).toBe(true);
    expect(Object.isFrozen(skillExtraction.POLICY_VERIFICATION_OUTCOMES)).toBe(true);
  });

  it('the package README exists and states the read-only boundary', () => {
    const readme = readFileSync(join(PACKAGE_ROOT, 'README.md'), 'utf-8');
    expect(readme.toLowerCase()).toContain('read-only');
    expect(readme.toLowerCase()).toContain('validated');
  });
});
