/**
 * EnvironmentDefinition tests (Work Order A009 gates 2, 3, 12):
 *
 *   - all fifteen ENV1.0 declare fields are required, typed and validated
 *     (negative tests per field group: missing field ⇒ error);
 *   - content addressing: same declaration ⇒ same digest; ANY field
 *     change ⇒ a different digest (all 15 fields probed);
 *   - deep-freeze: no mutation API, every reachable object is frozen;
 *   - fail-closed verification (ENVIRONMENT_TAMPERED);
 *   - registry-style dedup (idempotent re-registration; version conflict
 *     on divergent content; append-only history).
 */

import { describe, expect, it } from 'vitest';
import {
  createEnvironmentDefinition,
  createEnvironmentRegistry,
  environmentDefinitionView,
  environmentVersionRef,
  findEnvironmentVersionRef,
  isEnvironmentDefinition,
  isEnvironmentVersionRef,
  parseEnvironmentIdentity,
  registerEnvironmentDefinition,
  toEnvironmentIdentity,
  verifyEnvironmentDefinition,
  formatEnvironmentIdentity,
  isSameEnvironmentIdentity,
  type CreateEnvironmentDefinitionInput,
} from './definition.js';
import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import {
  makeCheckpointingOverrides,
  makeDefinitionInput,
  makeNondeterministicSeedPolicy,
  DIGEST_C,
  DIGEST_D,
} from './test-support.js';

async function makeDefinition(
  overrides: Partial<CreateEnvironmentDefinitionInput> = {},
) {
  return createEnvironmentDefinition(makeDefinitionInput(overrides));
}

describe('environment definition — fifteen declare fields (gate 2)', () => {
  it('creates a fully valid definition with all fifteen fields', async () => {
    const definition = await makeDefinition();
    expect(definition.recordVersion).toBe(1);
    expect(definition.identity).toEqual({ namespace: 'tenant-a', name: 'engineering-sandbox' });
    expect(definition.version).toBe('1.2.0');
    expect(definition.image.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(definition.initialState.snapshot.snapshotId).toBe('snapshot-initial');
    expect(definition.seedPolicy.reproducibility.mode).toBe('deterministic');
    expect(definition.actionSurface.actions).toHaveLength(2);
    expect(definition.observationSurface.observations).toHaveLength(2);
    expect(definition.resourceLimits.cpuMillis).toBe(2000);
    expect(definition.networkPolicy.egress).toBe('default-deny');
    expect(definition.filesystemPolicy.writeMode).toBe('declared-mounts-only');
    expect(definition.secretPolicy.isolation).toBe('isolation-boundary');
    expect(definition.timeLimits.startupSeconds).toBe(60);
    expect(definition.resetSemantics.mode).toBe('recreate');
    expect(definition.checkpointSemantics.supported).toBe(false);
    expect(definition.evidenceOutputs.outputs).toHaveLength(2);
    expect(definition.evaluationHooks.evaluators).toHaveLength(1);
    expect(definition.evaluationHooks.verifiers).toHaveLength(1);
    expect(definition.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(isEnvironmentDefinition(definition)).toBe(true);
  });

  it.each([
    'identity',
    'version',
    'image',
    'initialState',
    'seedPolicy',
    'actionSurface',
    'observationSurface',
    'resourceLimits',
    'networkPolicy',
    'filesystemPolicy',
    'secretPolicy',
    'timeLimits',
    'resetSemantics',
    'checkpointSemantics',
    'evidenceOutputs',
    'evaluationHooks',
  ] as const)('missing declare field %s is rejected', async (field) => {
    const input = makeDefinitionInput() as unknown as Record<string, unknown>;
    delete input[field];
    await expect(
      createEnvironmentDefinition(input as unknown as CreateEnvironmentDefinitionInput),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION,
        name: 'EnvironmentError',
      }),
    );
    const error = await createEnvironmentDefinition(
      input as unknown as CreateEnvironmentDefinitionInput,
    ).then(
      () => null,
      (thrown: unknown) => (thrown instanceof EnvironmentError ? thrown : null),
    );
    expect(error?.message).toContain(String(field));
  });

  it.each([
    ['identity', { namespace: 'BAD', name: 'engineering-sandbox' }],
    ['version', 'not-semver'],
    ['image', { imageKind: 'content-addressed-image', digest: 'zz', buildDigest: null }],
    [
      'initialState',
      { snapshot: { snapshotId: 'ok', digest: 'nope' }, snapshotSupport: 'supported' },
    ],
    ['seedPolicy', { reproducibility: null, seed: null, seedAlgorithm: null, reseedPolicy: 'no' }],
    ['actionSurface', { actions: [], tools: [] }],
    ['observationSurface', { observations: [] }],
    ['resourceLimits', { cpuMillis: 0, memoryMiB: 1024, wallClockSeconds: 3600 }],
    ['networkPolicy', { egress: 'allow-all', allows: [] }],
    ['filesystemPolicy', { writeMode: 'read-write-anywhere', mounts: [] }],
    ['secretPolicy', { isolation: 'shared', injectionPoints: [] }],
    ['timeLimits', { startupSeconds: 0, cleanupGraceSeconds: 30, deadlineBehavior: 'hard-stop' }],
    ['resetSemantics', { mode: 'keep-forever', checkpoint: null, cleanup: 'destroy' }],
    ['checkpointSemantics', { supported: 'yes', triggers: [], retention: null }],
    ['evidenceOutputs', { outputs: [] }],
    [
      'evaluationHooks',
      {
        evaluators: [],
        verifiers: [],
      },
    ],
  ] as const)('invalid declare field %s is rejected', async (field, value) => {
    const input = makeDefinitionInput({ [field]: value } as Partial<CreateEnvironmentDefinitionInput>);
    await expect(makeDefinition(input)).rejects.toThrowError(EnvironmentError);
  });
});

