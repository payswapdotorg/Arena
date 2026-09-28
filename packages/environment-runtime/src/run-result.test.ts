/**
 * RunResult tests (Work Order A010 gate 9):
 *   - positive: completed runs produce a content-addressed result
 *     binding the A009 RunAddress (all six parts);
 *   - negative: ANY missing digest fails construction (trajectory,
 *     snapshot, evidence, environment), non-completed states are
 *     rejected, address/record mismatches are rejected, tampering is
 *     detected.
 */

import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import {
  createRunResult,
  isRunAddress,
  isRunResult,
  runAddressKey,
  runResultView,
  toRunAddress,
  verifyRunResult,
} from './run-result.js';
import {
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  DIGEST_D,
  DIGEST_E,
  T5,
  TENANT_A,
  makeDeclarationInput,
} from './test-support.js';
import { createRunRecord } from './run-record.js';

function addressInput() {
  return {
    taskVersion: { taskId: 'task-build-website', version: '2.1.0' },
    environmentVersion: {
      namespace: 'tenant-a',
      name: 'engineering-sandbox',
      version: '1.2.0',
      digest: DIGEST_A,
    },
    runId: 'run-000042',
    initialSnapshotDigest: DIGEST_B,
    trajectoryDigest: DIGEST_C,
    evidenceDigests: [DIGEST_C, DIGEST_D],
  };
}

function resultInput() {
  return {
    runId: 'tenant-a/run-000042',
    tenantId: TENANT_A,
    recordDigest: DIGEST_E,
    finalState: 'completed' as const,
    finishedAt: T5,
    runAddress: addressInput(),
  };
}

describe('RunResult (gate 9)', () => {
  it('produces a content-addressed result for a completed run (positive)', async () => {
    const result = await createRunResult(resultInput());
    expect(isRunResult(result)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.finalState).toBe('completed');
    expect(result.runAddress.trajectoryDigest).toBe(DIGEST_C);
    expect(result.runAddress.evidenceDigests.length).toBe(2);
    await expect(verifyRunResult(result)).resolves.toBe(result.digest);
    const again = await createRunResult(resultInput());
    expect(again.digest).toBe(result.digest);
    expect(runResultView(result).runAddress).toEqual(result.runAddress);
    expect(typeof runAddressKey(result.runAddress)).toBe('string');
    expect(isRunAddress(result.runAddress)).toBe(true);
  });

  it('the run address is the record address (tenant-local key, positive)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    const result = await createRunResult({
      ...resultInput(),
      recordDigest: record.digest,
    });
    // The address run id is the tenant-LOCAL key of the scoped run id.
    expect(result.runAddress.runId).toBe('run-000042');
    expect(result.runId).toBe(record.runId);
  });

  it('missing digest ⇒ construction fails (negative, gate 9)', async () => {
    const missingTrajectory = { ...addressInput(), trajectoryDigest: 'not-a-digest' };
    expect(
      (await capture(() => createRunResult({ ...resultInput(), runAddress: missingTrajectory })))
        ?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.RUN_RESULT_INCOMPLETE);

    const missingSnapshot = { ...addressInput(), initialSnapshotDigest: '' };
    expect(
      (await capture(() => createRunResult({ ...resultInput(), runAddress: missingSnapshot })))
        ?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.RUN_RESULT_INCOMPLETE);

    const missingEvidence = { ...addressInput(), evidenceDigests: [] };
    expect(
      (await capture(() => createRunResult({ ...resultInput(), runAddress: missingEvidence })))
        ?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.RUN_RESULT_INCOMPLETE);

    const missingEnvironmentDigest = {
      ...addressInput(),
      environmentVersion: { namespace: 'tenant-a', name: 'engineering-sandbox', version: '1.2.0', digest: 'short' },
    };
    expect(
      (await capture(() =>
        createRunResult({ ...resultInput(), runAddress: missingEnvironmentDigest }),
      ))?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.RUN_RESULT_INCOMPLETE);

    const missingTaskVersion = { ...addressInput(), taskVersion: { taskId: 'X', version: '' } };
    expect(
      (await capture(() =>
        createRunResult({ ...resultInput(), runAddress: missingTaskVersion }),
      ))?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.RUN_RESULT_INCOMPLETE);
  });

  it('rejects non-completed final states (negative, gate 9)', async () => {
    const error = await capture(() =>
      createRunResult({ ...resultInput(), finalState: 'failed' as 'completed' }),
    );
    expect(error?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_RESULT);
  });

  it('rejects an address naming a different run (negative)', async () => {
    const error = await capture(() =>
      createRunResult({
        ...resultInput(),
        runAddress: { ...addressInput(), runId: 'run-000099' },
      }),
    );
    expect(error?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_RESULT);
  });

  it('rejects malformed envelopes (negative)', async () => {
    expect(
      (await capture(() => createRunResult({ ...resultInput(), runId: 'bad id' })))?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_ID);
    expect(
      (await capture(() => createRunResult({ ...resultInput(), tenantId: 'BAD' })))?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_TENANT);
    expect(
      (await capture(() =>
        createRunResult({ ...resultInput(), finishedAt: '2026-01-15T09:30:05Z' }),
      ))?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_TIMESTAMP);
    expect(
      (await capture(() =>
        createRunResult({ ...resultInput(), recordDigest: 'xyz' }),
      ))?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_SNAPSHOT_DIGEST);
    expect(isRunAddress(null)).toBe(false);
    expect(isRunAddress({ ...addressInput(), evidenceDigests: [] })).toBe(false);
    expect(() => toRunAddress(null as never)).toThrow(EnvironmentRuntimeError);
  });

  it('detects result tampering (negative)', async () => {
    const result = await createRunResult(resultInput());
    const tampered = { ...result, finishedAt: '2026-01-15T09:30:09.000Z' } as typeof result;
    await expect(verifyRunResult(tampered)).rejects.toThrow(EnvironmentRuntimeError);
    await expect(verifyRunResult(null as never)).rejects.toThrow(EnvironmentRuntimeError);
  });
});

async function capture(fn: () => Promise<unknown>): Promise<EnvironmentRuntimeError | undefined> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof EnvironmentRuntimeError) return error;
  }
  return undefined;
}

