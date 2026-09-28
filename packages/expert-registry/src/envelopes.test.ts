/**
 * Envelope wiring tests (Work Order A006 gate 9; lock rules 17, 18, 22) —
 * commands carry REQUIRED idempotency keys, payloads are strictly
 * validated, schema refs are pinned to the expert namespace, and the core
 * tamper tripwire is wired.
 */

import { describe, expect, it } from 'vitest';
import {
  EXPERT_SCHEMAS,
  EXPERT_SCHEMA_VERSION,
  expertEnvelopeDigest,
  expertSchemaRef,
  isKnownExpertSchema,
  makeAttachEvidenceCommand,
  makeDomainPackPublishedEvent,
  makeExpertRegisteredEvent,
  makeProfilePublishedEvent,
  makePublishProfileCommand,
  makeRecordReliabilityCommand,
  makeRecordTaskCommand,
  makeRegisterExpertCommand,
  makeReinstateProfileCommand,
  makeRetireProfileCommand,
  makeSuspendProfileCommand,
  makeSupersedeProfileCommand,
  parseExpertEnvelope,
  verifyExpertEnvelope,
} from './envelopes.js';
import { newCorrelationId, newIdempotencyKey } from '@arena/protocol-core';
import { createExpertProfile, expertVersionRef } from './profile.js';
import { publishProfile } from './lifecycle.js';
import { createExpertDomainPack } from './domain-pack.js';
import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import {
  AT,
  AT_LATER,
  DECLARER,
  DIGEST_D,
  expectThrowsCode,
  RECORDER,
  validDomainPackInput,
  validProfileInput,
} from './test-support.js';

const CORRELATION = newCorrelationId();
const IDEMPOTENCY = { idempotencyKey: newIdempotencyKey() };

async function draft() {
  return createExpertProfile(validProfileInput());
}

describe('schema registry (positive)', () => {
  it('owns the expert namespace at version 1.0.0', () => {
    expect(EXPERT_SCHEMA_VERSION).toBe('1.0.0');
    expect(Object.keys(EXPERT_SCHEMAS).length).toBe(41);
    const ref = expertSchemaRef('expert/profile');
    expect(ref).toEqual({ namespace: 'expert', name: 'profile', version: '1.0.0' });
    expect(isKnownExpertSchema(ref)).toBe(true);
    expect(isKnownExpertSchema({ namespace: 'expert', name: 'profile', version: '2.0.0' })).toBe(
      false,
    );
    expect(isKnownExpertSchema({ namespace: 'other', name: 'profile', version: '1.0.0' })).toBe(
      false,
    );
  });

  it('unknown schema names throw', () => {
    expect(() =>
      expertSchemaRef('expert/not-a-schema' as never),
    ).toThrow(ExpertRegistryError);
  });
});

