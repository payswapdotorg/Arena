/**
 * Hygiene suite (Work Order A010 gates 13, 15):
 *
 *   1. Runtime-neutrality negatives — no runner/provider-specific
 *      strings in CANONICAL / DIGESTED environment-runtime objects, in
 *      the NON-TEST sources of the domain package, or in the committed
 *      generated contracts. (The reference runner ships its own hygiene
 *      suite in services/environment-runner — gate 13 covers it too.)
 *   2. Public-surface hygiene — no `any` in the public surface; the
 *      internal test-support module is not exported; every exported
 *      object is frozen.
 *
 * The deny-lists live only in this test file (the checker must not be
 * part of the scanned surface), mirroring the A002/A009 hygiene suites.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson, digestCanonical } from '@arena/protocol-core';
import { createRunCheckpoint } from './checkpoint.js';
import { createRunRecord } from './run-record.js';
import { createRunResult } from './run-result.js';
import { evaluateAdmission } from './admission.js';
import { toEnvironmentAdmissionView } from './isolation-envelope.js';
import { makeRunId } from './run-id.js';
import { initialRunState } from './run-state.js';
import * as environmentRuntime from './index.js';
import {
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  DIGEST_D,
  T1,
  makeDeclarationInput,
  makeEnvironmentView,
} from './test-support.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Runner / provider tokens (case-insensitive). Long unambiguous tokens
 * use substring semantics; short tokens use alphanumeric delimiters so
 * ordinary protocol vocabulary is never matched. Mirrors A009.
 */
const RUNTIME_SUBSTRING_DENY = [
  'docker',
  'podman',
  'firecracker',
  'containerd',
  'gvisor',
  'qemu',
  'vmware',
  'virtualbox',
  'hyperv',
  'kubernetes',
  'openstack',
  'nspawn',
  'microvm',
];
const RUNTIME_WORD_DENY = ['aws', 'gcp', 'azure', 'k8s', 'ec2', 'gce', 'vm', 'runc', 'crun', 'kvm'];

const SUBSTRING_PATTERN = new RegExp(`(?:${RUNTIME_SUBSTRING_DENY.join('|')})`, 'i');
const WORD_PATTERN = new RegExp(`(?<![a-z0-9])(?:${RUNTIME_WORD_DENY.join('|')})(?![a-z0-9])`, 'i');

function containsRuntimeToken(text: string): boolean {
  return SUBSTRING_PATTERN.test(text) || WORD_PATTERN.test(text);
}

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

describe('runtime-neutrality hygiene (gate 13)', () => {
  it('canonical and digested domain objects contain no runner/provider token', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    const checkpoint = await createRunCheckpoint({
      runId: 'tenant-a/run-000042',
      tenantId: 'tenant-a',
      sequence: 1,
      snapshotDigest: DIGEST_C,
      stepIndex: 2,
      recordedAt: T1,
    });
    const state = initialRunState(record);
    const result = await createRunResult({
      runId: 'tenant-a/run-000042',
      tenantId: 'tenant-a',
      recordDigest: record.digest,
      finalState: 'completed',
      finishedAt: T1,
      runAddress: {
        taskVersion: { taskId: 'task-build-website', version: '2.1.0' },
        environmentVersion: {
          namespace: 'tenant-a',
          name: 'engineering-sandbox',
          version: '1.2.0',
          digest: record.environment.digest,
        },
        runId: 'run-000042',
        initialSnapshotDigest: record.initialSnapshotDigest,
        trajectoryDigest: DIGEST_D,
        evidenceDigests: [DIGEST_D],
      },
    });
    const decision = evaluateAdmission(
      toEnvironmentAdmissionView(makeEnvironmentView()),
      {
        resource: record.resourceEnvelope,
        network: record.networkEnvelope,
        filesystem: record.filesystemEnvelope,
        secret: record.secretEnvelope,
      },
    );

    const canonicalForms = [
      canonicalJson(record),
      canonicalJson(checkpoint),
      canonicalJson(state),
      canonicalJson(result),
      canonicalJson(decision),
      canonicalJson(makeRunId('tenant-a', 'run-000042')),
      await digestCanonical(record),
      await digestCanonical(checkpoint),
      await digestCanonical(result),
    ];
    expect(canonicalForms.length).toBe(9);
    for (const form of canonicalForms) {
      expect(containsRuntimeToken(form), `runtime leakage in: ${form.slice(0, 120)}`).toBe(false);
    }
  });

  it('the domain package non-test sources contain no runner/provider token (gate 13)', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThan(10);
    // The ONLY sanctioned appearance of the token vocabulary in sources
    // is the two exported tripwire pattern-source constants themselves
    // (the enforcement vocabulary — assertRuntimeNeutralString uses them
    // to REJECT leaking inputs; they never enter a canonical or digested
    // object, which the canonical-forms scan above proves).
    const tripwires = [
      environmentRuntime.RUNTIME_NEUTRALITY_SUBSTRING_PATTERN_SOURCE,
      environmentRuntime.RUNTIME_NEUTRALITY_WORD_PATTERN_SOURCE,
    ];
    const violations: string[] = [];
    for (const file of sources) {
      let text = readFileSync(file, 'utf-8');
      for (const tripwire of tripwires) {
        text = text.split(tripwire).join('<tripwire-pattern-source>');
      }
      if (containsRuntimeToken(text)) violations.push(file);
    }
    expect(violations, `runtime/provider leakage in sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the committed generated contracts contain no runner/provider token', () => {
    const contractsDir = join(PACKAGE_ROOT, 'contracts');
    const contractFiles = statSync(contractsDir, { throwIfNoEntry: false })
      ? collectFiles(contractsDir, (name) => name.endsWith('.json'))
      : [];
    expect(contractFiles).toHaveLength(23);
    const violations: string[] = [];
    for (const file of contractFiles) {
      const text = readFileSync(file, 'utf-8');
      if (containsRuntimeToken(text)) violations.push(file);
    }
    expect(violations, `runtime/provider leakage in contracts:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the scanner itself detects the deny-list tokens (self-test, negative control)', () => {
    expect(containsRuntimeToken('image: "docker:24"')).toBe(true);
    expect(containsRuntimeToken('runs on k8s')).toBe(true);
    expect(containsRuntimeToken('firecracker microvm')).toBe(true);
    expect(containsRuntimeToken('hosted in aws')).toBe(true);
    expect(containsRuntimeToken('gcp project id')).toBe(true);
    expect(containsRuntimeToken('azure subscription')).toBe(true);
    expect(containsRuntimeToken('containerd socket')).toBe(true);
    // No false positives on this package's vocabulary:
    expect(containsRuntimeToken('engineering-sandbox isolation-boundary')).toBe(false);
    expect(containsRuntimeToken('content-addressed-image snapshot-initial')).toBe(false);
    expect(containsRuntimeToken('the environment runtime governs all run flows')).toBe(false);
    expect(containsRuntimeToken('evaluators verifiers evidence outputs')).toBe(false);
    expect(containsRuntimeToken('provisioning checkpointing wall-clock')).toBe(false);
  });

  it('construction rejects runner/provider strings and secret material (gate 13 negatives)', async () => {
    await expect(
      createRunRecord(makeDeclarationInput({ runKey: 'k8s-run-1' })),
    ).rejects.toThrow();
    await expect(
      createRunRecord(makeDeclarationInput({ seed: 'aws-seed-1' })),
    ).rejects.toThrow();
    await expect(
      createRunRecord({ ...makeDeclarationInput(), apiKey: 'leak' } as never),
    ).rejects.toThrow();
  });
});

