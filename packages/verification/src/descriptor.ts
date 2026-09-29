/**
 * VerifierDescriptor — the content-addressed, versioned DECLARATION of
 * a verifier (Work Order A013; spec EV1.0: "A verifier declares
 * required evidence, method, pass/fail/unknown semantics and
 * reproducibility policy"; architecture-lock rule 12 — public artifacts
 * are explicitly published and versioned; spec/quality-model.md — the
 * assessor-versioning rule, "changing an assessor requires a new
 * version and cannot be treated as a pure model improvement", binds
 * verifiers identically).
 *
 * A descriptor binds:
 *   - `verifierId` + `version` — the verifier's own versioned identity.
 *     Because the descriptor is content-addressed, ANY change to ANY
 *     field changes the digest; registering a different descriptor under
 *     the same (verifierId, version) is an identity conflict in the
 *     reference registry (services/verification) — the enforcement
 *     point of "any change ⇒ a new version";
 *   - `method` — the CLOSED EV1.0 verification-method vocabulary
 *     (verifier-method.ts; unknown methods are rejected);
 *   - `requiredEvidence` — the REQUIRED-EVIDENCE declaration (evidence.ts):
 *     one clause per requirement — kind, claim, optional artifact pin,
 *     optional producer pin. Non-empty; unique requirement ids;
 *   - `outcomeSemantics` — the declared meaning of pass / fail /
 *     unknown for THIS verifier (outcome.ts; all three mandatory);
 *   - `reproducibility` — the policy enum
 *     (deterministic | seeded-stochastic | provider-dependent) with the
 *     seed and parameters recorded when applicable. Consistency rules:
 *     a deterministic verifier carries NO seed (it is not seed-addressed);
 *     a seeded-stochastic verifier MUST carry a seed (its reruns are
 *     seed-addressed); a provider-dependent verifier MAY carry either;
 *   - `inputSchema` / `outputSchema` — versioned SchemaRefs naming the
 *     verifier's input and output schemas (the reference verifiers pin
 *     arena:schema/verification/verification-record@1.0.0 as output);
 *   - `provenance` — who authored the verifier, when, with what notes.
 *
 * Content addressing: the sha256 digest is computed over the canonical
 * JSON of the digest-free view with @arena/protocol-core's
 * digestCanonical — NEVER reimplemented here. Same descriptor ⇒ same
 * digest; deep-frozen at creation — there is NO mutation API.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { SchemaRef } from '@arena/protocol-core';
import { isSchemaRef } from '@arena/protocol-core';
import { VERIFICATION_ERROR_CODES, VerificationError } from './errors.js';
import type { VerifierMethod } from './verifier-method.js';
import { isVerifierMethod, toVerifierMethod } from './verifier-method.js';
import type { OutcomeSemantics } from './outcome.js';
import { isOutcomeSemantics, toOutcomeSemantics } from './outcome.js';
import type { EvidenceRequirement } from './evidence.js';
import { isEvidenceRequirement, toRequiredEvidence } from './evidence.js';
import {
  deepFreeze,
  expectEnumMember,
  expectFields,
  isContentDigest,
  isNeutralId,
  isNeutralText,
  isVerificationSeed,
  isVerificationTimestamp,
  isVerificationVersion,
  toContentDigest,
  toNeutralId,
  toNeutralText,
  toSchemaRefValue,
  toVerificationSeed,
  toVerificationTimestamp,
  toVerificationVersion,
} from './shared.js';
import type {
  ContentDigest,
  NeutralId,
  NeutralText,
  VerificationSeed,
  VerificationTimestamp,
  VerificationVersion,
} from './shared.js';

/** Wire version of the verifier-descriptor shape. */
export const VERIFIER_DESCRIPTOR_VERSION = 1 as const;

/** Identity charset for verifier ids (closed, neutral). */
export const VERIFIER_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';

const VERIFIER_ID_PATTERN = new RegExp(VERIFIER_ID_PATTERN_SOURCE);