describe('command envelopes (positive)', () => {
  it('register-expert command validates the payload and pins its schema', async () => {
    const profile = await draft();
    const envelope = makeRegisterExpertCommand(
      { profile, registrar: DECLARER },
      { correlationId: CORRELATION, ...IDEMPOTENCY },
    );
    expect(envelope.kind).toBe('command');
    expect(envelope.schema).toBe('arena:schema/expert/register-expert-command@1.0.0');
    expect(envelope.idempotencyKey).not.toBeNull();
    expect(envelope.payload.profile.digest).toBe(profile.digest);
  });

  it('every lifecycle command constructor pins its schema', async () => {
    const profile = await draft();
    const base = {
      currentStateDigest: profile.digest,
      at: AT_LATER,
      actor: DECLARER,
    };
    expect(
      makePublishProfileCommand(base, { correlationId: CORRELATION, ...IDEMPOTENCY }).schema,
    ).toBe('arena:schema/expert/publish-profile-command@1.0.0');
    expect(
      makeSuspendProfileCommand(base, { correlationId: CORRELATION, ...IDEMPOTENCY }).schema,
    ).toBe('arena:schema/expert/suspend-profile-command@1.0.0');
    expect(
      makeReinstateProfileCommand(base, { correlationId: CORRELATION, ...IDEMPOTENCY }).schema,
    ).toBe('arena:schema/expert/reinstate-profile-command@1.0.0');
    expect(
      makeRetireProfileCommand(
        { ...base, note: 'Leaving the program.' },
        { correlationId: CORRELATION, ...IDEMPOTENCY },
      ).schema,
    ).toBe('arena:schema/expert/retire-profile-command@1.0.0');
    expect(
      makeSupersedeProfileCommand(
        { ...base, superseding: expertVersionRef(profile) },
        { correlationId: CORRELATION, ...IDEMPOTENCY },
      ).schema,
    ).toBe('arena:schema/expert/supersede-profile-command@1.0.0');
    expect(
      makeAttachEvidenceCommand(
        { ...base, evidence: [{ digest: DIGEST_D, description: 'More evidence.' }] },
        { correlationId: CORRELATION, ...IDEMPOTENCY },
      ).schema,
    ).toBe('arena:schema/expert/attach-evidence-command@1.0.0');
    expect(
      makeRecordTaskCommand(
        {
          ...base,
          records: [
            {
              kind: 'task-outcome',
              tenant: 'tenant-a',
              taskId: 'task-42',
              version: '1.0.0',
              digest: DIGEST_D,
              occurredAt: AT_LATER,
            },
          ],
        },
        { correlationId: CORRELATION, ...IDEMPOTENCY },
      ).schema,
    ).toBe('arena:schema/expert/record-task-command@1.0.0');
    expect(
      makeRecordReliabilityCommand(
        {
          ...base,
          entry: { kind: 'task-completed', occurredAt: AT_LATER, recordedBy: RECORDER },
        },
        { correlationId: CORRELATION, ...IDEMPOTENCY },
      ).schema,
    ).toBe('arena:schema/expert/record-reliability-command@1.0.0');
  });
});

describe('command envelopes (negative)', () => {
  it('commands WITHOUT an idempotency key are rejected (lock rule 17)', async () => {
    const profile = await draft();
    for (const make of [
      () =>
        makeRegisterExpertCommand(
          { profile, registrar: DECLARER },
          { correlationId: CORRELATION },
        ),
      () =>
        makePublishProfileCommand(
          { currentStateDigest: profile.digest, at: AT_LATER, actor: DECLARER },
          { correlationId: CORRELATION },
        ),
    ]) {
      let caught: unknown;
      try {
        make();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ExpertRegistryError);
      expect((caught as ExpertRegistryError).message).toMatch(/idempotency key/);
    }
  });

  it('invalid payloads are rejected by the command constructors', async () => {
    const profile = await draft();
    const base = {
      currentStateDigest: profile.digest,
      at: AT_LATER,
      actor: DECLARER,
    };
    const context = { correlationId: CORRELATION, ...IDEMPOTENCY };
    expect(() =>
      makeRegisterExpertCommand({ profile: {} as never, registrar: DECLARER }, context),
    ).toThrow(/structurally valid profile/);
    expect(() =>
      makeRegisterExpertCommand({ profile, registrar: 'nope' as never }, context),
    ).toThrow(/valid principal/);
    expect(() =>
      makePublishProfileCommand({ ...base, currentStateDigest: 'bad' }, context),
    ).toThrow(/sha256 state digest/);
    expect(() =>
      makePublishProfileCommand(
        { ...base, actor: { type: 'user', tenant: 'tenant-a', principalId: 'x' }, note: '' },
        context,
      ),
    ).toThrow(/non-empty/);
    expect(() =>
      makeRetireProfileCommand({ ...base, note: '' }, context),
    ).toThrow(/non-empty rationale note/);
    expect(() =>
      makeSupersedeProfileCommand({ ...base, superseding: { tenant: 'x' } as never }, context),
    ).toThrow(/valid superseding profile version ref/);
    expect(() =>
      makeAttachEvidenceCommand({ ...base, evidence: [] }, context),
    ).toThrow(/at least one valid evidence ref/);
    expect(() =>
      makeRecordTaskCommand({ ...base, records: [{}] as never }, context),
    ).toThrow(/at least one valid task record ref/);
    expect(() =>
      makeRecordReliabilityCommand(
        { ...base, entry: { kind: 'task-cancelled', occurredAt: AT, recordedBy: RECORDER } },
        context,
      ),
    ).toThrow(/sequence-less outcome entry/);
    expectThrowsCode(
      () =>
        makeRecordReliabilityCommand(
          {
            ...base,
            entry: {
              kind: 'task-completed',
              occurredAt: AT,
              recordedBy: RECORDER,
              sequence: 1,
            } as never,
          },
          context,
        ),
      EXPERT_ERROR_CODES.INVALID_RELIABILITY,
    );
  });
});

