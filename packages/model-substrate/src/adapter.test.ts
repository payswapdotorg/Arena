/**
 * SubstrateAdapter protocol tests: AdapterDescriptor content addressing and
 * registry-style dedup, protocol version pinning, capability probing,
 * health/integrity reporting, and adapter-envelope enforcement.
 */

import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import { ModelSubstrateError } from './errors.js';
import {
  ADAPTER_HEALTH_STATUSES,
  adapterDescriptorDigest,
  adapterDescriptorView,
  assertRegistrationWithinAdapterEnvelope,
  createAdapterDescriptor,
  isAdapterDescriptor,
  isAdapterHealthReport,
  isSubstrateCapabilityProfile,
  toAdapterHealthReport,
  toSubstrateCapabilityProfile,
  verifyAdapterDescriptor,
} from './adapter.js';
import type { CreateAdapterDescriptorInput } from './adapter.js';
import { MODEL_SUBSTRATE_PROTOCOL_VERSION } from './version.js';
import { toSubstrateRegistrationDescriptor } from './substrate.js';

const DESCRIPTOR_INPUT: CreateAdapterDescriptorInput = {
  adapterId: 'neutral-mock',
  adapterVersion: '1.0.0',
  protocolVersion: MODEL_SUBSTRATE_PROTOCOL_VERSION,
  supportedModalities: ['text-input', 'text-output', 'structured-input', 'structured-output'],
  supportedToolCalling: 'function-calling',
  contextCeiling: { maxContextUnits: 200000, maxOutputUnits: 32000 },
};

describe('createAdapterDescriptor (positive)', () => {
  it('content-addresses the descriptor: same input ⇒ same digest (registry-style dedup)', async () => {
    const a = await createAdapterDescriptor(DESCRIPTOR_INPUT);
    const b = await createAdapterDescriptor(DESCRIPTOR_INPUT);
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await adapterDescriptorDigest(a)).toBe(a.digest);
  });

  it('different input ⇒ different digest', async () => {
    const a = await createAdapterDescriptor(DESCRIPTOR_INPUT);
    const b = await createAdapterDescriptor({
      ...DESCRIPTOR_INPUT,
      adapterVersion: '1.1.0',
    });
    expect(a.digest).not.toBe(b.digest);
  });

  it('carries the adapter version identity and is deeply frozen', async () => {
    const descriptor = await createAdapterDescriptor(DESCRIPTOR_INPUT);
    expect(descriptor.adapterId).toBe('neutral-mock');
    expect(descriptor.adapterVersion).toBe('1.0.0');
    expect(descriptor.protocolVersion).toBe(MODEL_SUBSTRATE_PROTOCOL_VERSION);
    expect(descriptor.supportedToolCalling).toBe('function-calling');
    expect(isAdapterDescriptor(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.supportedModalities)).toBe(true);
    expect(Object.isFrozen(descriptor.contextCeiling)).toBe(true);
    // The digest-free view commits to exactly the identity + envelope.
    const view = adapterDescriptorView(descriptor);
    expect('digest' in view).toBe(false);
    expect(view.adapterId).toBe('neutral-mock');
  });

  it('verification recomputes the digest', async () => {
    const descriptor = await createAdapterDescriptor(DESCRIPTOR_INPUT);
    expect(await verifyAdapterDescriptor(descriptor)).toBe(descriptor.digest);
  });

  it('canonical serialization is provider-neutral', async () => {
    const descriptor = await createAdapterDescriptor(DESCRIPTOR_INPUT);
    const serialized = canonicalJson(descriptor);
    for (const banned of ['openai', 'anthropic', 'gpt-', 'claude', 'bearer', 'apiKey']) {
      expect(serialized).not.toContain(banned);
    }
  });
});

