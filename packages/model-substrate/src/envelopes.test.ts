/**
 * Envelope wiring tests (gate 8): commands carry REQUIRED non-null
 * idempotency keys (lock rule 17), events carry correlation ids, payloads
 * are strictly validated, canonical-JSON serializable, digest-verifiable,
 * and the core parser rejects unknown envelope versions.
 */

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  newCorrelationId,
  newIdempotencyKey,
  serializeEnvelope,
  toIdempotencyKey,
} from '@arena/protocol-core';
import { ModelSubstrateError } from './errors.js';
import {
  MODEL_SUBSTRATE_SCHEMAS,
  makeCompatibilityResultRecordedEvent,
  makeDeclareSubstrateUpgradeCommand,
  makeRecordCompatibilityResultCommand,
  makeRegisterSubstrateCommand,
  makeSubstrateRegisteredEvent,
  makeSubstrateUpgradeDeclaredEvent,
  modelSubstrateEnvelopeDigest,
  modelSubstrateSchemaRef,
  parseModelSubstrateEnvelope,
  verifyModelSubstrateEnvelope,
} from './envelopes.js';
import { createSubstrateRegistry } from './registry.js';
import type { SubstrateRegistration } from './registry.js';
import { createAdapterDescriptor } from './adapter.js';
import { createSubstrateRecord } from './substrate.js';
import type { CreateSubstrateRecordInput } from './substrate.js';
import { createSubstrateUpgrade } from './upgrade.js';
import { createSubstrateCompatibilityResult } from './compatibility.js';
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

async function makeRegistration(): Promise<SubstrateRegistration> {
  const registry = createSubstrateRegistry();
  return registry.register({
    substrateId: 'sub-reasoner-1',
    substrate: await createSubstrateRecord(SUBSTRATE_INPUT),
    adapterDescriptor: await createAdapterDescriptor(DESCRIPTOR_INPUT),
    registeredAt: '2026-01-15T09:30:00.000Z',
  });
}

function context() {
  return { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() };
}

describe('command envelopes (positive)', () => {
  it('register-substrate command carries a required idempotency key and validates its payload', async () => {
    const registration = await makeRegistration();
    const envelope = makeRegisterSubstrateCommand({ registration }, context());
    expect(envelope.kind).toBe('command');
    expect(envelope.schema).toBe('arena:schema/model-substrate/register-substrate-command@1.0.0');
    expect(envelope.idempotencyKey).not.toBeNull();
    expect(envelope.payload.registration.substrateId).toBe('sub-reasoner-1');
  });

  it('declare-substrate-upgrade and record-compatibility-result commands round-trip', async () => {
    const upgrade = createSubstrateUpgrade({
      upgradeId: 'upgrade-1',
      fromSubstrateDigest: '1'.repeat(64),
      toSubstrateDigest: '2'.repeat(64),
      recertificationRequired: true,
      declaredAt: '2026-01-15T09:30:00.000Z',
    });
    const result = createSubstrateCompatibilityResult({
      testId: 't-1',
      bodyVersionDigest: '1'.repeat(64),
      substrateDigest: '2'.repeat(64),
      outcome: 'pass',
    });
    const upgradeCommand = makeDeclareSubstrateUpgradeCommand({ upgrade }, context());
    const resultCommand = makeRecordCompatibilityResultCommand({ result }, context());
    expect(upgradeCommand.schema).toBe(
      'arena:schema/model-substrate/declare-substrate-upgrade-command@1.0.0',
    );
    expect(resultCommand.schema).toBe(
      'arena:schema/model-substrate/record-compatibility-result-command@1.0.0',
    );
  });
});

describe('command envelopes (negative)', () => {
  it('commands without an idempotency key are rejected (lock rule 17)', async () => {
    const registration = await makeRegistration();
    expect(() =>
      makeRegisterSubstrateCommand(
        { registration },
        { correlationId: newCorrelationId() },
      ),
    ).toThrow(/require an idempotency key/);
  });

  it('payload shape violations are rejected before wrapping', async () => {
    const registration = await makeRegistration();
    expect(() =>
      makeRegisterSubstrateCommand(
        { registration: { ...registration, registrationDigest: 'nope' } as never },
        context(),
      ),
    ).toThrow(/structurally valid substrate registration/);
    expect(() =>
      makeDeclareSubstrateUpgradeCommand(
        { upgrade: { upgradeId: 'x' } as never },
        context(),
      ),
    ).toThrow(/structurally valid substrate upgrade/);
    expect(() =>
      makeRecordCompatibilityResultCommand({ result: { testId: 'x' } as never }, context()),
    ).toThrow(/structurally valid compatibility result/);
  });
});