function toVerifierId(value: string): NeutralId {
  if (typeof value !== 'string' || !VERIFIER_ID_PATTERN.test(value)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `verifier descriptor: invalid verifier id: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { pattern: VERIFIER_ID_PATTERN_SOURCE },
    });
  }
  return value as NeutralId;
}

// ---------------------------------------------------------------------------
// Reproducibility policy
// ---------------------------------------------------------------------------

/** The CLOSED reproducibility-policy vocabulary. */
export const REPRODUCIBILITY_POLICIES = Object.freeze([
  'deterministic',
  'seeded-stochastic',
  'provider-dependent',
] as const);

export type ReproducibilityPolicy = (typeof REPRODUCIBILITY_POLICIES)[number];

/** Structural (non-throwing) check for the closed policy enum. */
export function isReproducibilityPolicy(value: unknown): value is ReproducibilityPolicy {
  return (
    typeof value === 'string' &&
    (REPRODUCIBILITY_POLICIES as readonly string[]).includes(value)
  );
}

/**
 * The reproducibility declaration (EV1.0: "reproducibility policy"):
 * the policy plus the seed / parameters recorded when applicable.
 * Consistency: deterministic ⇒ seed null; seeded-stochastic ⇒ seed
 * REQUIRED; provider-dependent ⇒ seed optional.
 */
export interface VerifierReproducibility {
  readonly policy: ReproducibilityPolicy;
  /** The recorded seed (required for seeded-stochastic; null for deterministic). */
  readonly seed: VerificationSeed | null;
  /** Recorded parameters (free-form neutral text, null when none). */
  readonly parameters: NeutralText | null;
}

/** Stable field list for reproducibility (tests + contracts mirror it). */
export const VERIFIER_REPRODUCIBILITY_FIELDS = Object.freeze([
  'policy',
  'seed',
  'parameters',
] as const) as readonly string[];

export interface VerifierReproducibilityInput {
  readonly policy: string;
  readonly seed: string | null;
  readonly parameters: string | null;
}

/** Structural (non-throwing) check for the reproducibility declaration. */
export function isVerifierReproducibility(
  value: unknown,
): value is VerifierReproducibility {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isReproducibilityPolicy(candidate['policy']) &&
    (candidate['seed'] === null || isVerificationSeed(candidate['seed'])) &&
    (candidate['parameters'] === null || isNeutralText(candidate['parameters']))
  );
}

function toVerifierReproducibility(value: unknown): VerifierReproducibility {
  const record = expectFields(
    value,
    ['policy', 'seed', 'parameters'],
    [],
    VERIFICATION_ERROR_CODES.INVALID_REPRODUCIBILITY,
    'verifier reproducibility',
  );
  const policy = expectEnumMember(
    record['policy'],
    REPRODUCIBILITY_POLICIES,
    'policy',
    VERIFICATION_ERROR_CODES.INVALID_REPRODUCIBILITY,
    'verifier reproducibility',
  );
  const seed = record['seed'];
  if (seed !== null && typeof seed !== 'string') {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_REPRODUCIBILITY, {
      message: 'verifier reproducibility: seed must be a neutral seed string or null',
    });
  }
  const parameters = record['parameters'];
  if (parameters !== null && typeof parameters !== 'string') {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_REPRODUCIBILITY, {
      message: 'verifier reproducibility: parameters must be neutral text or null',
    });
  }
  if (policy === 'deterministic' && seed !== null) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_REPRODUCIBILITY, {
      message: 'verifier reproducibility: a deterministic verifier carries no seed (deterministic reruns are not seed-addressed)',
      details: { policy, seed },
    });
  }
  if (policy === 'seeded-stochastic' && seed === null) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_REPRODUCIBILITY, {
      message: 'verifier reproducibility: a seeded-stochastic verifier MUST record its seed (reruns are seed-addressed)',
      details: { policy },
    });
  }
  return deepFreeze({
    policy,
    seed: seed === null ? null : toVerificationSeed(seed),
    parameters: parameters === null ? null : toNeutralText(parameters, 'verifier reproducibility parameters'),
  });
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Provenance of the verifier declaration (EV1.0 "provenance"). */
export interface VerifierProvenance {
  /** Neutral identity of the authoring principal (expert, org, pipeline). */
  readonly authoredBy: NeutralId;
  /** When the descriptor was authored (ms-precision UTC). */
  readonly submittedAt: VerificationTimestamp;
  /** Optional free-form notes (method, data sources, review state). */
  readonly notes: NeutralText | null;
}

/** Stable field list for provenance (tests + contracts mirror it). */
export const VERIFIER_PROVENANCE_FIELDS = Object.freeze([
  'authoredBy',
  'submittedAt',
  'notes',
] as const) as readonly string[];

/** Structural (non-throwing) check for provenance. */
export function isVerifierProvenance(value: unknown): value is VerifierProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['authoredBy']) &&
    isVerificationTimestamp(candidate['submittedAt']) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

function toVerifierProvenance(value: unknown): VerifierProvenance {
  const record = expectFields(
    value,
    ['authoredBy', 'submittedAt', 'notes'],
    [],
    VERIFICATION_ERROR_CODES.INVALID_PROVENANCE,
    'verifier provenance',
  );
  const notes = record['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'verifier provenance: notes must be neutral text or null',
    });
  }
  return deepFreeze({
    authoredBy: toNeutralId(
      typeof record['authoredBy'] === 'string' ? record['authoredBy'] : '',
      'verifier provenance authoredBy',
    ),
    submittedAt: toVerificationTimestamp(
      typeof record['submittedAt'] === 'string' ? record['submittedAt'] : '',
      'verifier provenance submittedAt',
    ),
    notes: notes === null ? null : toNeutralText(notes, 'verifier provenance notes'),
  });
}

// ---------------------------------------------------------------------------
// VerifierDescriptor
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the descriptor digest commits to. */
export interface VerifierDescriptorView {
  readonly recordVersion: typeof VERIFIER_DESCRIPTOR_VERSION;
  readonly verifierId: NeutralId;
  readonly version: VerificationVersion;
  readonly method: VerifierMethod;
  readonly requiredEvidence: readonly EvidenceRequirement[];
  readonly outcomeSemantics: OutcomeSemantics;
  readonly reproducibility: VerifierReproducibility;
  readonly inputSchema: SchemaRef;
  readonly outputSchema: SchemaRef;
  readonly provenance: VerifierProvenance;
}

/** A frozen, content-addressed verifier descriptor: the view plus its sha256 digest. */
export interface VerifierDescriptor extends VerifierDescriptorView {
  readonly digest: ContentDigest;
}

/** Stable field list for the descriptor view (tests + contracts mirror it). */
export const VERIFIER_DESCRIPTOR_FIELDS = Object.freeze([
  'recordVersion',
  'verifierId',
  'version',
  'method',
  'requiredEvidence',
  'outcomeSemantics',
  'reproducibility',
  'inputSchema',
  'outputSchema',
  'provenance',
] as const) as readonly string[];

export interface CreateVerifierDescriptorInput {
  readonly verifierId: string;
  readonly version: string;
  readonly method: string;
  readonly requiredEvidence: readonly {
    readonly requirementId: string;
    readonly evidenceKind: string;
    readonly claim: string;
    readonly artifact: {
      readonly namespace: string;
      readonly name: string;
      readonly version: string;
      readonly digest: string;
    } | null;
    readonly requiredProducer: string | null;
  }[];
  readonly outcomeSemantics: {
    readonly pass: string;
    readonly fail: string;
    readonly unknown: string;
  };
  readonly reproducibility: VerifierReproducibilityInput;
  readonly inputSchema: SchemaRef;
  readonly outputSchema: SchemaRef;
  readonly provenance: {
    readonly authoredBy: string;
    readonly submittedAt: string;
    readonly notes: string | null;
  };
}

/** Structural (non-throwing) check for the digest-free view. */
export function isVerifierDescriptorView(value: unknown): value is VerifierDescriptorView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === VERIFIER_DESCRIPTOR_VERSION &&
    isNeutralId(candidate['verifierId']) &&
    isVerificationVersion(candidate['version']) &&
    isVerifierMethod(candidate['method']) &&
    Array.isArray(candidate['requiredEvidence']) &&
    (candidate['requiredEvidence'] as unknown[]).length > 0 &&
    (candidate['requiredEvidence'] as unknown[]).every((entry) => isEvidenceRequirement(entry)) &&
    isOutcomeSemantics(candidate['outcomeSemantics']) &&
    isVerifierReproducibility(candidate['reproducibility']) &&
    isSchemaRef(candidate['inputSchema']) &&
    isSchemaRef(candidate['outputSchema']) &&
    isVerifierProvenance(candidate['provenance'])
  );
}

/** Structural (non-throwing) check for the full descriptor (view + digest). */
export function isVerifierDescriptor(value: unknown): value is VerifierDescriptor {
  if (!isVerifierDescriptorView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed verifier
 * descriptor. Rejects unknown methods (closed enum), empty or
 * duplicate-bearing required-evidence declarations, incomplete outcome
 * semantics, contradictory reproducibility policies, malformed schemas
 * and provenance, and unknown fields — all with typed
 * VerificationErrors.
 */
export async function createVerifierDescriptor(
  input: CreateVerifierDescriptorInput,
): Promise<VerifierDescriptor> {
  const record = expectFields(
    input,
    [
      'verifierId',
      'version',
      'method',
      'requiredEvidence',
      'outcomeSemantics',
      'reproducibility',
      'inputSchema',
      'outputSchema',
      'provenance',
    ],
    [],
    VERIFICATION_ERROR_CODES.INVALID_DESCRIPTOR,
    'verifier descriptor',
  );

  const method = toVerifierMethod(
    typeof record['method'] === 'string' ? record['method'] : '',
    'verifier descriptor',
  );

  const view: VerifierDescriptorView = {
    recordVersion: VERIFIER_DESCRIPTOR_VERSION,
    verifierId: toVerifierId(
      typeof record['verifierId'] === 'string' ? record['verifierId'] : '',
    ),
    version: toVerificationVersion(
      typeof record['version'] === 'string' ? record['version'] : '',
      'verifier descriptor version',
    ),
    method,
    requiredEvidence: toRequiredEvidence(record['requiredEvidence']),
    outcomeSemantics: toOutcomeSemantics(record['outcomeSemantics']),
    reproducibility: toVerifierReproducibility(record['reproducibility']),
    inputSchema: toSchemaRefValue(
      (isSchemaRef(record['inputSchema'])
        ? record['inputSchema']
        : { namespace: '', name: '', version: '' }) as SchemaRef,
    ),
    outputSchema: toSchemaRefValue(
      (isSchemaRef(record['outputSchema'])
        ? record['outputSchema']
        : { namespace: '', name: '', version: '' }) as SchemaRef,
    ),
    provenance: toVerifierProvenance(record['provenance']),
  };
  const digest = toContentDigest(await digestCanonical(view), 'verifier descriptor digest');
  return deepFreeze({ ...view, digest }) as VerifierDescriptor;
}

/** The digest-free view of a descriptor (what the digest commits to). */
export function verifierDescriptorView(
  descriptor: VerifierDescriptor,
): VerifierDescriptorView {
  const { digest: _digest, ...view } = descriptor;
  return deepFreeze({ ...view }) as VerifierDescriptorView;
}

/**
 * Recompute the descriptor digest over the digest-free view and compare
 * (optionally against an expected digest). Throws VERIFICATION_TAMPERED
 * on any mismatch.
 */
export async function recomputeVerifierDescriptorDigest(
  descriptor: VerifierDescriptor,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isVerifierDescriptor(descriptor)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: 'descriptor digest recomputation requires a structurally valid verifier descriptor',
    });
  }
  const actual = await digestCanonical(verifierDescriptorView(descriptor));
  if (actual !== descriptor.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.TAMPERED, {
      message: `verifier descriptor digest mismatch: expected ${expectedDigest ?? descriptor.digest}, got ${actual}`,
      details: {
        verifierId: descriptor.verifierId,
        version: descriptor.version,
        expected: expectedDigest ?? descriptor.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed descriptor digest');
}

/**
 * The verifier identity key — "verifierId@version". The reference
 * registry keys duplicate detection on this pair: registering a
 * DIFFERENT descriptor digest under the same identity is a version
 * conflict (spec/quality-model.md: changing a verifier requires a new
 * version — same version, different bytes is a conflict, never a silent
 * improvement).
 */
export function verifierIdentityKey(descriptor: VerifierDescriptor): string {
  return `${descriptor.verifierId}@${descriptor.version}`;
}
