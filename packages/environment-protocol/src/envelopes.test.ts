/**
 * Envelope wiring tests (Work Order A009 gate 8 — mirrors
 * @arena/artifact-protocol's envelope suite): commands carry a REQUIRED
 * non-null idempotency key, events do not, payloads are strictly validated,
 * canonical serialization round-trips, digests verify, tampering fails
 * closed, and the core parser rejects unknown envelope versions.
 */

import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  newCorrelationId,
  toIdempotencyKey,
  type Envelope,
} from '@arena/protocol-core';
import {
  ENVIRONMENT_SCHEMAS,
  environmentEnvelopeDigest,
  environmentSchemaRef,
  isKnownEnvironmentSchema,
  makeAdmitWorkloadCommand,
  makeEnvironmentRegisteredEvent,
  makeRegisterEnvironmentCommand,
  makeWorkloadAdmittedEvent,
  parseEnvironmentEnvelope,
  verifyEnvironmentEnvelope,
} from './envelopes.js';
import {
  createEnvironmentDefinition,
  environmentVersionRef,
} from './definition.js';
import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import { toWorkloadDeclaration } from './workload.js';
import { makeDefinitionInput, makeWorkloadInput } from './test-support.js';

async function makeDefinition() {
  return createEnvironmentDefinition(makeDefinitionInput());
}

describe('schema registry', () => {
  it('resolves every schema name and pins the version', () => {
    for (const name of Object.keys(ENVIRONMENT_SCHEMAS) as (keyof typeof ENVIRONMENT_SCHEMAS)[]) {
      const ref = environmentSchemaRef(name);
      expect(ref.namespace).toBe('environment');
      expect(ref.version).toBe(ENVIRONMENT_SCHEMAS[name]);
      expect(isKnownEnvironmentSchema(ref)).toBe(true);
    }
  });

  it('the registry covers the full generated surface', () => {
    expect(Object.keys(ENVIRONMENT_SCHEMAS)).toHaveLength(26);
  });

  it('unknown refs are not known schemas', () => {
    expect(
      isKnownEnvironmentSchema({ namespace: 'environment', name: 'nope', version: '1.0.0' }),
    ).toBe(false);
    expect(
      isKnownEnvironmentSchema({ namespace: 'environment', name: 'environment-definition', version: '2.0.0' }),
    ).toBe(false);
  });
});

describe('command envelopes (idempotency required)', () => {
  it('register-environment command carries a validated definition and idempotency key', async () => {
    const definition = await makeDefinition();
    const envelope = makeRegisterEnvironmentCommand(
      { environment: definition },
      { correlationId: newCorrelationId(), idempotencyKey: toIdempotencyKey('register-env-1') },
    );
    expect(envelope.kind).toBe('command');
    expect(envelope.idempotencyKey).toBe('register-env-1');
    expect(envelope.schema).toBe('arena:schema/environment/register-environment-command@1.0.0');
  });

  it('commands without an idempotency key are rejected (lock rule 17)', async () => {
    const definition = await makeDefinition();
    expect(() =>
      makeRegisterEnvironmentCommand(
        { environment: definition },
        { correlationId: newCorrelationId() },
      ),
    ).toThrowError(EnvironmentError);
  });

  it('admit-workload command validates both payload parts', async () => {
    const definition = await makeDefinition();
    const ref = environmentVersionRef(definition);
    const workload = toWorkloadDeclaration(makeWorkloadInput());
    const envelope = makeAdmitWorkloadCommand(
      { environment: ref, workload },
      { correlationId: newCorrelationId(), idempotencyKey: toIdempotencyKey('admit-1') },
    );
    expect(envelope.kind).toBe('command');
    expect(envelope.payload.workload.trust).toBe('untrusted');
  });

  it('structurally invalid command payloads are rejected', async () => {
    const definition = await makeDefinition();
    expect(() =>
      makeRegisterEnvironmentCommand(
        { environment: { ...definition, digest: 'nope' } as unknown as Parameters<typeof makeRegisterEnvironmentCommand>[0]['environment'] },
        { correlationId: newCorrelationId(), idempotencyKey: toIdempotencyKey('x') },
      ),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION }),
    );
    expect(() =>
      makeAdmitWorkloadCommand(
        {
          environment: environmentVersionRef(definition),
          workload: {} as unknown as Parameters<typeof makeAdmitWorkloadCommand>[0]['workload'],
        },
        { correlationId: newCorrelationId(), idempotencyKey: toIdempotencyKey('x') },
      ),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD }),
    );
  });
});

