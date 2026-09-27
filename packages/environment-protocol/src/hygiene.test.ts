/**
 * Hygiene suite (Work Order A009 gates 10, 13):
 *
 *   1. Runtime-neutrality negatives — no runner/provider-specific strings
 *      (docker, k8s, podman, firecracker, aws, gcp, azure, ...) appear in
 *      CANONICAL / DIGESTED environment-protocol objects, and the committed
 *      generated contracts are clean. Construction-side rejection of
 *      runtime leakage is covered by shared.test.ts /
 *      definition.test.ts / workload.test.ts; here we prove the OUTPUT
 *      side (gate 10).
 *   2. Public-surface hygiene — no `any` type leaks in the non-test sources
 *      and the internal test-support module is not part of the public
 *      surface.
 *
 * The deny-lists live only in this test file (the checker must not be part
 * of the scanned surface), mirroring how scripts/governance-check.py
 * keeps its provider regex outside packages/protocol-core and how the
 * sibling A002/A003 hygiene suites are structured.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson, digestCanonical, makeEnvelope, newCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import {
  createEnvironmentDefinition,
  environmentDefinitionView,
  environmentVersionRef,
} from './definition.js';
import { toRunAddress } from './run-address.js';
import { toWorkloadDeclaration } from './workload.js';
import { makeCheckpointingOverrides, makeDefinitionInput, makeNondeterministicSeedPolicy, makeWorkloadInput, DIGEST_A, DIGEST_B, DIGEST_C, DIGEST_D } from './test-support.js';
import * as environmentProtocol from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/**
 * Runner / provider tokens (case-insensitive). Long unambiguous tokens use
 * substring semantics; short tokens (aws, gcp, azure, k8s, ec2, gce, vm,
 * runc, crun, kvm) use alphanumeric delimiters so ordinary protocol
 * vocabulary ("governs", "platform") is never matched.
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

describe('runtime-neutrality hygiene (gate 10 — canonical/digested objects)', () => {
  it('canonical and digested domain objects contain no runner/provider token', async () => {
    const definition = await createEnvironmentDefinition(makeDefinitionInput());
    const checkpointing = await createEnvironmentDefinition({
      ...makeDefinitionInput(makeCheckpointingOverrides()),
      seedPolicy: makeNondeterministicSeedPolicy(),
    });
    const workload = toWorkloadDeclaration(makeWorkloadInput());
    const address = toRunAddress({
      taskVersion: { taskId: 'task-build-website', version: '2.1.0' },
      environmentVersion: {
        namespace: 'tenant-a',
        name: 'engineering-sandbox',
        version: '1.2.0',
        digest: definition.digest,
      },
      runId: 'run-000042',
      initialSnapshotDigest: DIGEST_B,
      trajectoryDigest: DIGEST_C,
      evidenceDigests: [DIGEST_D, DIGEST_A],
    });
    const envelope = makeEnvelope({
      kind: 'command',
      schema: 'arena:schema/environment/register-environment-command@1.0.0',
      correlationId: newCorrelationId(),
      idempotencyKey: toIdempotencyKey('idem-key-1'),
      payload: { environment: definition },
    });

    const canonicalForms = [
      canonicalJson(definition),
      canonicalJson(environmentDefinitionView(definition)),
      canonicalJson(checkpointing),
      canonicalJson(environmentVersionRef(definition)),
      canonicalJson(workload),
      canonicalJson(address),
      canonicalJson(envelope),
      // Digest inputs flow through the same canonical serializer; hashing
      // them also proves the digested byte stream is runtime-neutral.
      await digestCanonical(definition),
      await digestCanonical(checkpointing),
      await digestCanonical(workload),
    ];
    expect(canonicalForms.length).toBe(10);
    for (const form of canonicalForms) {
      expect(containsRuntimeToken(form), `runtime leakage in: ${form.slice(0, 120)}`).toBe(false);
    }
  });

  it('the committed generated contracts contain no runner/provider token', () => {
    const contractFiles = statSync(join(REPO_ROOT, 'contracts', 'environment'), {
      throwIfNoEntry: false,
    })
      ? collectFiles(join(REPO_ROOT, 'contracts', 'environment'), (name) => name.endsWith('.json'))
      : [];
    expect(contractFiles).toHaveLength(26);
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
    expect(containsRuntimeToken('the environment governs all task flows')).toBe(false);
    expect(containsRuntimeToken('some flaws remain in the outcome')).toBe(false);
    expect(containsRuntimeToken('evaluators verifiers evidence outputs')).toBe(false);
  });
});

describe('public-surface hygiene (gate 13 — no any leaks)', () => {
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
    const exportNames = Object.keys(environmentProtocol);
    expect(exportNames.length).toBeGreaterThan(60);
    for (const internal of [
      'makeDefinitionInput',
      'makeNondeterministicSeedPolicy',
      'makeCheckpointingOverrides',
      'makeWorkloadInput',
    ]) {
      expect(exportNames).not.toContain(internal);
    }
    // Key domain constructors and guards are exported:
    for (const expected of [
      'createEnvironmentDefinition',
      'verifyEnvironmentDefinition',
      'environmentDefinitionView',
      'computeEnvironmentDigest',
      'createEnvironmentRegistry',
      'registerEnvironmentDefinition',
      'findEnvironmentVersionRef',
      'environmentVersionRef',
      'toEnvironmentImage',
      'toInitialStateDeclaration',
      'toSeedPolicy',
      'toReproducibilityProfile',
      'toActionSurface',
      'toObservationSurface',
      'toResourceLimits',
      'toNetworkPolicy',
      'toFilesystemPolicy',
      'toSecretPolicy',
      'toTimeLimits',
      'toResetSemantics',
      'toCheckpointSemantics',
      'toEvidenceOutputs',
      'toEvaluationHooks',
      'toRunAddress',
      'toWorkloadDeclaration',
      'assertLeastPrivilege',
      'makeRegisterEnvironmentCommand',
      'makeAdmitWorkloadCommand',
      'makeEnvironmentRegisteredEvent',
      'makeWorkloadAdmittedEvent',
      'parseEnvironmentEnvelope',
      'verifyEnvironmentEnvelope',
      'EnvironmentError',
      'ENVIRONMENT_ERROR_CODES',
      'ENVIRONMENT_SCHEMAS',
      'ENVIRONMENT_PROTOCOL_VERSION',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('every export is a function, a frozen object or a frozen array constant', () => {
    for (const [name, value] of Object.entries(environmentProtocol)) {
      if (typeof value === 'function') continue; // functions and classes
      if (typeof value === 'object' && value !== null) {
        expect(Object.isFrozen(value), `exported object ${name} must be frozen`).toBe(true);
        continue;
      }
      expect(
        typeof value,
        `unexpected export ${name} of type ${typeof value}`,
      ).toMatch(/^(string|number|object|function)$/);
    }
  });
});
