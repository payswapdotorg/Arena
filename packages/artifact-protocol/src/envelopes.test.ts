import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_ERROR_CODES,
  newCorrelationId,
  newIdempotencyKey,
  serializeEnvelope,
  toCorrelationId,
} from '@arena/protocol-core';
import {
  ARTIFACT_SCHEMAS,
  ARTIFACT_SCHEMA_VERSION,
  type ArtifactPublishedEventPayload,
  type PublishArtifactCommandPayload,
  artifactEnvelopeDigest,
  artifactSchemaRef,
  isKnownArtifactSchema,
  makeArtifactPublishedEvent,
  makePublishArtifactCommand,
  makeRetractPublicationCommand,
  parseArtifactEnvelope,
  verifyArtifactEnvelope,
} from './envelopes.js';
import { createMaterialArtifact, type MaterialArtifact } from './artifact.js';
import { toContentDigest } from './content-digest.js';
import { toPrincipalRef } from './principal.js';
import { toRightsMetadata } from './rights.js';
import { toTimestamp } from './timestamp.js';

const correlationId = toCorrelationId('artifact-flow-1');
const PUBLISHER = toPrincipalRef({
  type: 'service',
  tenant: 'acme',
  principalId: 'registry-control-plane',
});
const RIGHTS = toRightsMetadata({
  license: 'CC-BY-4.0',
  commercialUse: 'allowed',
  redistribution: 'allowed',
  customerData: 'none',
});

async function sampleArtifact(): Promise<MaterialArtifact<unknown>> {
  return createMaterialArtifact({
    identity: { namespace: 'acme', name: 'reference-dataset', version: '1.4.2' },
    content: { rows: 3 },
  });
}

async function publishPayload(): Promise<PublishArtifactCommandPayload> {
  return { artifact: await sampleArtifact(), publisher: PUBLISHER, rights: RIGHTS };
}

describe('Artifact envelopes (positive)', () => {
  it('makes an idempotency-keyed publish command inside Envelope<T>', async () => {
    const payload = await publishPayload();
    const envelope = makePublishArtifactCommand(payload, {
      correlationId,
      idempotencyKey: newIdempotencyKey(),
    });
    expect(envelope.v).toBe(1);
    expect(envelope.kind).toBe('command');
    expect(envelope.schema).toBe('arena:schema/artifacts/publish-artifact-command@1.0.0');
    expect(envelope.correlationId).toBe('artifact-flow-1');
    expect(envelope.idempotencyKey).not.toBeNull();
    expect(envelope.payload).toEqual(payload);
  });

  it('round-trips through canonical serialization with schema pinning', async () => {
    const payload = await publishPayload();
    const envelope = makePublishArtifactCommand(payload, {
      correlationId,
      idempotencyKey: newIdempotencyKey(),
    });
    const raw = serializeEnvelope(envelope);
    const parsed = parseArtifactEnvelope<PublishArtifactCommandPayload>(
      raw,
      'artifacts/publish-artifact-command',
    );
    expect(parsed.payload).toEqual(payload);
  });

  it('emits artifact-published events with correlation ids', async () => {
    const artifact = await sampleArtifact();
    const payload: ArtifactPublishedEventPayload = {
      publication: {
        recordVersion: 1,
        action: 'publish',
        artifact: {
          namespace: artifact.identity.namespace,
          name: artifact.identity.name,
          version: artifact.identity.version,
          digest: artifact.digest,
        },
        publisher: PUBLISHER,
        rights: RIGHTS,
        publishedAt: toTimestamp('2026-09-26T12:00:00.000Z'),
      },
    };
    const envelope = makeArtifactPublishedEvent(payload, { correlationId });
    expect(envelope.kind).toBe('event');
    expect(envelope.idempotencyKey).toBeNull(); // events are not commands
    const raw = serializeEnvelope(envelope);
    const parsed = parseArtifactEnvelope<ArtifactPublishedEventPayload>(
      raw,
      'artifacts/artifact-published-event',
    );
    expect(parsed.payload.publication.action).toBe('publish');
  });

  it('verifies the envelope digest end-to-end', async () => {
    const payload = await publishPayload();
    const envelope = makePublishArtifactCommand(payload, {
      correlationId,
      idempotencyKey: newIdempotencyKey(),
    });
    const raw = serializeEnvelope(envelope);
    const digest = await artifactEnvelopeDigest(envelope);
    await expect(verifyArtifactEnvelope(raw, digest)).resolves.toBeDefined();
  });

  it('exposes the schema registry with consistent versions', () => {
    expect(ARTIFACT_SCHEMA_VERSION).toBe('1.0.0');
    for (const [name, version] of Object.entries(ARTIFACT_SCHEMAS)) {
      expect(version).toBe(ARTIFACT_SCHEMA_VERSION);
      const ref = artifactSchemaRef(name as keyof typeof ARTIFACT_SCHEMAS);
      expect(ref.namespace).toBe('artifacts');
      expect(isKnownArtifactSchema(ref)).toBe(true);
    }
    expect(
      isKnownArtifactSchema({ namespace: 'artifacts', name: 'envelope', version: '1.0.0' }),
    ).toBe(false);
    expect(
      isKnownArtifactSchema({ namespace: 'artifacts', name: 'rights', version: '9.9.9' }),
    ).toBe(false);
  });
});

