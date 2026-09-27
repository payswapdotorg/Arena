/**
 * SubstrateAdapter protocol — the versioned, provider-neutral adapter
 * interface for registering Cognitive Substrates (Work Order A016; spec
 * AB1.0; architecture-lock rules 2, 10; requirement R19;
 * docs/architecture.md §17 "External providers and models interact via
 * adapters. Provider-specific semantics never enter Arena kernel
 * contracts.").
 *
 * This module is PURE TYPES + VALIDATORS — no I/O, no clock, no network,
 * zero provider knowledge. A SubstrateAdapter implementation (see
 * adapters/models/* for the reference adapters):
 *
 *   - carries a content-addressed `descriptor` (AdapterDescriptor: neutral
 *     adapter id, adapter semver, the protocol surface version it
 *     implements, and the capability envelope it can register);
 *   - `registerSubstrate(descriptor)` validates a neutral registration
 *     descriptor against its envelope and materializes a
 *     CognitiveSubstrate-shaped record (via createSubstrateRecord — the
 *     adapter contributes its OWN adapterId/adapterVersion identity);
 *   - `probeCapabilities()` reports the modality / tool-calling / context
 *     profiles the adapter currently offers;
 *   - `reportHealth()` reports health and the result of the adapter's
 *     integrity self-check (descriptor digest re-verification).
 *
 * NO provider strings anywhere: adapter descriptors reject provider brand
 * names and credential-shaped fields exactly like @arena/agent-body's
 * substrates (the screening conventions are vendored in ./shared.ts and
 * parity-pinned against contracts/agent-body).
 */

import { digestCanonical } from '@arena/protocol-core';
import type {
  SubstrateCondition,
  SubstrateContextLimits,
  SubstrateModality,
  ToolCallingLevel,
} from '@arena/agent-body';
import { MODEL_SUBSTRATE_ERROR_CODES, ModelSubstrateError } from './errors.js';
import type {
  CreateSubstrateRegistrationDescriptorInput,
  SubstrateRegistrationDescriptor,
} from './substrate.js';
import type { CognitiveSubstrate } from '@arena/agent-body';
import { MODEL_SUBSTRATE_PROTOCOL_VERSION } from './version.js';
import {
  TOOL_CALLING_LEVELS,
  assertNoCredentialFields,
  assertProviderNeutralString,
  deepFreeze,
  isContentDigest,
  isModelSubstrateSemver,
  isNeutralId,
  isSubstrateCondition,
  isSubstrateModality,
  isTimestampView,
  isToolCallingLevel,
  toolCallingLevelIndex,
} from './shared.js';
import { SUBSTRATE_MAX_UNITS_LIMIT, isContextLimits } from './substrate.js';

// ---------------------------------------------------------------------------
// AdapterDescriptor — the content-addressed identity of an adapter build
// ---------------------------------------------------------------------------

/** Wire version of the adapter descriptor shape. */
export const ADAPTER_DESCRIPTOR_RECORD_VERSION = 1 as const;

/** Digest-free view of an adapter descriptor — what the digest commits to. */
export interface AdapterDescriptorView {
  readonly recordVersion: typeof ADAPTER_DESCRIPTOR_RECORD_VERSION;
  /** Neutral adapter identifier (the isolation boundary id; never a provider brand). */
  readonly adapterId: string;
  /** Adapter semver — the adapter's version identity. */
  readonly adapterVersion: string;
  /** Protocol surface version this adapter implements (must equal the package protocol version). */
  readonly protocolVersion: string;
  /** Modalities the adapter can register on behalf of its provider. */
  readonly supportedModalities: readonly SubstrateModality[];
  /** Highest tool-calling level the adapter can register. */
  readonly supportedToolCalling: ToolCallingLevel;
  /** Ceiling on context limits the adapter will register (native units). */
  readonly contextCeiling: SubstrateContextLimits;
}

export interface AdapterDescriptor extends AdapterDescriptorView {
  /** sha256 content digest over the canonical digest-free view. */
  readonly digest: string;
}

