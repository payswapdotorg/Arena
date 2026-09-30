/**
 * The reference structural-engineer environment definitions (ENV1.0 via
 * @arena/environment-protocol).
 *
 * Two variants:
 *  - `structural-analysis-sandbox` — the primary analysis world: seeded
 *    deterministic structural-analysis simulation with checkpointing,
 *    internal reference-data egress (section library + code editions),
 *    declared mounts (model, drawings/specs, evidence) and a secret
 *    injection boundary for the reference-data registry credential;
 *  - `structural-hermetic-review` — a fully offline review world for
 *    sealed model + drawing packages: derived image, ZERO egress
 *    allowances, no checkpoints, snapshot-restore resets.
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
  STRUCTURAL_ENGINEER_ENV_NAMESPACE,
  STRUCTURAL_ENGINEER_ENV_T0,
  STRUCTURAL_ENGINEER_HERMETIC_BUILD_DIGEST,
  STRUCTURAL_ENGINEER_HERMETIC_IMAGE_DIGEST,
  STRUCTURAL_ENGINEER_HERMETIC_NAME,
  STRUCTURAL_ENGINEER_HERMETIC_SNAPSHOT_DIGEST,
  STRUCTURAL_ENGINEER_HERMETIC_VERSION,
  STRUCTURAL_ENGINEER_RUN_SEED,
  STRUCTURAL_ENGINEER_SANDBOX_IMAGE_DIGEST,
  STRUCTURAL_ENGINEER_SANDBOX_NAME,
  STRUCTURAL_ENGINEER_SANDBOX_SNAPSHOT_DIGEST,
  STRUCTURAL_ENGINEER_SANDBOX_VERSION,
} from './shared.js';

/** The action/tool surface shared by both reference environments. */
function structuralEngineerActionSurface() {
  return Object.freeze({
    actions: [
      { actionId: 'run-structural-analysis', description: 'Execute the structural solver over the pinned model and emit per-check demand/capacity utilization ratios.' },
      { actionId: 'update-load-model', description: 'Apply one minimal, reviewable correction to load/model parameters inside /model.' },
      { actionId: 'record-calculation-sheet', description: 'Record an auditable calculation sheet into /evidence; limit-state criteria are never relaxed.' },
    ],
    tools: [
      { toolId: 'solver-engine', description: 'Bounded structural solver inside the sandbox (no host access).' },
      { toolId: 'model-io', description: 'Read/write access to the structural model limited to declared mounts.' },
      { toolId: 'reference-data-client', description: 'Section properties and design-code lookups against the pinned internal registries.' },
      { toolId: 'calculation-recorder', description: 'Calculation-sheet capture and diff inspection for evidence mounts.' },
    ],
  });
}

/** The observation surface shared by both reference environments. */
function structuralEngineerObservationSurface() {
  return Object.freeze({
    observations: [
      { observationId: 'obs-solver-log', channel: 'stdout' as const, description: 'Solver stdout stream: per-check utilization ratios.' },
      { observationId: 'obs-solver-issues', channel: 'stderr' as const, description: 'Solver diagnostics and warnings stream.' },
      { observationId: 'obs-model-state', channel: 'files' as const, description: 'Model snapshots after each parameter correction.' },
      { observationId: 'obs-events', channel: 'events' as const, description: 'Structured run events.' },
      { observationId: 'obs-metrics', channel: 'metrics' as const, description: 'Solve timing and resource metrics.' },
    ],
  });
}

/**
 * The full ENV1.0 declaration input for the primary reference
 * structural-analysis sandbox. Deterministic.
 */
