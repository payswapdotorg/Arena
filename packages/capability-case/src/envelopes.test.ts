/**
 * Envelope suite (Work Order A005 gate 8 + gate 11): Envelope<T> wiring with
 * idempotency keys for commands, event construction, schema pinning and the
 * core tamper tripwire.
 */

import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CASE_SCHEMAS,
  capabilityCaseEnvelopeDigest,
  capabilityCaseSchemaRef,
  isKnownCapabilityCaseSchema,
  makeActivateCaseCommand,
  makeAttachEvidenceCommand,
  makeCaseRegisteredEvent,
  makeCompilationTargetDerivedEvent,
  makeRegisterCaseCommand,
  makeResolveCaseCommand,
  makeSubmitCaseCommand,
  makeSupersedeCaseCommand,
  makeTriageCaseCommand,
  parseCapabilityCaseEnvelope,
  verifyCapabilityCaseEnvelope,
} from './envelopes.js';
import type { RegisterCaseCommandPayload } from './envelopes.js';
import { toCaseVersionRef } from './identity.js';
import { deriveCompilationTarget } from './compilation.js';
import { createCapabilityCase } from './case.js';
import { submitCase, triageCase } from './lifecycle.js';
import { serializeEnvelope } from '@arena/protocol-core';
import { newCorrelationId, newIdempotencyKey, toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import {
  ACTOR,
  ACTOR_SERVICE,
  AT_EVEN_LATER,
  AT_LATER,
  DIGEST_A,
  DIGEST_B,
  validCaseInput,
} from './test-support.js';

const CORRELATION = toCorrelationId('corr-case-1');
const IDEMPOTENCY = toIdempotencyKey('idem-case-1');

describe('schema registry (positive)', () => {
  it('resolves every schema name to its versioned ref', () => {
    const ref = capabilityCaseSchemaRef('capability-case/case');
    expect(ref).toEqual({ namespace: 'capability-case', name: 'case', version: '1.0.0' });
    expect(isKnownCapabilityCaseSchema(ref)).toBe(true);
    expect(Object.keys(CAPABILITY_CASE_SCHEMAS).length).toBe(29);
  });

  it('unknown schema names fail closed (negative)', () => {
    expect(() =>
      capabilityCaseSchemaRef('capability-case/not-a-schema' as never),
    ).toThrow(/unknown capability-case protocol schema/);
    expect(
      isKnownCapabilityCaseSchema({ namespace: 'capability-case', name: 'case', version: '9.9.9' }),
    ).toBe(false);
  });
});

describe('commands (idempotency keys REQUIRED — lock rule 17)', () => {
  it('register-case command carries the case and the registrar', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const envelope = makeRegisterCaseCommand(
      { caseRecord: draft, registrar: ACTOR },
      { correlationId: CORRELATION, idempotencyKey: IDEMPOTENCY },
    );
    expect(envelope.kind).toBe('command');
    expect(envelope.idempotencyKey).toBe(IDEMPOTENCY);
    expect(envelope.schema).toBe('arena:schema/capability-case/register-case-command@1.0.0');
    expect(envelope.payload.caseRecord.digest).toBe(draft.digest);
  });

  it('the transition commands carry intent inputs', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const base = { correlationId: CORRELATION, idempotencyKey: IDEMPOTENCY };
    const submit = makeSubmitCaseCommand(
      { currentStateDigest: draft.digest, at: AT_LATER, actor: ACTOR },
      base,
    );
    expect(submit.schema).toBe('arena:schema/capability-case/submit-case-command@1.0.0');
    const triage = makeTriageCaseCommand(
      { currentStateDigest: draft.digest, at: AT_LATER, actor: ACTOR_SERVICE, note: 'rationale' },
      base,
    );
    expect(triage.schema).toContain('triage-case-command');
    const activate = makeActivateCaseCommand(
      { currentStateDigest: draft.digest, at: AT_LATER, actor: ACTOR_SERVICE },
      base,
    );
    expect(activate.schema).toContain('activate-case-command');
    const resolve = makeResolveCaseCommand(
      { currentStateDigest: draft.digest, at: AT_LATER, actor: ACTOR_SERVICE, resolution: 'done' },
      base,
    );
    expect(resolve.schema).toContain('resolve-case-command');
    const supersede = makeSupersedeCaseCommand(
      {
        currentStateDigest: draft.digest,
        at: AT_LATER,
        actor: ACTOR,
        superseding: toCaseVersionRef({
          tenant: 'tenant-a',
          caseId: 'case-review-invoices',
          version: '2.0.0',
          digest: DIGEST_A,
        }),
      },
      base,
    );
    expect(supersede.schema).toContain('supersede-case-command');
    const attach = makeAttachEvidenceCommand(
      {
        currentStateDigest: draft.digest,
        at: AT_LATER,
        actor: ACTOR,
        evidence: [{ digest: DIGEST_B, description: 'more evidence' }],
      },
      base,
    );
    expect(attach.schema).toContain('attach-evidence-command');
    for (const envelope of [submit, triage, activate, resolve, supersede, attach]) {
      expect(envelope.kind).toBe('command');
      expect(envelope.idempotencyKey).toBe(IDEMPOTENCY);
    }
  });

  it('events are constructable (no idempotency key required)', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const registered = makeCaseRegisteredEvent(
      { caseRecord: draft, event: draft.lifecycle[0]! },
      { correlationId: CORRELATION },
    );
    expect(registered.kind).toBe('event');
    expect(registered.idempotencyKey).toBeNull();
    expect(registered.schema).toContain('case-registered-event');

    const submitted = await submitCase(draft, { at: AT_LATER, actor: ACTOR });
    const submittedEvent = makeCaseRegisteredEvent(
      { caseRecord: submitted, event: submitted.lifecycle[1]! },
      { correlationId: CORRELATION },
    );
    expect(submittedEvent.payload.caseRecord.status).toBe('submitted');
  });

  it('compilation-target-derived events carry the target', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const submitted = await submitCase(draft, { at: AT_LATER, actor: ACTOR });
    const triaged = await triageCase(submitted, {
      at: AT_LATER,
      actor: ACTOR_SERVICE,
      note: 'ready',
    });
    const target = await deriveCompilationTarget(triaged, { derivedAt: AT_EVEN_LATER });
    const envelope = makeCompilationTargetDerivedEvent(
      { target, derivedBy: ACTOR_SERVICE },
      { correlationId: CORRELATION },
    );
    expect(envelope.schema).toContain('compilation-target-derived-event');
    expect(envelope.payload.target.digest).toBe(target.digest);
  });
});

