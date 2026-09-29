/**
 * Hygiene suite for the fabric (Work Order A019):
 *
 *   1. READ-ONLY PROOFS (lock rule 6): a full extraction run leaves
 *      every source record bit-identical (canonical-form compare) and
 *      frozen; the fabric sources never call the evidence tier's
 *      write APIs.
 *   2. Ledger immutability: run records and drafts are frozen; there
 *      is no update/delete surface (public API audit).
 *   3. Public-surface hygiene: the internal test-support module is not
 *      exported; exported registries/fabric classes are the surface.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import * as fabric from './index.js';
import { ExtractionService } from './fabric.js';
import {
  CORR,
  makeRef,
  registerDefaultPolicy,
  RUN_KEY,
  T5,
  T6,
} from './test-support.js';

const SERVICE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Evidence-tier WRITE APIs the fabric must never call. */
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

describe('read-only proofs (lock rule 6)', () => {
  it('a full extraction run leaves every source record bit-identical and frozen', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const ref = await makeRef();
    const before = [
      canonicalJson(ref.trajectory),
      ...ref.evaluations.map((record) => canonicalJson(record)),
      ...ref.verifications.map((record) => canonicalJson(record)),
    ];
    await service.extract(policy.digest, [ref], {
      runKey: RUN_KEY,
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
    });
    const after = [
      canonicalJson(ref.trajectory),
      ...ref.evaluations.map((record) => canonicalJson(record)),
      ...ref.verifications.map((record) => canonicalJson(record)),
    ];
    expect(after).toEqual(before);
    expect(Object.isFrozen(ref.trajectory)).toBe(true);
    expect(ref.evaluations.every((record) => Object.isFrozen(record))).toBe(true);
    expect(ref.verifications.every((record) => Object.isFrozen(record))).toBe(true);
  });

  it('the fabric sources never call the evidence tier write APIs', () => {
    const sources = collectFiles(
      join(SERVICE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts',
    );
    expect(sources.length).toBeGreaterThanOrEqual(3);
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8').toLowerCase();
      for (const token of WRITE_API_DENY) {
        if (text.includes(token)) violations.push(`${file}: ${token}`);
      }
    }
    expect(violations, `evidence-tier write API usage in fabric sources:\n${violations.join('\n')}`).toEqual([]);
  });
});

describe('ledger immutability + public surface', () => {
  it('run records and drafts are frozen on creation', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const ref = await makeRef();
    const record = await service.extract(policy.digest, [ref], {
      runKey: RUN_KEY,
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
    });
    expect(Object.isFrozen(record)).toBe(true);
    const draft = service.getDraft(record.drafts[0] as string);
    expect(draft).toBeDefined();
    expect(Object.isFrozen(draft)).toBe(true);
  });

  it('the public surface exposes no update/delete APIs (audit)', () => {
    const service = new ExtractionService();
    const proto = Object.getPrototypeOf(service) as Record<string, unknown>;
    const methods = Object.getOwnPropertyNames(proto);
    for (const forbidden of ['update', 'delete', 'remove', 'rewrite', 'patch']) {
      expect(methods, `fabric must not expose ${forbidden}`).not.toContain(forbidden);
    }
    expect(methods).toContain('extract');
    expect(methods).toContain('getRunRecord');
    expect(methods).toContain('listRuns');
    expect(methods).toContain('getDraft');
  });

  it('test-support is not re-exported by the public surface', () => {
    const surfaceKeys = Object.keys(fabric);
    for (const helper of ['makeRef', 'makeTrajectory', 'makeEvaluation', 'makeVerification', 'TestLcg']) {
      expect(surfaceKeys).not.toContain(helper);
    }
    expect(surfaceKeys).toContain('ExtractionService');
    expect(surfaceKeys).toContain('ExtractionPolicyRegistry');
    expect(surfaceKeys).toContain('createExtractionRunRecord');
  });

  it('the service README exists and states the read-only + idempotency contract', () => {
    const readme = readFileSync(join(SERVICE_ROOT, 'README.md'), 'utf-8');
    expect(readme.toLowerCase()).toContain('read-only');
    expect(readme.toLowerCase()).toContain('idempotent');
    expect(readme.toLowerCase()).toContain('validated');
  });
});
