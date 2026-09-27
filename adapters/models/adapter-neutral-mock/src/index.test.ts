/**
 * neutral-mock adapter tests: protocol contract round-trips (gate 7) —
 * descriptor determinism, registration within/outside the envelope,
 * provider/credential rejection, probe + health validation, and the full
 * Envelope wire round-trip (idempotency keys REQUIRED on commands).
 */

import { describe, expect, it } from 'vitest';
import {
  newCorrelationId,
  newIdempotencyKey,
  serializeEnvelope,
} from '@arena/protocol-core';
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
  NEUTRAL_MOCK_ADAPTER_ID,
  NEUTRAL_MOCK_ADAPTER_VERSION,
  NEUTRAL_MOCK_ENVELOPE,
  createNeutralMockAdapter,
} from './index.js';

const REGISTRATION = {
  modelFamily: 'reasoner',
  modelId: 'reasoner-general-2',
  modelRevision: 'r7',
  modalityProfile: ['text-input', 'text-output', 'structured-input'],
  toolCallingProfile: 'function-calling',
  contextLimits: { maxContextUnits: 200000, maxOutputUnits: 32000 },
  conditions: ['stable'],
};

const FIXED_CLOCK = () => '2026-01-15T09:30:00.000Z';

describe('neutral-mock adapter — descriptor (adapter version identity)', () => {
  it('is content-addressed and deterministic across instances', async () => {
    const a = await createNeutralMockAdapter({ clock: FIXED_CLOCK });
    const b = await createNeutralMockAdapter({ clock: FIXED_CLOCK });
    expect(a.descriptor.digest).toBe(b.descriptor.digest);
    expect(a.descriptor.adapterId).toBe(NEUTRAL_MOCK_ADAPTER_ID);
    expect(a.descriptor.adapterVersion).toBe(NEUTRAL_MOCK_ADAPTER_VERSION);
    expect(a.descriptor.protocolVersion).toBe('1.0.0');
    expect(a.descriptor.supportedToolCalling).toBe(NEUTRAL_MOCK_ENVELOPE.supportedToolCalling);
  });

  it('different adapter versions yield different descriptor digests', async () => {
    const a = await createNeutralMockAdapter({ clock: FIXED_CLOCK });
    const b = await createNeutralMockAdapter({
      clock: FIXED_CLOCK,
      adapterVersion: '1.1.0',
    });
    expect(a.descriptor.digest).not.toBe(b.descriptor.digest);
  });
});

describe('neutral-mock adapter — registerSubstrate', () => {
  it('materializes a verified CognitiveSubstrate-shaped record carrying the ADAPTER identity', async () => {
    const adapter = await createNeutralMockAdapter({ clock: FIXED_CLOCK });
    const substrate = await adapter.registerSubstrate(REGISTRATION);
    expect(substrate.adapterId).toBe(NEUTRAL_MOCK_ADAPTER_ID);
    expect(substrate.adapterVersion).toBe(NEUTRAL_MOCK_ADAPTER_VERSION);
    expect(substrate.modelFamily).toBe('reasoner');
    expect(substrate.modelId).toBe('reasoner-general-2');
    expect(substrate.modelRevision).toBe('r7');
    expect(substrate.modalityProfile).toEqual([
      'text-input',
      'text-output',
      'structured-input',
    ]);
    expect(substrate.toolCallingProfile).toBe('function-calling');
    expect(substrate.contextLimits).toEqual({ maxContextUnits: 200000, maxOutputUnits: 32000 });
    expect(substrate.integrity.digestAlgorithm).toBe('sha256');
    // Deterministic: same registration input ⇒ same content digest.
    const again = await adapter.registerSubstrate(REGISTRATION);
    expect(again.integrity.contentDigest).toBe(substrate.integrity.contentDigest);
    // Deep-frozen, structurally valid.
    expect(Object.isFrozen(substrate)).toBe(true);
  });

  it('rejects registrations outside the declared envelope (isolation boundary)', async () => {
    const adapter = await createNeutralMockAdapter({ clock: FIXED_CLOCK });
    await expect(
      adapter.registerSubstrate({
        ...REGISTRATION,
        modalityProfile: ['audio-input'], // not in the envelope
      }),
    ).rejects.toThrow(/does not support modality/);
    await expect(
      adapter.registerSubstrate({
        ...REGISTRATION,
        contextLimits: { maxContextUnits: 999999, maxOutputUnits: 1 },
      }),
    ).rejects.toThrow(/context limits of at most/);
  });

  it('rejects provider brand names and credential-shaped inputs (lock rule 10)', async () => {
    const adapter = await createNeutralMockAdapter({ clock: FIXED_CLOCK });
    await expect(
      adapter.registerSubstrate({ ...REGISTRATION, modelId: 'gpt-4o-mini' }),
    ).rejects.toThrow(/provider brand name/);
    await expect(
      adapter.registerSubstrate({ ...REGISTRATION, modelFamily: 'claude-family' }),
    ).rejects.toThrow(/provider brand name/);
    await expect(
      adapter.registerSubstrate({ ...REGISTRATION, apiKey: 'sk-1' } as never),
    ).rejects.toThrow(/credential-shaped field/);
    await expect(
      adapter.registerSubstrate({ ...REGISTRATION, modalityProfile: ['telepathy'] }),
    ).rejects.toThrow(/unknown substrate modality/);
    await expect(
      adapter.registerSubstrate({ ...REGISTRATION, extra: 'field' } as never),
    ).rejects.toThrow(/unknown registration descriptor field/);
  });
});

