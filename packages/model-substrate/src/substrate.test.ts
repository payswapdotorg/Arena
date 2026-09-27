/**
 * Substrate record tests: construction of the agent-body
 * CognitiveSubstrate shape (all eight AB1.0 items), content addressing and
 * registry-style dedup, the GOLDEN cross-implementation digest (byte-level
 * interop with @arena/agent-body's createCognitiveSubstrate — same
 * canonicalization primitive, same digest-free view), tamper detection,
 * deep freeze, registration descriptor validation.
 */

import { describe, expect, it } from 'vitest';
import { canonicalJson, digestCanonical } from '@arena/protocol-core';
import { ModelSubstrateError } from './errors.js';
import {
  createSubstrateRecord,
  isSubstrateRecord,
  isSubstrateRegistrationDescriptor,
  substrateRecordDigest,
  substrateRecordView,
  substrateRecordViewDigest,
  toSubstrateRegistrationDescriptor,
  verifySubstrateRecord,
} from './substrate.js';
import type { CreateSubstrateRecordInput } from './substrate.js';
import { SUBSTRATE_RECORD_VERSION } from './substrate.js';

const FIXTURE: CreateSubstrateRecordInput = {
  adapterId: 'adapter-reasoning-1',
  adapterVersion: '1.4.0',
  modelFamily: 'reasoner',
  modelId: 'reasoner-general-2',
  modelRevision: 'r7',
  modalityProfile: ['text-input', 'text-output', 'structured-input'],
  toolCallingProfile: 'function-calling',
  contextLimits: { maxContextUnits: 200000, maxOutputUnits: 32000 },
  conditions: ['stable'],
};

/**
 * GOLDEN cross-implementation digest: the value @arena/agent-body's
 * createCognitiveSubstrate produces for the IDENTICAL input (computed once
 * with both implementations side by side; both yield this exact sha256).
 * This pins byte-level interop: any divergence in field set, canonical
 * form or digest computation breaks this test.
 */
const GOLDEN_INTEROP_DIGEST =
  'd1d31e165adf819c123dc60eceb141a989edd31f4b7869f1eab9595b33509890';