describe('environment definition — content addressing (gate 3)', () => {
  it('same declaration ⇒ same digest (registry-style dedup basis)', async () => {
    const first = await makeDefinition();
    const second = await makeDefinition();
    expect(first.digest).toBe(second.digest);
    expect(first).toEqual(second);
  });

  it.each([
    ['identity', { namespace: 'tenant-b', name: 'engineering-sandbox' }],
    ['version', '1.3.0'],
    ['image', { imageKind: 'content-addressed-image', digest: DIGEST_D, buildDigest: null }],
    [
      'initialState',
      { snapshot: { snapshotId: 'snapshot-second', digest: '2222222222222222222222222222222222222222222222222222222222222222' }, snapshotSupport: 'supported' },
    ],
    ['seedPolicy', makeNondeterministicSeedPolicy()],
    ['actionSurface', { actions: [{ actionId: 'run-step', description: null }], tools: [] }],
    [
      'observationSurface',
      {
        observations: [
          { observationId: 'obs-stdout', channel: 'stdout', description: null },
          { observationId: 'obs-metrics', channel: 'metrics', description: null },
        ],
      },
    ],
    ['resourceLimits', { cpuMillis: 4000, memoryMiB: 1024, wallClockSeconds: 3600 }],
    ['networkPolicy', { egress: 'default-deny', allows: [] }],
    [
      'filesystemPolicy',
      {
        writeMode: 'declared-mounts-only',
        mounts: [
          { mountPath: '/workspace', access: 'read-write', source: 'workspace' },
          { mountPath: '/task-inputs', access: 'read-only', source: 'initial-state' },
          { mountPath: '/evidence', access: 'read-write', source: 'evidence' },
          { mountPath: '/scratch', access: 'read-write', source: 'ephemeral' },
        ],
      },
    ],
    [
      'secretPolicy',
      {
        isolation: 'isolation-boundary',
        injectionPoints: [
          { secretId: 'signing-reference', mountPath: '/bindings/signing', mechanism: 'stream' },
        ],
      },
    ],
    ['timeLimits', { startupSeconds: 90, cleanupGraceSeconds: 30, deadlineBehavior: 'hard-stop' }],
    ['resetSemantics', { mode: 'restore-snapshot', checkpoint: null, cleanup: 'destroy' }],
    ['checkpointSemantics', { supported: true, triggers: ['manual'], retention: 2 }],
    [
      'evidenceOutputs',
      {
        outputs: [
          { outputId: 'ev-trajectory', kind: 'trajectory', addressing: 'content-addressed', description: null },
        ],
      },
    ],
    [
      'evaluationHooks',
      {
        evaluators: [
          {
            hookId: 'eval-standard-suite',
            role: 'evaluator',
            phase: 'post-run',
            invocationSchema: 'arena:schema/evaluation/suite-run@1.0.0',
            description: 'now described',
          },
        ],
        verifiers: [
          {
            hookId: 'verify-output-contracts',
            role: 'verifier',
            phase: 'on-evidence',
            invocationSchema: 'arena:schema/verification/check@1.0.0',
            description: null,
          },
        ],
      },
    ],
  ] as const)('any field change ⇒ a different digest: %s', async (field, value) => {
    const base = await makeDefinition();
    const changed = await makeDefinition({
      [field]: value,
    } as Partial<CreateEnvironmentDefinitionInput>);
    expect(changed.digest).not.toBe(base.digest);
  });

  it('verifyEnvironmentDefinition recomputes and returns the digest', async () => {
    const definition = await makeDefinition();
    await expect(verifyEnvironmentDefinition(definition)).resolves.toBe(definition.digest);
  });

  it('a mutated copy fails closed with ENVIRONMENT_TAMPERED', async () => {
    const definition = await makeDefinition();
    const tampered = {
      ...environmentDefinitionView(definition),
      digest: definition.digest,
      resourceLimits: { ...definition.resourceLimits, cpuMillis: 9999 },
    } as typeof definition;
    await expect(verifyEnvironmentDefinition(tampered)).rejects.toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.TAMPERED }) as EnvironmentError,
    );
  });

  it('isEnvironmentDefinition rejects non-definitions', async () => {
    const definition = await makeDefinition();
    expect(isEnvironmentDefinition({})).toBe(false);
    expect(isEnvironmentDefinition(null)).toBe(false);
    expect(isEnvironmentDefinition({ ...definition, recordVersion: 2 })).toBe(false);
    expect(isEnvironmentDefinition({ ...definition, digest: 'not-a-digest' })).toBe(false);
  });
});

