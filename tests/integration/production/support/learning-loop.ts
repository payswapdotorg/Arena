/**
 * tests/integration/production/support/learning-loop.ts — the
 * CONSENT/RIGHTS-GATED learning candidate and Q1.0 adoption gate
 * (Work Order P006; issue #158; ADR-P001-03 envelope lineage;
 * architecture-lock rules 31/32; spec/quality-model.md Q1.0).
 *
 * The integrated flow's learning tail, composed from the REAL
 * capability-learning compiler (@arena/capability-learning — the C022
 * surface, consumed never reimplemented):
 *
 *   1. PROJECT the completed escalation's consented knowledge patch
 *      into a typed ImprovementCandidate (source kind
 *      `knowledge-patch-candidate`; rights projected from the session
 *      submission's consent statement — `granted-for-global-reuse` only
 *      when the expert's completion contract granted it, `insufficient`
 *      otherwise);
 *   2. COMPILE through the REAL deterministic compiler — a candidate
 *      whose rights are `insufficient` can be INGESTED (observation is
 *      allowed) but can NEVER compile into a globally reusable program
 *      (typed `blocked-with-reasons: rights-insufficient` — the
 *      rights-free-global-learning wall);
 *   3. ADOPT only through the Q1.0 five-condition capability-lift gate
 *      over an A020 ExperimentRunRecord (typed verdicts:
 *      adopted-with-evidence / rejected-with-reasons /
 *      unknown-insufficient-sample — never a bare boolean);
 *   4. ROUTE an adopted program into the A021/A022/A023 destinations as
 *      GATED proposals carrying the FULL program lineage
 *      (ADR-P001-03 — the wire shape stays full-lineage in v1).
 *
 * The A020 run record is hand-built through the package's own test kit
 * (@arena/capability-learning/test-support — makeRunRecord: the
 * documented fixture discipline for structurally-valid run records; the
 * REAL createExperimentRunRecord constructor validates it). This is the
 * Arena-side learning operator's composition, not a client surface.
 */

import { createHash } from 'node:crypto';
import {
  compilePrograms,
  createImprovementCandidate,
  evaluateAdoptionGate,
  assembleProgramExperiment,
  routeGatedProposals,
} from '@arena/capability-learning';
import type {
  AdoptionGateVerdict,
  CompilationOutcome,
  ImprovementProgram,
} from '@arena/capability-learning';
import { makeRunRecord } from '@arena/capability-learning/test-support';
import type { ExperimentRunRecord } from '@arena/learning';

/** The candidate projection's consent basis. */
export interface LearningConsentBasis {
  /** The escalation the knowledge patch came from. */
  readonly requestId: string;
  readonly tenantId: string;
  /** The expert session reference (the evidence lineage). */
  readonly sessionRef: string;
  /** The capsule digest the candidate's evidence refs bind to. */
  readonly capsuleDigest: string;
  /** The completion contract's consent statement (typed at the session). */
  readonly consentGranted: boolean;
  /** The consent statement text (recorded verbatim). */
  readonly consentStatement: string;
}

/** The projected improvement candidate input (closed shape). */
export interface ProjectedCandidateSpec {
  readonly candidateId: string;
  readonly tenantId: string;
  /** sha256-hex digests binding the evidence lineage. */
  readonly sourceRecordRef: string;
  readonly artifactDigest: string;
  readonly evidenceRefs: readonly string[];
  readonly rightsStatus: 'granted-for-global-reuse' | 'granted-tenant-scoped' | 'insufficient';
  readonly consentStatement: string;
}

export interface LearningLoopReceipt {
  /** The consented candidate's compilation (compilable). */
  readonly consentedOutcome: CompilationOutcome;
  /** The consented program (present iff compilation succeeded). */
  readonly program: ImprovementProgram | null;
  /** The UNCONSENTED candidate's compilation (blocked, rights-insufficient). */
  readonly unconsentedOutcome: CompilationOutcome;
  /** The Q1.0 adoption gate verdict over the A020 run record. */
  readonly gateVerdict: AdoptionGateVerdict | null;
  /** The routed gated proposals (A021/A022/A023 destinations). */
  readonly proposals: readonly { readonly proposalId: string; readonly destination: string }[];
}