describe('Artifact envelopes (negative — protocol tripwires)', () => {
  it('a command without an idempotency key is rejected at construction', async () => {
    const payload = await publishPayload();
    expect(() =>
      makePublishArtifactCommand(payload, { correlationId }),
    ).toThrow(/idempotency key/);
  });

  it('a wire command missing its idempotency key is rejected by the core parser', async () => {
    const payload = await publishPayload();
    const envelope = makePublishArtifactCommand(payload, {
      correlationId,
      idempotencyKey: newIdempotencyKey(),
    });
    const raw = serializeEnvelope(envelope);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    delete parsed['idempotencyKey'];
    try {
      parseArtifactEnvelope(JSON.stringify(parsed));
      expect.unreachable('missing idempotencyKey must fail');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(PROTOCOL_ERROR_CODES.INVALID_ENVELOPE);
    }
  });

  it('unknown envelope versions are rejected', async () => {
    const payload = await publishPayload();
    const envelope = makePublishArtifactCommand(payload, {
      correlationId,
      idempotencyKey: newIdempotencyKey(),
    });
    const raw = JSON.parse(serializeEnvelope(envelope)) as Record<string, unknown>;
    raw['v'] = 2;
    try {
      parseArtifactEnvelope(JSON.stringify(raw));
      expect.unreachable('unknown envelope version must fail');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(PROTOCOL_ERROR_CODES.UNSUPPORTED_VERSION);
    }
  });

  it('tampered envelopes fail digest verification', async () => {
    const payload = await publishPayload();
    const envelope = makePublishArtifactCommand(payload, {
      correlationId,
      idempotencyKey: newIdempotencyKey(),
    });
    const raw = serializeEnvelope(envelope);
    const digest = await artifactEnvelopeDigest(envelope);

    // Tamper with the payload while keeping the envelope shape valid.
    const tampered = JSON.parse(raw) as { payload: { artifact: { content: unknown } } };
    tampered.payload.artifact.content = { rows: 999 };
    await expect(
      verifyArtifactEnvelope(JSON.stringify(tampered), digest),
    ).rejects.toMatchObject({ code: PROTOCOL_ERROR_CODES.ENVELOPE_TAMPERED });
  });

  it('schema pinning rejects the wrong payload schema', async () => {
    const payload = await publishPayload();
    const envelope = makePublishArtifactCommand(payload, {
      correlationId,
      idempotencyKey: newIdempotencyKey(),
    });
    const raw = serializeEnvelope(envelope);
    try {
      parseArtifactEnvelope(raw, 'artifacts/retract-publication-command');
      expect.unreachable('schema mismatch must fail');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(PROTOCOL_ERROR_CODES.SCHEMA_MISMATCH);
    }
  });

  it('invalid payloads are rejected at construction', async () => {
    const artifact = await sampleArtifact();
    expect(() =>
      makePublishArtifactCommand(
        // malformed: rights missing → MISSING_RIGHTS at construction
        { artifact, publisher: PUBLISHER, rights: { license: '' } as never },
        { correlationId, idempotencyKey: newIdempotencyKey() },
      ),
    ).toThrow(/rights/);
    expect(() =>
      makeRetractPublicationCommand(
        { publicationDigest: 'nothex' as never, publisher: PUBLISHER },
        { correlationId, idempotencyKey: newIdempotencyKey() },
      ),
    ).toThrow(/digest/);
    expect(() =>
      makeArtifactPublishedEvent({ publication: { action: 'publish' } as never }, {
        correlationId,
      }),
    ).toThrow(/publication/);
  });

  it('random correlation ids are usable for multi-flow commands', async () => {
    const payload = await publishPayload();
    const a = makePublishArtifactCommand(payload, {
      correlationId: newCorrelationId(),
      idempotencyKey: newIdempotencyKey(),
    });
    const b = makeRetractPublicationCommand(
      { publicationDigest: toContentDigest('a'.repeat(64)), publisher: PUBLISHER },
      { correlationId: newCorrelationId(), idempotencyKey: newIdempotencyKey() },
    );
    expect(a.correlationId).not.toBe(b.correlationId);
    expect(a.schema).not.toBe(b.schema);
  });
});
