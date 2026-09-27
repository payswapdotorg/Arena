/**
 * Workload declaration and the least-privilege admission check (spec
 * ENV1.0 "Isolation"; architecture-lock rule 8; docs/architecture.md §16;
 * Work Order A009 gate 6 tail).
 *
 * A WorkloadDeclaration states WHAT runs inside an environment: its trust
 * classification and its requirements (network hosts, write paths, secret
 * references, minimum CPU/memory/time). assertLeastPrivilege compares a
 * declaration against the environment's declared policies and REJECTS any
 * workload that requires more than the declared allows — for untrusted
 * workloads this is the mandated gate; the check is applied uniformly to
 * all workloads because environment execution is isolated and bounded
 * (architecture-lock rule 8) and trust is a property of the operator, not
 * a license to exceed declared boundaries.
 *
 * The declaration carries only references and quotas — never secret
 * material, never runner bindings.
 */

import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import type { EnvironmentDefinition } from './definition.js';
import { isEnvironmentDefinition } from './definition.js';
import { declaresSecret, isPathWritable } from './isolation.js';
import type { Hostname, MountPath } from './shared.js';
import {
  assertNoSecretMaterialFields,
  assertRuntimeNeutralTree,
  expectEnumMember,
  expectFields,
  isHostname,
  isMountPath,
  toHostname,
  toMountPath,
} from './shared.js';

/** Workload trust classification (drives isolation strictness downstream). */
export const WORKLOAD_TRUST_LEVELS = Object.freeze(['trusted', 'untrusted'] as const);
export type WorkloadTrust = (typeof WORKLOAD_TRUST_LEVELS)[number];

/** What a workload requires from the environment (all reference/quotas, never material). */
export interface WorkloadRequirements {
  readonly networkHosts: readonly Hostname[];
  readonly writePaths: readonly MountPath[];
  readonly secretIds: readonly string[];
  readonly minCpuMillis: number;
  readonly minMemoryMiB: number;
  readonly minWallClockSeconds: number;
}

export interface WorkloadDeclaration {
  readonly trust: WorkloadTrust;
  readonly requirements: WorkloadRequirements;
}

export function isWorkloadRequirements(value: unknown): value is WorkloadRequirements {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['networkHosts']) &&
    candidate['networkHosts'].every((entry) => isHostname(entry)) &&
    Array.isArray(candidate['writePaths']) &&
    candidate['writePaths'].every((entry) => isMountPath(entry)) &&
    Array.isArray(candidate['secretIds']) &&
    candidate['secretIds'].every((entry) => typeof entry === 'string') &&
    typeof candidate['minCpuMillis'] === 'number' &&
    Number.isInteger(candidate['minCpuMillis']) &&
    candidate['minCpuMillis'] > 0 &&
    typeof candidate['minMemoryMiB'] === 'number' &&
    Number.isInteger(candidate['minMemoryMiB']) &&
    candidate['minMemoryMiB'] > 0 &&
    typeof candidate['minWallClockSeconds'] === 'number' &&
    Number.isInteger(candidate['minWallClockSeconds']) &&
    candidate['minWallClockSeconds'] > 0
  );
}

export function isWorkloadDeclaration(value: unknown): value is WorkloadDeclaration {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate['trust'] !== 'string' ||
    !(WORKLOAD_TRUST_LEVELS as readonly string[]).includes(candidate['trust'])
  ) {
    return false;
  }
  return isWorkloadRequirements(candidate['requirements']);
}

function toWorkloadRequirements(value: unknown): WorkloadRequirements {
  const record = expectFields(
    value,
    [
      'networkHosts',
      'writePaths',
      'secretIds',
      'minCpuMillis',
      'minMemoryMiB',
      'minWallClockSeconds',
    ],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD,
    'workload requirements',
  );
  const rawHosts = record['networkHosts'];
  if (!Array.isArray(rawHosts)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD, {
      message: 'workload requirements: networkHosts must be an array of hostnames',
    });
  }
  const networkHosts = Object.freeze(
    rawHosts.map((entry) => toHostname(typeof entry === 'string' ? entry : '')),
  );
  const rawPaths = record['writePaths'];
  if (!Array.isArray(rawPaths)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD, {
      message: 'workload requirements: writePaths must be an array of absolute paths',
    });
  }
  const writePaths = Object.freeze(
    rawPaths.map((entry) => toMountPath(typeof entry === 'string' ? entry : '')),
  );
  const rawSecrets = record['secretIds'];
  if (!Array.isArray(rawSecrets) || !rawSecrets.every((entry) => typeof entry === 'string')) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD, {
      message: 'workload requirements: secretIds must be an array of secret references (ids)',
    });
  }
  const secretIds = Object.freeze([...(rawSecrets as string[])]);
  const readPositive = (field: string): number => {
    const raw = record[field];
    if (
      typeof raw !== 'number' ||
      !Number.isInteger(raw) ||
      raw <= 0
    ) {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD, {
        message: `workload requirements: ${field} must be a positive integer, got: ${String(raw)}`,
      });
    }
    return raw;
  };
  return Object.freeze({
    networkHosts,
    writePaths,
    secretIds,
    minCpuMillis: readPositive('minCpuMillis'),
    minMemoryMiB: readPositive('minMemoryMiB'),
    minWallClockSeconds: readPositive('minWallClockSeconds'),
  });
}