describe('environment definition — deep freeze (gate 12)', () => {
  function assertDeepFrozen(value: unknown, path = 'definition'): void {
    if (typeof value !== 'object' || value === null) return;
    expect(Object.isFrozen(value), `${path} must be frozen`).toBe(true);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => assertDeepFrozen(entry, `${path}[${String(index)}]`));
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertDeepFrozen(child, `${path}.${key}`);
    }
  }

  it('every reachable object of the definition is frozen', async () => {
    const definition = await makeDefinition(makeCheckpointingOverrides());
    assertDeepFrozen(definition);
  });

  it('mutation attempts fail silently or throw in strict mode (no mutation API)', async () => {
    'use strict';
    const definition = await makeDefinition();
    expect(() => {
      (definition as unknown as Record<string, unknown>)['version'] = '9.9.9';
    }).toThrow();
    expect(definition.version).toBe('1.2.0');
    expect(() => {
      (definition.resourceLimits as unknown as Record<string, unknown>)['cpuMillis'] = 1;
    }).toThrow();
    expect(definition.resourceLimits.cpuMillis).toBe(2000);
  });
});

describe('environment registry — append-only dedup (gate 3)', () => {
  it('registers a definition and resolves its version ref', async () => {
    const definition = await makeDefinition();
    const registry = await registerEnvironmentDefinition(
      createEnvironmentRegistry(),
      definition,
    );
    expect(registry.entries).toHaveLength(1);
    const ref = environmentVersionRef(definition);
    expect(isEnvironmentVersionRef(ref)).toBe(true);
    expect(findEnvironmentVersionRef(registry, definition.identity, definition.version)).toEqual(
      ref,
    );
    expect(findEnvironmentVersionRef(registry, definition.identity, '0.0.1')).toBeNull();
  });

  it('re-registering identical content is idempotent (same digest)', async () => {
    const definition = await makeDefinition();
    const registry = await registerEnvironmentDefinition(
      createEnvironmentRegistry(),
      definition,
    );
    const again = await registerEnvironmentDefinition(registry, await makeDefinition());
    expect(again).toBe(registry);
    expect(again.entries).toHaveLength(1);
  });

  it('same version with different content is a VERSION_CONFLICT (history never rewritten)', async () => {
    const registry = await registerEnvironmentDefinition(
      createEnvironmentRegistry(),
      await makeDefinition(),
    );
    const divergentDefinition = await createEnvironmentDefinition(
      makeDefinitionInput({
        resourceLimits: { cpuMillis: 8000, memoryMiB: 1024, wallClockSeconds: 3600 },
      }),
    );
    expect(divergentDefinition.digest).not.toBe(registry.entries[0]?.digest);
    await expect(
      registerEnvironmentDefinition(registry, divergentDefinition),
    ).rejects.toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.VERSION_CONFLICT }) as EnvironmentError,
    );
  });

  it('new versions append in order (append-only)', async () => {
    let registry = createEnvironmentRegistry();
    registry = await registerEnvironmentDefinition(registry, await makeDefinition());
    registry = await registerEnvironmentDefinition(
      registry,
      await makeDefinition({ version: '1.3.0' }),
    );
    expect(registry.entries.map((entry) => entry.version)).toEqual(['1.2.0', '1.3.0']);
  });

  it('a tampered definition is rejected before registration (fail closed)', async () => {
    const definition = await makeDefinition();
    const tampered = {
      ...environmentDefinitionView(definition),
      digest: definition.digest,
      timeLimits: { ...definition.timeLimits, startupSeconds: 5555 },
    } as typeof definition;
    await expect(
      registerEnvironmentDefinition(createEnvironmentRegistry(), tampered),
    ).rejects.toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.TAMPERED }) as EnvironmentError,
    );
  });
});

