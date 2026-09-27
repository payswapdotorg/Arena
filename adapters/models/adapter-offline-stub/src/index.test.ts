/**
 * offline-stub adapter tests: protocol contract round-trips (gate 7) —
 * fixed catalog enforcement, envelope restriction, determinism, provider/
 * credential rejection, probe + health validation, wire round-trip.
 */

import { describe, expect, it } from 'vitest';
import { newCorrelationId, newIdempotencyKey, serializeEnvelope } from '@arena/protocol-core';
import {
  createSubstrateRegistry,
  isSubstrateRegistration,
  makeRegisterSubstrateCommand,
  makeSubstrateRegisteredEvent,
  modelSubstrateEnvelopeDigest,
  parseModelSubstrateEnvelope,
  verifyModelSubstrateEnvelope,
  type SubstrateRegistration,
} from '@arena/model-substrate';
import {
  OFFLINE_STUB_ADAPTER_ID,
  OFFLINE_STUB_ADAPTER_VERSION,
  OFFLINE_STUB_CATALOG,
  OFFLINE_STUB_ENVELOPE,
  createOfflineStubAdapter,
} from './index.js';

const CATALOG_ENTRY_INPUT = {
  modelFamily: 'offline-reasoner',
  modelId: 'offline-stub-1',
  modelRevision: 'r1',
  modalityProfile: ['text-input', 'text-output'],
  toolCallingProfile: 'text-protocol',
  contextLimits: { maxContextUnits: 8192, maxOutputUnits: 4096 },
  conditions: ['stable'],
};

const FIXED_CLOCK = () => '2026-01-15T09:30:00.000Z';

describe('offline-stub adapter — descriptor (adapter version identity)', () => {
  it('is content-addressed and deterministic across instances', async () => {
    const a = await createOfflineStubAdapter({ clock: FIXED_CLOCK });
    const b = await createOfflineStubAdapter({ clock: FIXED_CLOCK });
    expect(a.descriptor.digest).toBe(b.descriptor.digest);
    expect(a.descriptor.adapterId).toBe(OFFLINE_STUB_ADAPTER_ID);
    expect(a.descriptor.adapterVersion).toBe(OFFLINE_STUB_ADAPTER_VERSION);
    expect(a.descriptor.supportedToolCalling).toBe(OFFLINE_STUB_ENVELOPE.supportedToolCalling);
    expect(a.descriptor.contextCeiling).toEqual(OFFLINE_STUB_ENVELOPE.contextCeiling);
    // Version changes re-digest the descriptor (adapter version identity).
    const c = await createOfflineStubAdapter({
      clock: FIXED_CLOCK,
      adapterVersion: '1.1.0',
    });
    expect(c.descriptor.digest).not.toBe(a.descriptor.digest);
  });
});

describe('offline-stub adapter — registerSubstrate (fixed catalog)', () => {
  it('registers exact catalog entries with the ADAPTER identity and catalog truth', async () => {
    const adapter = await createOfflineStubAdapter({ clock: FIXED_CLOCK });
    const substrate = await adapter.registerSubstrate(CATALOG_ENTRY_INPUT);
    expect(substrate.adapterId).toBe(OFFLINE_STUB_ADAPTER_ID);
    expect(substrate.adapterVersion).toBe(OFFLINE_STUB_ADAPTER_VERSION);
    expect(substrate.modelFamily).toBe('offline-reasoner');
    expect(substrate.modelId).toBe('offline-stub-1');
    expect(substrate.modelRevision).toBe('r1');
    // The catalog entry's tool-calling profile wins over the request.
    expect(substrate.toolCallingProfile).toBe('text-protocol');
    expect(substrate.conditions).toEqual(['stable']);
    expect(substrate.integrity.digestAlgorithm).toBe('sha256');
    // Deterministic.
    const again = await adapter.registerSubstrate(CATALOG_ENTRY_INPUT);
    expect(again.integrity.contentDigest).toBe(substrate.integrity.contentDigest);
    expect(Object.isFrozen(substrate)).toBe(true);
  });

  it('rejects anything outside the offline catalog (isolation boundary)', async () => {
    const adapter = await createOfflineStubAdapter({ clock: FIXED_CLOCK });
    await expect(
      adapter.registerSubstrate({ ...CATALOG_ENTRY_INPUT, modelId: 'offline-stub-9' }),
    ).rejects.toThrow(/not in the offline catalog/);
    await expect(
      adapter.registerSubstrate({ ...CATALOG_ENTRY_INPUT, modelRevision: 'r99' }),
    ).rejects.toThrow(/not in the offline catalog/);
    await expect(
      adapter.registerSubstrate({
        ...CATALOG_ENTRY_INPUT,
        modelFamily: 'some-other-family',
      }),
    ).rejects.toThrow(/not in the offline catalog/);
  });

  it('rejects registrations outside the offline envelope', async () => {
    const adapter = await createOfflineStubAdapter({ clock: FIXED_CLOCK });
    await expect(
      adapter.registerSubstrate({
        ...CATALOG_ENTRY_INPUT,
        modalityProfile: ['audio-input'], // offline stub is text-only
      }),
    ).rejects.toThrow(/does not support modality/);
    await expect(
      adapter.registerSubstrate({
        ...CATALOG_ENTRY_INPUT,
        contextLimits: { maxContextUnits: 999999, maxOutputUnits: 1 },
      }),
    ).rejects.toThrow(/context limits of at most/);
  });

  it('rejects provider brand names and credential-shaped inputs (lock rule 10)', async () => {
    const adapter = await createOfflineStubAdapter({ clock: FIXED_CLOCK });
    await expect(
      adapter.registerSubstrate({ ...CATALOG_ENTRY_INPUT, modelId: 'gpt-4o-mini' }),
    ).rejects.toThrow(/provider brand name/);
    await expect(
      adapter.registerSubstrate({ ...CATALOG_ENTRY_INPUT, apiKey: 'sk-1' } as never),
    ).rejects.toThrow(/credential-shaped field/);
  });

  it('the catalog is closed and frozen', () => {
    expect(OFFLINE_STUB_CATALOG).toHaveLength(2);
    expect(Object.isFrozen(OFFLINE_STUB_CATALOG)).toBe(true);
    for (const entry of OFFLINE_STUB_CATALOG) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });
});