describe('command validation (negative)', () => {
  const base = { correlationId: CORRELATION, idempotencyKey: IDEMPOTENCY };

  it('commands WITHOUT an idempotency key are rejected (lock rule 17)', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    expect(() =>
      makeRegisterCaseCommand({ caseRecord: draft, registrar: ACTOR }, {
        correlationId: CORRELATION,
      }),
    ).toThrow(/idempotency key/);
    expect(() =>
      makeSubmitCaseCommand(
        { currentStateDigest: draft.digest, at: AT_LATER, actor: ACTOR },
        { correlationId: CORRELATION },
      ),
    ).toThrow(/idempotency key/);
  });

  it('invalid payloads are rejected', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    expect(() =>
      makeRegisterCaseCommand(
        { caseRecord: { ...draft, digest: 'nope' } as never, registrar: ACTOR },
        base,
      ),
    ).toThrow(/structurally valid case/);
    expect(() =>
      makeSubmitCaseCommand(
        { currentStateDigest: 'not-a-digest', at: AT_LATER, actor: ACTOR },
        base,
      ),
    ).toThrow(/sha256 state digest/);
    expect(() =>
      makeSubmitCaseCommand(
        {
          currentStateDigest: draft.digest,
          at: AT_LATER,
          actor: { type: 'model', tenant: 'tenant-a', principalId: 'x' },
        },
        base,
      ),
    ).toThrow(/valid principal/);
    expect(() =>
      makeTriageCaseCommand(
        { currentStateDigest: draft.digest, at: AT_LATER, actor: ACTOR_SERVICE, note: '' },
        base,
      ),
    ).toThrow(/non-empty rationale note/);
    expect(() =>
      makeResolveCaseCommand(
        { currentStateDigest: draft.digest, at: AT_LATER, actor: ACTOR_SERVICE, resolution: '' },
        base,
      ),
    ).toThrow(/non-empty resolution/);
    expect(() =>
      makeSupersedeCaseCommand(
        {
          currentStateDigest: draft.digest,
          at: AT_LATER,
          actor: ACTOR,
          superseding: { tenant: 'x', caseId: 'y', version: '1.0.0', digest: 'z' },
        },
        base,
      ),
    ).toThrow(/superseding case version ref/);
    expect(() =>
      makeAttachEvidenceCommand(
        { currentStateDigest: draft.digest, at: AT_LATER, actor: ACTOR, evidence: [] },
        base,
      ),
    ).toThrow(/at least one valid evidence ref/);
    expect(() =>
      makeAttachEvidenceCommand(
        {
          currentStateDigest: draft.digest,
          at: AT_LATER,
          actor: ACTOR,
          evidence: [{ digest: 'nope', description: 'x' }],
        },
        base,
      ),
    ).toThrow(/valid evidence ref/);
  });
});

describe('parsing and verification (positive + negative)', () => {
  it('round-trips an envelope with schema pinning', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const envelope = makeRegisterCaseCommand(
      { caseRecord: draft, registrar: ACTOR },
      { correlationId: CORRELATION, idempotencyKey: IDEMPOTENCY },
    );
    const raw = serializeEnvelope(envelope);
    const parsed = parseCapabilityCaseEnvelope<RegisterCaseCommandPayload>(
      raw,
      'capability-case/register-case-command',
    );
    expect(parsed.id).toBe(envelope.id);
    expect(parsed.payload.caseRecord.digest).toBe(draft.digest);
  });

  it('schema mismatches are rejected (negative)', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const envelope = makeRegisterCaseCommand(
      { caseRecord: draft, registrar: ACTOR },
      { correlationId: CORRELATION, idempotencyKey: IDEMPOTENCY },
    );
    const raw = serializeEnvelope(envelope);
    expect(() =>
      parseCapabilityCaseEnvelope(raw, 'capability-case/submit-case-command'),
    ).toThrow(/does not match expected/);
  });

  it('the envelope digest verifies and detects tampering', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const envelope = makeRegisterCaseCommand(
      { caseRecord: draft, registrar: ACTOR },
      { correlationId: CORRELATION, idempotencyKey: newIdempotencyKey() },
    );
    const raw = serializeEnvelope(envelope);
    const digest = await capabilityCaseEnvelopeDigest(envelope);
    await expect(verifyCapabilityCaseEnvelope(raw, digest)).resolves.toBeDefined();
    const tamperedRaw = raw.replace('"kind":"command"', '"kind":"event"');
    if (tamperedRaw !== raw) {
      await expect(verifyCapabilityCaseEnvelope(tamperedRaw, digest)).rejects.toThrow();
    }
  });

  it('fresh correlation ids are generatable (wiring sanity)', () => {
    expect(newCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