describe('createSubstrateRecord (positive)', () => {
  it('identifies all eight spec AB1.0 items', async () => {
    const record = await createSubstrateRecord(FIXTURE);
    expect(record.recordVersion).toBe(SUBSTRATE_RECORD_VERSION);
    expect(record.adapterId).toBe('adapter-reasoning-1'); // 1. provider adapter
    expect(record.modelFamily).toBe('reasoner'); // 2a. family
    expect(record.modelId).toBe('reasoner-general-2'); // 2b. model id
    expect(record.modelRevision).toBe('r7'); // 3. revision
    expect(record.modalityProfile).toEqual(['text-input', 'text-output', 'structured-input']); // 4.
    expect(record.toolCallingProfile).toBe('function-calling'); // 5.
    expect(record.contextLimits).toEqual({ maxContextUnits: 200000, maxOutputUnits: 32000 }); // 6.
    expect(record.adapterVersion).toBe('1.4.0'); // 7. adapter version
    expect(record.integrity.digestAlgorithm).toBe('sha256'); // 8. integrity
    expect(record.integrity.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('GOLDEN interop: matches @arena/agent-body byte-for-byte', async () => {
    const record = await createSubstrateRecord(FIXTURE);
    expect(record.integrity.contentDigest).toBe(GOLDEN_INTEROP_DIGEST);
    // ...and equals an independently recomputed digest over the view.
    expect(await substrateRecordDigest(record)).toBe(GOLDEN_INTEROP_DIGEST);
  });

  it('registry-style dedup: same content ⇒ same digest; different content ⇒ different digest', async () => {
    const a = await createSubstrateRecord(FIXTURE);
    const b = await createSubstrateRecord(FIXTURE);
    const c = await createSubstrateRecord({ ...FIXTURE, modelRevision: 'r8' });
    expect(a.integrity.contentDigest).toBe(b.integrity.contentDigest);
    expect(c.integrity.contentDigest).not.toBe(a.integrity.contentDigest);
  });

  it('the digest commits to the canonical digest-free view', async () => {
    const record = await createSubstrateRecord(FIXTURE);
    const view = substrateRecordView(record);
    expect(await substrateRecordViewDigest(view)).toBe(record.integrity.contentDigest);
    expect(await digestCanonical(view)).toBe(record.integrity.contentDigest);
    // The digest-free view carries no integrity field.
    expect('integrity' in view).toBe(false);
  });

  it('is structurally recognized and deeply frozen', async () => {
    const record = await createSubstrateRecord(FIXTURE);
    expect(isSubstrateRecord(record)).toBe(true);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.modalityProfile)).toBe(true);
    expect(Object.isFrozen(record.contextLimits)).toBe(true);
    expect(Object.isFrozen(record.integrity)).toBe(true);
  });

  it('verification recomputes the integrity digest', async () => {
    const record = await createSubstrateRecord(FIXTURE);
    expect(await verifySubstrateRecord(record)).toBe(record.integrity.contentDigest);
  });

  it('canonical serialization is provider-neutral', async () => {
    const record = await createSubstrateRecord(FIXTURE);
    const serialized = canonicalJson(record);
    for (const banned of ['openai', 'anthropic', 'gpt-', 'claude', 'bearer', 'apiKey']) {
      expect(serialized).not.toContain(banned);
    }
  });

  it('conditions default to empty', async () => {
    const { conditions: _omit, ...rest } = FIXTURE;
    const record = await createSubstrateRecord(rest);
    expect(record.conditions).toEqual([]);
  });
});

describe('createSubstrateRecord (negative — construction fails closed)', () => {
  it('rejects credential-shaped fields (gate 2)', async () => {
    for (const field of ['apiKey', 'token', 'password', 'secret']) {
      const input = { ...FIXTURE, [field]: 'x' } as unknown as CreateSubstrateRecordInput;
      await expect(createSubstrateRecord(input)).rejects.toThrow(/credential-shaped field/);
    }
    await expect(
      createSubstrateRecord({ ...FIXTURE, contextLimits: { apiKey: 'x' } as never }),
    ).rejects.toThrow(/credential-shaped field/);
  });

  it('rejects provider brand names in every identifier (gate 2, lock rule 10)', async () => {
    for (const overrides of [
      { adapterId: 'adapter-openai-1' },
      { modelFamily: 'claude-family' },
      { modelId: 'gpt-4o-mini' },
      { modelRevision: 'anthropic-r1' },
    ]) {
      await expect(createSubstrateRecord({ ...FIXTURE, ...overrides })).rejects.toThrow(
        /provider brand name/,
      );
    }
  });

  it('rejects invalid neutral identifiers and versions', async () => {
    await expect(createSubstrateRecord({ ...FIXTURE, adapterId: 'BAD_ID' })).rejects.toThrow(
      /invalid adapter identifier/,
    );
    await expect(createSubstrateRecord({ ...FIXTURE, adapterVersion: '1.0' })).rejects.toThrow(
      ModelSubstrateError,
    );
    await expect(createSubstrateRecord({ ...FIXTURE, modelFamily: 'X' })).rejects.toThrow(
      /invalid model family/,
    );
    await expect(createSubstrateRecord({ ...FIXTURE, modelId: 'BAD model' })).rejects.toThrow(
      /invalid model id/,
    );
  });

  it('rejects unknown and duplicate modalities / tool levels / conditions', async () => {
    await expect(
      createSubstrateRecord({ ...FIXTURE, modalityProfile: ['smell-input'] }),
    ).rejects.toThrow(/unknown substrate modality/);
    await expect(
      createSubstrateRecord({ ...FIXTURE, modalityProfile: ['text-input', 'text-input'] }),
    ).rejects.toThrow(/duplicate substrate modality/);
    await expect(
      createSubstrateRecord({ ...FIXTURE, modalityProfile: [] }),
    ).rejects.toThrow(/non-empty array/);
    await expect(
      createSubstrateRecord({ ...FIXTURE, toolCallingProfile: 'telepathy' }),
    ).rejects.toThrow(/unknown tool-calling profile/);
    await expect(
      createSubstrateRecord({ ...FIXTURE, conditions: ['stable', 'stable'] }),
    ).rejects.toThrow(/duplicate substrate condition/);
    await expect(
      createSubstrateRecord({ ...FIXTURE, conditions: ['on-fire'] }),
    ).rejects.toThrow(/unknown substrate condition/);
  });

  it('rejects malformed context limits', async () => {
    await expect(
      createSubstrateRecord({ ...FIXTURE, contextLimits: { maxContextUnits: 0, maxOutputUnits: 1 } }),
    ).rejects.toThrow(/context limits/);
    await expect(
      createSubstrateRecord({ ...FIXTURE, contextLimits: { maxContextUnits: 1.5, maxOutputUnits: 1 } }),
    ).rejects.toThrow(/context limits/);
  });

  it('tamper detection: any mutation breaks verification', async () => {
    const record = await createSubstrateRecord(FIXTURE);
    const tampered = {
      ...record,
      modelRevision: 'r999',
    };
    await expect(verifySubstrateRecord(tampered)).rejects.toThrow(/integrity mismatch/);
    expect(isSubstrateRecord(tampered)).toBe(true); // still structurally valid
  });
});

describe('registration descriptors (gate 2 input shape)', () => {
  it('validates and freezes a neutral registration descriptor', () => {
    const descriptor = toSubstrateRegistrationDescriptor({
      modelFamily: 'reasoner',
      modelId: 'reasoner-general-2',
      modelRevision: 'r7',
      modalityProfile: ['text-input', 'text-output'],
      toolCallingProfile: 'json-schema',
      contextLimits: { maxContextUnits: 1000, maxOutputUnits: 100 },
      conditions: ['stable'],
    });
    expect(isSubstrateRegistrationDescriptor(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(descriptor.conditions).toEqual(['stable']);
  });

  it('rejects unknown fields (closed shape)', () => {
    expect(() =>
      toSubstrateRegistrationDescriptor({
        modelFamily: 'reasoner',
        modelId: 'r-2',
        modelRevision: 'r7',
        modalityProfile: ['text-input'],
        toolCallingProfile: 'none',
        contextLimits: { maxContextUnits: 10, maxOutputUnits: 1 },
        providerModelName: 'gpt-4o', // unknown field — provider semantics stay behind the adapter
      } as never),
    ).toThrow(/unknown registration descriptor field/);
  });

  it('rejects provider names, credentials, unknown vocabularies', () => {
    expect(() =>
      toSubstrateRegistrationDescriptor({
        modelFamily: 'claude-family',
        modelId: 'r-2',
        modelRevision: 'r7',
        modalityProfile: ['text-input'],
        toolCallingProfile: 'none',
        contextLimits: { maxContextUnits: 10, maxOutputUnits: 1 },
      }),
    ).toThrow(/provider brand name/);
    expect(() =>
      toSubstrateRegistrationDescriptor({
        modelFamily: 'reasoner',
        modelId: 'r-2',
        modelRevision: 'r7',
        modalityProfile: ['text-input'],
        toolCallingProfile: 'none',
        contextLimits: { maxContextUnits: 10, maxOutputUnits: 1 },
        conditions: ['preview'],
        apiKey: 'sk-1',
      } as never),
    ).toThrow(/credential-shaped field/);
    expect(() =>
      toSubstrateRegistrationDescriptor({
        modelFamily: 'reasoner',
        modelId: 'r-2',
        modelRevision: 'r7',
        modalityProfile: ['telepathy'],
        toolCallingProfile: 'none',
        contextLimits: { maxContextUnits: 10, maxOutputUnits: 1 },
      }),
    ).toThrow(/unknown substrate modality/);
  });
});
