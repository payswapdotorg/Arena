/**
 * Envelope wiring tests: idempotency-keyed commands (lock rule 17),
 * correlation ids, canonical digest verification, schema pinning —
 * mirroring the A002 envelope suite.
 */

import { describe, expect, it } from 'vitest';
import {
  newCorrelationId,
  newIdempotencyKey,
  serializeEnvelope,
} from '@arena/protocol-core';
import { ProtocolError } from '@arena/protocol-core';
import { toTimestampView } from './shared.js';
import { AGENT_BODY_SCHEMAS } from './envelopes.js';
import {
  agentBodyEnvelopeDigest,
  agentInstanceTerminatedPayload,
  agentBodySchemaRef,
  isKnownAgentBodySchema,
  makeCreatePossessionCommand,
  makePossessionCreatedEvent,
  makeRegisterSubstrateCommand,
  makeSubstrateRegisteredEvent,
  makeTerminateAgentInstanceCommand,
  makeAgentInstanceTerminatedEvent,
  parseAgentBodyEnvelope,
  verifyAgentBodyEnvelope,
} from './envelopes.js';
import { createAgentInstance, completeAgentInstance, startAgentInstance } from './instance.js';
import type { InstanceTerminationStatus } from './instance.js';
import {
  DIGEST_A,
  TIMESTAMP,
  TIMESTAMP_LATER,
  makePossession,
  makeSubstrate,
} from './test-support.js';

describe('schema registry (positive)', () => {
  it('resolves every schema name to an arena:schema/agent-body ref', () => {
    for (const name of Object.keys(AGENT_BODY_SCHEMAS)) {
      const ref = agentBodySchemaRef(name as keyof typeof AGENT_BODY_SCHEMAS);
      expect(ref.namespace).toBe('agent-body');
      expect(ref.version).toBe('1.0.0');
      expect(isKnownAgentBodySchema(ref)).toBe(true);
    }
    expect(isKnownAgentBodySchema({ namespace: 'agent-body', name: 'nope', version: '1.0.0' })).toBe(
      false,
    );
  });

  it('throws for unknown schema names', () => {
    expect(() =>
      agentBodySchemaRef('agent-body/does-not-exist' as keyof typeof AGENT_BODY_SCHEMAS),
    ).toThrow(/unknown agent body schema/);
  });
});

