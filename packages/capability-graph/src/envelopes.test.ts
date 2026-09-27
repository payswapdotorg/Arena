/**
 * Envelope wiring tests (Work Order A004, gate 7): idempotency-keyed
 * commands, correlation-addressed events, canonical serialization, digest
 * verification, schema pinning — mirroring the A002 envelope patterns.
 */

import { describe, expect, it } from 'vitest';
import { newCorrelationId, newIdempotencyKey } from '@arena/protocol-core';
import {
  CAPABILITY_SCHEMAS,
  CAPABILITY_SCHEMA_VERSION,
  capabilityEnvelopeDigest,
  capabilitySchemaRef,
  isKnownCapabilitySchema,
  makeAddEdgeCommand,
  makeAddNodeCommand,
  makeApplyDomainPackCommand,
  makeDomainPackAppliedEvent,
  makeEdgeAddedEvent,
  makeNodeAddedEvent,
  makeSupersedeNodeCommand,
  parseCapabilityEnvelope,
  verifyCapabilityEnvelope,
} from './envelopes.js';
import { createCapabilityEdge } from './edges.js';
import { createCapabilityNode } from './nodes.js';
import { toDomainPack } from './domain-pack.js';
import { FIXTURE_PROVENANCE, makeNode, skillPayload, titledPayload } from './testing.js';

describe('schema registry (positive)', () => {
  it('every capability schema resolves to a versioned SchemaRef', () => {
    for (const name of Object.keys(CAPABILITY_SCHEMAS)) {
      const ref = capabilitySchemaRef(name as keyof typeof CAPABILITY_SCHEMAS);
      expect(ref.namespace).toBe('capability');
      expect(ref.version).toBe(CAPABILITY_SCHEMA_VERSION);
      expect(isKnownCapabilitySchema(ref)).toBe(true);
      expect(isKnownCapabilitySchema({ ...ref, version: '9.9.9' })).toBe(false);
      expect(isKnownCapabilitySchema({ namespace: 'artifacts', name: ref.name, version: ref.version })).toBe(false);
    }
  });

  it('unknown schema names throw', () => {
    expect(() =>
      capabilitySchemaRef('capability/does-not-exist' as keyof typeof CAPABILITY_SCHEMAS),
    ).toThrow(/unknown capability-graph schema/);
  });
});