describe('neutral-mock adapter — probeCapabilities / reportHealth', () => {
  it('probes report the declared envelope deterministically', async () => {
    const adapter = await createNeutralMockAdapter({ clock: FIXED_CLOCK });
    const probe = await adapter.probeCapabilities();
    expect(probe.modalityProfile).toEqual([...NEUTRAL_MOCK_ENVELOPE.supportedModalities]);
    expect(probe.toolCallingProfile).toBe('function-calling');
    expect(probe.contextLimits).toEqual(NEUTRAL_MOCK_ENVELOPE.contextCeiling);
    const again = await adapter.probeCapabilities();
    expect(again).toEqual(probe);
  });

  it('health reports are deterministic with an injected clock and self-verify the descriptor digest', async () => {
    const adapter = await createNeutralMockAdapter({ clock: FIXED_CLOCK });
    const health = await adapter.reportHealth();
    expect(health.status).toBe('healthy');
    expect(health.checkedAt).toBe('2026-01-15T09:30:00.000Z');
    expect(health.descriptorDigest).toBe(adapter.descriptor.digest);
    expect(health.integrityVerified).toBe(true);
    const again = await adapter.reportHealth();
    expect(again).toEqual(health);
  });
});

describe('neutral-mock adapter — protocol contract round-trip (gate 7)', () => {
  it('registration → registry → command envelope → wire → parse → verify (idempotency REQUIRED)', async () => {
    const adapter = await createNeutralMockAdapter({ clock: FIXED_CLOCK });
    const substrate = await adapter.registerSubstrate(REGISTRATION);

    // Registry append (protocol-level, idempotent).
    const registry = createSubstrateRegistry();
    const registration: SubstrateRegistration = await registry.register({
      substrateId: 'sub-reasoner-1',
      substrate,
      adapterDescriptor: adapter.descriptor,
      registeredAt: '2026-01-15T09:30:00.000Z',
    });
    expect(isSubstrateRegistration(registration)).toBe(true);
    const replay = await registry.register({
      substrateId: 'sub-reasoner-1',
      substrate,
      adapterDescriptor: adapter.descriptor,
      registeredAt: '2027-01-01T00:00:00.000Z',
    });
    expect(replay).toBe(registration); // idempotent

    // Command envelope with a REQUIRED idempotency key.
    const command = makeRegisterSubstrateCommand(
      { registration },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    expect(command.kind).toBe('command');
    expect(command.idempotencyKey).not.toBeNull();
    const raw = serializeEnvelope(command);
    const parsed = parseModelSubstrateEnvelope<{ registration: SubstrateRegistration }>(
      raw,
      'model-substrate/register-substrate-command',
    );
    expect(parsed.payload.registration.substrateId).toBe('sub-reasoner-1');
    expect(parsed.payload.registration.substrate.integrity.contentDigest).toBe(
      substrate.integrity.contentDigest,
    );
    const digest = await modelSubstrateEnvelopeDigest(command);
    const verified = await verifyModelSubstrateEnvelope(raw, digest);
    expect(verified.id).toBe(command.id);

    // Commands without an idempotency key never exist (lock rule 17).
    expect(() =>
      makeRegisterSubstrateCommand({ registration }, { correlationId: newCorrelationId() }),
    ).toThrow(/require an idempotency key/);

    // Event envelope (null idempotency key) round-trips too.
    const event = makeSubstrateRegisteredEvent(
      { registration },
      { correlationId: newCorrelationId() },
    );
    expect(event.idempotencyKey).toBeNull();
    expect(serializeEnvelope(event)).toContain('"kind":"event"');
  });

  it('upgrade declarations never rebind a possession (R45) and round-trip over the wire', async () => {
    const { createSubstrateUpgrade, makeDeclareSubstrateUpgradeCommand } = await import(
      '@arena/model-substrate'
    );
    const adapter = await createNeutralMockAdapter({ clock: FIXED_CLOCK });
    const oldSubstrate = await adapter.registerSubstrate(REGISTRATION);
    const newSubstrate = await adapter.registerSubstrate({
      ...REGISTRATION,
      modelRevision: 'r8',
    });
    const upgrade = createSubstrateUpgrade({
      upgradeId: 'upgrade-reasoner-r7-r8',
      fromSubstrateDigest: oldSubstrate.integrity.contentDigest,
      toSubstrateDigest: newSubstrate.integrity.contentDigest,
      recertificationRequired: true,
      declaredAt: '2026-01-15T10:00:00.000Z',
    });
    expect(upgrade.recertificationRequired).toBe(true);
    const command = makeDeclareSubstrateUpgradeCommand(
      { upgrade },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    const raw = serializeEnvelope(command);
    const parsed = parseModelSubstrateEnvelope<{ upgrade: typeof upgrade }>(
      raw,
      'model-substrate/declare-substrate-upgrade-command',
    );
    expect(parsed.payload.upgrade.upgradeId).toBe('upgrade-reasoner-r7-r8');
    // A possession-shaped field is structurally absent from the upgrade.
    expect(Object.keys(parsed.payload.upgrade)).not.toContain('possession');
  });
});