describe('createAdapterDescriptor (negative — fails closed)', () => {
  it('rejects a protocol version this build does not implement (closed version policy)', async () => {
    await expect(
      createAdapterDescriptor({ ...DESCRIPTOR_INPUT, protocolVersion: '2.0.0' }),
    ).rejects.toThrow(/closed version policy/);
    await expect(
      createAdapterDescriptor({ ...DESCRIPTOR_INPUT, protocolVersion: '1.0' }),
    ).rejects.toThrow(ModelSubstrateError);
  });

  it('rejects provider brand names and credentials (gate 2)', async () => {
    await expect(
      createAdapterDescriptor({ ...DESCRIPTOR_INPUT, adapterId: 'openai-bridge' }),
    ).rejects.toThrow(/provider brand name/);
    await expect(
      createAdapterDescriptor({ ...DESCRIPTOR_INPUT, apiKey: 'sk-1' } as never),
    ).rejects.toThrow(/credential-shaped field/);
  });

  it('rejects malformed identity, vocabularies and ceiling', async () => {
    await expect(
      createAdapterDescriptor({ ...DESCRIPTOR_INPUT, adapterId: 'BAD_ID' }),
    ).rejects.toThrow(/invalid adapter identifier/);
    await expect(
      createAdapterDescriptor({ ...DESCRIPTOR_INPUT, supportedModalities: [] }),
    ).rejects.toThrow(/non-empty array/);
    await expect(
      createAdapterDescriptor({ ...DESCRIPTOR_INPUT, supportedModalities: ['smell-input'] }),
    ).rejects.toThrow(/unknown substrate modality/);
    await expect(
      createAdapterDescriptor({ ...DESCRIPTOR_INPUT, supportedToolCalling: 'telepathy' }),
    ).rejects.toThrow(/unknown supported tool-calling/);
    await expect(
      createAdapterDescriptor({ ...DESCRIPTOR_INPUT, contextCeiling: { maxContextUnits: 0, maxOutputUnits: 1 } }),
    ).rejects.toThrow(/context ceiling/);
    // Output cannot exceed context.
    await expect(
      createAdapterDescriptor({
        ...DESCRIPTOR_INPUT,
        contextCeiling: { maxContextUnits: 100, maxOutputUnits: 200 },
      }),
    ).rejects.toThrow(/maxOutputUnits may not exceed/);
  });

  it('tamper detection: any mutation breaks verification', async () => {
    const descriptor = await createAdapterDescriptor(DESCRIPTOR_INPUT);
    const tampered = { ...descriptor, adapterVersion: '9.9.9' };
    await expect(verifyAdapterDescriptor(tampered)).rejects.toThrow(/integrity mismatch/);
  });
});

describe('capability profiles (probe output)', () => {
  it('validates and freezes; guard recognizes them', () => {
    const profile = toSubstrateCapabilityProfile({
      modalityProfile: ['text-input', 'text-output'],
      toolCallingProfile: 'json-schema',
      contextLimits: { maxContextUnits: 1000, maxOutputUnits: 100 },
      conditions: ['stable'],
    });
    expect(isSubstrateCapabilityProfile(profile)).toBe(true);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(profile.conditions).toEqual(['stable']);
  });

  it('rejects unknown statuses of shape (negative)', () => {
    expect(() =>
      toSubstrateCapabilityProfile({
        modalityProfile: [],
        toolCallingProfile: 'json-schema',
        contextLimits: { maxContextUnits: 1, maxOutputUnits: 1 },
      }),
    ).toThrow(/non-empty array/);
    expect(() =>
      toSubstrateCapabilityProfile({
        modalityProfile: ['text-input'],
        toolCallingProfile: 'nope',
        contextLimits: { maxContextUnits: 1, maxOutputUnits: 1 },
      }),
    ).toThrow(/unknown tool-calling profile/);
    expect(() =>
      toSubstrateCapabilityProfile({
        modalityProfile: ['text-input'],
        toolCallingProfile: 'none',
        contextLimits: { maxContextUnits: 1, maxOutputUnits: 1 },
        conditions: ['unknown-condition'],
      }),
    ).toThrow(/unknown substrate condition/);
    expect(isSubstrateCapabilityProfile({ recordVersion: 1 })).toBe(false);
  });
});