describe('command envelopes (positive)', () => {
  it('add-node command requires an idempotency key and validates its payload', async () => {
    const node = await makeNode('domain', 'd', '1.0.0');
    const command = makeAddNodeCommand(
      { node },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    expect(command.kind).toBe('command');
    expect(command.schema).toBe('arena:schema/capability/add-node-command@1.0.0');
    expect(command.idempotencyKey).not.toBeNull();
    const parsed = parseCapabilityEnvelope(
      JSON.stringify(command),
      'capability/add-node-command',
    );
    expect(parsed.id).toBe(command.id);
    expect(parsed.correlationId).toBe(command.correlationId);
  });

  it('add-edge and supersede-node commands validate their payloads', async () => {
    const skill = await makeNode('skill', 's', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const tool = await makeNode('tool', 't', '1.0.0');
    const edge = await createCapabilityEdge({
      kind: 'requires',
      source: skill,
      target: tool,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const context = {
      correlationId: newCorrelationId(),
      idempotencyKey: newIdempotencyKey(),
    };
    const addEdge = makeAddEdgeCommand({ edge }, context);
    expect(addEdge.schema).toBe('arena:schema/capability/add-edge-command@1.0.0');

    const superseding = await createCapabilityNode({
      kind: 'skill',
      id: 's',
      version: '1.1.0',
      payload: skillPayload({ summary: 'v2' }),
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      supersedes: skill.digest,
    });
    const supersede = makeSupersedeNodeCommand({ node: superseding }, context);
    expect(supersede.schema).toBe('arena:schema/capability/supersede-node-command@1.0.0');
    // a node WITHOUT supersedes is rejected by the supersede command
    expect(() => makeSupersedeNodeCommand({ node: skill }, context)).toThrow(
      /supersedes digest/,
    );
  });

  it('apply-domain-pack command validates its pack payload', async () => {
    const pack = toDomainPack({
      packId: 'env-pack',
      version: '1.0.0',
      targetDomain: { kind: 'domain', id: 'd', version: '1.0.0' },
      declaration: {
        skills: [],
        evaluators: [
          { id: 'ev', version: '1.0.0', payload: titledPayload({ title: 'Evaluator' }) },
        ],
        environments: [],
        edges: [],
      },
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const command = makeApplyDomainPackCommand(
      { pack },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    expect(command.schema).toBe('arena:schema/capability/apply-domain-pack-command@1.0.0');
    expect(() =>
      makeApplyDomainPackCommand(
        { pack: { packId: 'BAD' } as never },
        { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
      ),
    ).toThrow(/valid domain pack descriptor/);
  });
});

describe('command envelopes (negative — lock rule 17)', () => {
  it('commands without an idempotency key are rejected', async () => {
    const node = await makeNode('domain', 'd', '1.0.0');
    expect(() =>
      makeAddNodeCommand({ node }, { correlationId: newCorrelationId() }),
    ).toThrow(/idempotency key/);
  });

  it('invalid payloads are rejected before the envelope is built', async () => {
    const context = {
      correlationId: newCorrelationId(),
      idempotencyKey: newIdempotencyKey(),
    };
    expect(() => makeAddNodeCommand({ node: { kind: 'domain' } as never }, context)).toThrow(
      /structurally valid capability node/,
    );
    expect(() => makeAddEdgeCommand({ edge: { kind: 'requires' } as never }, context)).toThrow(
      /structurally valid capability edge/,
    );
  });
});

describe('event envelopes (positive + negative)', () => {
  it('events carry correlation ids and canonical, verifiable wire forms', async () => {
    const node = await makeNode('domain', 'd', '1.0.0');
    const event = makeNodeAddedEvent(
      { node },
      { correlationId: newCorrelationId() },
    );
    expect(event.kind).toBe('event');
    expect(event.idempotencyKey).toBeNull(); // events do not require one
    const raw = JSON.stringify(event);
    const digest = await capabilityEnvelopeDigest(event);
    const verified = await verifyCapabilityEnvelope(raw, digest);
    expect(verified.id).toBe(event.id);

    // tampering breaks the digest (core tripwire reused)
    const tampered = JSON.parse(raw) as Record<string, unknown>;
    const payload = tampered['payload'] as Record<string, unknown>;
    payload['node'] = { ...node, digest: 'f'.repeat(64) };
    await expect(
      verifyCapabilityEnvelope(JSON.stringify(tampered), digest),
    ).rejects.toThrow(/digest mismatch/);
  });

  it('edge-added and domain-pack-applied events validate payloads', async () => {
    const skill = await makeNode('skill', 's', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const tool = await makeNode('tool', 't', '1.0.0');
    const edge = await createCapabilityEdge({
      kind: 'requires',
      source: skill,
      target: tool,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const edgeEvent = makeEdgeAddedEvent(
      { edge },
      { correlationId: newCorrelationId() },
    );
    expect(edgeEvent.schema).toBe('arena:schema/capability/edge-added-event@1.0.0');
    expect(() =>
      makeEdgeAddedEvent({ edge: 42 as never }, { correlationId: newCorrelationId() }),
    ).toThrow(/structurally valid capability edge/);

    const packEvent = makeDomainPackAppliedEvent(
      {
        packId: 'env-pack',
        packVersion: '1.0.0',
        packDigest: 'a'.repeat(64),
        declaredNodeKeys: ['skill/x@1.0.0'],
      },
      { correlationId: newCorrelationId() },
    );
    expect(packEvent.schema).toBe('arena:schema/capability/domain-pack-applied-event@1.0.0');
    expect(() =>
      makeDomainPackAppliedEvent(
        { packId: 'x', packVersion: '1.0.0', packDigest: 'zz', declaredNodeKeys: [] },
        { correlationId: newCorrelationId() },
      ),
    ).toThrow(/packDigest/);
  });
});

describe('parsing (negative)', () => {
  it('malformed JSON and schema mismatches are rejected by the core parser', async () => {
    expect(() => parseCapabilityEnvelope('{')).toThrow(/not valid JSON|JSON/);
    const node = await makeNode('domain', 'd', '1.0.0');
    const event = makeNodeAddedEvent({ node }, { correlationId: newCorrelationId() });
    const raw = JSON.stringify(event);
    expect(() =>
      parseCapabilityEnvelope(raw, 'capability/edge-added-event'),
    ).toThrow(/does not match expected/);
  });
});
