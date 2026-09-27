/**
 * SubstrateRegistry tests: append-only registration, idempotent
 * re-registration of the same digest, conflict rejection (different
 * descriptor under the same neutral id; digest aliasing), adapter-mismatch
 * and tamper rejection, lookups by digest and neutral id, deep-freeze
 * append-only guard.
 */

import { describe, expect, it } from 'vitest';
import { ModelSubstrateError } from './errors.js';
import { createSubstrateRegistry, isSubstrateRegistration } from './registry.js';
import type { RegisterSubstrateInput } from './registry.js';
import { createAdapterDescriptor } from './adapter.js';
import { createSubstrateRecord } from './substrate.js';
import type { CreateSubstrateRecordInput } from './substrate.js';
import { MODEL_SUBSTRATE_PROTOCOL_VERSION } from './version.js';

const SUBSTRATE_INPUT: CreateSubstrateRecordInput = {
  adapterId: 'neutral-mock',
  adapterVersion: '1.0.0',
  modelFamily: 'reasoner',
  modelId: 'reasoner-general-2',
  modelRevision: 'r7',
  modalityProfile: ['text-input', 'text-output', 'structured-input'],
  toolCallingProfile: 'function-calling',
  contextLimits: { maxContextUnits: 200000, maxOutputUnits: 32000 },
  conditions: ['stable'],
};

const DESCRIPTOR_INPUT = {
  adapterId: 'neutral-mock',
  adapterVersion: '1.0.0',
  protocolVersion: MODEL_SUBSTRATE_PROTOCOL_VERSION,
  supportedModalities: ['text-input', 'text-output', 'structured-input'],
  supportedToolCalling: 'function-calling',
  contextCeiling: { maxContextUnits: 200000, maxOutputUnits: 32000 },
};

async function makeRegistrationInput(
  overrides: Partial<RegisterSubstrateInput> = {},
  substrateOverrides: Partial<CreateSubstrateRecordInput> = {},
): Promise<RegisterSubstrateInput> {
  const substrate = await createSubstrateRecord({ ...SUBSTRATE_INPUT, ...substrateOverrides });
  const adapterDescriptor = await createAdapterDescriptor(DESCRIPTOR_INPUT);
  return {
    substrateId: 'sub-reasoner-1',
    substrate,
    adapterDescriptor,
    registeredAt: '2026-01-15T09:30:00.000Z',
    ...overrides,
  };
}

describe('SubstrateRegistry (positive)', () => {
  it('appends a registration and serves it by digest and by neutral id', async () => {
    const registry = createSubstrateRegistry();
    const input = await makeRegistrationInput();
    const record = await registry.register(input);
    expect(record.substrateId).toBe('sub-reasoner-1');
    expect(record.substrate.modelId).toBe('reasoner-general-2');
    expect(record.adapterDescriptor.adapterId).toBe('neutral-mock');
    expect(record.registeredAt).toBe('2026-01-15T09:30:00.000Z');
    expect(record.registrationDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(isSubstrateRegistration(record)).toBe(true);

    expect(registry.list()).toHaveLength(1);
    expect(registry.getBySubstrateId('sub-reasoner-1')).toBe(record);
    expect(registry.getByDigest(input.substrate.integrity.contentDigest)).toBe(record);
    expect(registry.getBySubstrateId('missing-id')).toBeNull();
    expect(registry.getByDigest('0'.repeat(64))).toBeNull();
  });

  it('re-registering the SAME digest is idempotent (same record object, no growth)', async () => {
    const registry = createSubstrateRegistry();
    const input = await makeRegistrationInput();
    const first = await registry.register(input);
    // Same content, different registeredAt: idempotent — the ORIGINAL record stands.
    const replay = await registry.register({ ...input, registeredAt: '2027-08-08T08:08:08.000Z' });
    expect(replay).toBe(first);
    expect(replay.registeredAt).toBe('2026-01-15T09:30:00.000Z');
    expect(registry.list()).toHaveLength(1);
  });

  it('different content registers under a different neutral id (upgrades are new records)', async () => {
    const registry = createSubstrateRegistry();
    const r1 = await registry.register(await makeRegistrationInput());
    const input2 = await makeRegistrationInput(
      { substrateId: 'sub-reasoner-2' },
      { modelRevision: 'r8' },
    );
    const r2 = await registry.register(input2);
    expect(registry.list()).toHaveLength(2);
    expect(r1.substrate.integrity.contentDigest).not.toBe(r2.substrate.integrity.contentDigest);
    expect(r2.substrate.modelRevision).toBe('r8');
  });

  it('records and the list snapshot are deep-frozen (append-only guard)', async () => {
    const registry = createSubstrateRegistry();
    const record = await registry.register(await makeRegistrationInput());
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.substrate)).toBe(true);
    const snapshot = registry.list();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => {
      (snapshot as unknown as unknown[]).push(record);
    }).toThrow(TypeError);
    // The registry object itself exposes no mutation surface.
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.keys(registry).sort()).toEqual(['getByDigest', 'getBySubstrateId', 'list', 'register']);
  });
});

