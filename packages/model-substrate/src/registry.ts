/**
 * SubstrateRegistry — the in-memory, protocol-level registry of substrate
 * registrations (Work Order A016; requirement R19).
 *
 * Semantics (append-only, content-addressed, neutral):
 *
 *   - `register` appends a `SubstrateRegistration` record binding a NEUTRAL
 *     substrate id to a substrate record (by content digest) and the
 *     adapter descriptor that registered it. The registration record itself
 *     is content-addressed (sha256 over its digest-free view).
 *   - Re-registering the SAME substrate digest under the SAME neutral id
 *     with the SAME adapter descriptor is IDEMPOTENT: the existing record is
 *     returned, nothing is appended.
 *   - Registering a DIFFERENT substrate (or a different adapter descriptor)
 *     under an ALREADY-USED neutral id is a CONFLICT and is rejected
 *     (MODEL_SUBSTRATE_REGISTRY_CONFLICT) — an id is append-only and never
 *     re-points.
 *   - Registering an already-registered substrate digest under a DIFFERENT
 *     neutral id is likewise rejected: digests and neutral ids are 1:1 in
 *     this registry (no id aliasing — the digest is the truth).
 *   - The registry cross-checks that the substrate's adapterId /
 *     adapterVersion MATCH the adapter descriptor (a substrate must have
 *     been registered through the adapter named in the registration).
 *   - The registry re-verifies BOTH digests (substrate integrity, adapter
 *     descriptor) before appending — tampered inputs fail closed with
 *     MODEL_SUBSTRATE_TAMPERED.
 *
 * There is no mutation or removal API: `list()` returns a frozen snapshot
 * of frozen records (deep-frozen append-only guard).
 */

import type { CognitiveSubstrate } from '@arena/agent-body';
import { digestCanonical } from '@arena/protocol-core';
import { MODEL_SUBSTRATE_ERROR_CODES, ModelSubstrateError } from './errors.js';
import type { AdapterDescriptor } from './adapter.js';
import { isAdapterDescriptor, verifyAdapterDescriptor } from './adapter.js';
import { isSubstrateRecord, verifySubstrateRecord } from './substrate.js';
import {
  assertNoCredentialFields,
  assertProviderNeutralString,
  deepFreeze,
  isContentDigest,
  isNeutralId,
  isTimestampView,
  toContentDigest,
} from './shared.js';

// ---------------------------------------------------------------------------
// SubstrateRegistration — the append-only registration record
// ---------------------------------------------------------------------------

/** Wire version of the substrate registration shape. */
export const SUBSTRATE_REGISTRATION_RECORD_VERSION = 1 as const;

/** Digest-free view of a registration record — what its digest commits to. */
export interface SubstrateRegistrationView {
  readonly recordVersion: typeof SUBSTRATE_REGISTRATION_RECORD_VERSION;
  /** Neutral registry id (stable public handle; the digest is the truth). */
  readonly substrateId: string;
  /** Content address of the registered substrate record. */
  readonly substrateDigest: string;
  /** Content address of the adapter descriptor that performed the registration. */
  readonly adapterDigest: string;
  /** UTC millisecond timestamp of the (first, idempotent) registration. */
  readonly registeredAt: string;
}

export interface SubstrateRegistration {
  readonly recordVersion: typeof SUBSTRATE_REGISTRATION_RECORD_VERSION;
  /** Neutral registry id (stable public handle; the digest is the truth). */
  readonly substrateId: string;
  /** The full, verified substrate record (agent-body CognitiveSubstrate shape). */
  readonly substrate: CognitiveSubstrate;
  /** The full, verified adapter descriptor that performed the registration. */
  readonly adapterDescriptor: AdapterDescriptor;
  /** UTC millisecond timestamp of the (first, idempotent) registration. */
  readonly registeredAt: string;
  /** sha256 content digest over the digest-free view of this record. */
  readonly registrationDigest: string;
}

/** The neutral substrate id + registered content + registering adapter. */
export interface RegisterSubstrateInput {
  readonly substrateId: string;
  readonly substrate: CognitiveSubstrate;
  readonly adapterDescriptor: AdapterDescriptor;
  /** Defaults to now; deterministic registries may pin it. */
  readonly registeredAt?: string;
}