describe('event envelopes (no idempotency required)', () => {
  it('environment-registered and workload-admitted events validate their payloads', async () => {
    const definition = await makeDefinition();
    const ref = environmentVersionRef(definition);
    const registered = makeEnvironmentRegisteredEvent(
      { environment: ref },
      { correlationId: newCorrelationId() },
    );
    expect(registered.kind).toBe('event');
    expect(registered.idempotencyKey).toBeNull();

    const workload = toWorkloadDeclaration(makeWorkloadInput());
    const admitted = makeWorkloadAdmittedEvent(
      { environment: ref, workload },
      { correlationId: newCorrelationId() },
    );
    expect(admitted.schema).toBe('arena:schema/environment/workload-admitted-event@1.0.0');
  });

  it('structurally invalid event payloads are rejected', async () => {
    expect(() =>
      makeEnvironmentRegisteredEvent(
        { environment: { namespace: 'x' } as unknown as Parameters<typeof makeEnvironmentRegisteredEvent>[0]['environment'] },
        { correlationId: newCorrelationId() },
      ),
    ).toThrowError(EnvironmentError);
  });
});

describe('serialization, parsing and verification', () => {
  it('round-trips through canonical JSON with schema pinning', async () => {
    const definition = await makeDefinition();
    const envelope = makeRegisterEnvironmentCommand(
      { environment: definition },
      { correlationId: newCorrelationId(), idempotencyKey: toIdempotencyKey('register-env-2') },
    );
    const raw = canonicalJson(envelope);
    const parsed = parseEnvironmentEnvelope<{ environment: { digest: string } }>(
      raw,
      'environment/register-environment-command',
    );
    expect(parsed.id).toBe(envelope.id);
    expect(parsed.payload.environment.digest).toBe(definition.digest);
  });

  it('schema pinning rejects mismatched payload schemas', async () => {
    const definition = await makeDefinition();
    const envelope = makeRegisterEnvironmentCommand(
      { environment: definition },
      { correlationId: newCorrelationId(), idempotencyKey: toIdempotencyKey('register-env-3') },
    );
    const raw = canonicalJson(envelope);
    expect(() =>
      parseEnvironmentEnvelope(raw, 'environment/admit-workload-command'),
    ).toThrowError(
      expect.objectContaining({ code: 'PROTOCOL_SCHEMA_MISMATCH' }) as Error,
    );
  });

  it('the canonical digest verifies and detects tampering (fail closed)', async () => {
    const definition = await makeDefinition();
    const envelope = makeEnvironmentRegisteredEvent(
      { environment: environmentVersionRef(definition) },
      { correlationId: newCorrelationId() },
    );
    const raw = canonicalJson(envelope);
    const digest = await environmentEnvelopeDigest(envelope);
    await expect(verifyEnvironmentEnvelope(raw, digest)).resolves.toEqual(envelope);

    const tampered = JSON.parse(raw) as { payload: { environment: { name: string } } };
    tampered.payload.environment.name = 'tampered-env';
    await expect(
      verifyEnvironmentEnvelope(JSON.stringify(tampered), digest),
    ).rejects.toThrowError(
      expect.objectContaining({ code: 'PROTOCOL_ENVELOPE_TAMPERED' }) as Error,
    );
  });

  it('unknown envelope wire versions are rejected by the core parser', async () => {
    const definition = await makeDefinition();
    const envelope = makeEnvironmentRegisteredEvent(
      { environment: environmentVersionRef(definition) },
      { correlationId: newCorrelationId() },
    );
    const raw = JSON.parse(canonicalJson(envelope)) as Record<string, unknown>;
    raw['v'] = 99;
    expect(() => parseEnvironmentEnvelope(JSON.stringify(raw))).toThrowError(
      expect.objectContaining({ code: 'PROTOCOL_UNSUPPORTED_VERSION' }) as Error,
    );
  });

  it('commands missing an idempotency key fail the core parser on the wire', async () => {
    const definition = await makeDefinition();
    const envelope = makeRegisterEnvironmentCommand(
      { environment: definition },
      { correlationId: newCorrelationId(), idempotencyKey: toIdempotencyKey('k') },
    );
    const raw = JSON.parse(canonicalJson(envelope)) as Record<string, unknown>;
    raw['idempotencyKey'] = null;
    expect(() => parseEnvironmentEnvelope(JSON.stringify(raw))).toThrowError(
      expect.objectContaining({ code: 'PROTOCOL_INVALID_ENVELOPE' }) as Error,
    );
  });
});

describe('envelope typing', () => {
  it('the envelope generic carries the payload type', async () => {
    const definition = await makeDefinition();
    const envelope: Envelope<{ environment: typeof definition }> = makeRegisterEnvironmentCommand(
      { environment: definition },
      { correlationId: newCorrelationId(), idempotencyKey: toIdempotencyKey('typed') },
    );
    expect(envelope.payload.environment.identity.name).toBe('engineering-sandbox');
  });
});
