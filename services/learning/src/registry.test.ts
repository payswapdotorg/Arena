/**
 * ExperimentRegistry tests — registration, digest resolution,
 * idempotent re-registration, identity conflicts.
 */

import { describe, expect, it } from 'vitest';
import { ExperimentRegistry } from './registry.js';
import { LEARNING_ERROR_CODES } from '@arena/learning';
import { makeDescriptor } from './test-support.js';

describe('ExperimentRegistry', () => {
  it('registers and resolves descriptors by digest', async () => {
    const registry = new ExperimentRegistry();
    const descriptor = await makeDescriptor();
    const registered = await registry.registerExperiment(descriptor);
    expect(registered.digest).toBe(descriptor.digest);
    expect(registry.getExperiment(descriptor.digest as string)).toBe(descriptor);
    expect(registry.listExperiments()).toHaveLength(1);
  });

  it('re-registration of the SAME digest is an idempotent no-op', async () => {
    const registry = new ExperimentRegistry();
    const descriptor = await makeDescriptor();
    await registry.registerExperiment(descriptor);
    const again = await registry.registerExperiment(descriptor);
    expect(again.digest).toBe(descriptor.digest);
    expect(registry.listExperiments()).toHaveLength(1);
  });

  it('registers multiple versions of one experiment id', async () => {
    const registry = new ExperimentRegistry();
    const v1 = await makeDescriptor();
    const v2 = await makeDescriptor({ version: '1.1.0' });
    await registry.registerExperiment(v1);
    await registry.registerExperiment(v2);
    expect(registry.listExperiments()).toHaveLength(2);
    expect(registry.listExperimentsById('experiment-reconciliation-0001')).toHaveLength(2);
    expect(registry.listExperimentsById('experiment-unknown')).toEqual([]);
  });

  it('REJECTS a different digest under the same identity (changing an experiment requires a new version)', async () => {
    const registry = new ExperimentRegistry();
    const v1 = await makeDescriptor();
    await registry.registerExperiment(v1);
    // Same (experimentId, version), different content: change the intervention surface.
    const conflicting = await makeDescriptor({ changedSurface: 'procedures' });
    await expect(registry.registerExperiment(conflicting)).rejects.toMatchObject({
      code: LEARNING_ERROR_CODES.IDENTITY_CONFLICT,
    });
  });

  it('REJECTS structurally invalid descriptors', async () => {
    const registry = new ExperimentRegistry();
    await expect(registry.registerExperiment({} as never)).rejects.toMatchObject({
      code: LEARNING_ERROR_CODES.INVALID_DESCRIPTOR,
    });
  });

  it('REJECTS tampered descriptors (digest recomputation)', async () => {
    const registry = new ExperimentRegistry();
    const descriptor = await makeDescriptor();
    const tampered = { ...descriptor, version: '9.9.9' } as typeof descriptor;
    await expect(registry.registerExperiment(tampered)).rejects.toMatchObject({
      code: LEARNING_ERROR_CODES.TAMPERED,
    });
  });
});
