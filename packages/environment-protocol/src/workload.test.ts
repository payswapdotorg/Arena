/**
 * Workload declaration and least-privilege admission tests (Work Order
 * A009 gate 6 tail): untrusted (and all) workloads requiring more than the
 * environment declares are rejected — per dimension (network, filesystem,
 * secrets, CPU, memory, time) — and an in-bounds workload passes.
 */

import { describe, expect, it } from 'vitest';
import { createEnvironmentDefinition } from './definition.js';
import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import {
  assertLeastPrivilege,
  isWorkloadDeclaration,
  toWorkloadDeclaration,
} from './workload.js';
import { makeDefinitionInput, makeWorkloadInput } from './test-support.js';

async function makeDefinition() {
  return createEnvironmentDefinition(makeDefinitionInput());
}

describe('workload declaration', () => {
  it('validates and freezes a reference-and-quota-only declaration', () => {
    const workload = toWorkloadDeclaration(makeWorkloadInput());
    expect(isWorkloadDeclaration(workload)).toBe(true);
    expect(workload.trust).toBe('untrusted');
    expect(Object.isFrozen(workload)).toBe(true);
    expect(Object.isFrozen(workload.requirements)).toBe(true);
    expect(Object.isFrozen(workload.requirements.networkHosts)).toBe(true);
  });

  it('rejects malformed requirements (strict shape, positive quotas)', () => {
    expect(() =>
      toWorkloadDeclaration({ trust: 'untrusted', requirements: { networkHosts: 'x' } as unknown as Parameters<typeof toWorkloadDeclaration>[0]['requirements'] }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD }),
    );
    expect(() =>
      toWorkloadDeclaration({
        trust: 'untrusted',
        requirements: {
          ...makeWorkloadInput().requirements,
          minCpuMillis: 0,
        },
      }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toWorkloadDeclaration({
        trust: 'untrusted',
        requirements: {
          ...makeWorkloadInput().requirements,
          writePaths: ['relative/path'],
        },
      }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toWorkloadDeclaration({ trust: 'suspicious', requirements: makeWorkloadInput().requirements }),
    ).toThrowError(EnvironmentError);
  });

  it('rejects credential-shaped fields in the declaration', () => {
    expect(() =>
      toWorkloadDeclaration({
        trust: 'untrusted',
        requirements: {
          ...makeWorkloadInput().requirements,
          password: 'hunter2',
        } as unknown as Parameters<typeof toWorkloadDeclaration>[0]['requirements'],
      }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.CREDENTIAL_REJECTED }),
    );
  });

  it('rejects runtime leakage in required hosts and paths', () => {
    expect(() =>
      toWorkloadDeclaration({
        trust: 'untrusted',
        requirements: {
          ...makeWorkloadInput().requirements,
          networkHosts: ['docker-registry.internal'],
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.RUNTIME_LEAKAGE }),
    );
  });
});

describe('least-privilege admission (gate 6 tail)', () => {
  it('an in-bounds untrusted workload is admitted', async () => {
    const definition = await makeDefinition();
    const workload = toWorkloadDeclaration(makeWorkloadInput());
    expect(assertLeastPrivilege(definition, workload)).toBe(workload);
  });

  it('network egress beyond the explicit allows is rejected', async () => {
    const definition = await makeDefinition();
    const workload = toWorkloadDeclaration({
      trust: 'untrusted',
      requirements: {
        ...makeWorkloadInput().requirements,
        networkHosts: ['packages.internal', 'outside.internal'],
      },
    });
    expect(() => assertLeastPrivilege(definition, workload)).toThrowError(
      expect.objectContaining({
        code: ENVIRONMENT_ERROR_CODES.LEAST_PRIVILEGE_VIOLATION,
        message: expect.stringContaining('outside.internal'),
      }),
    );
  });

  it('write paths outside declared read-write mounts are rejected (no blanket write)', async () => {
    const definition = await makeDefinition();
    const workload = toWorkloadDeclaration({
      trust: 'untrusted',
      requirements: {
        ...makeWorkloadInput().requirements,
        writePaths: ['/workspace', '/task-inputs'],
      },
    });
    expect(() => assertLeastPrivilege(definition, workload)).toThrowError(
      expect.objectContaining({
        code: ENVIRONMENT_ERROR_CODES.LEAST_PRIVILEGE_VIOLATION,
        message: expect.stringContaining('/task-inputs'),
      }),
    );
  });

  it('undeclared secret references are rejected (secret isolation)', async () => {
    const definition = await makeDefinition();
    const workload = toWorkloadDeclaration({
      trust: 'untrusted',
      requirements: {
        ...makeWorkloadInput().requirements,
        secretIds: ['signing-reference', 'undeclared-reference'],
      },
    });
    expect(() => assertLeastPrivilege(definition, workload)).toThrowError(
      expect.objectContaining({
        code: ENVIRONMENT_ERROR_CODES.LEAST_PRIVILEGE_VIOLATION,
        message: expect.stringContaining('undeclared-reference'),
      }),
    );
  });

  it.each([
    ['minCpuMillis', 4000],
    ['minMemoryMiB', 2048],
    ['minWallClockSeconds', 7200],
  ])('resource requirements beyond the declared bounds are rejected: %s', async (field, value) => {
    const definition = await makeDefinition();
    const workload = toWorkloadDeclaration({
      trust: 'untrusted',
      requirements: {
        ...makeWorkloadInput().requirements,
        [field]: value,
      },
    });
    expect(() => assertLeastPrivilege(definition, workload)).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.LEAST_PRIVILEGE_VIOLATION }),
    );
  });

  it('a trusted workload exceeding the declared allows is also rejected (bounded execution is uniform)', async () => {
    const definition = await makeDefinition();
    const workload = toWorkloadDeclaration({
      trust: 'trusted',
      requirements: {
        ...makeWorkloadInput().requirements,
        networkHosts: ['outside.internal'],
      },
    });
    expect(() => assertLeastPrivilege(definition, workload)).toThrowError(EnvironmentError);
  });

  it('structural invalidity is rejected before the check runs', async () => {
    const definition = await makeDefinition();
    expect(() => assertLeastPrivilege(definition, {} as unknown as Parameters<typeof assertLeastPrivilege>[1])).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD }),
    );
    expect(() =>
      assertLeastPrivilege(
        {} as unknown as Parameters<typeof assertLeastPrivilege>[0],
        toWorkloadDeclaration(makeWorkloadInput()),
      ),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION }),
    );
  });
});
