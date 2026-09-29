/**
 * Evidence validation primitives (Work Order A013 core objects §3.3) —
 * the checks that distinguish "evidence exists" from "evidence exists
 * and supports the claim".
 *
 * Four primitives, each individually testable and composed by
 * assessEvidenceForRequirements:
 *
 *   1. EVIDENCE-KIND MATCHING — matchEvidenceForRequirement: pure
 *      selection of the bundle entries that could satisfy a declared
 *      requirement (kind equality, plus exact artifact-pin equality when
 *      the requirement pins one). Deterministic: unpinned requirements
 *      select the FIRST matching entry in bundle order.
 *
 *   2. REFERENCE RESOLUTION — validateEvidenceReference resolves an
 *      EvidenceReference's A002 ArtifactRef through an ArtifactResolver
 *      (the A002 resolver contract, reused verbatim). An unresolvable
 *      reference establishes NOTHING: at the requirement level it maps
 *      to `missing` (a bundle entry that cannot produce its artifact is
 *      a dangling claim, not evidence).
 *
 *   3. DIGEST VERIFICATION — the resolved artifact must satisfy BOTH
 *      digest equalities: recomputed(content view) === artifact.digest
 *      (A002 verifyArtifact — fail-closed tamper detection) AND
 *      artifact.digest === reference.artifact.digest (the bundle's
 *      address must name the artifact that was actually resolved).
 *      Any mismatch → `present-unverified`, NEVER a silent pass.
 *
 *   4. PROVENANCE-CHAIN VALIDATION — A002 verifyArtifactTree over the
 *      resolved artifact: every embedded lineage ref must resolve, match
 *      its identity AND digest, and verify recursively (diamond-safe,
 *      cycle-fail-closed). A broken chain → `present-unverified`.
 *
 * The requirement-level composition (assessEvidenceForRequirements)
 * yields one of three intermediate states per requirement — `missing`,
 * `present-unverified`, or `verified` (verified = resolved + digest-
 * verified + provenance-chain-verified; whether the evidence then
 * SUPPORTS the claim is the verifier hook's separate responsibility).
 */

import {
  artifactRefKey,
  isMaterialArtifact,
  verifyArtifact,
  verifyArtifactTree,
} from '@arena/artifact-protocol';
import type { ArtifactRef, MaterialArtifact } from '@arena/artifact-protocol';
import { VERIFICATION_ERROR_CODES, VerificationError } from './errors.js';
import type { EvidenceReference, EvidenceRequirement } from './evidence.js';
import { isEvidenceReference, isEvidenceRequirement } from './evidence.js';

/**
 * Resolves an A002 artifact reference to the referenced artifact (or
 * null when unknown) — the A002 ArtifactResolver contract, reused
 * verbatim (type alias for intent-naming at the verification boundary).
 */
export type EvidenceArtifactResolver = (
  ref: ArtifactRef,
) => MaterialArtifact<unknown> | null | Promise<MaterialArtifact<unknown> | null>;

// ---------------------------------------------------------------------------
// Primitive 1: evidence-kind matching (pure)
// ---------------------------------------------------------------------------

/**
 * Select the bundle entries that could satisfy the requirement: same
 * evidence kind, and — when the requirement pins an exact artifact —
 * the same A002 artifact ref (namespace/name/version/digest all equal).
 * Pure, order-preserving, deterministic.
 */
export function matchEvidenceForRequirement(
  requirement: EvidenceRequirement,
  bundle: readonly EvidenceReference[],
): readonly EvidenceReference[] {
  if (!isEvidenceRequirement(requirement)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_REQUIREMENT, {
      message: 'evidence matching requires a structurally valid evidence requirement',
    });
  }
  const matches = bundle.filter((entry) => {
    if (!isEvidenceReference(entry)) return false;
    if (entry.evidenceKind !== requirement.evidenceKind) return false;
    if (requirement.artifact === null) return true;
    return artifactRefKey(entry.artifact) === artifactRefKey(requirement.artifact);
  });
  return Object.freeze(matches);
}

/**
 * Deterministic single selection: the FIRST match in bundle order
 * (documented reference-fabric rule; multi-evidence correlation per
 * requirement is future work — see the A013 limitations note).
 */
export function selectEvidenceForRequirement(
  requirement: EvidenceRequirement,
  bundle: readonly EvidenceReference[],
): EvidenceReference | null {
  const matches = matchEvidenceForRequirement(requirement, bundle);
  return matches.length > 0 ? (matches[0] as EvidenceReference) : null;
}

// ---------------------------------------------------------------------------
// Primitives 2-4: resolution + digest + provenance chain
// ---------------------------------------------------------------------------

/** Why a present evidence reference failed validation (closed taxonomy). */
export const EVIDENCE_VALIDATION_FAILURES = Object.freeze([
  'unresolvable',
  'reference-digest-mismatch',
  'digest-mismatch',
  'provenance-chain-broken',
] as const);

export type EvidenceValidationFailure = (typeof EVIDENCE_VALIDATION_FAILURES)[number];

/** The outcome of validating ONE evidence reference. */
export interface EvidenceValidation {
  readonly reference: EvidenceReference;
  /** The resolved artifact when resolution succeeded (possibly tampered). */
  readonly artifact: MaterialArtifact<unknown> | null;
  /** Null iff the reference resolved AND both digest checks AND the chain check passed. */
  readonly failure: EvidenceValidationFailure | null;
  /** Deterministic human-readable detail for the failure (null on success). */
  readonly detail: string | null;
}

