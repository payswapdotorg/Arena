/**
 * Gated proposals (Work Order C022): adopted improvements become
 * PROPOSALS into the destination surfaces — A021 (new immutable
 * BodyVersions), A022 (compatibility/re-testing obligations for
 * substrate-affecting changes) and A023 (recertification triggers) —
 * through their PUBLIC PORTS; adoption of an ungated improvement is
 * STRUCTURALLY IMPOSSIBLE.
 *
 * The structural impossibility is enforced at the ONLY constructor:
 * createGatedImprovementProposal REQUIRES an AdoptionGateVerdict whose
 * kind is 'adopted-with-evidence' and whose programRef binds to the
 * program being proposed — every other verdict kind throws
 * CAPABILITY_LEARNING_NOT_ADOPTED (fail-closed). There is no other way
 * to construct a proposal object in this package.
 *
 * Destination routing (DISCLOSED DESIGN DECISION, derived from the
 * specs):
 *
 *   - 'body-forge'               — EVERY adopted program proposes a NEW
 *     BodyVersion through A021 (LE1.0: "Learning may produce a new Body
 *     Version"; the forge's immutability law keeps the prior version
 *     addressable forever);
 *   - 'compatibility-retest'     — programs whose intervention class is
 *     substrate-affecting (substrate, model-specific-adaptation) ALSO
 *     propose an A022 compatibility/re-testing obligation;
 *   - 'recertification-trigger' — programs whose supersedes lineage
 *     replaces a prior artifact version ALSO propose an A023
 *     recertification trigger (a certified composition changed).
 *
 * Proposals are CANDIDATES at the destination surfaces — never direct
 * writes (lock rule 32; "nothing becomes globally reusable
 * automatically").
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  deepFreeze,
  isContentDigest,
  isNeutralId,
  toContentDigest,
  toLearningId,
  toNeutralId,
  toNeutralText,
} from '@arena/learning';
import type { ContentDigest, LearningId, NeutralId, NeutralText } from '@arena/learning';
import { CAPABILITY_LEARNING_ERROR_CODES, CapabilityLearningError } from './errors.js';
import type { ImprovementProgram } from './program.js';
import { isImprovementProgram } from './program.js';
import type { AdoptionGateVerdict, MeasuredLift } from './gate.js';
import { isAdoptionGateVerdict } from './gate.js';

/** Wire version of the gated-proposal shape. */
export const GATED_PROPOSAL_VERSION = 1 as const;

/** The closed proposal-destination vocabulary (the A021/A022/A023 seams). */
export const PROPOSAL_DESTINATIONS = Object.freeze([
  'body-forge',
  'compatibility-retest',
  'recertification-trigger',
] as const);
export type ProposalDestination = (typeof PROPOSAL_DESTINATIONS)[number];

export function isProposalDestination(value: unknown): value is ProposalDestination {
  return (
    typeof value === 'string' &&
    (PROPOSAL_DESTINATIONS as readonly string[]).includes(value)
  );
}

/** The substrate-affecting intervention classes (A022 re-testing obligations). */
export const SUBSTRATE_AFFECTING_CLASSES = Object.freeze([
  'substrate',
  'model-specific-adaptation',
] as const);

/** The adoption evidence a proposal carries (the gate verdict, verbatim). */
export interface AdoptionEvidence {
  readonly gateVerdictRef: ContentDigest;
  readonly runRecordRef: ContentDigest;
  readonly experimentRef: ContentDigest;
  readonly measuredLift: readonly MeasuredLift[];
}

/** The digest-free gated-proposal view — exactly what the digest commits to. */
export interface GatedImprovementProposalView {
  readonly recordVersion: typeof GATED_PROPOSAL_VERSION;
  readonly proposalId: LearningId;
  readonly destination: ProposalDestination;
  readonly tenantId: NeutralId;
  /** The program digest this proposal proposes (bound to the gate verdict). */
  readonly programRef: ContentDigest;
  /** The NEW versioned artifact the program proposes (never a historical digest). */
  readonly proposedArtifactRef: ContentDigest;
  /** Append-only lineage: the prior artifact version, or null. */
  readonly supersedes: ContentDigest | null;
  /** The EXPLICIT changed surface (LE1.0 nine). */
  readonly changedSurface: string;
  /** Globally reusable ONLY with explicit rights on every candidate (lock rules 31/32). */
  readonly globalReuse: boolean;
  readonly rights: {
    readonly status: string;
    readonly statement: string;
  };
  readonly adoptionEvidence: AdoptionEvidence;
  readonly provenance: {
    readonly proposedBy: NeutralId;
    readonly notes: NeutralText | null;
  };
}