describe('health reports', () => {
  it('validates and freezes; a failed self-check is well-formed reporting', () => {
    const healthy = toAdapterHealthReport({
      status: 'healthy',
      checkedAt: '2026-01-15T09:30:00.000Z',
      descriptorDigest: 'a'.repeat(64),
      integrityVerified: true,
    });
    expect(isAdapterHealthReport(healthy)).toBe(true);
    expect(Object.isFrozen(healthy)).toBe(true);
    // A FAILED self-check is still a valid report (fail-closed reporting).
    const failed = toAdapterHealthReport({
      status: 'degraded',
      checkedAt: '2026-01-15T09:30:00.000Z',
      descriptorDigest: 'a'.repeat(64),
      integrityVerified: false,
    });
    expect(isAdapterHealthReport(failed)).toBe(true);
    expect(failed.integrityVerified).toBe(false);
    expect(ADAPTER_HEALTH_STATUSES).toEqual(['healthy', 'degraded', 'unavailable']);
  });

  it('rejects malformed reports (negative)', () => {
    expect(() =>
      toAdapterHealthReport({
        status: 'on-fire',
        checkedAt: '2026-01-15T09:30:00.000Z',
        descriptorDigest: 'a'.repeat(64),
        integrityVerified: true,
      }),
    ).toThrow(/unknown adapter health status/);
    expect(() =>
      toAdapterHealthReport({
        status: 'healthy',
        checkedAt: '2026-01-15T09:30:00Z',
        descriptorDigest: 'a'.repeat(64),
        integrityVerified: true,
      }),
    ).toThrow(/timestamp/);
    expect(() =>
      toAdapterHealthReport({
        status: 'healthy',
        checkedAt: '2026-01-15T09:30:00.000Z',
        descriptorDigest: 'not-a-digest',
        integrityVerified: true,
      }),
    ).toThrow(/descriptor digest/);
    expect(() =>
      toAdapterHealthReport({
        status: 'healthy',
        checkedAt: '2026-01-15T09:30:00.000Z',
        descriptorDigest: 'a'.repeat(64),
        integrityVerified: 'yes' as never,
      }),
    ).toThrow(/integrityVerified/);
    expect(isAdapterHealthReport({})).toBe(false);
  });
});

describe('adapter-envelope enforcement (gate 2: provider semantics stay behind the adapter)', () => {
  it('accepts a registration within the envelope (positive)', async () => {
    const adapter = await createAdapterDescriptor(DESCRIPTOR_INPUT);
    const registration = toSubstrateRegistrationDescriptor({
      modelFamily: 'reasoner',
      modelId: 'reasoner-1',
      modelRevision: 'r1',
      modalityProfile: ['text-input', 'text-output'],
      toolCallingProfile: 'json-schema',
      contextLimits: { maxContextUnits: 1000, maxOutputUnits: 100 },
    });
    expect(() => assertRegistrationWithinAdapterEnvelope(adapter, registration)).not.toThrow();
  });

  it('rejects modalities, tool levels and limits beyond the envelope', async () => {
    const adapter = await createAdapterDescriptor(DESCRIPTOR_INPUT);
    const base = {
      modelFamily: 'reasoner',
      modelId: 'reasoner-1',
      modelRevision: 'r1',
      modalityProfile: ['text-input'],
      toolCallingProfile: 'none',
      contextLimits: { maxContextUnits: 1000, maxOutputUnits: 100 },
    };
    expect(() =>
      assertRegistrationWithinAdapterEnvelope(
        adapter,
        toSubstrateRegistrationDescriptor({ ...base, modalityProfile: ['audio-input'] }),
      ),
    ).toThrow(/does not support modality/);
    expect(() =>
      assertRegistrationWithinAdapterEnvelope(
        adapter,
        toSubstrateRegistrationDescriptor(base),
      ),
    ).not.toThrow();
    expect(() =>
      assertRegistrationWithinAdapterEnvelope(
        adapter,
        toSubstrateRegistrationDescriptor({ ...base, contextLimits: { maxContextUnits: 999999, maxOutputUnits: 100 } }),
      ),
    ).toThrow(/context limits of at most/);
  });
});