describe('environment identity (declare field 1)', () => {
  it('formats and parses the stable string form', () => {
    const identity = toEnvironmentIdentity({ namespace: 'tenant-a', name: 'engineering-sandbox' });
    const formatted = formatEnvironmentIdentity(identity);
    expect(formatted).toBe('arena:environment/tenant-a/engineering-sandbox');
    expect(parseEnvironmentIdentity(formatted)).toEqual(identity);
    expect(isSameEnvironmentIdentity(identity, { ...identity })).toBe(true);
  });

  it('rejects malformed identity strings and parts', () => {
    expect(() => parseEnvironmentIdentity('not-a-ref')).toThrowError(EnvironmentError);
    expect(() => parseEnvironmentIdentity('arena:environment/Tenant-A/env')).toThrowError(
      EnvironmentError,
    );
    expect(() =>
      toEnvironmentIdentity({ namespace: 'tenant-a', name: 'Bad_Name' }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_IDENTITY }) as EnvironmentError,
    );
  });
});

describe('cross-field invariants (gates 4, 6, 7 at the definition level)', () => {
  it('deterministic + seed is rejected (contradiction)', async () => {
    const input = makeDefinitionInput({
      seedPolicy: {
        reproducibility: { mode: 'deterministic', capture: null, note: null },
        seed: 'seed-0001',
        seedAlgorithm: 'counter-based-derivation',
        reseedPolicy: 'forbidden',
        note: null,
      },
    });
    await expect(createEnvironmentDefinition(input)).rejects.toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_SEED_POLICY }) as EnvironmentError,
    );
  });

  it('deterministic + capture metadata is rejected (contradiction)', async () => {
    const input = makeDefinitionInput({
      seedPolicy: {
        reproducibility: {
          mode: 'deterministic',
          capture: {
            seed: 'recorded',
            versions: 'recorded',
            externalInputs: 'recorded',
            timingContext: 'recorded',
          },
          note: null,
        },
        seed: null,
        seedAlgorithm: null,
        reseedPolicy: 'forbidden',
        note: null,
      },
    });
    await expect(createEnvironmentDefinition(input)).rejects.toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY }) as EnvironmentError,
    );
  });

  it('nondeterministic without full capture is rejected', async () => {
    const input = makeDefinitionInput({
      seedPolicy: {
        reproducibility: { mode: 'nondeterministic', capture: null, note: null },
        seed: 'seed-0001',
        seedAlgorithm: 'counter-based-derivation',
        reseedPolicy: 'declared-only',
        note: null,
      },
    });
    await expect(createEnvironmentDefinition(input)).rejects.toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY }) as EnvironmentError,
    );
  });

  it('a full nondeterministic declaration is accepted (with a seed)', async () => {
    const definition = await makeDefinition({
      seedPolicy: makeNondeterministicSeedPolicy(),
    });
    expect(definition.seedPolicy.reproducibility.mode).toBe('nondeterministic');
    expect(definition.seedPolicy.seed).toBe('seed-0001');
    await expect(verifyEnvironmentDefinition(definition)).resolves.toBe(definition.digest);
  });

  it('checkpoint support without the snapshot support flag is rejected', async () => {
    const input = makeDefinitionInput({
      initialState: {
        snapshot: { snapshotId: 'snapshot-initial', digest: DIGEST_C },
        snapshotSupport: 'not-supported',
      },
      ...makeCheckpointingOverrides(),
    });
    await expect(createEnvironmentDefinition(input)).rejects.toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS }) as EnvironmentError,
    );
  });

  it('reset-to-checkpoint without a checkpoint ref is rejected', async () => {
    const input = makeDefinitionInput({
      resetSemantics: { mode: 'reset-to-checkpoint', checkpoint: null, cleanup: 'destroy' },
    });
    await expect(createEnvironmentDefinition(input)).rejects.toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_RESET_SEMANTICS }) as EnvironmentError,
    );
  });

  it('cleanup budget exceeding the wall clock is rejected', async () => {
    const input = makeDefinitionInput({
      timeLimits: { startupSeconds: 60, cleanupGraceSeconds: 7200, deadlineBehavior: 'hard-stop' },
    });
    await expect(createEnvironmentDefinition(input)).rejects.toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_TIME_LIMITS }) as EnvironmentError,
    );
  });

  it('a read-write mount with read-only write mode is rejected (contradiction)', async () => {
    const input = makeDefinitionInput({
      filesystemPolicy: {
        writeMode: 'read-only',
        mounts: [
          { mountPath: '/workspace', access: 'read-write', source: 'workspace' },
        ],
      },
    });
    await expect(createEnvironmentDefinition(input)).rejects.toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY }) as EnvironmentError,
    );
  });
});
