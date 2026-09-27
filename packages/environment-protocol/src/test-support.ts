/**
 * Internal test support — fixture builders shared by the
 * environment-protocol test suites. NOT part of the public surface:
 * index.ts does not export it and tsconfig.build.json excludes it from
 * dist. Every fixture value is deliberately runtime-neutral and
 * secret-free (neutral identifiers, no runner/provider brand names, no
 * credential-shaped fields).
 */

import type { CreateEnvironmentDefinitionInput } from './definition.js';

/** Well-known sha256-hex fixture digests (valid lowercase 64-hex strings; no meaning). */
export const DIGEST_A = '1111111111111111111111111111111111111111111111111111111111111111';
export const DIGEST_B = '2222222222222222222222222222222222222222222222222222222222222222';
export const DIGEST_C = '3333333333333333333333333333333333333333333333333333333333333333';
export const DIGEST_D = '4444444444444444444444444444444444444444444444444444444444444444';

export function makeDefinitionInput(
  overrides: Partial<CreateEnvironmentDefinitionInput> = {},
): CreateEnvironmentDefinitionInput {
  return {
    identity: { namespace: 'tenant-a', name: 'engineering-sandbox' },
    version: '1.2.0',
    image: {
      imageKind: 'content-addressed-image',
      digest: DIGEST_A,
      buildDigest: null,
    },
    initialState: {
      snapshot: { snapshotId: 'snapshot-initial', digest: DIGEST_B },
      snapshotSupport: 'supported',
    },
    seedPolicy: {
      reproducibility: { mode: 'deterministic', capture: null, note: null },
      seed: null,
      seedAlgorithm: null,
      reseedPolicy: 'forbidden',
      note: null,
    },
    actionSurface: {
      actions: [
        { actionId: 'run-step', description: 'Execute one declared procedure step.' },
        { actionId: 'submit-result', description: null },
      ],
      tools: [{ toolId: 'file-tool', description: null }],
    },
    observationSurface: {
      observations: [
        { observationId: 'obs-stdout', channel: 'stdout', description: null },
        { observationId: 'obs-files', channel: 'files', description: null },
      ],
    },
    resourceLimits: { cpuMillis: 2000, memoryMiB: 1024, wallClockSeconds: 3600 },
    networkPolicy: {
      egress: 'default-deny',
      allows: [
        { host: 'packages.internal', port: 443, protocol: 'https' },
        { host: 'registry.internal', port: 443, protocol: 'https' },
      ],
    },
    filesystemPolicy: {
      writeMode: 'declared-mounts-only',
      mounts: [
        { mountPath: '/workspace', access: 'read-write', source: 'workspace' },
        { mountPath: '/task-inputs', access: 'read-only', source: 'initial-state' },
        { mountPath: '/evidence', access: 'read-write', source: 'evidence' },
      ],
    },
    secretPolicy: {
      isolation: 'isolation-boundary',
      injectionPoints: [
        { secretId: 'signing-reference', mountPath: '/bindings/signing', mechanism: 'file-mount' },
      ],
    },
    timeLimits: { startupSeconds: 60, cleanupGraceSeconds: 30, deadlineBehavior: 'grace-then-stop' },
    resetSemantics: { mode: 'recreate', checkpoint: null, cleanup: 'destroy' },
    checkpointSemantics: { supported: false, triggers: [], retention: null },
    evidenceOutputs: {
      outputs: [
        { outputId: 'ev-trajectory', kind: 'trajectory', addressing: 'content-addressed', description: null },
        { outputId: 'ev-artifacts', kind: 'artifacts', addressing: 'content-addressed', description: null },
      ],
    },
    evaluationHooks: {
      evaluators: [
        {
          hookId: 'eval-standard-suite',
          role: 'evaluator',
          phase: 'post-run',
          invocationSchema: 'arena:schema/evaluation/suite-run@1.0.0',
          description: null,
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
    ...overrides,
  };
}

export function makeNondeterministicSeedPolicy(): CreateEnvironmentDefinitionInput['seedPolicy'] {
  return {
    reproducibility: {
      mode: 'nondeterministic',
      capture: {
        seed: 'effective seed recorded in the run evidence',
        versions: 'image and environment versions recorded in the run address',
        externalInputs: 'declared external inputs recorded with their digests',
        timingContext: 'wall-clock and monotonic timing recorded in the trajectory',
      },
      note: null,
    },
    seed: 'seed-0001',
    seedAlgorithm: 'counter-based-derivation',
    reseedPolicy: 'declared-only',
    note: null,
  };
}

export function makeCheckpointingOverrides(): Partial<CreateEnvironmentDefinitionInput> {
  return {
    resetSemantics: {
      mode: 'reset-to-checkpoint',
      checkpoint: { checkpointId: 'checkpoint-phase-1', digest: DIGEST_C },
      cleanup: 'retain-evidence',
    },
    checkpointSemantics: { supported: true, triggers: ['manual', 'on-phase'], retention: 4 },
  };
}

export function makeWorkloadInput() {
  return {
    trust: 'untrusted',
    requirements: {
      networkHosts: ['packages.internal'],
      writePaths: ['/workspace'],
      secretIds: ['signing-reference'],
      minCpuMillis: 1000,
      minMemoryMiB: 512,
      minWallClockSeconds: 1800,
    },
  };
}