export interface CreateAdapterDescriptorInput {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly protocolVersion: string;
  readonly supportedModalities: readonly string[];
  readonly supportedToolCalling: string;
  readonly contextCeiling: { maxContextUnits: number; maxOutputUnits: number };
}

function invalidDescriptor(message: string, details?: Record<string, unknown>): never {
  throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_ADAPTER_DESCRIPTOR, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/**
 * Create an immutable, content-addressed AdapterDescriptor. The descriptor
 * is registry-style dedupable: the SAME input always yields the SAME digest
 * (test), and any different input yields a different digest. The protocol
 * version must be exactly the one this build implements
 * (MODEL_SUBSTRATE_UNSUPPORTED_VERSION otherwise — adapters from unknown
 * protocol surfaces are rejected, mirroring the core's closed version
 * policy).
 */
export async function createAdapterDescriptor(
  input: CreateAdapterDescriptorInput,
): Promise<AdapterDescriptor> {
  assertNoCredentialFields(input, 'adapterDescriptor');

  if (typeof input.adapterId !== 'string' || !isNeutralId(input.adapterId)) {
    invalidDescriptor(
      `invalid adapter identifier: ${JSON.stringify(input.adapterId)} (neutral identifier required; provider details remain behind adapters)`,
    );
  }
  assertProviderNeutralString(input.adapterId, 'adapterId');

  const adapterVersion = toSemver(input.adapterVersion);
  assertProviderNeutralString(adapterVersion, 'adapterVersion');

  if (typeof input.protocolVersion !== 'string' || !isModelSubstrateSemver(input.protocolVersion)) {
    invalidDescriptor(
      `invalid protocol version: ${JSON.stringify(input.protocolVersion)} (exact semver required)`,
    );
  }
  if (input.protocolVersion !== MODEL_SUBSTRATE_PROTOCOL_VERSION) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.UNSUPPORTED_VERSION, {
      message: `adapter declares protocol surface ${JSON.stringify(input.protocolVersion)} but this build implements ${MODEL_SUBSTRATE_PROTOCOL_VERSION} (closed version policy)`,
      details: { expected: MODEL_SUBSTRATE_PROTOCOL_VERSION, actual: input.protocolVersion },
    });
  }

  if (!Array.isArray(input.supportedModalities) || input.supportedModalities.length === 0) {
    invalidDescriptor('supportedModalities must be a non-empty array of substrate modalities');
  }
  const seenModalities = new Set<string>();
  const supportedModalities: SubstrateModality[] = input.supportedModalities.map((modality) => {
    if (!isSubstrateModality(modality)) {
      invalidDescriptor(`unknown substrate modality: ${JSON.stringify(modality)}`, {
        known: 'see SUBSTRATE_MODALITIES',
      });
    }
    if (seenModalities.has(modality)) {
      invalidDescriptor(`duplicate supported modality: ${JSON.stringify(modality)}`);
    }
    seenModalities.add(modality);
    return modality;
  });

  if (!isToolCallingLevel(input.supportedToolCalling)) {
    invalidDescriptor(
      `unknown supported tool-calling level: ${JSON.stringify(input.supportedToolCalling)}`,
      { known: [...TOOL_CALLING_LEVELS] },
    );
  }

  if (!isContextLimits(input.contextCeiling)) {
    invalidDescriptor(
      'context ceiling must carry integer maxContextUnits and maxOutputUnits between 1 and ' +
        String(SUBSTRATE_MAX_UNITS_LIMIT),
    );
  }
  if (input.contextCeiling.maxOutputUnits > input.contextCeiling.maxContextUnits) {
    invalidDescriptor(
      'context ceiling maxOutputUnits may not exceed maxContextUnits (an adapter cannot emit more than it can address)',
    );
  }

  const view: AdapterDescriptorView = {
    recordVersion: ADAPTER_DESCRIPTOR_RECORD_VERSION,
    adapterId: input.adapterId,
    adapterVersion,
    protocolVersion: input.protocolVersion,
    supportedModalities: Object.freeze(supportedModalities),
    supportedToolCalling: input.supportedToolCalling,
    contextCeiling: Object.freeze({ ...input.contextCeiling }),
  };

  const digest = toDigestHex(await adapterDescriptorViewDigest(view));
  return deepFreeze({ ...view, digest });
}

