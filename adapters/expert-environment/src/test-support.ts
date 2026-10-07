/**
 * Test support (Work Order C006) — deterministic A009 EnvironmentDefinition
 * fixture for the expert-environment adapter tests. Mirrors
 * @arena/environment-protocol's internal fixture shape (the package does
 * not export its own test-support); every value is runtime-neutral and
 * secret-free.
 */

import { createEnvironmentDefinition } from '@arena/environment-protocol';
import type { CreateEnvironmentDefinitionInput, EnvironmentDefinition } from '@arena/environment-protocol';

const DIGEST_A = '1111111111111111111111111111111111111111111111111111111111111111';
const DIGEST_B = '2222222222222222222222222222222222222222222222222222222222222222';

export const TENANT_A = 'tenant-alpha';
export const REQUEST_ID = 'esc_33333333333333333333333333333333';
export const T0 = '2026-10-07T10:05:00.000Z';
export const EXPIRY = '2026-10-07T11:00:00.000Z';

export function makeDefinitionInput(
  overrides: Partial<CreateEnvironmentDefinitionInput> = {},
): CreateEnvironmentDefinitionInput {
  return {
    identity: { namespace: 'tenant-a', name: 'engineering-sandbox' },
    version: '1.2.0',
    image: { imageKind: 'content-addressed-image', digest: DIGEST_A, buildDigest: null },
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
      tools: [
        { toolId: 'search-vendors', description: null },
        { toolId: 'compute-reconciliation', description: null },
        { toolId: 'admin-console', description: null },
      ],
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
      allows: [{ host: 'packages.internal', port: 443, protocol: 'https' }],
    },
    filesystemPolicy: {
      writeMode: 'declared-mounts-only',
      mounts: [
        { mountPath: '/workspace', access: 'read-write', source: 'workspace' },
        { mountPath: '/task-inputs', access: 'read-only', source: 'initial-state' },
      ],
    },
    secretPolicy: {
      isolation: 'isolation-boundary',
      injectionPoints: [
        { secretId: 'admin-console-binding', mountPath: '/tools/admin-console', mechanism: 'environment-binding' },
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

export async function makeEnvironmentDefinition(
  overrides: Partial<CreateEnvironmentDefinitionInput> = {},
): Promise<EnvironmentDefinition> {
  return createEnvironmentDefinition(makeDefinitionInput(overrides));
}