describe('SubstrateRegistry (negative — conflicts fail closed)', () => {
  it('a DIFFERENT descriptor under the same neutral id is a conflict (rejected)', async () => {
    const registry = createSubstrateRegistry();
    await registry.register(await makeRegistrationInput());
    // Same substrateId, different substrate content (new revision):
    const conflicting = await makeRegistrationInput(
      { substrateId: 'sub-reasoner-1' },
      { modelRevision: 'r8' },
    );
    await expect(registry.register(conflicting)).rejects.toThrow(
      /already registered with different content/,
    );
    expect(registry.list()).toHaveLength(1);
  });

  it('a different ADAPTER descriptor under the same neutral id is a conflict', async () => {
    const registry = createSubstrateRegistry();
    await registry.register(await makeRegistrationInput());
    const newerAdapter = await createAdapterDescriptor({
      ...DESCRIPTOR_INPUT,
      adapterVersion: '1.1.0',
    });
    const input = await makeRegistrationInput();
    await expect(
      registry.register({ ...input, adapterDescriptor: newerAdapter }),
    ).rejects.toThrow(ModelSubstrateError);
  });

  it('re-registering an existing digest under a DIFFERENT neutral id is rejected (no id aliasing)', async () => {
    const registry = createSubstrateRegistry();
    const first = await registry.register(await makeRegistrationInput());
    await expect(
      registry.register(
        await makeRegistrationInput({ substrateId: 'sub-reasoner-alias' }),
      ),
    ).rejects.toThrow(/digests and neutral ids are 1:1/);
    expect(registry.getBySubstrateId('sub-reasoner-alias')).toBeNull();
    expect(registry.list()).toHaveLength(1);
    expect(registry.getByDigest(first.substrate.integrity.contentDigest)).toBe(first);
  });

  it('a substrate must match the registering adapter (ADAPTER_MISMATCH)', async () => {
    const registry = createSubstrateRegistry();
    const otherAdapter = await createAdapterDescriptor({
      ...DESCRIPTOR_INPUT,
      adapterId: 'offline-stub',
    });
    const input = await makeRegistrationInput();
    await expect(
      registry.register({ ...input, adapterDescriptor: otherAdapter }),
    ).rejects.toThrow(/registered through exactly one adapter/);
  });

  it('tampered substrates and descriptors fail closed before any append', async () => {
    const registry = createSubstrateRegistry();
    const input = await makeRegistrationInput();
    const tamperedSubstrate = {
      ...input.substrate,
      modelRevision: 'r999',
    };
    await expect(
      registry.register({ ...input, substrate: tamperedSubstrate }),
    ).rejects.toThrow(/integrity mismatch/);
    const tamperedDescriptor = { ...input.adapterDescriptor, adapterVersion: '9.9.9' };
    await expect(
      registry.register({ ...input, adapterDescriptor: tamperedDescriptor }),
    ).rejects.toThrow(/integrity mismatch/);
    expect(registry.list()).toHaveLength(0);
  });

  it('rejects malformed ids, timestamps and shapes', async () => {
    const registry = createSubstrateRegistry();
    const input = await makeRegistrationInput();
    await expect(
      registry.register({ ...input, substrateId: 'BAD_ID' }),
    ).rejects.toThrow(/invalid substrate id/);
    await expect(
      registry.register({ ...input, substrateId: 'gpt-bridge' }),
    ).rejects.toThrow(/provider brand name/);
    await expect(
      registry.register({ ...input, registeredAt: '2026-01-15T09:30:00Z' }),
    ).rejects.toThrow(/timestamp/);
    await expect(
      registry.register({ ...input, substrate: { modelId: 'x' } as never }),
    ).rejects.toThrow(/structurally valid substrate record/);
  });
});
