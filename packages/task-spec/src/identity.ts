/**
 * Task identity + pure taskIdentity (id + semver) resolution (Work Order
 * A008; spec/task-spec.md TS1.0 "task identity/version"; the guards
 * requirement: "a pure taskIdentity (id + semver) resolution").
 *
 * A task's LOGICAL identity is (tenant scope, task id); a task VERSION is
 * one content-addressed object (identity + semver version + digest).
 * Resolution is PURE: given a set of TaskSpecs it resolves an exact
 * (identity, version) pair, or the latest version by semver precedence —
 * no store, no clock, no I/O. Two different digests under the same
 * (identity, version) pair are an IDENTITY CONFLICT (a version is a
 * content address, never a moving pointer — lock rule 22 family).
 */

import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';
import type { TaskSpec } from './spec.js';
import {
  compareTaskVersions,
  isTaskSpecId,
  isTenantScope,
  toTaskSpecId,
  toTenantScope,
  toTaskVersion,
} from './shared.js';

/** The logical identity of a task: owning tenant scope + task id. */
export interface TaskIdentity {
  readonly tenant: string;
  readonly taskId: string;
}

/** A content-addressed ref to one exact task version. */
export interface TaskVersionRef {
  readonly tenant: string;
  readonly taskId: string;
  readonly version: string;
  readonly digest: string;
}

export function isTaskIdentity(value: unknown): value is TaskIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isTenantScope(candidate['tenant']) && isTaskSpecId(candidate['taskId']);
}

/** Validate and freeze a task identity; typed error otherwise. */
export function toTaskIdentity(value: { tenant: string; taskId: string }): TaskIdentity {
  return Object.freeze({
    tenant: toTenantScope(value.tenant),
    taskId: toTaskSpecId(value.taskId),
  });
}

/** The stable logical key of a task identity: "<tenant>/<taskId>". */
export function taskLogicalKey(identity: TaskIdentity): string {
  return `${identity.tenant}/${identity.taskId}`;
}

/** The stable logical key of a task version ref: "<tenant>/<taskId>". */
export function taskVersionRefLogicalKey(ref: TaskVersionRef): string {
  return `${ref.tenant}/${ref.taskId}`;
}

/** The stable display form of a task version ref: "<tenant>/<taskId>@<version>". */
export function formatTaskVersionRef(ref: TaskVersionRef): string {
  return `${ref.tenant}/${ref.taskId}@${ref.version}`;
}

/** Validate and freeze a task version ref; typed error otherwise. */
export function toTaskVersionRef(value: {
  tenant: string;
  taskId: string;
  version: string;
  digest: string;
}): TaskVersionRef {
  return Object.freeze({
    tenant: toTenantScope(value.tenant),
    taskId: toTaskSpecId(value.taskId),
    version: toTaskVersion(value.version),
    digest: ((): string => {
      if (typeof value.digest !== 'string' || !/^[0-9a-f]{64}$/.test(value.digest)) {
        throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_REF, {
          message: `invalid task version ref digest: ${JSON.stringify(value.digest)}`,
        });
      }
      return value.digest;
    })(),
  });
}

/**
 * PURE taskIdentity resolution: resolve `identity` against `specs`.
 *
 *   - with `options.version`: the EXACT (identity, version) spec —
 *     TASK_NOT_FOUND when absent, IDENTITY_CONFLICT when the same pair
 *     carries two different digests;
 *   - without: the LATEST version by semver precedence (ties resolved by
 *     digest equality — two DIFFERENT digests at the highest version are
 *     an IDENTITY CONFLICT, never an arbitrary pick).
 *
 * Tenant scoping is exact (lock rule 11): identity matching never crosses
 * tenant scopes.
 */
export function resolveTaskIdentity(
  specs: readonly TaskSpec[],
  identity: { tenant: string; taskId: string },
  options?: { version?: string },
): TaskSpec {
  const wantedTenant = identity.tenant;
  const wantedTaskId = identity.taskId;
  const candidates = specs.filter(
    (spec) => spec.identity.tenant === wantedTenant && spec.identity.taskId === wantedTaskId,
  );
  if (candidates.length === 0) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.TASK_NOT_FOUND, {
      message: `no task found for identity ${taskLogicalKey({ tenant: wantedTenant, taskId: wantedTaskId })}`,
      details: { tenant: wantedTenant, taskId: wantedTaskId },
    });
  }

  if (options?.version !== undefined) {
    const exact = candidates.filter((spec) => spec.version === options.version);
    if (exact.length === 0) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.TASK_NOT_FOUND, {
        message: `no task ${taskLogicalKey({ tenant: wantedTenant, taskId: wantedTaskId })} at version ${JSON.stringify(options.version)}`,
        details: { tenant: wantedTenant, taskId: wantedTaskId, version: options.version },
      });
    }
    const first = exact[0] as TaskSpec;
    for (const spec of exact.slice(1)) {
      if (spec.digest !== first.digest) {
        throw new TaskSpecError(TASK_SPEC_ERROR_CODES.IDENTITY_CONFLICT, {
          message: `identity conflict: ${formatTaskVersionRef(taskVersionRefOf(first))} is addressed by two different digests (${first.digest} vs ${spec.digest})`,
          details: { tenant: wantedTenant, taskId: wantedTaskId, version: options.version },
        });
      }
    }
    return first;
  }

  let latest = candidates[0] as TaskSpec;
  for (const spec of candidates.slice(1)) {
    const precedence = compareTaskVersions(spec.version, latest.version);
    if (precedence > 0) {
      latest = spec;
    } else if (precedence === 0 && spec.digest !== latest.digest) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `identity conflict: ${formatTaskVersionRef(taskVersionRefOf(spec))} is addressed by two different digests (${latest.digest} vs ${spec.digest})`,
        details: { tenant: wantedTenant, taskId: wantedTaskId, version: spec.version },
      });
    }
  }
  return latest;
}

/** The content-addressed ref of one exact task version. */
export function taskVersionRefOf(spec: TaskSpec): TaskVersionRef {
  return Object.freeze({
    tenant: spec.identity.tenant,
    taskId: spec.identity.taskId,
    version: spec.version,
    digest: spec.digest,
  });
}