/** The Q1.0 five conditions as the gate evaluated them (explicit). */
export function q10ConditionsOf(verdict: AdoptionGateVerdict | null): readonly {
  readonly condition: string;
  readonly met: boolean;
}[] {
  if (verdict === null) return [];
  const conditions = (verdict as unknown as { conditions: Record<string, unknown> }).conditions;
  return [
    { condition: 'pinnedPopulationImprovement', met: conditions['pinnedPopulationImprovement'] === true },
    { condition: 'survivesVerificationAudit', met: conditions['survivesVerificationAudit'] === true },
    { condition: 'evaluatorVersionChangesAccounted', met: conditions['evaluatorVersionChangesAccounted'] === true },
    { condition: 'protectedCapabilityRegressionMeasured', met: conditions['protectedCapabilityRegressionMeasured'] === true },
    { condition: 'uncertaintyReported', met: conditions['uncertaintyReported'] === true },
  ];
}

/** Bind a session ref as a content digest (evidence binds BY DIGEST). */
function digestOf(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex');
}

/**
 * Build a candidate SPEC from the session's consent basis: rights are
 * projected from the recorded consent — NEVER assumed. An unconsented
 * session yields `insufficient` (observation allowed, reuse blocked).
 */
export function candidateSpecFromConsent(
  basis: LearningConsentBasis,
  overrides: { readonly candidateId: string },
): ProjectedCandidateSpec {
  return {
    candidateId: overrides.candidateId,
    tenantId: basis.tenantId,
    sourceRecordRef: basis.capsuleDigest,
    artifactDigest: basis.capsuleDigest,
    evidenceRefs: [basis.capsuleDigest, digestOf(basis.sessionRef)],
    rightsStatus: basis.consentGranted ? 'granted-for-global-reuse' : 'insufficient',
    consentStatement: basis.consentStatement,
  };
}

/** Build the REAL improvement candidate from a spec (the C022 input). */
async function buildCandidate(spec: ProjectedCandidateSpec) {
  return createImprovementCandidate({
    candidateId: spec.candidateId,
    tenantId: spec.tenantId,
    sourceKind: 'knowledge-patch-candidate',
    sourceRecordRef: spec.sourceRecordRef,
    changedSurface: 'skills',
    artifact: {
      namespace: 'arena-skills',
      name: 'boq-local-convention-skill',
      version: '1.0.0',
      digest: spec.artifactDigest,
    },
    supersedes: null,
    targetCapability: {
      kind: 'capability',
      id: 'capability-reconciliation',
      version: '1.2.0',
      digest: '5555555555555555555555555555555555555555555555555555555555555555',
    },
    baseline: {
      bodyRef: '4444444444444444444444444444444444444444444444444444444444444444',
      substrateRef: '6666666666666666666666666666666666666666666666666666666666666666',
      runtimeRef: null,
    },
    experimentPlan: {
      taskPopulation: [{ taskId: 'task-quantity-takeoff-block-c', version: '1.0.0' }],
      evaluationSuiteRefs: [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ],
      verificationSuiteRefs: [
        '5555555555555555555555555555555555555555555555555555555555555555',
      ],
      environmentVersions: [
        {
          namespace: 'arena',
          name: 'boq-accra-sandbox',
          version: '1.1.0',
          digest: '2222222222222222222222222222222222222222222222222222222222222222',
        },
      ],
      outcomeMetrics: [
        {
          metricId: 'boq-quantity-accuracy',
          description: 'fraction of takeoff quantities correct on the pinned population',
          direction: 'higher-is-better',
        },
      ],
      uncertainty: { method: 'analytic-variance', notes: 'variance over the pinned population' },
      protectedCapabilities: [
        {
          ref: {
            kind: 'capability',
            id: 'capability-audit-trail',
            version: '1.0.0',
            digest: '7777777777777777777777777777777777777777777777777777777777777777',
          },
          metricId: 'audit-trail-completeness',
          direction: 'higher-is-better',
        },
      ],
    },
    evidenceRefs: [...spec.evidenceRefs],
    rights: {
      status: spec.rightsStatus,
      statement: spec.consentStatement,
    },
    // The compilation pipeline targets a GLOBALLY REUSABLE program; the
    // rights statement is the gate (an insufficient-rights candidate
    // requesting global reuse compiles BLOCKED — lock rules 31/32).
    globalReuseRequested: true,
    provenance: {
      capturedFrom: 'escalation-session',
      capturedAt: '2026-10-09T12:00:00.000Z',
      notes: null,
    },
  });
}

