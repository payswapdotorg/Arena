/**
 * Shared test fixtures for @arena/environment-runtime (NOT part of the
 * public surface — hygiene.test.ts asserts it is not exported).
 */

import type { CreateRunRecordInput } from './run-record.js';

export const DIGEST_A =
  '1111111111111111111111111111111111111111111111111111111111111111';
export const DIGEST_B =
  '2222222222222222222222222222222222222222222222222222222222222222';
export const DIGEST_C =
  '3333333333333333333333333333333333333333333333333333333333333333';
export const DIGEST_D =
  '4444444444444444444444444444444444444444444444444444444444444444';
export const DIGEST_E =
  '5555555555555555555555555555555555555555555555555555555555555555';

export const T0 = '2026-01-15T09:30:00.000Z';
export const T1 = '2026-01-15T09:30:01.000Z';
export const T2 = '2026-01-15T09:30:02.000Z';
export const T3 = '2026-01-15T09:30:03.000Z';
export const T4 = '2026-01-15T09:30:04.000Z';
export const T5 = '2026-01-15T09:30:05.000Z';
export const T6 = '2026-01-15T09:30:06.000Z';
export const T7 = '2026-01-15T09:30:07.000Z';

export const TENANT_A = 'tenant-a';
export const TENANT_B = 'tenant-b';

export interface DeclarationOverrides {
  readonly runKey?: string;
  readonly tenantId?: string;
  readonly seed?: string | null;
  readonly jobRef?: string;
  readonly initialSnapshotDigest?: string;
  readonly cpuMillis?: number;
  readonly memoryMiB?: number;
  readonly wallClockSeconds?: number;
  readonly environmentDigest?: string;
  readonly networkAllows?: readonly { host: string; port: number; protocol: string }[];
  readonly mounts?: readonly { mountPath: string; access: string; source: string }[];
  readonly secretPoints?: readonly {
    secretId: string;
    mountPath: string;
    mechanism: string;
  }[];
  readonly submittedAt?: string;
}

export function makeDeclarationInput(
  overrides: DeclarationOverrides = {},
): CreateRunRecordInput {
  return {
    runId: `${overrides.tenantId ?? TENANT_A}/${overrides.runKey ?? 'run-000042'}`,
    tenantId: overrides.tenantId ?? TENANT_A,
    environment: {
      namespace: 'tenant-a',
      name: 'engineering-sandbox',
      version: '1.2.0',
      digest: overrides.environmentDigest ?? DIGEST_A,
    },
    jobRef: overrides.jobRef ?? 'job-7f3a2b',
    initialSnapshotDigest: overrides.initialSnapshotDigest ?? DIGEST_B,
    seed: overrides.seed === undefined ? 'seed-1234' : overrides.seed,
    submittedAt: overrides.submittedAt ?? T0,
    resourceEnvelope: {
      cpuMillis: overrides.cpuMillis ?? 2000,
      memoryMiB: overrides.memoryMiB ?? 512,
      wallClockSeconds: overrides.wallClockSeconds ?? 600,
    },
    networkEnvelope: {
      egress: 'default-deny',
      allows: overrides.networkAllows ?? [
        { host: 'packages.example.org', port: 443, protocol: 'https' },
      ],
    },
    filesystemEnvelope: {
      writeMode: 'declared-mounts-only',
      mounts: overrides.mounts ?? [
        { mountPath: '/workspace', access: 'read-write', source: 'workspace' },
        { mountPath: '/evidence', access: 'read-only', source: 'evidence' },
      ],
    },
    secretEnvelope: {
      isolation: 'isolation-boundary',
      injectionPoints: overrides.secretPoints ?? [
        {
          secretId: 'registry-credentials',
          mountPath: '/run/secrets/registry',
          mechanism: 'file-mount',
        },
      ],
    },
  };
}

/** The environment-side bounds the default declaration fits inside. */
export function makeEnvironmentView(
  overrides: {
    cpuMillis?: number;
    memoryMiB?: number;
    wallClockSeconds?: number;
    networkAllows?: readonly { host: string; port: number; protocol: string }[];
    mounts?: readonly { mountPath: string; access: string; source: string }[];
    secretPoints?: readonly {
      secretId: string;
      mountPath: string;
      mechanism: string;
    }[];
  } = {},
): {
  resourceLimits: { cpuMillis: number; memoryMiB: number; wallClockSeconds: number };
  networkPolicy: { egress: string; allows: readonly { host: string; port: number; protocol: string }[] };
  filesystemPolicy: {
    writeMode: string;
    mounts: readonly { mountPath: string; access: string; source: string }[];
  };
  secretPolicy: {
    isolation: string;
    injectionPoints: readonly {
      secretId: string;
      mountPath: string;
      mechanism: string;
    }[];
  };
  timeLimits: { startupSeconds: number; cleanupGraceSeconds: number; deadlineBehavior: string };
} {
  return {
    resourceLimits: {
      cpuMillis: overrides.cpuMillis ?? 4000,
      memoryMiB: overrides.memoryMiB ?? 1024,
      wallClockSeconds: overrides.wallClockSeconds ?? 900,
    },
    networkPolicy: {
      egress: 'default-deny',
      allows: overrides.networkAllows ?? [
        { host: 'packages.example.org', port: 443, protocol: 'https' },
        { host: 'artifacts.example.org', port: 443, protocol: 'https' },
      ],
    },
    filesystemPolicy: {
      writeMode: 'declared-mounts-only',
      mounts: overrides.mounts ?? [
        { mountPath: '/workspace', access: 'read-write', source: 'workspace' },
        { mountPath: '/evidence', access: 'read-only', source: 'evidence' },
        { mountPath: '/run/secrets', access: 'read-only', source: 'initial-state' },
      ],
    },
    secretPolicy: {
      isolation: 'isolation-boundary',
      injectionPoints: overrides.secretPoints ?? [
        {
          secretId: 'registry-credentials',
          mountPath: '/run/secrets/registry',
          mechanism: 'file-mount',
        },
      ],
    },
    timeLimits: {
      startupSeconds: 60,
      cleanupGraceSeconds: 30,
      deadlineBehavior: 'hard-stop',
    },
  };
}
