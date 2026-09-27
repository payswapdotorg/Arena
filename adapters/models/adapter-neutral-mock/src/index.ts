/**
 * @arena/adapter-neutral-mock — reference SubstrateAdapter implementation
 * (Work Order A016; requirement R19; architecture-lock rule 10;
 * docs/architecture.md §17).
 *
 * A fully capable DETERMINISTIC mock adapter: it registers any neutral
 * substrate descriptor that fits its declared capability envelope,
 * materializing the CognitiveSubstrate-shaped record through
 * @arena/model-substrate's validated constructor (the adapter contributes
 * its own identity — provider semantics stay behind this boundary). Zero
 * external runtime dependencies; NO provider SDK — real provider adapters
 * ship later per deployment tier.
 *
 * All outputs are deterministic: the same config and inputs always yield
 * the same descriptor digest, substrate digests, capability profile and
 * (with an injected clock) health reports.
 */

import type { CognitiveSubstrate } from '@arena/model-substrate';
import {
  MODEL_SUBSTRATE_PROTOCOL_VERSION,
  type AdapterDescriptor,
  type AdapterHealthReport,
  type SubstrateAdapter,
  type SubstrateCapabilityProfile,
  adapterDescriptorDigest,
  assertRegistrationWithinAdapterEnvelope,
  createAdapterDescriptor,
  createSubstrateRecord,
  toAdapterHealthReport,
  toSubstrateCapabilityProfile,
  toSubstrateRegistrationDescriptor,
} from '@arena/model-substrate';

/** Neutral adapter id of this reference implementation. */
export const NEUTRAL_MOCK_ADAPTER_ID = 'neutral-mock' as const;

/** Default adapter version of this reference implementation. */
export const NEUTRAL_MOCK_ADAPTER_VERSION = '1.0.0' as const;

/** The capability envelope the neutral mock declares (neutral units). */
export const NEUTRAL_MOCK_ENVELOPE = {
  supportedModalities: [
    'text-input',
    'text-output',
    'structured-input',
    'structured-output',
  ],
  supportedToolCalling: 'function-calling',
  contextCeiling: { maxContextUnits: 200000, maxOutputUnits: 32000 },
} as const;

export interface NeutralMockAdapterConfig {
  /** Adapter semver contributed to every registration. Default '1.0.0'. */
  readonly adapterVersion?: string;
  /**
   * Deterministic clock for health reports (UTC ms ISO). Defaults to the
   * real clock; tests inject a fixed value for byte-determinism.
   */
  readonly clock?: () => string;
}

/**
 * Create the neutral-mock reference adapter. Deterministic: two instances
 * built from the same config carry the SAME content-addressed descriptor
 * digest (registry-style dedup).
 */
export async function createNeutralMockAdapter(
  config: NeutralMockAdapterConfig = {},
): Promise<SubstrateAdapter> {
  const adapterVersion = config.adapterVersion ?? NEUTRAL_MOCK_ADAPTER_VERSION;
  const clock = config.clock ?? (() => new Date().toISOString());

  const descriptor: AdapterDescriptor = await createAdapterDescriptor({
    adapterId: NEUTRAL_MOCK_ADAPTER_ID,
    adapterVersion,
    protocolVersion: MODEL_SUBSTRATE_PROTOCOL_VERSION,
    supportedModalities: [...NEUTRAL_MOCK_ENVELOPE.supportedModalities],
    supportedToolCalling: NEUTRAL_MOCK_ENVELOPE.supportedToolCalling,
    contextCeiling: { ...NEUTRAL_MOCK_ENVELOPE.contextCeiling },
  });

  return {
    descriptor,

    async registerSubstrate(registration): Promise<CognitiveSubstrate> {
      // 1. Validate the neutral descriptor (closed shape, neutral charset,
      //    no provider brand names, no credential-shaped fields).
      const validated = toSubstrateRegistrationDescriptor(registration);
      // 2. Enforce the adapter's declared capability envelope (this is the
      //    isolation boundary: what the mock can register is what it
      //    declares — nothing more).
      assertRegistrationWithinAdapterEnvelope(descriptor, validated);
      // 3. Materialize the CognitiveSubstrate-shaped record with the
      //    ADAPTER's identity (adapterId + adapterVersion) contributed here.
      return createSubstrateRecord({
        adapterId: descriptor.adapterId,
        adapterVersion: descriptor.adapterVersion,
        modelFamily: validated.modelFamily,
        modelId: validated.modelId,
        modelRevision: validated.modelRevision,
        modalityProfile: [...validated.modalityProfile],
        toolCallingProfile: validated.toolCallingProfile,
        contextLimits: { ...validated.contextLimits },
        conditions: [...validated.conditions],
      });
    },

    async probeCapabilities(): Promise<SubstrateCapabilityProfile> {
      // The probe reports the adapter's current envelope (deterministic).
      return toSubstrateCapabilityProfile({
        modalityProfile: [...NEUTRAL_MOCK_ENVELOPE.supportedModalities],
        toolCallingProfile: NEUTRAL_MOCK_ENVELOPE.supportedToolCalling,
        contextLimits: { ...NEUTRAL_MOCK_ENVELOPE.contextCeiling },
        conditions: ['stable'],
      });
    },

    async reportHealth(): Promise<AdapterHealthReport> {
      // Integrity self-check: recompute the descriptor digest and compare.
      const recomputed = await adapterDescriptorDigest(descriptor);
      return toAdapterHealthReport({
        status: 'healthy',
        checkedAt: clock(),
        descriptorDigest: descriptor.digest,
        integrityVerified: recomputed === descriptor.digest,
      });
    },
  };
}