/** A frozen, content-addressed gated proposal: the view plus its sha256 digest. */
export interface GatedImprovementProposal extends GatedImprovementProposalView {
  readonly digest: ContentDigest;
}

/** Stable field list for the gated-proposal view. */
export const GATED_PROPOSAL_FIELDS = Object.freeze([
  'recordVersion',
  'proposalId',
  'destination',
  'tenantId',
  'programRef',
  'proposedArtifactRef',
  'supersedes',
  'changedSurface',
  'globalReuse',
  'rights',
  'adoptionEvidence',
  'provenance',
] as const);

/** Structural (non-throwing) check for the digest-free proposal view. */
export function isGatedImprovementProposalView(value: unknown): value is GatedImprovementProposalView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const evidence = candidate['admissionEvidence'] ?? candidate['adoptionEvidence'];
  const provenance = candidate['provenance'];
  return (
    candidate['recordVersion'] === GATED_PROPOSAL_VERSION &&
    isNeutralId(candidate['proposalId']) &&
    isProposalDestination(candidate['destination']) &&
    isNeutralId(candidate['tenantId']) &&
    isContentDigest(candidate['programRef']) &&
    isContentDigest(candidate['proposedArtifactRef']) &&
    (candidate['supersedes'] === null || isContentDigest(candidate['supersedes'])) &&
    typeof candidate['changedSurface'] === 'string' &&
    typeof candidate['globalReuse'] === 'boolean' &&
    typeof candidate['rights'] === 'object' &&
    candidate['rights'] !== null &&
    typeof evidence === 'object' &&
    evidence !== null &&
    isContentDigest((evidence as Record<string, unknown>)['gateVerdictRef']) &&
    isContentDigest((evidence as Record<string, unknown>)['runRecordRef']) &&
    Array.isArray((evidence as Record<string, unknown>)['measuredLift']) &&
    typeof provenance === 'object' &&
    provenance !== null &&
    isNeutralId((provenance as Record<string, unknown>)['proposedBy'])
  );
}

/** Structural (non-throwing) check for the full proposal (view + digest). */
export function isGatedImprovementProposal(value: unknown): value is GatedImprovementProposal {
  if (!isGatedImprovementProposalView(value)) return false;
  return isContentDigest((value as unknown as Record<string, unknown>)['digest']);
}

/**
 * THE gated-proposal constructor — the ONLY way to build a proposal.
 *
 * Fail-closed preconditions (each independently enforced):
 *   1. the gate verdict must be a structurally valid AdoptionGateVerdict;
 *   2. the gate verdict's programRef MUST bind to the program (mismatched
 *      verdicts are refused — you cannot adopt program A with the
 *      evidence of program B);
 *   3. the gate verdict's kind MUST be 'adopted-with-evidence' — every
 *      other verdict (rejected-with-reasons / unknown-insufficient-sample)
 *      throws CAPABILITY_LEARNING_NOT_ADOPTED. Adoption of an ungated
 *      improvement is STRUCTURALLY IMPOSSIBLE.
 */
