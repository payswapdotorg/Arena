/**
 * Tenant-scoped run identity (Work Order A010 gates 2, 6; requirement
 * R29; docs/architecture.md §16 multi-tenancy).
 *
 * Run ids are NAMESPACED BY TENANT by construction: the wire form is
 * `<tenant>/<run-key>`, where the tenant half is a lowercase namespace
 * and the run-key half uses A009's neutral-id charset — the run key is
 * exactly what A009's RunAddress.runId addresses (the evidence address
 * is tenant-local; the tenant scope itself is bound by the RunRecord,
 * whose digest includes the tenant id). The tenant is therefore part of
 * the run address itself — and part of the RunRecord digest (a run
 * record for tenant-a can never be re-issued under tenant-b without
 * changing its content digest).
 *
 * Every operation that RESOLVES a run reference must first assert the
 * tenant scope (assertSameTenant / runIdTenant): a cross-tenant run
 * reference fails closed with TENANT_ISOLATION_VIOLATION (gate 6
 * negative test).
 */

import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import type { RunId, RunKey, TenantId } from './shared.js';
import { isRunId, isTenantId, toRunKey, toTenantId } from './shared.js';

/** Stable string prefix for the string form of a run id. */
export const RUN_ID_PREFIX = 'arena:run';

/** Compose a tenant-scoped run id from its parts. */
export function makeRunId(tenant: string, runKey: string): RunId {
  const tenantId = toTenantId(tenant);
  const key = toRunKey(runKey);
  return `${tenantId}/${key}` as RunId;
}

/** Decompose a run id into its tenant and run-key halves. */
export function parseRunId(runId: string): { tenant: TenantId; runKey: RunKey } {
  if (!isRunId(runId)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_ID, {
      message: `invalid run id: ${JSON.stringify(runId)} (expected the tenant-scoped form <tenant>/<run-key>)`,
    });
  }
  const [tenant, runKey] = runId.split('/');
  if (tenant === undefined || runKey === undefined) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_ID, {
      message: `invalid run id: ${JSON.stringify(runId)}`,
    });
  }
  return { tenant: toTenantId(tenant), runKey: toRunKey(runKey) };
}

/** The tenant half of a run id (namespacing by construction). */
export function runIdTenant(runId: RunId): TenantId {
  return parseRunId(runId).tenant;
}

/** The tenant-local run-key half of a run id. */
export function runIdKey(runId: RunId): RunKey {
  return parseRunId(runId).runKey;
}

/** Stable addressable string form: `arena:run/<tenant>/<run-key>`. */
export function formatRunId(runId: RunId): string {
  return `${RUN_ID_PREFIX}/${runId}`;
}

/**
 * Tenant-isolation guard (gate 6; R29): a run reference may only be
 * resolved by its owning tenant. A cross-tenant reference fails closed
 * with TENANT_ISOLATION_VIOLATION carrying both the owning tenant and
 * the requesting tenant.
 */
export function assertSameTenant(runId: RunId, tenant: string): void {
  const owner = runIdTenant(runId);
  if (owner !== tenant) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.TENANT_ISOLATION_VIOLATION, {
        message: `cross-tenant run reference rejected: run ${JSON.stringify(runId)} belongs to tenant ${JSON.stringify(owner)}, not ${JSON.stringify(tenant)} (tenant boundaries cover environments and their runs — architecture §16)`,
        details: { runId, owningTenant: owner, requestingTenant: tenant },
      },
    );
  }
}

/** True iff the run id belongs to the given tenant (non-throwing twin). */
export function isRunOfTenant(runId: unknown, tenant: unknown): boolean {
  return isRunId(runId) && isTenantId(tenant) && runIdTenant(runId) === tenant;
}