describe('event envelopes (positive)', () => {
  it('events carry correlation ids and null idempotency keys', async () => {
    const registration = await makeRegistration();
    const event = makeSubstrateRegisteredEvent(
      { registration },
      { correlationId: newCorrelationId() },
    );
    expect(event.kind).toBe('event');
    expect(event.idempotencyKey).toBeNull();
    expect(event.schema).toBe('arena:schema/model-substrate/substrate-registered-event@1.0.0');
  });

  it('upgrade-declared and compatibility-recorded events validate payloads', () => {
    const upgrade = createSubstrateUpgrade({
      upgradeId: 'upgrade-1',
      fromSubstrateDigest: '1'.repeat(64),
      toSubstrateDigest: '2'.repeat(64),
      recertificationRequired: true,
    });
    const result = createSubstrateCompatibilityResult({
      testId: 't-1',
      bodyVersionDigest: '1'.repeat(64),
      substrateDigest: '2'.repeat(64),
      outcome: 'fail',
      reasons: ['lacks text-input'],
    });
    expect(makeSubstrateUpgradeDeclaredEvent({ upgrade }, { correlationId: newCorrelationId() }).schema).toBe(
      'arena:schema/model-substrate/substrate-upgrade-declared-event@1.0.0',
    );
    expect(
      makeCompatibilityResultRecordedEvent({ result }, { correlationId: newCorrelationId() }).schema,
    ).toBe('arena:schema/model-substrate/compatibility-result-recorded-event@1.0.0');
  });
});

describe('parse / digest / verify (core tripwires reused verbatim)', () => {
  it('wire round-trip: serialize → parse pinned to schema → verify digest', async () => {
    const registration = await makeRegistration();
    const command = makeRegisterSubstrateCommand({ registration }, context());
    const raw = serializeEnvelope(command);
    const parsed = parseModelSubstrateEnvelope<{ registration: SubstrateRegistration }>(
      raw,
      'model-substrate/register-substrate-command',
    );
    expect(parsed.id).toBe(command.id);
    expect(parsed.payload.registration.substrateId).toBe('sub-reasoner-1');
    const digest = await modelSubstrateEnvelopeDigest(command);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const verified = await verifyModelSubstrateEnvelope(raw, digest);
    expect(verified.id).toBe(command.id);
  });

  it('tampering breaks verification (PROTOCOL_ENVELOPE_TAMPERED)', async () => {
    const registration = await makeRegistration();
    const command = makeRegisterSubstrateCommand({ registration }, context());
    const digest = await modelSubstrateEnvelopeDigest(command);
    const tampered = JSON.parse(serializeEnvelope(command)) as Record<string, unknown>;
    tampered['issuedAt'] = '2020-01-01T00:00:00.000Z';
    await expect(verifyModelSubstrateEnvelope(JSON.stringify(tampered), digest)).rejects.toThrow(
      /digest mismatch/,
    );
  });

  it('schema pinning rejects the wrong payload schema', async () => {
    const registration = await makeRegistration();
    const event = makeSubstrateRegisteredEvent(
      { registration },
      { correlationId: newCorrelationId() },
    );
    const raw = serializeEnvelope(event);
    expect(() =>
      parseModelSubstrateEnvelope(raw, 'model-substrate/register-substrate-command'),
    ).toThrow(/does not match expected/);
  });

  it('the schema registry is closed and versioned', () => {
    expect(Object.keys(MODEL_SUBSTRATE_SCHEMAS)).toHaveLength(18);
    expect(modelSubstrateSchemaRef('model-substrate/substrate-record')).toEqual({
      namespace: 'model-substrate',
      name: 'substrate-record',
      version: '1.0.0',
    });
    // Unknown schema names are rejected with a closed known-set.
    expect(() =>
      modelSubstrateSchemaRef('model-substrate/does-not-exist' as never),
    ).toThrow(ModelSubstrateError);
  });

  it('canonical serialization is provider-neutral', async () => {
    const registration = await makeRegistration();
    const command = makeRegisterSubstrateCommand({ registration }, context());
    const serialized = canonicalJson(command);
    for (const banned of ['openai', 'anthropic', 'gpt-', 'claude', 'bearer', 'apiKey']) {
      expect(serialized).not.toContain(banned);
    }
    expect(command.correlationId).toBeDefined();
    expect(toIdempotencyKey('idem-1')).toBe('idem-1');
  });
});