/**
 * Run the consent/rights-gated learning loop end-to-end:
 * project → compile (consented + unconsented) → Q1.0 gate → routed
 * gated proposals.
 */
export async function runConsentGatedLearningLoop(
  consentedSpec: ProjectedCandidateSpec,
  unconsentedSpec: ProjectedCandidateSpec,
): Promise<LearningLoopReceipt> {
  const consented = await buildCandidate(consentedSpec);
  const unconsented = await buildCandidate(unconsentedSpec);

  // The rights wall: the unconsented candidate compiles BLOCKED with the
  // typed rights-insufficient reason (never a silent global reuse).
  const unconsentedOutcomes = await compilePrograms([unconsented], {
    compiledBy: 'arena-p006-integrated-battery',
  });
  const unconsentedOutcome = unconsentedOutcomes[0];
  if (unconsentedOutcome === undefined) {
    throw new Error('the compiler returned no outcome for the unconsented candidate');
  }

  // The consented candidate compiles into a typed ImprovementProgram.
  const outcomes = await compilePrograms([consented], {
    compiledBy: 'arena-p006-integrated-battery',
  });
  const consentedOutcome = outcomes[0];
  if (consentedOutcome === undefined) {
    throw new Error('the compiler returned no outcome for the consented candidate');
  }

  if (consentedOutcome.kind !== 'compilable') {
    return {
      consentedOutcome,
      program: null,
      unconsentedOutcome,
      gateVerdict: null,
      proposals: [],
    };
  }
  const program = consentedOutcome.program;

  // The A020 experiment + run record (the package's own fixture kit
  // builds the structurally-valid run record through the REAL
  // constructor; verdict lift-demonstrated over a measured lift).
  const experiment = await assembleProgramExperiment(program, {
    experimentId: 'experiment-p006-0001',
  });
  const runRecord: ExperimentRunRecord = await makeRunRecord({
    experimentKey: 'idem-p006-0001',
    descriptorRef: experiment.digest as unknown as string,
    verdictKind: 'lift-demonstrated',
    baselineValue: 0.8,
    interventionValue: 0.9,
    variance: 0.01,
  });

  // The Q1.0 five-condition adoption gate (typed verdict).
  const gateVerdict = await evaluateAdoptionGate({
    program,
    experiment,
    runRecord,
    candidates: [consented],
  });

  // Routed gated proposals (A021/A022/A023) — only an adopted program
  // proposes (routeGatedProposals throws on non-adopted verdicts).
  const proposals =
    gateVerdict.kind === 'adopted-with-evidence'
      ? await routeGatedProposals(program, gateVerdict, {
          proposedBy: 'arena-p006-integrated-battery',
        })
      : [];

  return {
    consentedOutcome,
    program,
    unconsentedOutcome,
    gateVerdict,
    proposals: proposals.map((proposal) => ({
      proposalId: proposal.proposalId,
      destination: proposal.destination,
    })),
  };
}