export function structuralAnalysisSandboxInput(): CreateEnvironmentDefinitionInput {
  return {
    identity: {
      namespace: STRUCTURAL_ENGINEER_ENV_NAMESPACE,
      name: STRUCTURAL_ENGINEER_SANDBOX_NAME,
    },
    version: STRUCTURAL_ENGINEER_SANDBOX_VERSION,
    image: {
      imageKind: 'content-addressed-image',
      digest: STRUCTURAL_ENGINEER_SANDBOX_IMAGE_DIGEST,
      buildDigest: null,
    },
    initialState: {
      snapshot: {
        snapshotId: 'snapshot-struct-sandbox-initial',
        digest: STRUCTURAL_ENGINEER_SANDBOX_SNAPSHOT_DIGEST,
      },
      snapshotSupport: 'supported',
    },
    seedPolicy: {
      reproducibility: {
        mode: 'nondeterministic',
        capture: {
          seed: 'the run seed drives the deterministic LCG workload simulation',
          versions: 'environment-runtime 1.0.0; environment-structural-engineer 1.0.0',
          externalInputs: 'none - the reference simulation is closed',
          timingContext: 'injected manual clock; no wall-clock reads',
        },
      },
      seed: STRUCTURAL_ENGINEER_RUN_SEED,
      seedAlgorithm: 'lcg-32',
      reseedPolicy: 'forbidden',
      note: 'seeded simulation; identical seed + clock yields identical runs',
    },
    actionSurface: structuralEngineerActionSurface(),
    observationSurface: structuralEngineerObservationSurface(),
    resourceLimits: { cpuMillis: 4000, memoryMiB: 8192, wallClockSeconds: 3600 },
    networkPolicy: {
      egress: 'default-deny',
      allows: [
        { host: 'sections.internal', port: 443, protocol: 'https' },
        { host: 'codes.internal', port: 443, protocol: 'https' },
      ],
    },
    filesystemPolicy: {
      writeMode: 'declared-mounts-only',
      mounts: [
        { mountPath: '/model', access: 'read-write', source: 'workspace' },
        { mountPath: '/task-inputs', access: 'read-only', source: 'initial-state' },
        { mountPath: '/evidence', access: 'read-write', source: 'evidence' },
        { mountPath: '/run/secrets', access: 'read-only', source: 'initial-state' },
      ],
    },
    secretPolicy: {
      isolation: 'isolation-boundary',
      injectionPoints: [
        {
          secretId: 'reference-data-credential',
          mountPath: '/run/secrets/reference-data',
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
        { outputId: 'ev-artifacts', kind: 'artifacts', addressing: 'content-addressed', description: 'analysis reports and calculation sheets' },
        { outputId: 'ev-logs', kind: 'logs', addressing: 'append-only-ledger', description: 'solver logs' },
        { outputId: 'ev-metrics', kind: 'metrics', addressing: 'content-addressed', description: 'solve timing and resource metrics' },
      ],
    },
    evaluationHooks: {
      evaluators: [
        {
          hookId: 'eval-struct-reference-suite',
          role: 'evaluator',
          phase: 'post-run',
          invocationSchema: 'arena:schema/evaluation/suite-run@1.0.0',
          description: 'the A012 reference evaluation suite hook',
        },
      ],
      verifiers: [
        {
          hookId: 'verify-struct-evidence',
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
 * derived image, zero egress allowances, no checkpoints,
 * restore-snapshot resets. Sealed drawing/model packages are reviewed
 * entirely offline.
 */
export function structuralHermeticInput(): CreateEnvironmentDefinitionInput {
  return {
    identity: {
      namespace: STRUCTURAL_ENGINEER_ENV_NAMESPACE,
      name: STRUCTURAL_ENGINEER_HERMETIC_NAME,
    },
    version: STRUCTURAL_ENGINEER_HERMETIC_VERSION,
    image: {
      imageKind: 'derived-image',
      digest: STRUCTURAL_ENGINEER_HERMETIC_IMAGE_DIGEST,
      buildDigest: STRUCTURAL_ENGINEER_HERMETIC_BUILD_DIGEST,
    },
    initialState: {
      snapshot: {
        snapshotId: 'snapshot-struct-hermetic-initial',
        digest: STRUCTURAL_ENGINEER_HERMETIC_SNAPSHOT_DIGEST,
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
    actionSurface: structuralEngineerActionSurface(),
    observationSurface: structuralEngineerObservationSurface(),
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
        { outputId: 'ev-artifacts', kind: 'artifacts', addressing: 'content-addressed', description: 'review annotations on the sealed model package' },
      ],
    },
    evaluationHooks: {
      evaluators: [
        {
          hookId: 'eval-struct-hermetic-suite',
          role: 'evaluator',
          phase: 'post-run',
          invocationSchema: 'arena:schema/evaluation/suite-run@1.0.0',
          description: 'the A012 reference evaluation suite hook (offline)',
        },
      ],
      verifiers: [
        {
          hookId: 'verify-struct-hermetic-evidence',
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
export async function createStructuralAnalysisSandbox(): Promise<EnvironmentDefinition> {
  return createEnvironmentDefinition(structuralAnalysisSandboxInput());
}

/** Create (validate + digest + freeze) the hermetic review definition. */
export async function createStructuralHermetic(): Promise<EnvironmentDefinition> {
  return createEnvironmentDefinition(structuralHermeticInput());
}

/** The content-addressed version ref of the primary sandbox. */
export async function structuralAnalysisSandboxRef(): Promise<EnvironmentVersionRef> {
  const definition = await createStructuralAnalysisSandbox();
  return {
    namespace: definition.identity.namespace,
    name: definition.identity.name,
    version: definition.version,
    digest: definition.digest,
  };
}

/** Fixed reference timestamp exported for consumers building records. */
export const STRUCTURAL_ENGINEER_ENV_REFERENCE_TIME = STRUCTURAL_ENGINEER_ENV_T0;
