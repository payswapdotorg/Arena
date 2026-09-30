/**
 * Positive + negative/adversarial tests for the reference structural
 * environment definitions and their A010 consumption surface.
 */

import { describe, expect, it } from 'vitest';
import { environmentVersionRef } from '@arena/environment-protocol';
import {
  ENVIRONMENT_RUNTIME_ERROR_CODES,
  EnvironmentRuntimeError,
  transitionRunState,
} from '@arena/environment-runtime';
import {
  canonicalRunLifecycle,
  createStructuralAnalysisSandbox,
  createStructuralHermetic,
  evaluateSandboxAdmission,
  sandboxAdmissionView,
  sandboxSnapshotDigest,
  structuralAnalysisSandboxInput,
  structuralAnalysisSandboxRef,
  structuralEngineerRunDeclaration,
  structuralHermeticInput,
} from './index.js';

const HEX64 = /^[0-9a-f]{64}$/;
const TASK_VERSION = { taskId: 'task-struct-failing-check', version: '1.0.0' } as const;

describe('definitions (positive)', () => {
  it('creates the reference sandbox with a stable content digest', async () => {
    const [a, b] = await Promise.all([
      createStructuralAnalysisSandbox(),
      createStructuralAnalysisSandbox(),
    ]);
    expect(a.digest).toMatch(HEX64);
    expect(a.digest).toBe(b.digest);
    expect(a.identity).toEqual({
      namespace: 'arena-reference',
      name: 'structural-analysis-sandbox',
    });
    expect(a.version).toBe('1.0.0');
    expect(a.checkpointSemantics.supported).toBe(true);
    expect(a.networkPolicy.allows).toHaveLength(2);
    expect(a.filesystemPolicy.mounts.map((m) => m.mountPath)).toEqual([
      '/model',
      '/task-inputs',
      '/evidence',
      '/run/secrets',
    ]);
    expect(a.evaluationHooks.evaluators).toHaveLength(1);
    expect(a.evaluationHooks.verifiers).toHaveLength(1);
  });

  it('declares the structural action surface on both variants', async () => {
    const [sandbox, hermetic] = await Promise.all([
      createStructuralAnalysisSandbox(),
      createStructuralHermetic(),
    ]);
    for (const definition of [sandbox, hermetic]) {
      expect(definition.actionSurface.actions.map((a) => a.actionId)).toEqual([
        'run-structural-analysis',
        'update-load-model',
        'record-calculation-sheet',
      ]);
      expect(definition.actionSurface.tools.map((t) => t.toolId)).toEqual([
        'solver-engine',
        'model-io',
        'reference-data-client',
        'calculation-recorder',
      ]);
    }
  });

  it('creates the hermetic variant with zero egress and no checkpoints', async () => {
    const hermetic = await createStructuralHermetic();
    expect(hermetic.digest).toMatch(HEX64);
    expect(hermetic.image.imageKind).toBe('derived-image');
    expect(hermetic.image.buildDigest).not.toBeNull();
    expect(hermetic.networkPolicy.allows).toEqual([]);
    expect(hermetic.checkpointSemantics.supported).toBe(false);
    expect(hermetic.resetSemantics.mode).toBe('restore-snapshot');
    expect(hermetic.digest).not.toBe((await createStructuralAnalysisSandbox()).digest);
  });

  it('exposes the sandbox version ref matching the definition', async () => {
    const [definition, ref] = await Promise.all([
      createStructuralAnalysisSandbox(),
      structuralAnalysisSandboxRef(),
    ]);
    expect(ref).toEqual(environmentVersionRef(definition));
  });

  it('declares a legal lifecycle for both variants of run flow', () => {
    const steps = canonicalRunLifecycle();
    expect(steps.map((step) => step.event)).toEqual([
      'provision-started',
      'provisioned',
      'started',
      'completed',
      'cleaned',
    ]);
    expect(steps[0]!.from).toBe('requested');
    expect(steps[steps.length - 1]!.to).toBe('cleaned');
    // every step is legal per the REAL transition table (no throw)
    let state = 'requested' as ReturnType<typeof transitionRunState>;
    for (const step of steps) {
      state = transitionRunState(state, step.event);
      expect(state).toBe(step.to);
    }
  });
});