/**
 * Validate one evidence reference end-to-end (resolution → digest
 * verification → provenance-chain validation). NEVER throws on evidence
 * problems — failures are returned, not raised, so the caller can record
 * them in the evidence-support summary (failing loudly is the RECORD's
 * job; a broken evidence item yields `unknown`, never a crash and never
 * a silent pass). Throws VerificationError only on structurally invalid
 * INPUTS (a malformed reference or resolver).
 */
export async function validateEvidenceReference(
  reference: EvidenceReference,
  resolve: EvidenceArtifactResolver,
): Promise<EvidenceValidation> {
  if (!isEvidenceReference(reference)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
      message: 'evidence validation requires a structurally valid evidence reference',
    });
  }
  const artifact = await resolve(reference.artifact);
  if (artifact === null) {
    return {
      reference,
      artifact: null,
      failure: 'unresolvable',
      detail: `evidence reference could not be resolved: ${artifactRefKey(reference.artifact)}`,
    };
  }
  if (!isMaterialArtifact(artifact)) {
    return {
      reference,
      artifact: null,
      failure: 'unresolvable',
      detail: `resolver returned a non-artifact for ${artifactRefKey(reference.artifact)}`,
    };
  }
  if (artifact.digest !== reference.artifact.digest) {
    return {
      reference,
      artifact,
      failure: 'reference-digest-mismatch',
      detail: `resolved artifact digest ${artifact.digest} does not match the referenced digest ${reference.artifact.digest}`,
    };
  }
  try {
    // Digest verification: recomputed canonical digest must equal the
    // artifact's claimed digest (A002 fail-closed tamper detection).
    await verifyArtifact(artifact);
    // Provenance-chain validation: every embedded lineage ref must
    // resolve, match identity+digest and verify recursively (A002
    // verifyArtifactTree — diamond-safe, cycle-fail-closed).
    await verifyArtifactTree(artifact, resolve);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const chainFailure = /reference could not be resolved|identity does not match|cycle detected/.test(
      detail,
    )
      ? ('provenance-chain-broken' as const)
      : ('digest-mismatch' as const);
    return { reference, artifact, failure: chainFailure, detail };
  }
  return { reference, artifact, failure: null, detail: null };
}

// ---------------------------------------------------------------------------
// Requirement-level composition
// ---------------------------------------------------------------------------

/** The intermediate verification states (pre-hook). */
export const REQUIREMENT_VALIDATION_STATES = Object.freeze([
  'missing',
  'present-unverified',
  'verified',
] as const);

export type RequirementValidationState = (typeof REQUIREMENT_VALIDATION_STATES)[number];

/**
 * One requirement's validation assessment: which reference was selected,
 * which artifact was verified (only when state === 'verified'), and the
 * deterministic note explaining a non-verified state.
 */
export interface RequirementAssessment {
  readonly requirement: EvidenceRequirement;
  /** The selected reference (null when nothing matched by kind/pin). */
  readonly reference: EvidenceReference | null;
  /** The verified artifact — non-null ONLY when state === 'verified'. */
  readonly artifact: MaterialArtifact<unknown> | null;
  readonly state: RequirementValidationState;
  readonly note: string | null;
}

/**
 * Compose the four primitives over every declared requirement:
 *
 *   no kind/pin match        → missing ("no matching evidence in bundle")
 *   match but unresolvable   → missing ("declared reference unresolvable")
 *   resolved but tampered    → present-unverified (digest / chain detail)
 *   fully verified           → verified (artifact handed to the hook)
 *
 * Deterministic: same (requirements, bundle, resolver-content) ⇒ same
 * assessments, byte for byte.
 */
export async function assessEvidenceForRequirements(
  requirements: readonly EvidenceRequirement[],
  bundle: readonly EvidenceReference[],
  resolve: EvidenceArtifactResolver,
): Promise<readonly RequirementAssessment[]> {
  const assessments: RequirementAssessment[] = [];
  for (const requirement of requirements) {
    const selected = selectEvidenceForRequirement(requirement, bundle);
    if (selected === null) {
      const kindPresent = bundle.some((entry) => entry.evidenceKind === requirement.evidenceKind);
      assessments.push({
        requirement,
        reference: null,
        artifact: null,
        state: 'missing',
        note: requirement.artifact === null
          ? `no evidence of kind ${JSON.stringify(requirement.evidenceKind)} in the bundle`
          : kindPresent
            ? `evidence of kind ${JSON.stringify(requirement.evidenceKind)} present but the pinned artifact ${artifactRefKey(requirement.artifact)} was not provided`
            : `no evidence of kind ${JSON.stringify(requirement.evidenceKind)} in the bundle`,
      });
      continue;
    }
    const validation = await validateEvidenceReference(selected, resolve);
    if (validation.failure === 'unresolvable') {
      // A declared-but-unresolvable reference establishes nothing: the
      // requirement's evidence is missing, with the dangling ref noted.
      assessments.push({
        requirement,
        reference: selected,
        artifact: null,
        state: 'missing',
        note: `declared reference unresolvable: ${validation.detail ?? artifactRefKey(selected.artifact)}`,
      });
      continue;
    }
    if (validation.failure !== null) {
      assessments.push({
        requirement,
        reference: selected,
        artifact: null,
        state: 'present-unverified',
        note: `${validation.failure}: ${validation.detail ?? 'unspecified validation failure'}`,
      });
      continue;
    }
    assessments.push({
      requirement,
      reference: selected,
      artifact: validation.artifact,
      state: 'verified',
      note: null,
    });
  }
  return Object.freeze(assessments);
}
