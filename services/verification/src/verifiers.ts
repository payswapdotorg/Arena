/**
 * Reference verifier implementations and the pluggable hook surface
 * (Work Order A013; mirrors the A012 reference verifiers module).
 *
 * The VERIFIER HOOK is the single pluggable seam of the reference
 * fabric: a function from one resolved, digest-verified,
 * provenance-validated evidence item (plus its requirement and the
 * descriptor) to a support verdict for the requirement's claim. The
 * runner (fabric.ts) resolves refs, runs the package's evidence
 * validation primitives, invokes the hook ONLY for fully verified
 * evidence and builds the VerificationRecord through the domain
 * constructor — hooks NEVER construct records and NEVER see
 * unverified evidence.
 *
 * Hook verdicts are a CLOSED three-member vocabulary (no quantitative
 * members — architecture-lock rule 7):
 *
 *   supported    — the verified evidence supports the requirement's claim;
 *   unsupported  — the verified evidence contradicts / does not support it;
 *   indeterminate— the method cannot decide even with verified evidence
 *                  (method limitation; drives outcome `unknown` with
 *                  reason `method-limitation`).
 *
 * ONLY TWO verifier methods have reference implementations (A013
 * scope NOTE):
 *   - constraint_check — makeConstraintCheckVerifier: deterministic,
 *     CONTENT-based; the evidence artifact's content must carry a
 *     `constraints` array with an entry {requirementId, satisfied} for
 *     the requirement — supported iff satisfied === true; an absent or
 *     malformed entry is unsupported (the constraint evidence does not
 *     establish the claim);
 *   - evidence_provenance_validation —
 *     makeEvidenceProvenanceValidationVerifier: deterministic,
 *     PROVENANCE-based; supported iff the evidence's producing
 *     principal matches the requirement's producer pin (when pinned)
 *     and the artifact carries a non-empty lineage (at least one
 *     embedded A002 ref) whose refs all resolved during validation —
 *     lineage-free evidence is indeterminate for a provenance check
 *     (the method cannot decide provenance adequacy without lineage).
 *
 * The other six EV1.0 methods (unit_integration_test,
 * deterministic_formal_check, simulation, measurement, inspection,
 * expert_review) are DECLARED descriptor types with this hook
 * interface available for future implementations — no reference
 * implementations ship here (noted in the A013 report).
 */

import type { MaterialArtifact } from '@arena/artifact-protocol';
import type { EvidenceReference, VerifierDescriptor } from '@arena/verification';


// ---------------------------------------------------------------------------
// Hook surface
// ---------------------------------------------------------------------------

/** Everything a hook needs to rule on one requirement's claim. */
export interface VerifierHookInput {
  readonly descriptor: VerifierDescriptor;
  /** The declared requirement being ruled on. */
  readonly requirement: VerifierDescriptor['requiredEvidence'][number];
  /** The selected evidence reference (validated shape). */
  readonly reference: EvidenceReference;
  /** The resolved, digest-verified, provenance-chain-verified artifact. */
  readonly artifact: MaterialArtifact<unknown>;
}

/** The CLOSED hook-verdict vocabulary (no quantitative members). */
export const HOOK_VERDICTS = Object.freeze(['supported', 'unsupported', 'indeterminate'] as const);

export type HookVerdict = (typeof HOOK_VERDICTS)[number];

/** One hook verdict entry: the closed verdict plus optional notes. */
export interface RequirementVerdict {
  readonly requirementId: string;
  readonly verdict: HookVerdict;
  readonly notes: string | null;
}

/** Hook-verdictEntry input shape (strict-shape validated by the fabric). */
export interface RequirementVerdictInput {
  readonly requirementId: string;
  readonly verdict: string;
  readonly notes: string | null;
}

/**
 * A verifier implementation: pure function from the resolved, VERIFIED
 * run inputs to per-requirement verdicts. Hooks must be deterministic
 * for deterministic policies (the same verified evidence ⇒ the same
 * verdicts); the runner handles everything else.
 */
export type VerifierHook = (
  input: VerifierHookInput,
) => Promise<readonly RequirementVerdictInput[]> | readonly RequirementVerdictInput[];

/** The two methods with reference implementations (A013 scope). */
export const IMPLEMENTED_VERIFIER_METHODS = Object.freeze([
  'constraint_check',
  'evidence_provenance_validation',
] as const);