export async function createGatedImprovementProposal(
  program: ImprovementProgram,
  gateVerdict: AdoptionGateVerdict,
  options: {
    readonly destination: ProposalDestination;
    readonly proposedBy: string;
    readonly notes?: string | null;
  },
): Promise<GatedImprovementProposal> {
  if (!isImprovementProgram(program)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_PROGRAM, {
      message: 'gated proposal requires a validated ImprovementProgram',
    });
  }
  if (!isAdoptionGateVerdict(gateVerdict)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_GATE_VERDICT, {
      message: 'gated proposal requires a structurally valid AdoptionGateVerdict',
    });
  }
  if ((gateVerdict.programRef as string) !== (program.digest as string)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_PROPOSAL, {
      message: 'gated proposal: the gate verdict does not bind to this program (programRef mismatch — the adoption evidence of one program cannot propose another)',
      details: {
        programDigest: program.digest as string,
        verdictProgramRef: gateVerdict.programRef as string,
      },
    });
  }
  if (gateVerdict.kind !== 'adopted-with-evidence') {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.NOT_ADOPTED, {
      message: `gated proposal REFUSED: the program's improvement was not adopted by the Q1.0 capability-lift gate (verdict kind ${JSON.stringify(gateVerdict.kind)}${gateVerdict.reasons.length > 0 ? `; reasons: ${(gateVerdict.reasons as readonly string[]).join(', ')}` : ''}) — adoption of an ungated improvement is structurally impossible`,
      details: {
        programId: program.programId as string,
        verdictKind: gateVerdict.kind,
        reasons: [...(gateVerdict.reasons as readonly string[])],
      },
    });
  }
  if (typeof options !== 'object' || options === null) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_PROPOSAL, {
      message: 'gated proposal requires options {destination, proposedBy}',
    });
  }
  if (!isProposalDestination(options.destination)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_PROPOSAL, {
      message: `gated proposal: destination must be one of [${PROPOSAL_DESTINATIONS.join(', ')}], got: ${JSON.stringify(options.destination)}`,
    });
  }
  if (typeof options.proposedBy !== 'string' || options.proposedBy.length === 0) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_PROPOSAL, {
      message: 'gated proposal: proposedBy must be a non-empty string (provenance)',
    });
  }

  const proposalId = toLearningId(
    `gp-${(program.digest as string).slice(0, 24)}-${options.destination}`,
    'gated proposal proposalId',
  );

  const view: GatedImprovementProposalView = {
    recordVersion: GATED_PROPOSAL_VERSION,
    proposalId,
    destination: options.destination,
    tenantId: program.tenantId,
    programRef: program.digest,
    proposedArtifactRef: program.proposedArtifactRef,
    supersedes: program.supersedes,
    changedSurface: program.interventionClass,
    globalReuse: program.globalReuse,
    rights: deepFreeze({
      status: program.rights.status,
      statement: program.rights.statement,
    }),
    adoptionEvidence: deepFreeze({
      gateVerdictRef: gateVerdict.digest,
      runRecordRef: gateVerdict.runRecordRef,
      experimentRef: gateVerdict.experimentRef,
      measuredLift: Object.freeze([...(gateVerdict.measuredLift as readonly MeasuredLift[])]),
    }),
    provenance: deepFreeze({
      proposedBy: toNeutralId(options.proposedBy, 'gated proposal proposedBy'),
      notes:
        options.notes === undefined || options.notes === null
          ? null
          : toNeutralText(options.notes, 'gated proposal notes'),
    }),
  };
  const digest = toContentDigest(await digestCanonical(view), 'gated proposal digest');
  return deepFreeze({ ...view, digest }) as GatedImprovementProposal;
}

/**
 * Route one ADOPTED program to its destination proposals (the closed
 * routing disclosed above). Returns 1–3 proposals: every adopted
 * program proposes a body-forge BodyVersion; substrate-affecting
 * classes additionally propose an A022 compatibility re-test; programs
 * superseding a prior version additionally propose an A023
 * recertification trigger.
 */
export async function routeGatedProposals(
  program: ImprovementProgram,
  gateVerdict: AdoptionGateVerdict,
  options: {
    readonly proposedBy: string;
    readonly notes?: string | null;
  },
): Promise<readonly GatedImprovementProposal[]> {
  const proposals: GatedImprovementProposal[] = [];
  const notes = options.notes === undefined ? null : options.notes;
  proposals.push(
    await createGatedImprovementProposal(program, gateVerdict, {
      destination: 'body-forge',
      proposedBy: options.proposedBy,
      notes,
    }),
  );
  if (
    (SUBSTRATE_AFFECTING_CLASSES as readonly string[]).includes(program.interventionClass)
  ) {
    proposals.push(
      await createGatedImprovementProposal(program, gateVerdict, {
        destination: 'compatibility-retest',
        proposedBy: options.proposedBy,
        notes,
      }),
    );
  }
  if (program.supersedes !== null) {
    proposals.push(
      await createGatedImprovementProposal(program, gateVerdict, {
        destination: 'recertification-trigger',
        proposedBy: options.proposedBy,
        notes,
      }),
    );
  }
  return Object.freeze(proposals);
}