function invalidRegistration(message: string, details?: Record<string, unknown>): never {
  throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_REGISTRATION, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

async function substrateRegistrationViewDigest(
  view: SubstrateRegistrationView,
): Promise<string> {
  return digestCanonical(view);
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * In-memory, append-only substrate registry (protocol level — no
 * persistence; services own durable ledgers). Created via
 * `createSubstrateRegistry()`.
 */
export interface SubstrateRegistry {
  /**
   * Append a registration (idempotent per substrate digest + neutral id +
   * adapter descriptor; conflicting re-use of a neutral id is rejected).
   * Verifies both the substrate integrity digest and the adapter descriptor
   * digest before appending (tampered inputs fail closed).
   */
  register(input: RegisterSubstrateInput): Promise<SubstrateRegistration>;
  /** Frozen snapshot of all registration records, in append order. */
  list(): readonly SubstrateRegistration[];
  /** Look up a registration by the substrate's content digest. */
  getByDigest(substrateDigest: string): SubstrateRegistration | null;
  /** Look up a registration by its neutral substrate id. */
  getBySubstrateId(substrateId: string): SubstrateRegistration | null;
}

/** Create an empty in-memory substrate registry. */
export function createSubstrateRegistry(): SubstrateRegistry {
  const byId = new Map<string, SubstrateRegistration>();
  const byDigest = new Map<string, SubstrateRegistration>();

  async function register(input: RegisterSubstrateInput): Promise<SubstrateRegistration> {
    assertNoCredentialFields(input, 'registration');

    if (typeof input.substrateId !== 'string' || !isNeutralId(input.substrateId)) {
      invalidRegistration(
        `invalid substrate id: ${JSON.stringify(input.substrateId)} (lowercase neutral identifier required)`,
      );
    }
    assertProviderNeutralString(input.substrateId, 'substrateId');

    if (!isSubstrateRecord(input.substrate)) {
      invalidRegistration('registration requires a structurally valid substrate record');
    }
    if (!isAdapterDescriptor(input.adapterDescriptor)) {
      invalidRegistration('registration requires a structurally valid adapter descriptor');
    }

    // Fail closed on tampered content BEFORE any registry state changes.
    await verifySubstrateRecord(input.substrate);
    await verifyAdapterDescriptor(input.adapterDescriptor);

    // The substrate must have been registered THROUGH the named adapter.
    if (
      input.substrate.adapterId !== input.adapterDescriptor.adapterId ||
      input.substrate.adapterVersion !== input.adapterDescriptor.adapterVersion
    ) {
      throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.ADAPTER_MISMATCH, {
        message: `substrate declares adapter ${input.substrate.adapterId}@${input.substrate.adapterVersion} but the registration adapter descriptor is ${input.adapterDescriptor.adapterId}@${input.adapterDescriptor.adapterVersion} (a substrate is registered through exactly one adapter)`,
        details: {
          substrateAdapter: `${input.substrate.adapterId}@${input.substrate.adapterVersion}`,
          descriptorAdapter: `${input.adapterDescriptor.adapterId}@${input.adapterDescriptor.adapterVersion}`,
        },
      });
    }

    const substrateDigest = toContentDigest(input.substrate.integrity.contentDigest);
    const adapterDigest = toContentDigest(input.adapterDescriptor.digest);
    const registeredAt = input.registeredAt ?? new Date().toISOString();
    if (!isTimestampView(registeredAt)) {
      invalidRegistration(
        `invalid registration timestamp: ${JSON.stringify(registeredAt)} (expected UTC ISO-8601 with exactly millisecond precision)`,
      );
    }

    // Idempotence / conflict resolution (append-only, digest-truth).
    const existingById = byId.get(input.substrateId);
    if (existingById !== undefined) {
      if (
        existingById.substrate.integrity.contentDigest === substrateDigest &&
        existingById.adapterDescriptor.digest === adapterDigest
      ) {
        return existingById; // idempotent re-registration of the same content
      }
      throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.REGISTRY_CONFLICT, {
        message: `substrate id ${JSON.stringify(input.substrateId)} is already registered with different content; neutral ids are append-only and never re-point (a changed substrate is a new registration under a new id)`,
        details: {
          substrateId: input.substrateId,
          registeredSubstrateDigest: existingById.substrate.integrity.contentDigest,
          registeredAdapterDigest: existingById.adapterDescriptor.digest,
          incomingSubstrateDigest: substrateDigest,
          incomingAdapterDigest: adapterDigest,
        },
      });
    }
    const existingByDigest = byDigest.get(substrateDigest);
    if (existingByDigest !== undefined) {
      throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.REGISTRY_CONFLICT, {
        message: `substrate digest ${substrateDigest} is already registered under neutral id ${JSON.stringify(existingByDigest.substrateId)}; digests and neutral ids are 1:1 (register an id alias is not supported — the digest is the truth)`,
        details: {
          substrateId: input.substrateId,
          substrateDigest,
          existingSubstrateId: existingByDigest.substrateId,
        },
      });
    }

    const view: SubstrateRegistrationView = {
      recordVersion: SUBSTRATE_REGISTRATION_RECORD_VERSION,
      substrateId: input.substrateId,
      substrateDigest,
      adapterDigest,
      registeredAt,
    };
    const registrationDigest = toContentDigest(
      await substrateRegistrationViewDigest(view),
    );
    const record: SubstrateRegistration = deepFreeze({
      recordVersion: SUBSTRATE_REGISTRATION_RECORD_VERSION,
      substrateId: input.substrateId,
      substrate: input.substrate,
      adapterDescriptor: input.adapterDescriptor,
      registeredAt,
      registrationDigest,
    });
    byId.set(input.substrateId, record);
    byDigest.set(substrateDigest, record);
    return record;
  }

  function list(): readonly SubstrateRegistration[] {
    return Object.freeze([...byId.values()]);
  }

  function getByDigest(substrateDigest: string): SubstrateRegistration | null {
    return byDigest.get(substrateDigest) ?? null;
  }

  function getBySubstrateId(substrateId: string): SubstrateRegistration | null {
    return byId.get(substrateId) ?? null;
  }

  return Object.freeze({ register, list, getByDigest, getBySubstrateId });
}

/** Structural guard for a substrate registration record. */
export function isSubstrateRegistration(value: unknown): value is SubstrateRegistration {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === SUBSTRATE_REGISTRATION_RECORD_VERSION &&
    typeof candidate['substrateId'] === 'string' &&
    isNeutralId(candidate['substrateId']) &&
    isSubstrateRecord(candidate['substrate']) &&
    isAdapterDescriptor(candidate['adapterDescriptor']) &&
    typeof candidate['registeredAt'] === 'string' &&
    isTimestampView(candidate['registeredAt']) &&
    isContentDigest(candidate['registrationDigest'])
  );
}