describe('commands (idempotency keys are REQUIRED — lock rule 17)', () => {
  it('makeRegisterSubstrateCommand wires a validated command envelope', async () => {
    const substrate = await makeSubstrate();
    const envelope = makeRegisterSubstrateCommand(
      { substrate, registrant: { type: 'service', tenant: 'tenant-a', principalId: 'registry-svc' } },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    expect(envelope.kind).toBe('command');
    expect(envelope.schema).toBe('arena:schema/agent-body/register-substrate-command@1.0.0');
    expect(envelope.idempotencyKey).not.toBeNull();
    const digest = await agentBodyEnvelopeDigest(envelope);
    await expect(
      verifyAgentBodyEnvelope(serializeEnvelope(envelope), digest),
    ).resolves.toBeDefined();
  });

  it('rejects commands without an idempotency key', async () => {
    const substrate = await makeSubstrate();
    expect(() =>
      makeRegisterSubstrateCommand(
        { substrate, registrant: { type: 'service', tenant: 'tenant-a', principalId: 'registry-svc' } },
        { correlationId: newCorrelationId() },
      ),
    ).toThrow(/idempotency key/);
    const possession = await makePossession();
    expect(() =>
      makeCreatePossessionCommand(
        { possession, creator: { type: 'user', tenant: 'tenant-a', principalId: 'user-7' } },
        { correlationId: newCorrelationId() },
      ),
    ).toThrow(/idempotency key/);
    expect(() =>
      makeTerminateAgentInstanceCommand(
        {
          instanceId: 'agent-inst-0001',
          possessionDigest: DIGEST_A,
          status: 'completed',
          reason: 'done',
          terminatedAt: toTimestampView(TIMESTAMP_LATER),
        },
        { correlationId: newCorrelationId() },
      ),
    ).toThrow(/idempotency key/);
  });

  it('rejects invalid command payloads', async () => {
    expect(() =>
      makeRegisterSubstrateCommand(
        { substrate: { recordVersion: 2 } as never, registrant: { type: 'service', tenant: 'tenant-a', principalId: 's' } },
        { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
      ),
    ).toThrow(/structurally valid cognitive substrate/);
    expect(() =>
      makeTerminateAgentInstanceCommand(
        {
          instanceId: 'agent-inst-0001',
          possessionDigest: 'zzz',
          status: 'completed',
          reason: 'done',
          terminatedAt: toTimestampView(TIMESTAMP_LATER),
        },
        { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
      ),
    ).toThrow(/possession digest/);
    expect(() =>
      makeTerminateAgentInstanceCommand(
        {
          instanceId: 'agent-inst-0001',
          possessionDigest: DIGEST_A,
          status: 'vaporized' as unknown as InstanceTerminationStatus,
          reason: 'done',
          terminatedAt: toTimestampView(TIMESTAMP_LATER),
        },
        { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
      ),
    ).toThrow(/termination status/);
  });
});

describe('events (correlation ids, no idempotency requirement)', () => {
  it('wires possession-created and substrate-registered events', async () => {
    const possession = await makePossession();
    const substrate = await makeSubstrate();
    const created = makePossessionCreatedEvent(
      { possession },
      { correlationId: newCorrelationId() },
    );
    expect(created.kind).toBe('event');
    expect(created.idempotencyKey).toBeNull();
    const registered = makeSubstrateRegisteredEvent(
      { substrate },
      { correlationId: newCorrelationId() },
    );
    expect(registered.schema).toBe('arena:schema/agent-body/substrate-registered-event@1.0.0');
  });

  it('builds the agent-instance-terminated event payload from a TERMINATED instance', () => {
    const instance = completeAgentInstance(
      startAgentInstance(
        createAgentInstance({
          possessionDigest: DIGEST_A,
          environment: {
            environmentId: 'env-standard',
            environmentVersion: '3.2.0',
            instanceId: 'env-inst-0001',
            snapshotDigest: '5'.repeat(64),
          },
          instanceId: 'agent-inst-0001',
          createdAt: TIMESTAMP,
        }),
        TIMESTAMP,
      ),
      { reason: 'task finished', terminatedAt: TIMESTAMP_LATER },
    );
    const payload = agentInstanceTerminatedPayload(instance);
    expect(payload.instanceId).toBe('agent-inst-0001');
    expect(payload.termination.status).toBe('completed');
    const envelope = makeAgentInstanceTerminatedEvent(payload, {
      correlationId: newCorrelationId(),
    });
    expect(envelope.schema).toBe('arena:schema/agent-body/agent-instance-terminated-event@1.0.0');
  });

  it('refuses terminated-event payloads for LIVE instances', () => {
    const live = createAgentInstance({ possessionDigest: DIGEST_A, environment: {
      environmentId: 'env-standard',
      environmentVersion: '3.2.0',
      instanceId: 'env-inst-0001',
      snapshotDigest: '5'.repeat(64),
    } });
    expect(() => agentInstanceTerminatedPayload(live)).toThrow(/still live/);
  });
});

describe('parsing and verification (fail closed)', () => {
  it('parses with schema pinning and rejects schema mismatches', async () => {
    const possession = await makePossession();
    const envelope = makeCreatePossessionCommand(
      { possession, creator: { type: 'user', tenant: 'tenant-a', principalId: 'user-7' } },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    const raw = serializeEnvelope(envelope);
    const parsed = parseAgentBodyEnvelope(raw, 'agent-body/create-possession-command');
    expect(parsed.id).toBe(envelope.id);
    expect(() =>
      parseAgentBodyEnvelope(raw, 'agent-body/register-substrate-command'),
    ).toThrow(ProtocolError);
  });

  it('tampered envelopes fail digest verification', async () => {
    const substrate = await makeSubstrate();
    const envelope = makeRegisterSubstrateCommand(
      { substrate, registrant: { type: 'service', tenant: 'tenant-a', principalId: 'registry-svc' } },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    const raw = serializeEnvelope(envelope);
    const digest = await agentBodyEnvelopeDigest(envelope);
    const tampered = raw.replace('"command"', '"event"');
    await expect(verifyAgentBodyEnvelope(tampered, digest)).rejects.toThrow(ProtocolError);
  });

  it('malformed JSON and unknown versions are rejected by the core parser', () => {
    expect(() => parseAgentBodyEnvelope('{')).toThrow(ProtocolError);
    const unknown = JSON.stringify({
      v: 99,
      kind: 'event',
      schema: 'arena:schema/agent-body/possession-created-event@1.0.0',
      id: '0b8443e6-5b21-4d88-a917-640e3a84415f',
      correlationId: 'corr-1',
      idempotencyKey: null,
      issuedAt: '2026-01-15T09:30:00.000Z',
      payload: {},
    });
    expect(() => parseAgentBodyEnvelope(unknown)).toThrow(ProtocolError);
  });
});