describe('event envelopes (positive + negative)', () => {
  it('profile-state events validate the resulting profile and pin schemas', async () => {
    const profile = await publishProfile(await draft(), { at: AT_LATER, actor: DECLARER });
    const event = profile.lifecycle[profile.lifecycle.length - 1]!;
    const envelope = makeProfilePublishedEvent(
      { profile, event },
      { correlationId: CORRELATION },
    );
    expect(envelope.kind).toBe('event');
    expect(envelope.schema).toBe('arena:schema/expert/profile-published-event@1.0.0');
    expect(envelope.idempotencyKey).toBeNull(); // events are not idempotent-keyed
    expect(
      makeExpertRegisteredEvent({ profile: await draft(), event: (await draft()).lifecycle[0]! }, {
        correlationId: CORRELATION,
      }).schema,
    ).toBe('arena:schema/expert/expert-registered-event@1.0.0');
  });

  it('domain-pack-published events validate the pack', async () => {
    const pack = await createExpertDomainPack(validDomainPackInput());
    const envelope = makeDomainPackPublishedEvent(
      { pack, publishedBy: DECLARER },
      { correlationId: CORRELATION },
    );
    expect(envelope.schema).toBe('arena:schema/expert/domain-pack-published-event@1.0.0');
    expect(() =>
      makeDomainPackPublishedEvent(
        { pack: {} as never, publishedBy: DECLARER },
        { correlationId: CORRELATION },
      ),
    ).toThrow(/structurally valid pack/);
    expect(() =>
      makeDomainPackPublishedEvent(
        { pack, publishedBy: 'nope' as never },
        { correlationId: CORRELATION },
      ),
    ).toThrow(/valid principal/);
  });

  it('events reject structurally invalid profiles', async () => {
    expect(() =>
      makeProfilePublishedEvent(
        { profile: {} as never, event: {} as never },
        { correlationId: CORRELATION },
      ),
    ).toThrow(/structurally valid resulting profile/);
  });
});

describe('parse / digest / verify (core reuse)', () => {
  it('round-trips a command envelope through the core parser', async () => {
    const profile = await draft();
    const envelope = makeRegisterExpertCommand(
      { profile, registrar: DECLARER },
      { correlationId: CORRELATION, ...IDEMPOTENCY },
    );
    const raw = JSON.stringify(envelope);
    const parsed = parseExpertEnvelope<{ profile: { digest: string } }>(
      raw,
      'expert/register-expert-command',
    );
    expect(parsed.id).toBe(envelope.id);
    expect(parsed.payload.profile.digest).toBe(profile.digest);
    // Schema mismatch is rejected by the core parser.
    expect(() =>
      parseExpertEnvelope(raw, 'expert/publish-profile-command'),
    ).toThrow(/SCHEMA_MISMATCH|schema/);
  });

  it('the core tamper tripwire is wired (envelope digest + verify)', async () => {
    const profile = await draft();
    const envelope = makeRegisterExpertCommand(
      { profile, registrar: DECLARER },
      { correlationId: CORRELATION, ...IDEMPOTENCY },
    );
    const digest = await expertEnvelopeDigest(envelope);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const raw = JSON.stringify(envelope);
    await expect(verifyExpertEnvelope(raw, digest)).resolves.toBeTruthy();
    await expect(verifyExpertEnvelope(raw, 'f'.repeat(64))).rejects.toThrow(
      /digest mismatch/,
    );
  });
});