describe('public-surface hygiene (gate 15 — no any leaks)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThan(10);
    const anyPatterns = [
      /:\s*any\b/,
      /\bas\s+any\b/,
      /<any>/,
      /\bany\[\]/,
      /readonly\s+any\b/,
      /\bPromise<any>\b/,
    ];
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      for (const pattern of anyPatterns) {
        const match = pattern.exec(text);
        if (match) violations.push(`${file}: /${match[0]}/`);
      }
    }
    expect(violations, `any leaks found:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the public surface is rich but excludes the internal test-support module', () => {
    const exportNames = Object.keys(environmentRuntime);
    expect(exportNames.length).toBeGreaterThan(100);
    for (const internal of [
      'makeDeclarationInput',
      'makeEnvironmentView',
      'DIGEST_A',
      'DIGEST_B',
      'T0',
    ]) {
      expect(exportNames).not.toContain(internal);
    }
    for (const expected of [
      'ENVIRONMENT_RUNTIME_ERROR_CODES',
      'EnvironmentRuntimeError',
      'createRunRecord',
      'verifyRunRecord',
      'runRecordView',
      'isRunRecord',
      'RUN_STATES',
      'RUN_TRANSITIONS',
      'transitionRunState',
      'canTransitionRunState',
      'enforceTimeLimit',
      'RUNTIME_EVENT_KINDS',
      'isRuntimeEvent',
      'makeRunSubmittedEvent',
      'makeStateTransitionedEvent',
      'appendRuntimeEventEnvelope',
      'createEnvironmentEventLog',
      'verifyEnvironmentEventLog',
      'eventsForRun',
      'eventsForTenant',
      'eventsEnteringState',
      'evaluateAdmission',
      'assertAdmissible',
      'makeRunId',
      'parseRunId',
      'assertSameTenant',
      'createRunCheckpoint',
      'restoreToCheckpoint',
      'createRunResult',
      'verifyRunResult',
      'toRunAddress',
      'makeSubmitRunCommand',
      'makeStartRunCommand',
      'makeRuntimeEventEnvelope',
      'parseRuntimeEnvelope',
      'verifyRuntimeEnvelope',
      'ENVIRONMENT_RUNTIME_SCHEMAS',
      'ENVIRONMENT_RUNTIME_SCHEMA_REGISTRY',
      'SeededLcg',
      'createSeededLcg',
      'stepLcg',
      'initialRunState',
      'applyRuntimeEvent',
      'foldRunEvents',
      'runStatesSnapshot',
      'runsInState',
      'ENVIRONMENT_RUNTIME_VERSION',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('every export is a function or a frozen object/array constant', () => {
    for (const [name, value] of Object.entries(environmentRuntime)) {
      if (typeof value === 'function') continue; // functions and classes
      if (typeof value === 'object' && value !== null) {
        expect(Object.isFrozen(value), `exported object ${name} must be frozen`).toBe(true);
        continue;
      }
      expect(typeof value, `unexpected export ${name} of type ${typeof value}`).toMatch(
        /^(string|number|object|function)$/,
      );
    }
  });

  it('all reachable lifecycle paths are exercised by the transition table (sanity)', () => {
    // Every state is reachable from 'requested' through table edges.
    const reachable = new Set<string>(['requested']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const edge of environmentRuntime.RUN_TRANSITIONS) {
        if (edge.from.some((from) => reachable.has(from)) && !reachable.has(edge.to)) {
          reachable.add(edge.to);
          grew = true;
        }
      }
    }
    expect([...reachable].sort()).toEqual([...environmentRuntime.RUN_STATES].sort());
  });
});

void DIGEST_A;
void DIGEST_B;