describe('offline-stub adapter — probeCapabilities / reportHealth', () => {
  it('probes report the offline baseline deterministically', async () => {
    const adapter = await createOfflineStubAdapter({ clock: FIXED_CLOCK });
    const probe = await adapter.probeCapabilities();
    expect(probe.modalityProfile).toEqual(['text-input', 'text-output']);
    expect(probe.toolCallingProfile).toBe('text-protocol');
    expect(probe.contextLimits).toEqual({ maxContextUnits: 8192, maxOutputUnits: 4096 });
    expect(probe.conditions).toEqual(['stable', 'capacity-constrained']);
    expect(await adapter.probeCapabilities()).toEqual(probe);
  });

  it('health reports are deterministic with an injected clock and self-verify', async () => {
    const adapter = await createOfflineStubAdapter({ clock: FIXED_CLOCK });
    const health = await adapter.reportHealth();
    expect(health.status).toBe('healthy');
    expect(health.checkedAt).toBe('2026-01-15T09:30:00.000Z');
    expect(health.descriptorDigest).toBe(adapter.descriptor.digest);
    expect(health.integrityVerified).toBe(true);
  });
});

describe('offline-stub adapter — protocol contract round-trip (gate 7)', () => {
  it('registration → registry → command envelope → wire → parse → verify (idempotency REQUIRED)', async () => {
    const adapter = await createOfflineStubAdapter({ clock: FIXED_CLOCK });
    const substrate = await adapter.registerSubstrate(CATALOG_ENTRY_INPUT);

    const registry = createSubstrateRegistry();
    const registration: SubstrateRegistration = await registry.register({
      substrateId: 'sub-offline-1',
      substrate,
      adapterDescriptor: adapter.descriptor,
      registeredAt: '2026-01-15T09:30:00.000Z',
    });
    expect(isSubstrateRegistration(registration)).toBe(true);
    expect(registry.getByDigest(substrate.integrity.contentDigest)).toBe(registration);

    const command = makeRegisterSubstrateCommand(
      { registration },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    expect(command.kind).toBe('command');
    expect(command.schema).toBe(
      'arena:schema/model-substrate/register-substrate-command@1.0.0',
    );
    const raw = serializeEnvelope(command);
    const parsed = parseModelSubstrateEnvelope<{ registration: SubstrateRegistration }>(
      raw,
      'model-substrate/register-substrate-command',
    );
    expect(parsed.payload.registration.substrate.modelId).toBe('offline-stub-1');
    const digest = await modelSubstrateEnvelopeDigest(command);
    expect((await verifyModelSubstrateEnvelope(raw, digest)).id).toBe(command.id);

    expect(() =>
      makeRegisterSubstrateCommand({ registration }, { correlationId: newCorrelationId() }),
    ).toThrow(/require an idempotency key/);

    const event = makeSubstrateRegisteredEvent(
      { registration },
      { correlationId: newCorrelationId() },
    );
    expect(event.idempotencyKey).toBeNull();
  });
});