describe('consumption surface (positive)', () => {
  it('builds a run declaration that the sandbox admits', async () => {
    const definition = await createStructuralAnalysisSandbox();
    const declaration = structuralEngineerRunDeclaration(definition, TASK_VERSION);
    expect(declaration.environment.digest).toBe(definition.digest);
    expect(declaration.initialSnapshotDigest).toBe(sandboxSnapshotDigest(definition));
    const decision = evaluateSandboxAdmission(definition, declaration);
    expect(decision.admitted).toBe(true);
    expect(decision.violations).toEqual([]);
  });

  it('projects the admission view from the definition', async () => {
    const definition = await createStructuralAnalysisSandbox();
    const view = sandboxAdmissionView(definition);
    expect(view.resourceLimits.cpuMillis).toBe(4000);
    expect(view.networkPolicy.allows).toHaveLength(2);
    expect(view.timeLimits.startupSeconds).toBe(120);
  });
});

describe('environment policy violations (negative/adversarial)', () => {
  it('rejects egress to an undeclared host', async () => {
    const definition = await createStructuralAnalysisSandbox();
    const declaration = structuralEngineerRunDeclaration(definition, TASK_VERSION, {
      networkEgress: [{ host: 'exfil.example.net', port: 443, protocol: 'https' }],
    });
    const decision = evaluateSandboxAdmission(definition, declaration);
    expect(decision.admitted).toBe(false);
    expect(decision.violations.length).toBeGreaterThan(0);
  });

  it('rejects resource envelopes over the ceiling', async () => {
    const definition = await createStructuralAnalysisSandbox();
    const declaration = structuralEngineerRunDeclaration(definition, TASK_VERSION, {
      cpuMillis: 8000,
      memoryMiB: 16384,
      wallClockSeconds: 7200,
    });
    const decision = evaluateSandboxAdmission(definition, declaration);
    expect(decision.admitted).toBe(false);
    expect(decision.violations.length).toBeGreaterThan(0);
  });

  it('rejects mounts outside the declared filesystem policy', async () => {
    const definition = await createStructuralAnalysisSandbox();
    const declaration = structuralEngineerRunDeclaration(definition, TASK_VERSION, {
      mounts: [{ mountPath: '/etc', access: 'read-write', source: 'workspace' }],
    });
    const decision = evaluateSandboxAdmission(definition, declaration);
    expect(decision.admitted).toBe(false);
  });

  it('rejects read-write mounts where the environment only allows read-only', async () => {
    const definition = await createStructuralAnalysisSandbox();
    const declaration = structuralEngineerRunDeclaration(definition, TASK_VERSION, {
      mounts: [{ mountPath: '/task-inputs', access: 'read-write', source: 'initial-state' }],
    });
    const decision = evaluateSandboxAdmission(definition, declaration);
    expect(decision.admitted).toBe(false);
  });

  it('rejects undeclared secret injection points', async () => {
    const definition = await createStructuralAnalysisSandbox();
    const declaration = structuralEngineerRunDeclaration(definition, TASK_VERSION, {
      secretInjectionPoints: [
        { secretId: 'host-ssh-key', mountPath: '/run/secrets/ssh', mechanism: 'file-mount' },
      ],
    });
    const decision = evaluateSandboxAdmission(definition, declaration);
    expect(decision.admitted).toBe(false);
  });

  it('rejects a hermetic run that wants any egress at all', async () => {
    const hermetic = await createStructuralHermetic();
    const declaration = structuralEngineerRunDeclaration(hermetic, TASK_VERSION, {
      networkEgress: [{ host: 'sections.internal', port: 443, protocol: 'https' }],
    });
    const decision = evaluateSandboxAdmission(hermetic, declaration);
    expect(decision.admitted).toBe(false);
  });

  it('rejects an illegal lifecycle transition with the runtime error taxonomy', () => {
    expect(() => transitionRunState('requested', 'completed')).toThrowError(EnvironmentRuntimeError);
    try {
      transitionRunState('cleaned', 'started');
    } catch (error) {
      expect((error as EnvironmentRuntimeError).code).toBe(
        ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION,
      );
    }
  });
});

describe('declaration input hygiene (negative)', () => {
  it('keeps deterministic seed policy consistency in both inputs', async () => {
    const sandbox = structuralAnalysisSandboxInput();
    // seeded simulation: nondeterministic mode requires a capture, seed requires an algorithm
    expect(sandbox.seedPolicy.reproducibility.mode).toBe('nondeterministic');
    expect(sandbox.seedPolicy.reproducibility.capture).not.toBeNull();
    expect(sandbox.seedPolicy.seed).not.toBeNull();
    expect(sandbox.seedPolicy.seedAlgorithm).not.toBeNull();

    const hermetic = structuralHermeticInput();
    // hermetic world: deterministic mode forbids seed and capture
    expect(hermetic.seedPolicy.reproducibility.mode).toBe('deterministic');
    expect(hermetic.seedPolicy.reproducibility.capture).toBeNull();
    expect(hermetic.seedPolicy.seed).toBeNull();
  });
});
