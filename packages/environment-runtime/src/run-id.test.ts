/**
 * Tenant-scoped run identity tests (Work Order A010 gate 6; R29).
 * Positive: composition/parsing round-trips, tenant extraction.
 * Negative: malformed ids, cross-tenant references fail closed.
 */

import { describe, expect, it } from 'vitest';
import {
  assertSameTenant,
  formatRunId,
  isRunOfTenant,
  makeRunId,
  parseRunId,
  runIdKey,
  runIdTenant,
} from './run-id.js';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';

describe('run id (gate 6 — tenant-scoped identity)', () => {
  it('composes and parses a tenant-scoped run id (positive)', () => {
    const runId = makeRunId('tenant-a', 'run-000042');
    expect(runId).toBe('tenant-a/run-000042');
    expect(parseRunId(runId)).toEqual({ tenant: 'tenant-a', runKey: 'run-000042' });
    expect(runIdTenant(runId)).toBe('tenant-a');
    expect(runIdKey(runId)).toBe('run-000042');
    expect(formatRunId(runId)).toBe('arena:run/tenant-a/run-000042');
  });

  it('rejects malformed ids (negative)', () => {
    expect(() => makeRunId('Tenant_A', 'run-1')).toThrow(EnvironmentRuntimeError);
    expect(() => makeRunId('tenant-a', 'Run 1')).toThrow(EnvironmentRuntimeError);
    expect(() => makeRunId('', 'run-1')).toThrow(EnvironmentRuntimeError);
    expect(() => makeRunId('tenant-a', '')).toThrow(EnvironmentRuntimeError);
    for (const bad of ['', 'run', '/run-1', 'tenant-a/', 'a b/run-1', 'tenant-a/run 1']) {
      expect(() => parseRunId(bad)).toThrow(EnvironmentRuntimeError);
    }
  });

  it('rejects cross-tenant run references with TENANT_ISOLATION_VIOLATION (negative, gate 6)', () => {
    const runId = makeRunId('tenant-a', 'run-000042');
    const error = capture(() => assertSameTenant(runId, 'tenant-b'));
    expect(error?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.TENANT_ISOLATION_VIOLATION);
    expect(error?.details).toMatchObject({
      runId: 'tenant-a/run-000042',
      owningTenant: 'tenant-a',
      requestingTenant: 'tenant-b',
    });
    expect(() => assertSameTenant(runId, 'tenant-a')).not.toThrow();
    expect(isRunOfTenant(runId, 'tenant-a')).toBe(true);
    expect(isRunOfTenant(runId, 'tenant-b')).toBe(false);
    expect(isRunOfTenant('not-a-run-id', 'tenant-a')).toBe(false);
  });
});

function capture(fn: () => void): EnvironmentRuntimeError | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvironmentRuntimeError) return error;
  }
  return undefined;
}