function toSemver(value: string): string {
  if (typeof value !== 'string' || !isModelSubstrateSemver(value)) {
    invalidDescriptor(
      `invalid adapter version: ${JSON.stringify(value)} (semver major.minor.patch with optional prerelease)`,
    );
  }
  return value;
}

function toDigestHex(value: string): string {
  if (!isContentDigest(value)) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_DIGEST, {
      message: `invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
    });
  }
  return value;
}

/** sha256 content digest over the canonical serialization of the digest-free view. */
export async function adapterDescriptorViewDigest(view: AdapterDescriptorView): Promise<string> {
  return digestCanonical(view);
}

/** The digest-free view of an adapter descriptor. */
export function adapterDescriptorView(descriptor: AdapterDescriptor): AdapterDescriptorView {
  return {
    recordVersion: descriptor.recordVersion,
    adapterId: descriptor.adapterId,
    adapterVersion: descriptor.adapterVersion,
    protocolVersion: descriptor.protocolVersion,
    supportedModalities: descriptor.supportedModalities,
    supportedToolCalling: descriptor.supportedToolCalling,
    contextCeiling: descriptor.contextCeiling,
  };
}

/** Content address of an adapter descriptor (equals its digest field). */
export async function adapterDescriptorDigest(descriptor: AdapterDescriptor): Promise<string> {
  return adapterDescriptorViewDigest(adapterDescriptorView(descriptor));
}

/** Structural guard for an adapter descriptor. */
export function isAdapterDescriptor(value: unknown): value is AdapterDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === ADAPTER_DESCRIPTOR_RECORD_VERSION &&
    typeof candidate['adapterId'] === 'string' &&
    isNeutralId(candidate['adapterId']) &&
    typeof candidate['adapterVersion'] === 'string' &&
    isModelSubstrateSemver(candidate['adapterVersion']) &&
    typeof candidate['protocolVersion'] === 'string' &&
    isModelSubstrateSemver(candidate['protocolVersion']) &&
    Array.isArray(candidate['supportedModalities']) &&
    candidate['supportedModalities'].length > 0 &&
    candidate['supportedModalities'].every((modality) => isSubstrateModality(modality)) &&
    isToolCallingLevel(candidate['supportedToolCalling']) &&
    isContextLimits(candidate['contextCeiling']) &&
    typeof candidate['digest'] === 'string' &&
    isContentDigest(candidate['digest'])
  );
}

/**
 * Re-compute an adapter descriptor's digest and compare it with the claimed
 * one. FAILS CLOSED with MODEL_SUBSTRATE_TAMPERED on any mismatch.
 */
export async function verifyAdapterDescriptor(descriptor: AdapterDescriptor): Promise<string> {
  if (!isAdapterDescriptor(descriptor)) {
    invalidDescriptor('not a structurally valid adapter descriptor');
  }
  const actual = await adapterDescriptorViewDigest(adapterDescriptorView(descriptor));
  if (actual !== descriptor.digest) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.TAMPERED, {
      message: `adapter descriptor integrity mismatch: expected ${descriptor.digest}, recomputed ${actual}`,
      details: { expected: descriptor.digest, actual },
    });
  }
  return actual;
}

// ---------------------------------------------------------------------------
// Envelope enforcement — a registration must fit the adapter's declared
// capability envelope (provider semantics stay behind the adapter)
// ---------------------------------------------------------------------------

/**
 * Assert that a substrate registration descriptor fits the adapter's
 * declared capability envelope: required modalities must be supported, the
 * tool-calling level must not exceed the adapter's maximum, and the context
 * limits must not exceed the adapter's ceiling. Throws
 * MODEL_SUBSTRATE_CAPABILITY_EXCEEDED otherwise. Pure, neutral validation
 * shared by every SubstrateAdapter implementation.
 */
export function assertRegistrationWithinAdapterEnvelope(
  adapter: AdapterDescriptor,
  registration: SubstrateRegistrationDescriptor,
): void {
  if (!isAdapterDescriptor(adapter)) {
    invalidDescriptor('not a structurally valid adapter descriptor');
  }
  const supported = new Set<string>(adapter.supportedModalities);
  for (const modality of registration.modalityProfile) {
    if (!supported.has(modality)) {
      throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.CAPABILITY_EXCEEDED, {
        message: `adapter ${adapter.adapterId} does not support modality ${JSON.stringify(modality)}`,
        details: { adapterId: adapter.adapterId, modality, supported: [...adapter.supportedModalities] },
      });
    }
  }
  if (toolCallingLevelIndex(registration.toolCallingProfile) > toolCallingLevelIndex(adapter.supportedToolCalling)) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.CAPABILITY_EXCEEDED, {
      message: `adapter ${adapter.adapterId} supports tool-calling at most ${adapter.supportedToolCalling}; registration requests ${registration.toolCallingProfile}`,
      details: {
        adapterId: adapter.adapterId,
        supported: adapter.supportedToolCalling,
        requested: registration.toolCallingProfile,
      },
    });
  }
  if (
    registration.contextLimits.maxContextUnits > adapter.contextCeiling.maxContextUnits ||
    registration.contextLimits.maxOutputUnits > adapter.contextCeiling.maxOutputUnits
  ) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.CAPABILITY_EXCEEDED, {
      message: `adapter ${adapter.adapterId} registers context limits of at most ${String(adapter.contextCeiling.maxContextUnits)}/${String(adapter.contextCeiling.maxOutputUnits)} units; registration requests ${String(registration.contextLimits.maxContextUnits)}/${String(registration.contextLimits.maxOutputUnits)}`,
      details: {
        adapterId: adapter.adapterId,
        ceiling: { ...adapter.contextCeiling },
        requested: { ...registration.contextLimits },
      },
    });
  }
}

// ---------------------------------------------------------------------------
// SubstrateCapabilityProfile — the probeCapabilities() output
// ---------------------------------------------------------------------------

/** Wire version of the capability profile shape. */
export const CAPABILITY_PROFILE_RECORD_VERSION = 1 as const;

/**
 * The modality / tool-calling / context profile reported by
 * `SubstrateAdapter.probeCapabilities()` — the adapter's CURRENT envelope
 * (what it can register/probe right now), in neutral terms.
 */
export interface SubstrateCapabilityProfile {
  readonly recordVersion: typeof CAPABILITY_PROFILE_RECORD_VERSION;
  readonly modalityProfile: readonly SubstrateModality[];
  readonly toolCallingProfile: ToolCallingLevel;
  readonly contextLimits: SubstrateContextLimits;
  readonly conditions: readonly SubstrateCondition[];
}

export interface CreateSubstrateCapabilityProfileInput {
  readonly modalityProfile: readonly string[];
  readonly toolCallingProfile: string;
  readonly contextLimits: { maxContextUnits: number; maxOutputUnits: number };
  readonly conditions?: readonly string[];
}

function invalidProfile(message: string, details?: Record<string, unknown>): never {
  throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_CAPABILITY_PROFILE, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/** Validate and freeze a substrate capability profile (probe output). */
export function toSubstrateCapabilityProfile(
  input: CreateSubstrateCapabilityProfileInput,
): SubstrateCapabilityProfile {
  assertNoCredentialFields(input, 'capabilityProfile');

  if (!Array.isArray(input.modalityProfile) || input.modalityProfile.length === 0) {
    invalidProfile('modality profile must be a non-empty array of substrate modalities');
  }
  const seen = new Set<string>();
  const modalityProfile: SubstrateModality[] = input.modalityProfile.map((modality) => {
    if (!isSubstrateModality(modality)) {
      invalidProfile(`unknown substrate modality: ${JSON.stringify(modality)}`, {
        known: 'see SUBSTRATE_MODALITIES',
      });
    }
    if (seen.has(modality)) {
      invalidProfile(`duplicate modality: ${JSON.stringify(modality)}`);
    }
    seen.add(modality);
    return modality;
  });

  if (!isToolCallingLevel(input.toolCallingProfile)) {
    invalidProfile(
      `unknown tool-calling profile: ${JSON.stringify(input.toolCallingProfile)}`,
      { known: [...TOOL_CALLING_LEVELS] },
    );
  }

  if (!isContextLimits(input.contextLimits)) {
    invalidProfile(
      'context limits must carry integer maxContextUnits and maxOutputUnits between 1 and ' +
        String(SUBSTRATE_MAX_UNITS_LIMIT),
    );
  }

  const conditions: SubstrateCondition[] = (input.conditions ?? []).map((condition) => {
    if (!isSubstrateCondition(condition)) {
      invalidProfile(`unknown substrate condition: ${JSON.stringify(condition)}`, {
        known: 'see SUBSTRATE_CONDITIONS',
      });
    }
    return condition;
  });
  const unique = new Set<SubstrateCondition>(conditions);
  if (unique.size !== conditions.length) {
    invalidProfile('duplicate substrate condition');
  }

  return deepFreeze({
    recordVersion: CAPABILITY_PROFILE_RECORD_VERSION,
    modalityProfile: Object.freeze(modalityProfile),
    toolCallingProfile: input.toolCallingProfile,
    contextLimits: Object.freeze({ ...input.contextLimits }),
    conditions: Object.freeze(conditions),
  });
}

/** Structural guard for a substrate capability profile. */
export function isSubstrateCapabilityProfile(
  value: unknown,
): value is SubstrateCapabilityProfile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === CAPABILITY_PROFILE_RECORD_VERSION &&
    Array.isArray(candidate['modalityProfile']) &&
    candidate['modalityProfile'].length > 0 &&
    candidate['modalityProfile'].every((modality) => isSubstrateModality(modality)) &&
    isToolCallingLevel(candidate['toolCallingProfile']) &&
    isContextLimits(candidate['contextLimits']) &&
    Array.isArray(candidate['conditions']) &&
    candidate['conditions'].every((condition) => isSubstrateCondition(condition))
  );
}

// ---------------------------------------------------------------------------
// AdapterHealthReport — health/integrity reporting
// ---------------------------------------------------------------------------

/** Wire version of the adapter health report shape. */
export const ADAPTER_HEALTH_RECORD_VERSION = 1 as const;

/** Closed health status vocabulary. */
export const ADAPTER_HEALTH_STATUSES = Object.freeze(['healthy', 'degraded', 'unavailable'] as const);
export type AdapterHealthStatus = (typeof ADAPTER_HEALTH_STATUSES)[number];

export function isAdapterHealthStatus(value: unknown): value is AdapterHealthStatus {
  return (
    typeof value === 'string' && (ADAPTER_HEALTH_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Health/integrity report produced by `SubstrateAdapter.reportHealth()`:
 * the adapter's current status, the moment of the check (UTC ms), the
 * content digest of the descriptor the report was produced FOR, and the
 * result of the adapter's integrity self-check (descriptor digest
 * re-verification). A report with `integrityVerified: false` is still a
 * WELL-FORMED report — it reports a failed self-check; consumers decide
 * what to do about it.
 */
export interface AdapterHealthReport {
  readonly recordVersion: typeof ADAPTER_HEALTH_RECORD_VERSION;
  readonly status: AdapterHealthStatus;
  readonly checkedAt: string;
  readonly descriptorDigest: string;
  readonly integrityVerified: boolean;
}

export interface CreateAdapterHealthReportInput {
  readonly status: string;
  readonly checkedAt: string;
  readonly descriptorDigest: string;
  readonly integrityVerified: boolean;
}

function invalidHealth(message: string, details?: Record<string, unknown>): never {
  throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_HEALTH_REPORT, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/** Validate and freeze an adapter health report. */
export function toAdapterHealthReport(input: CreateAdapterHealthReportInput): AdapterHealthReport {
  assertNoCredentialFields(input, 'healthReport');

  if (!isAdapterHealthStatus(input.status)) {
    invalidHealth(`unknown adapter health status: ${JSON.stringify(input.status)}`, {
      known: [...ADAPTER_HEALTH_STATUSES],
    });
  }
  if (typeof input.checkedAt !== 'string' || !isTimestampView(input.checkedAt)) {
    invalidHealth(
      `invalid health check timestamp: ${JSON.stringify(input.checkedAt)} (expected UTC ISO-8601 with exactly millisecond precision)`,
    );
  }
  if (typeof input.descriptorDigest !== 'string' || !isContentDigest(input.descriptorDigest)) {
    invalidHealth(
      `invalid descriptor digest in health report: ${JSON.stringify(input.descriptorDigest)} (expected lowercase sha256 hex)`,
    );
  }
  if (typeof input.integrityVerified !== 'boolean') {
    invalidHealth('integrityVerified must be a boolean');
  }
  return deepFreeze({
    recordVersion: ADAPTER_HEALTH_RECORD_VERSION,
    status: input.status,
    checkedAt: input.checkedAt,
    descriptorDigest: input.descriptorDigest,
    integrityVerified: input.integrityVerified,
  });
}

/** Structural guard for an adapter health report. */
export function isAdapterHealthReport(value: unknown): value is AdapterHealthReport {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === ADAPTER_HEALTH_RECORD_VERSION &&
    typeof candidate['status'] === 'string' &&
    (ADAPTER_HEALTH_STATUSES as readonly string[]).includes(candidate['status']) &&
    typeof candidate['checkedAt'] === 'string' &&
    isTimestampView(candidate['checkedAt']) &&
    typeof candidate['descriptorDigest'] === 'string' &&
    isContentDigest(candidate['descriptorDigest']) &&
    typeof candidate['integrityVerified'] === 'boolean'
  );
}

// ---------------------------------------------------------------------------
// The SubstrateAdapter interface (gate 2)
// ---------------------------------------------------------------------------

/**
 * The versioned, provider-neutral adapter protocol every model adapter
 * implements (requirement R19; architecture-lock rule 10; §17).
 *
 * Contract (all outputs validated by this package's validators):
 *   - `descriptor`            — the adapter's content-addressed version
 *                               identity (AdapterDescriptor; registry-style
 *                               dedup: same descriptor ⇒ same digest).
 *   - `registerSubstrate(descriptor)` — validates the neutral registration
 *                               descriptor (closed shape, neutral charset,
 *                               no provider brand names, no credentials)
 *                               against the adapter envelope and returns a
 *                               CognitiveSubstrate-shaped record carrying
 *                               the ADAPTER's identity.
 *   - `probeCapabilities()`   — modality / tool-calling / context profiles
 *                               currently offered (SubstrateCapabilityProfile).
 *   - `reportHealth()`        — health + descriptor integrity self-check
 *                               (AdapterHealthReport).
 *
 * Implementations MUST be provider-neutral in every canonical value: no
 * provider brand names, no credential material (the validators reject
 * both). Implementations are free to be async; they must be deterministic
 * for identical inputs (the reference adapters are).
 */
export interface SubstrateAdapter {
  /** The adapter's content-addressed identity (neutral, versioned). */
  readonly descriptor: AdapterDescriptor;
  /** Register a substrate through this adapter's isolation boundary. */
  registerSubstrate(
    descriptor: CreateSubstrateRegistrationDescriptorInput,
  ): Promise<CognitiveSubstrate>;
  /** Probe the modality / tool-calling / context profiles currently offered. */
  probeCapabilities(): Promise<SubstrateCapabilityProfile>;
  /** Report health and the adapter's descriptor integrity self-check. */
  reportHealth(): Promise<AdapterHealthReport>;
}

