/**
 * The A010 consumption surface for the reference software-engineer
 * sandbox: typed run declarations that fit inside the environment's
 * isolation envelopes, the admission view, and the canonical
 * provisioning lifecycle sequence.
 */

import type { EnvironmentDefinition } from '@arena/environment-protocol';
import type { SubmitRunCommandPayload } from '@arena/environment-runtime';
import {
  RUN_STATES,
  evaluateAdmission,
  toEnvironmentAdmissionView,
  toFilesystemEnvelope,
  toNetworkEnvelope,
  toResourceEnvelope,
  toSecretEnvelope,
  transitionRunState,
} from '@arena/environment-runtime';
import type {
  AdmissionDecision,
  EnvironmentAdmissionView,
  RunIsolationEnvelope,
  RunLifecycleEvent,
  RunState,
} from '@arena/environment-runtime';
import {
  SOFTWARE_ENGINEER_RUN_SEED,
  SOFTWARE_ENGINEER_RUN_TENANT,
} from './shared.js';

/** Shape of the declaration payload consumed by makeSubmitRunCommand. */
export type SoftwareEngineerRunDeclaration = SubmitRunCommandPayload['declaration'];

export interface SoftwareEngineerRunOptions {
  readonly runKey?: string;
  readonly jobRef?: string;
  readonly taskVersion?: { readonly taskId: string; readonly version: string };
  readonly cpuMillis?: number;
  readonly memoryMiB?: number;
  readonly wallClockSeconds?: number;
  readonly networkEgress?: readonly { readonly host: string; readonly port: number; readonly protocol: string }[];
  readonly mounts?: readonly { readonly mountPath: string; readonly access: string; readonly source: string }[];
  readonly secretInjectionPoints?: readonly {
    readonly secretId: string;
    readonly mountPath: string;
    readonly mechanism: string;
  }[];
}

/**
 * A typed run declaration for the reference sandbox that fits INSIDE
 * the environment's declared envelopes (subset egress, covered mounts,
 * declared secret injection points, resources under the ceiling).
 * The declaration pins the REAL definition digest and initial snapshot.
 */
export function softwareEngineerRunDeclaration(
  definition: EnvironmentDefinition,
  taskVersion: { readonly taskId: string; readonly version: string },
  options: SoftwareEngineerRunOptions = {},
): SoftwareEngineerRunDeclaration {
  return {
    runKey: options.runKey ?? 'run-se-reference-0001',
    tenantId: SOFTWARE_ENGINEER_RUN_TENANT,
    environment: {
      namespace: definition.identity.namespace,
      name: definition.identity.name,
      version: definition.version,
      digest: definition.digest,
    },
    jobRef: options.jobRef ?? 'job-se-reference-0001',
    taskVersion: { taskId: taskVersion.taskId, version: taskVersion.version },
    initialSnapshotDigest: definition.initialState.snapshot.digest,
    seed: SOFTWARE_ENGINEER_RUN_SEED,
    resourceEnvelope: {
      cpuMillis: options.cpuMillis ?? 2000,
      memoryMiB: options.memoryMiB ?? 4096,
      wallClockSeconds: options.wallClockSeconds ?? 1800,
    },
    networkEnvelope: {
      egress: 'default-deny',
      allows: options.networkEgress ?? [
        { host: 'packages.internal', port: 443, protocol: 'https' },
      ],
    },
    filesystemEnvelope: {
      writeMode: 'declared-mounts-only',
      mounts: options.mounts ?? [
        { mountPath: '/workspace', access: 'read-write', source: 'workspace' },
      ],
    },
    secretEnvelope: {
      isolation: 'isolation-boundary',
      injectionPoints: options.secretInjectionPoints ?? [
        {
          secretId: 'registry-credential',
          mountPath: '/run/secrets/registry',
          mechanism: 'file-mount',
        },
      ],
    },
  };
}

/** The initial snapshot digest of the reference sandbox definition. */
export function sandboxSnapshotDigest(definition: EnvironmentDefinition): string {
  return definition.initialState.snapshot.digest;
}

/** The A010 admission view of an EnvironmentDefinition (pure projection). */
export function sandboxAdmissionView(
  definition: EnvironmentDefinition,
): EnvironmentAdmissionView {
  return toEnvironmentAdmissionView({
    resourceLimits: definition.resourceLimits,
    networkPolicy: definition.networkPolicy,
    filesystemPolicy: definition.filesystemPolicy,
    secretPolicy: definition.secretPolicy,
    timeLimits: definition.timeLimits,
  });
}

/** Evaluate a run declaration against the sandbox admission rules (pure). */
export function evaluateSandboxAdmission(
  definition: EnvironmentDefinition,
  declaration: SoftwareEngineerRunDeclaration,
): AdmissionDecision {
  const envelope: RunIsolationEnvelope = {
    resource: toResourceEnvelope(declaration.resourceEnvelope),
    network: toNetworkEnvelope({
      egress: declaration.networkEnvelope.egress,
      allows: declaration.networkEnvelope.allows ?? [],
    }),
    filesystem: toFilesystemEnvelope({
      writeMode: declaration.filesystemEnvelope.writeMode,
      mounts: declaration.filesystemEnvelope.mounts ?? [],
    }),
    secret: toSecretEnvelope({
      isolation: declaration.secretEnvelope.isolation,
      injectionPoints: declaration.secretEnvelope.injectionPoints ?? [],
    }),
  };
  return evaluateAdmission(sandboxAdmissionView(definition), envelope);
}

/** One legal step of the run lifecycle state machine. */
export interface LifecycleStep {
  readonly event: RunLifecycleEvent;
  readonly from: RunState;
  readonly to: RunState;
}

/**
 * The canonical provisioning lifecycle of the reference sandbox:
 * requested → provisioning → ready → running → completed → cleaned,
 * derived from the REAL A010 transition table (every step is legal).
 */
export function canonicalRunLifecycle(): readonly LifecycleStep[] {
  const events: readonly RunLifecycleEvent[] = [
    'provision-started',
    'provisioned',
    'started',
    'completed',
    'cleaned',
  ];
  const steps: LifecycleStep[] = [];
  let state: RunState = RUN_STATES[0] as RunState;
  for (const event of events) {
    const to = transitionRunState(state, event);
    steps.push({ event, from: state, to });
    state = to;
  }
  return Object.freeze(steps);
}
