/**
 * The reference software-engineer environment definitions (ENV1.0 via
 * @arena/environment-protocol).
 *
 * Two variants:
 *  - `software-engineer-sandbox` — the primary dev sandbox: seeded
 *    deterministic simulation with checkpointing, internal registry
 *    egress, declared mounts and a secret injection boundary;
 *  - `software-engineer-hermetic-review` — a fully offline review
 *    world: derived image, ZERO egress allowances, no checkpoints,
 *    snapshot-restore resets.
 *
 * Both are deterministic data: identical inputs → identical digests.
 */

import {
  createEnvironmentDefinition,
} from '@arena/environment-protocol';
import type {
  CreateEnvironmentDefinitionInput,
  EnvironmentDefinition,
  EnvironmentVersionRef,
} from '@arena/environment-protocol';
import {
  SOFTWARE_ENGINEER_ENV_NAMESPACE,
  SOFTWARE_ENGINEER_ENV_T0,
  SOFTWARE_ENGINEER_HERMETIC_BUILD_DIGEST,
  SOFTWARE_ENGINEER_HERMETIC_IMAGE_DIGEST,
  SOFTWARE_ENGINEER_HERMETIC_NAME,
  SOFTWARE_ENGINEER_HERMETIC_SNAPSHOT_DIGEST,
  SOFTWARE_ENGINEER_HERMETIC_VERSION,
  SOFTWARE_ENGINEER_RUN_SEED,
  SOFTWARE_ENGINEER_SANDBOX_IMAGE_DIGEST,
  SOFTWARE_ENGINEER_SANDBOX_NAME,
  SOFTWARE_ENGINEER_SANDBOX_SNAPSHOT_DIGEST,
  SOFTWARE_ENGINEER_SANDBOX_VERSION,
} from './shared.js';

/** The action/tool surface shared by both reference environments. */
function softwareEngineerActionSurface() {
  return Object.freeze({
    actions: [
      { actionId: 'apply-file-edit', description: 'Apply one minimal, reviewable file edit inside /workspace.' },
      { actionId: 'run-test-suite', description: 'Execute the declared test suite and emit a per-test report.' },
      { actionId: 'run-build', description: 'Execute the declared build pipeline and capture status and logs.' },
      { actionId: 'commit-change', description: 'Stage and propose a commit; protected refs are never mutated.' },
    ],
    tools: [
      { toolId: 'shell', description: 'Bounded shell inside the sandbox (no host access).' },
      { toolId: 'file-io', description: 'Read/write access limited to declared mounts.' },
      { toolId: 'vcs-client', description: 'Diff/commit inspection and staging.' },
      { toolId: 'package-manager', description: 'Dependency resolution against the pinned internal registry.' },
    ],
  });
}

/** The observation surface shared by both reference environments. */
function softwareEngineerObservationSurface() {
  return Object.freeze({
    observations: [
      { observationId: 'obs-stdout', channel: 'stdout' as const, description: 'Command stdout stream.' },
      { observationId: 'obs-stderr', channel: 'stderr' as const, description: 'Command stderr stream.' },
      { observationId: 'obs-files', channel: 'files' as const, description: 'Workspace file snapshots after each step.' },
      { observationId: 'obs-events', channel: 'events' as const, description: 'Structured run events.' },
      { observationId: 'obs-metrics', channel: 'metrics' as const, description: 'Timing and resource metrics.' },
    ],
  });
}

/**
 * The full ENV1.0 declaration input for the primary reference
 * sandbox. Deterministic.
 */
export function softwareEngineerSandboxInput(): CreateEnvironmentDefinitionInput {
  return {
    identity: {
      namespace: SOFTWARE_ENGINEER_ENV_NAMESPACE,
      name: SOFTWARE_ENGINEER_SANDBOX_NAME,
    },
    version: SOFTWARE_ENGINEER_SANDBOX_VERSION,
    image: {
      imageKind: 'content-addressed-image',
      digest: SOFTWARE_ENGINEER_SANDBOX_IMAGE_DIGEST,
      buildDigest: null,
    },
    initialState: {
      snapshot: {
        snapshotId: 'snapshot-se-sandbox-initial',
        digest: SOFTWARE_ENGINEER_SANDBOX_SNAPSHOT_DIGEST,
      },
      snapshotSupport: 'supported',
    },
    seedPolicy: {
      reproducibility: {
        mode: 'nondeterministic',
        capture: {
          seed: 'the run seed drives the deterministic LCG workload simulation',
          versions: 'environment-runtime 1.0.0; environment-software-engineer 1.0.0',
          externalInputs: 'none - the reference simulation is closed',
          timingContext: 'injected manual clock; no wall-clock reads',
        },
      },
      seed: SOFTWARE_ENGINEER_RUN_SEED,
      seedAlgorithm: 'lcg-32',
      reseedPolicy: 'forbidden',
      note: 'seeded simulation; identical seed + clock yields identical runs',
    },
    actionSurface: softwareEngineerActionSurface(),
    observationSurface: softwareEngineerObservationSurface(),
    resourceLimits: { cpuMillis: 4000, memoryMiB: 8192, wallClockSeconds: 3600 },
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
        { mountPath: '/run/secrets', access: 'read-only', source: 'initial-state' },
      ],
    },
    secretPolicy: {
      isolation: 'isolation-boundary',
      injectionPoints: [
        {
          secretId: 'registry-credential',
          mountPath: '/run/secrets/registry',
          mechanism: 'file-mount',
        },
      ],
    },
    timeLimits: { startupSeconds: 120, cleanupGraceSeconds: 60, deadlineBehavior: 'grace-then-stop' },
    resetSemantics: { mode: 'recreate', checkpoint: null, cleanup: 'retain-evidence' },
    checkpointSemantics: { supported: true, triggers: ['manual', 'on-phase'], retention: 10 },
    evidenceOutputs: {
      outputs: [
        { outputId: 'ev-trajectory', kind: 'trajectory', addressing: 'content-addressed', description: 'the run event stream' },
        { outputId: 'ev-artifacts', kind: 'artifacts', addressing: 'content-addressed', description: 'test reports and build logs' },
        { outputId: 'ev-logs', kind: 'logs', addressing: 'append-only-ledger', description: 'command logs' },
        { outputId: 'ev-metrics', kind: 'metrics', addressing: 'content-addressed', description: 'timing and resource metrics' },
      ],
    },
    evaluationHooks: {
      evaluators: [
        {
          hookId: 'eval-se-reference-suite',
          role: 'evaluator',
          phase: 'post-run',
          invocationSchema: 'arena:schema/evaluation/suite-run@1.0.0',
          description: 'the A012 reference evaluation suite hook',
        },
      ],
      verifiers: [
        {
          hookId: 'verify-se-evidence',
          role: 'verifier',
          phase: 'on-evidence',
          invocationSchema: 'arena:schema/verification/check@1.0.0',
          description: 'the A013 reference verification hook',
        },
      ],
    },
  };
}