/** The six declared-but-unimplemented methods (A013 scope NOTE). */
export const UNIMPLEMENTED_VERIFIER_METHODS = Object.freeze([
  'unit_integration_test',
  'deterministic_formal_check',
  'simulation',
  'measurement',
  'inspection',
  'expert_review',
] as const);

// ---------------------------------------------------------------------------
// Reference implementation: constraint_check verifier
// ---------------------------------------------------------------------------

/** The content shape understood by the constraint-check reference verifier. */
export interface ConstraintEvidenceContent {
  readonly constraints?: readonly {
    readonly requirementId?: unknown;
    readonly satisfied?: unknown;
    readonly detail?: unknown;
  }[];
}

/**
 * The constraint_check reference verifier: deterministic, content-based.
 * The evidence artifact's content must carry a `constraints` array with
 * an entry for the requirement id; supported iff satisfied === true.
 * An absent array, an absent entry or a malformed entry is unsupported
 * — the constraint evidence does not establish the claim (never a
 * silent pass, never a crash on malformed content).
 */
export function makeConstraintCheckVerifier(): VerifierHook {
  return async (input: VerifierHookInput): Promise<readonly RequirementVerdictInput[]> => {
    const content = input.artifact.content as ConstraintEvidenceContent | null;
    const entry = content?.constraints?.find(
      (candidate) => candidate?.requirementId === input.requirement.requirementId,
    );
    if (entry === undefined) {
      return [
        {
          requirementId: input.requirement.requirementId,
          verdict: 'unsupported',
          notes: `constraint evidence carries no entry for requirement ${JSON.stringify(input.requirement.requirementId)}`,
        },
      ];
    }
    if (entry.satisfied === true) {
      return [
        {
          requirementId: input.requirement.requirementId,
          verdict: 'supported',
          notes:
            typeof entry.detail === 'string' && entry.detail.length > 0
              ? `constraint satisfied: ${entry.detail}`
              : 'constraint satisfied (evidence content entry satisfied=true)',
        },
      ];
    }
    return [
      {
        requirementId: input.requirement.requirementId,
        verdict: 'unsupported',
        notes:
          typeof entry.detail === 'string' && entry.detail.length > 0
            ? `constraint NOT satisfied: ${entry.detail}`
            : 'constraint NOT satisfied (evidence content entry satisfied!=true)',
      },
    ];
  };
}

// ---------------------------------------------------------------------------
// Reference implementation: evidence_provenance_validation verifier
// ---------------------------------------------------------------------------

/**
 * The evidence_provenance_validation reference verifier: deterministic,
 * provenance-based. For requirements with a producer pin: supported iff
 * the evidence's producing principal matches the pin. For unpinned
 * requirements: supported iff the evidence provenance is complete AND
 * the artifact carries a non-empty lineage (at least one embedded A002
 * ref — a provenance check cannot be decided without lineage:
 * indeterminate, the method-limitation unknown cause).
 */
export function makeEvidenceProvenanceValidationVerifier(): VerifierHook {
  return async (input: VerifierHookInput): Promise<readonly RequirementVerdictInput[]> => {
    const { requirement, reference, artifact } = input;
    if (requirement.requiredProducer !== null) {
      if (reference.provenance.producedBy === requirement.requiredProducer) {
        return [
          {
            requirementId: requirement.requirementId,
            verdict: 'supported',
            notes: `evidence produced by the pinned principal ${requirement.requiredProducer}`,
          },
        ];
      }
      return [
        {
          requirementId: requirement.requirementId,
          verdict: 'unsupported',
          notes: `evidence produced by ${reference.provenance.producedBy} but the requirement pins ${requirement.requiredProducer}`,
        },
      ];
    }
    const lineageCount = artifact.refs.length;
    if (lineageCount === 0) {
      return [
        {
          requirementId: requirement.requirementId,
          verdict: 'indeterminate',
          notes: 'lineage-free evidence: a provenance check cannot be decided without embedded lineage refs (method limitation)',
        },
      ];
    }
    return [
      {
        requirementId: requirement.requirementId,
        verdict: 'supported',
        notes: `evidence provenance complete (produced by ${reference.provenance.producedBy}) and lineage carries ${String(lineageCount)} resolved ref(s)`,
      },
    ];
  };
}
