/**
 * Envelope wiring tests (Work Order A024) — commands carry REQUIRED
 * idempotency keys, payloads are validated, schema pinning rejects
 * foreign schemas, the tamper tripwire fails closed.
 */

import { describe, expect, it } from 'vitest';
import { serializeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import {
  BODY_REGISTRY_SCHEMAS,
  BODY_REGISTRY_SCHEMA_VERSION,
  bodyRegistrySchemaRef,
  bodyRegistryEnvelopeDigest,
  checkBodyRegistryEnvelope,
  isKnownBodyRegistrySchema,
  makePublishReleaseCommand,
  makeRegisterReleaseCommand,
  makeReleasePublishedEvent,
  makeReleaseRegisteredEvent,
  parseBodyRegistryEnvelope,
  parsePublishReleaseCommand,
  parseRegisterReleaseCommand,
  parseReleasePublishedEvent,
  parseReleaseRegisteredEvent,
} from './envelopes.js';
import { BODY_REGISTRY_ERROR_CODES, BodyRegistryError, isBodyRegistryError } from './errors.js';
import type { RegisterReleaseCommandPayload } from './envelopes.js';
import { CORRELATION_ID, IDEMPOTENCY_KEY, T2, makeAdmittedScenario } from './test-support.js';

const CONTEXT = {
  correlationId: CORRELATION_ID as CorrelationId,
  idempotencyKey: IDEMPOTENCY_KEY as IdempotencyKey,
};

const CONTEXT_NO_KEY = { correlationId: CORRELATION_ID as CorrelationId };

async function makeValidRegistrationPayload(): Promise<RegisterReleaseCommandPayload> {
  const scenario = await makeAdmittedScenario();
  return {
    bodyVersionRef: {
      tenant: scenario.bodyVersion.body.tenant,
      name: scenario.bodyVersion.body.name,
      version: scenario.bodyVersion.version,
      digest: String(scenario.bodyVersion.digest),
    },
    releaseVersion: '2.0.0',
    channel: 'stable',
    tags: ['production'],
    certificationRefs: [scenario.certification.digest],
    compatibilityRefs: [scenario.compatibility.recordDigest],
    forgeRecordDigest: null,
  };
}

const RELEASE_REF = {
  namespace: 'acme',
  name: 'structural-engineer-body',
  version: '2.0.0',
  digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

const PUBLISH_PAYLOAD = {
  releaseRecordDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  publisher: { type: 'service', tenant: 'acme', principalId: 'release-bot' },
  rights: {
    license: 'Proprietary',
    commercialUse: 'requires-license',
    redistribution: 'tenant-only',
    customerData: 'derived',
  },
  publishedAt: T2,
};

describe('register-release command', () => {
  it('round-trips through the core envelope (schema-pinned parse)', async () => {
    const payload = await makeValidRegistrationPayload();
    const command = makeRegisterReleaseCommand(payload, CONTEXT);
    const raw = serializeEnvelope(command);
    const parsed = parseRegisterReleaseCommand(raw);
    expect(parsed.idempotencyKey).toBe(IDEMPOTENCY_KEY);
    expect(parsed.payload.channel).toBe('stable');
    expect(parsed.payload.certificationRefs).toEqual(payload.certificationRefs);
  });

  it('REQUIRES an idempotency key (architecture-lock rule 17)', async () => {
    const payload = await makeValidRegistrationPayload();
    expect(() => makeRegisterReleaseCommand(payload, CONTEXT_NO_KEY)).toThrow();
    expect(() => makeRegisterReleaseCommand(payload, CONTEXT_NO_KEY)).toThrowError(
      expect.objectContaining({ name: 'BodyRegistryError' }),
    );
  });

  it('rejects an unknown channel at construction', async () => {
    const payload = { ...(await makeValidRegistrationPayload()), channel: 'nightly' };
    expect(() => makeRegisterReleaseCommand(payload, CONTEXT)).toThrow();
  });

  it('rejects empty certification citations at construction (never a rubber stamp)', async () => {
    const payload = { ...(await makeValidRegistrationPayload()), certificationRefs: [] };
    expect(() => makeRegisterReleaseCommand(payload, CONTEXT)).toThrow();
  });

  it('rejects a malformed body-version ref at construction', async () => {
    const base = await makeValidRegistrationPayload();
    const payload = { ...base, bodyVersionRef: { ...base.bodyVersionRef, digest: 'nope' } };
    expect(() => makeRegisterReleaseCommand(payload, CONTEXT)).toThrow();
  });

  it('parse-time payload validation fails closed on a foreign payload', async () => {
    const command = makeRegisterReleaseCommand(await makeValidRegistrationPayload(), CONTEXT);
    const raw = serializeEnvelope({
      ...command,
      payload: { ...command.payload, channel: 'nightly' },
    });
    expect(() => parseRegisterReleaseCommand(raw)).toThrow();
  });
});

describe('release-registered event', () => {
  it('round-trips and validates the citable release ref', () => {
    const event = makeReleaseRegisteredEvent(
      { releaseRecordDigest: RELEASE_REF.digest, release: RELEASE_REF },
      CONTEXT,
    );
    const raw = serializeEnvelope(event);
    const parsed = parseReleaseRegisteredEvent(raw);
    expect(parsed.payload.release.namespace).toBe('acme');
    expect(parsed.idempotencyKey).toBe(IDEMPOTENCY_KEY); // events MAY carry keys
  });

  it('rejects a malformed release ref at construction', () => {
    expect(() =>
      makeReleaseRegisteredEvent(
        { releaseRecordDigest: RELEASE_REF.digest, release: { ...RELEASE_REF, version: '' } },
        CONTEXT,
      ),
    ).toThrow();
  });

  it('rejects an invalid record digest at construction', () => {
    expect(() =>
      makeReleaseRegisteredEvent(
        { releaseRecordDigest: 'not-a-digest', release: RELEASE_REF },
        CONTEXT,
      ),
    ).toThrow();
  });
});

describe('publish-release command + release-published event', () => {
  it('round-trips the publish command', () => {
    const command = makePublishReleaseCommand(PUBLISH_PAYLOAD, CONTEXT);
    const raw = serializeEnvelope(command);
    const parsed = parsePublishReleaseCommand(raw);
    expect(parsed.payload.publisher.principalId).toBe('release-bot');
    expect(parsed.payload.publishedAt).toBe(T2);
  });

  it('REQUIRES an idempotency key', () => {
    expect(() => makePublishReleaseCommand(PUBLISH_PAYLOAD, CONTEXT_NO_KEY)).toThrow();
  });

  it('rejects an invalid release-record digest at construction', () => {
    expect(() =>
      makePublishReleaseCommand({ ...PUBLISH_PAYLOAD, releaseRecordDigest: 'x' }, CONTEXT),
    ).toThrow();
  });

  it('round-trips the published event', () => {
    const event = makeReleasePublishedEvent(
      { publicationRecordDigest: RELEASE_REF.digest, release: RELEASE_REF },
      CONTEXT,
    );
    const raw = serializeEnvelope(event);
    const parsed = parseReleasePublishedEvent(raw);
    expect(parsed.payload.publicationRecordDigest).toBe(RELEASE_REF.digest);
  });
});

describe('schema registry + tamper tripwire', () => {
  it('resolves schema refs and rejects unknown names', () => {
    const ref = bodyRegistrySchemaRef('body-registry/release-record');
    expect(ref).toEqual({ namespace: 'body-registry', name: 'release-record', version: BODY_REGISTRY_SCHEMA_VERSION });
    expect(isKnownBodyRegistrySchema(ref)).toBe(true);
    expect(isKnownBodyRegistrySchema({ ...ref, version: '9.9.9' })).toBe(false);
    expect(() => bodyRegistrySchemaRef('body-registry/nope' as never)).toThrow();
  });

  it('the schema registry is frozen and complete', () => {
    expect(Object.isFrozen(BODY_REGISTRY_SCHEMAS)).toBe(true);
    expect(Object.keys(BODY_REGISTRY_SCHEMAS)).toContain('body-registry/register-release-command');
    expect(Object.keys(BODY_REGISTRY_SCHEMAS)).toContain('body-registry/release-published-event');
  });

  it('envelope digests are stable and the tripwire fails closed', async () => {
    const payload = await makeValidRegistrationPayload();
    const command = makeRegisterReleaseCommand(payload, CONTEXT);
    const raw = serializeEnvelope(command);
    const digest = await bodyRegistryEnvelopeDigest(command);
    const digestAgain = await bodyRegistryEnvelopeDigest(parseBodyRegistryEnvelope(raw));
    expect(digest).toBe(digestAgain);
    await expect(checkBodyRegistryEnvelope(raw, digest)).resolves.toBeTruthy();

    const tampered = serializeEnvelope({ ...command, payload: { ...command.payload, channel: 'development' } });
    await expect(checkBodyRegistryEnvelope(tampered, digest)).rejects.toSatisfy(
      (error: unknown) =>
        isBodyRegistryError(error) && (error as BodyRegistryError).code === BODY_REGISTRY_ERROR_CODES.TAMPERED,
    );
  });

  it('schema-pinned parsing rejects foreign schemas', async () => {
    const payload = await makeValidRegistrationPayload();
    const command = makeRegisterReleaseCommand(payload, CONTEXT);
    const raw = serializeEnvelope({
      ...command,
      schema: 'arena:schema/certification/certification-record@1.0.0',
    });
    expect(() => parseRegisterReleaseCommand(raw)).toThrow();
  });
});