/** Validate and freeze a workload declaration (references and quotas only). */
export function toWorkloadDeclaration(value: {
  trust: string;
  requirements: {
    networkHosts: readonly string[];
    writePaths: readonly string[];
    secretIds: readonly string[];
    minCpuMillis: number;
    minMemoryMiB: number;
    minWallClockSeconds: number;
  };
}): WorkloadDeclaration {
  assertNoSecretMaterialFields(value, 'workloadDeclaration');
  const record = expectFields(
    value,
    ['trust', 'requirements'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD,
    'workload declaration',
  );
  const trust = expectEnumMember(
    record['trust'],
    WORKLOAD_TRUST_LEVELS,
    'trust',
    ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD,
    'workload declaration',
  );
  const rawRequirements = record['requirements'];
  if (typeof rawRequirements !== 'object' || rawRequirements === null) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD, {
      message: 'workload declaration: requirements must be a workload requirements object',
    });
  }
  const requirements = toWorkloadRequirements(rawRequirements);
  const declaration: WorkloadDeclaration = Object.freeze({ trust, requirements });
  assertRuntimeNeutralTree(declaration, 'workloadDeclaration');
  return declaration;
}

/**
 * Least-privilege admission check (Work Order A009 gate 6 tail): a
 * workload — mandated for UNTRUSTED workloads, applied uniformly — must
 * require nothing beyond the environment's declared allows:
 *   - every required network host must be an explicitly allowed egress
 *     target (default-deny; no wildcard escape);
 *   - every required write path must be covered by a declared read-write
 *     mount (no blanket write);
 *   - every referenced secret must be a declared injection point
 *     (secret isolation);
 *   - required CPU/memory/time must fit inside the declared resource and
 *     time bounds (bounded execution).
 *
 * Throws ENVIRONMENT_LEAST_PRIVILEGE_VIOLATION (with the offending
 * requirements) on the first violation; returns the declaration unchanged
 * when admissible.
 */
export function assertLeastPrivilege(
  definition: EnvironmentDefinition,
  workload: WorkloadDeclaration,
): WorkloadDeclaration {
  if (!isEnvironmentDefinition(definition)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION, {
      message: 'least-privilege check: not a structurally valid environment definition',
    });
  }
  if (!isWorkloadDeclaration(workload)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD, {
      message: 'least-privilege check: not a structurally valid workload declaration',
    });
  }
  const requirements = workload.requirements;
  const violations: string[] = [];

  for (const host of requirements.networkHosts) {
    const allowed = definition.networkPolicy.allows.some((allow) => allow.host === host);
    if (!allowed) {
      violations.push(`network egress to '${host}' is not an explicit allow`);
    }
  }
  for (const path of requirements.writePaths) {
    if (!isPathWritable(definition.filesystemPolicy, path)) {
      violations.push(`write path '${path}' is not a declared read-write mount`);
    }
  }
  for (const secretId of requirements.secretIds) {
    if (!declaresSecret(definition.secretPolicy, secretId)) {
      violations.push(`secret '${secretId}' is not a declared injection point`);
    }
  }
  if (requirements.minCpuMillis > definition.resourceLimits.cpuMillis) {
    violations.push(
      `cpu requirement ${requirements.minCpuMillis} exceeds the declared bound ${definition.resourceLimits.cpuMillis}`,
    );
  }
  if (requirements.minMemoryMiB > definition.resourceLimits.memoryMiB) {
    violations.push(
      `memory requirement ${requirements.minMemoryMiB} exceeds the declared bound ${definition.resourceLimits.memoryMiB}`,
    );
  }
  if (requirements.minWallClockSeconds > definition.resourceLimits.wallClockSeconds) {
    violations.push(
      `wall-clock requirement ${requirements.minWallClockSeconds} exceeds the declared bound ${definition.resourceLimits.wallClockSeconds}`,
    );
  }

  if (violations.length > 0) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.LEAST_PRIVILEGE_VIOLATION, {
      message: `workload declaration requires more than the environment allows (${violations.length} violation(s)): ${violations.join('; ')}`,
      details: {
        trust: workload.trust,
        violations,
        note:
          'untrusted workloads execute only inside approved isolation boundaries (docs/architecture.md §16)',
      },
    });
  }
  return workload;
}