/**
 * The full ENV1.0 declaration input for the hermetic review variant:
 * derived image, zero egress allowances, no checkpoints, restore-snapshot resets.
 */
export function softwareEngineerHermeticInput(): CreateEnvironmentDefinitionInput {
  return {
    identity: {
      namespace: SOFTWARE_ENGINEER_ENV_NAMESPACE,
      name: SOFTWARE_ENGINEER_HERMETIC_NAME,
    },
    version: SOFTWARE_ENGINEER_HERMETIC_VERSION,
    image: {
      imageKind: 'derived-image',
      digest: SOFTWARE_ENGINEER_HERMETIC_IMAGE_DIGEST,
      buildDigest: SOFTWARE_ENGINEER_HERMETIC_BUILD_DIGEST,
    },
    initialState: {
      snapshot: {
        snapshotId: 'snapshot-se-hermetic-initial',
        digest: SOFTWARE_ENGINEER_HERMETIC_SNAPSHOT_DIGEST,
      },
      snapshotSupport: 'supported',
    },
    seedPolicy: {
      reproducibility: {
        mode: 'deterministic',
        capture: null,
        note: 'closed hermetic world; no external inputs, no seed required',
      },
      seed: null,
      seedAlgorithm: null,
      reseedPolicy: 'forbidden',
      note: null,
    },
    actionSurface: softwareEngineerActionSurface(),
    observationSurface: softwareEngineerObservationSurface(),
    resourceLimits: { cpuMillis: 2000, memoryMiB: 4096, wallClockSeconds: 1800 },
    networkPolicy: { egress: 'default-deny', allows: [] },
    filesystemPolicy: {
      writeMode: 'declared-mounts-only',
      mounts: [
        { mountPath: '/review', access: 'read-write', source: 'workspace' },
        { mountPath: '/task-inputs', access: 'read-only', source: 'initial-state' },
        { mountPath: '/evidence', access: 'read-write', source: 'evidence' },
      ],
    },
    secretPolicy: { isolation: 'isolation-boundary', injectionPoints: [] },
    timeLimits: { startupSeconds: 60, cleanupGraceSeconds: 30, deadlineBehavior: 'hard-stop' },
    resetSemantics: { mode: 'restore-snapshot', checkpoint: null, cleanup: 'destroy' },
    checkpointSemantics: { supported: false, triggers: [], retention: null },
    evidenceOutputs: {
      outputs: [
        { outputId: 'ev-trajectory', kind: 'trajectory', addressing: 'content-addressed', description: 'the review event stream' },
        { outputId: 'ev-artifacts', kind: 'artifacts', addressing: 'content-addressed', description: 'review annotations' },
      ],
    },
    evaluationHooks: {
      evaluators: [
        {
          hookId: 'eval-se-hermetic-suite',
          role: 'evaluator',
          phase: 'post-run',
          invocationSchema: 'arena:schema/evaluation/suite-run@1.0.0',
          description: 'the A012 reference evaluation suite hook (offline)',
        },
      ],
      verifiers: [
        {
          hookId: 'verify-se-hermetic-evidence',
          role: 'verifier',
          phase: 'on-completion',
          invocationSchema: 'arena:schema/verification/check@1.0.0',
          description: 'the A013 reference verification hook (offline)',
        },
      ],
    },
  };
}

/** Create (validate + digest + freeze) the primary reference sandbox definition. */
export async function createSoftwareEngineerSandbox(): Promise<EnvironmentDefinition> {
  return createEnvironmentDefinition(softwareEngineerSandboxInput());
}

/** Create (validate + digest + freeze) the hermetic review definition. */
export async function createSoftwareEngineerHermetic(): Promise<EnvironmentDefinition> {
  return createEnvironmentDefinition(softwareEngineerHermeticInput());
}

/** The content-addressed version ref of the primary sandbox. */
export async function softwareEngineerSandboxRef(): Promise<EnvironmentVersionRef> {
  const definition = await createSoftwareEngineerSandbox();
  return {
    namespace: definition.identity.namespace,
    name: definition.identity.name,
    version: definition.version,
    digest: definition.digest,
  };
}

/** Fixed reference timestamp exported for consumers building records. */
export const SOFTWARE_ENGINEER_ENV_REFERENCE_TIME = SOFTWARE_ENGINEER_ENV_T0;
