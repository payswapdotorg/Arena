/**
 * @arena/adapter-offline-stub — reference SubstrateAdapter implementation
 * (Work Order A016; requirement R19; architecture-lock rule 10;
 * docs/architecture.md §17).
 *
 * A fixed OFFLINE-CATALOG stub: exactly one offline model family with a
 * closed catalog of registrable entries. Registrations must match a
 * catalog entry EXACTLY (family, id, revision) and fit the offline
 * envelope — the stub is the isolation boundary, and it is deliberately
 * more restrictive than the neutral mock: text-only modalities,
 * text-protocol tool calling, small context limits. Zero external runtime
 * dependencies; NO provider SDK; all outputs deterministic.
 */

import type {
  AdapterDescriptor,
  AdapterHealthReport,
  CognitiveSubstrate,
  SubstrateAdapter,
  SubstrateCapabilityProfile,
  SubstrateRegistrationDescriptor,
} from '@arena/model-substrate';
import {
  MODEL_SUBSTRATE_ERROR_CODES,
  MODEL_SUBSTRATE_PROTOCOL_VERSION,
  ModelSubstrateError,
  adapterDescriptorDigest,
  assertRegistrationWithinAdapterEnvelope,
  createAdapterDescriptor,
  createSubstrateRecord,
  toAdapterHealthReport,
  toSubstrateCapabilityProfile,
  toSubstrateRegistrationDescriptor,
} from '@arena/model-substrate';

/** Neutral adapter id of this reference implementation. */
export const OFFLINE_STUB_ADAPTER_ID = 'offline-stub' as const;

/** Default adapter version of this reference implementation. */
export const OFFLINE_STUB_ADAPTER_VERSION = '1.0.0' as const;

/** The offline envelope (deliberately restricted: text, small limits). */
export const OFFLINE_STUB_ENVELOPE = {
  supportedModalities: ['text-input', 'text-output'],
  supportedToolCalling: 'text-protocol',
  contextCeiling: { maxContextUnits: 8192, maxOutputUnits: 4096 },
} as const;

/** A fixed catalog entry the offline stub can register. */
export interface OfflineStubCatalogEntry {
  readonly modelFamily: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly toolCallingProfile: 'none' | 'text-protocol';
  readonly conditions: readonly string[];
}

/** The closed offline catalog — the only registrable substrates. */
export const OFFLINE_STUB_CATALOG: readonly OfflineStubCatalogEntry[] = Object.freeze([
  Object.freeze({
    modelFamily: 'offline-reasoner',
    modelId: 'offline-stub-1',
    modelRevision: 'r1',
    toolCallingProfile: 'text-protocol',
    conditions: ['stable'],
  }),
  Object.freeze({
    modelFamily: 'offline-reasoner',
    modelId: 'offline-stub-1',
    modelRevision: 'r2',
    toolCallingProfile: 'none',
    conditions: ['stable', 'capacity-constrained'],
  }),
]);

export interface OfflineStubAdapterConfig {
  /** Adapter semver contributed to every registration. Default '1.0.0'. */
  readonly adapterVersion?: string;
  /** Deterministic clock for health reports (UTC ms ISO). */
  readonly clock?: () => string;
}

/**
 * Create the offline-stub reference adapter. Deterministic: the same
 * config always yields the same content-addressed descriptor digest.
 */
export async function createOfflineStubAdapter(
  config: OfflineStubAdapterConfig = {},
): Promise<SubstrateAdapter> {
  const adapterVersion = config.adapterVersion ?? OFFLINE_STUB_ADAPTER_VERSION;
  const clock = config.clock ?? (() => new Date().toISOString());

  const descriptor: AdapterDescriptor = await createAdapterDescriptor({
    adapterId: OFFLINE_STUB_ADAPTER_ID,
    adapterVersion,
    protocolVersion: MODEL_SUBSTRATE_PROTOCOL_VERSION,
    supportedModalities: [...OFFLINE_STUB_ENVELOPE.supportedModalities],
    supportedToolCalling: OFFLINE_STUB_ENVELOPE.supportedToolCalling,
    contextCeiling: { ...OFFLINE_STUB_ENVELOPE.contextCeiling },
  });

  function catalogEntryFor(
    registration: SubstrateRegistrationDescriptor,
  ): OfflineStubCatalogEntry {
    for (const entry of OFFLINE_STUB_CATALOG) {
      if (
        entry.modelFamily === registration.modelFamily &&
        entry.modelId === registration.modelId &&
        entry.modelRevision === registration.modelRevision
      ) {
        return entry;
      }
    }
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_SUBSTRATE, {
      message: `offline-stub registers catalog entries only: ${registration.modelFamily}/${registration.modelId}@${registration.modelRevision} is not in the offline catalog (families/ids/revisions must match a catalog entry exactly)`,
      details: {
        requested: `${registration.modelFamily}/${registration.modelId}@${registration.modelRevision}`,
        catalog: OFFLINE_STUB_CATALOG.map(
          (entry) => `${entry.modelFamily}/${entry.modelId}@${entry.modelRevision}`,
        ),
      },
    });
  }

  return {
    descriptor,

    async registerSubstrate(registration): Promise<CognitiveSubstrate> {
      // 1. Validate the neutral descriptor (closed shape, neutral charset,
      //    no provider brand names, no credential-shaped fields).
      const validated = toSubstrateRegistrationDescriptor(registration);
      // 2. The offline catalog is the isolation boundary: only exact
      //    catalog entries are registrable.
      const entry = catalogEntryFor(validated);
      // 3. Enforce the offline envelope.
      assertRegistrationWithinAdapterEnvelope(descriptor, validated);
      // 4. Materialize the CognitiveSubstrate-shaped record with the
      //    ADAPTER's identity. The stub pins the entry's tool-calling
      //    profile and conditions (catalog truth wins over the request).
      return createSubstrateRecord({
        adapterId: descriptor.adapterId,
        adapterVersion: descriptor.adapterVersion,
        modelFamily: entry.modelFamily,
        modelId: entry.modelId,
        modelRevision: entry.modelRevision,
        modalityProfile: [...validated.modalityProfile],
        toolCallingProfile: entry.toolCallingProfile,
        contextLimits: { ...validated.contextLimits },
        conditions: [...entry.conditions],
      });
    },

    async probeCapabilities(): Promise<SubstrateCapabilityProfile> {
      // The offline baseline profile (deterministic).
      return toSubstrateCapabilityProfile({
        modalityProfile: [...OFFLINE_STUB_ENVELOPE.supportedModalities],
        toolCallingProfile: OFFLINE_STUB_ENVELOPE.supportedToolCalling,
        contextLimits: { ...OFFLINE_STUB_ENVELOPE.contextCeiling },
        conditions: ['stable', 'capacity-constrained'],
      });
    },

    async reportHealth(): Promise<AdapterHealthReport> {
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
