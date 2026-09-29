/**
 * ExperimentEngine — the in-process reference EXPERIMENT ENGINE (Work
 * Order A020; requirements R15, R16; spec LE1.0; spec/quality-model.md
 * Q1.0).
 *
 * Pure TypeScript, ZERO external runtime dependencies (only
 * @arena/protocol-core + @arena/learning — the domain package whose
 * pure comparison/attribution/verdict computations and REAL guards
 * anchor the engine to the protocol). In-process only: no network, no
 * database (the A020 reference slice, mirroring the A012/A013/A019
 * reference fabrics).
 *
 * `run(descriptorRef, arms, options)` is PURE ORCHESTRATION:
 *   1. resolve the descriptor by digest from the registry
 *      (NOT_FOUND when absent);
 *   2. enforce the arm contracts — every trajectory/evaluation/
 *      verification record passes the REAL sibling guards
 *      (@arena/trajectory, @arena/evaluation, @arena/verification),
 *      evaluations must judge THIS arm's trajectories, verifications
 *      must address them through their evidence bundles, every
 *      trajectory belongs to the PINNED task population + environment
 *      versions, and the baseline arm matches the declared baseline
 *      body/substrate pins where declared;
 *   3. freeze the historical inputs (learning-boundary layer 1 —
 *      read-only over the evidence tier, lock rule 6);
 *   4. compute the comparison, protected-capability checks,
 *      uncertainty report, attribution and verdict with the package's
 *      PURE functions;
 *   5. build the ExperimentRunRecord through its constructor (which
 *      validates the full shape, incl. the confound ⇒
 *      inconclusive-unless-controlled invariant) and append it to the
 *      ledger.
 *
 * Determinism: given the same descriptor, the same arm records, the
 * same measurements and the same fixed clock options, the engine
 * emits the SAME content-addressed record (pure functions, no hidden
 * state — the ledger only accumulates).
 *
 * Idempotency (architecture-lock rule 17): the same experiment key +
 * the same command tuple (descriptor + arm input digests) replays as
 * a no-op returning the STORED record — byte-identical, never
 * duplicated; the same key + a different tuple is an
 * IDEMPOTENCY_CONFLICT.
 *
 * `proposeArtifact` turns a completed run into a LearningProposal —
 * a NEW content-addressed artifact proposal (e.g. an A019 SkillDraft
 * bound by digest) — rejected with LEARNING_REWRITE_ATTEMPT whenever
 * the proposal would consume a historical digest as its output (the
 * learning boundary, lock rule 6).
 */

import { digestCanonical, isIdempotencyKey } from '@arena/protocol-core';
import { isTrajectoryRecord, isTrajectoryCompleted } from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';
import { isEvaluationRecord } from '@arena/evaluation';
import type { EvaluationRecord } from '@arena/evaluation';
import { isVerificationRecord } from '@arena/verification';
import type { VerificationRecord } from '@arena/verification';
import {
  LEARNING_ERROR_CODES,
  LearningError,
  attributeExperiment,
  checkProtectedCapabilities,
  compareOutcomeMetrics,
  computeUncertaintyReport,
  createExperimentRunRecord,
  decideCapabilityLift,
  freezeHistoricalInputs,
  historicalDigestsOfRun,
  proposeLearningArtifact,
} from '@arena/learning';
import type {
  AttributionResultView,
  CapabilityLiftVerdict,
  ExperimentDescriptor,
  ExperimentRunRecord,
  LearningProposal,
  MetricMeasurement,
  ProtectedMeasurement,
} from '@arena/learning';
import { ExperimentRegistry } from './registry.js';
import type { ExperimentRegistry as Registry } from './registry.js';

/** Implementation version of the reference engine (provenance). */
export const LEARNING_IMPLEMENTATION_VERSION = '0.1.0';

/** The evidence + measurements of one experiment arm. */
export interface ExperimentArmInput {
  readonly trajectories: readonly TrajectoryRecord[];
  readonly evaluations: readonly EvaluationRecord[];
  readonly verifications: readonly VerificationRecord[];
  readonly metrics: readonly {
    readonly metricId: string;
    readonly value: number;
    readonly variance: number | null;
  }[];
  readonly protectedMetrics: readonly {
    readonly capabilityRef: string;
    readonly value: number;
  }[];
}

/** Both arms of one experiment run. */
export interface ExperimentArmsInput {
  readonly baseline: ExperimentArmInput;
  readonly intervention: ExperimentArmInput;
}

/** Options for one experiment run. */
export interface RunExperimentOptions {
  /** REQUIRED idempotency key — the experiment key (architecture-lock rule 17). */
  readonly experimentKey: string;
  /** REQUIRED correlation id of the causal flow. */
  readonly correlationId: string;
  /** Fixed recorded-at (ms-precision UTC); defaults to the run clock. */
  readonly recordedAt?: string;
  /** Free-form provenance notes recorded onto the run record. */
  readonly provenanceNotes?: string | null;
}

interface IdempotencyBinding {
  readonly commandCanonical: string;
  readonly recordDigest: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** True iff a verification record's evidence bundle names the given trajectory digest (the A013-side binding). */
function verificationReferencesTrajectory(
  record: VerificationRecord,
  trajectoryDigest: string,
): boolean {
  return record.evidence.some((entry) => entry.artifact.digest === trajectoryDigest);
}

async function armInputDigest(arm: ExperimentArmInput): Promise<string> {
  return digestCanonical({
    trajectories: arm.trajectories.map((entry) => entry.chainHead as string),
    evaluations: arm.evaluations.map((entry) => entry.digest as string),
    verifications: arm.verifications.map((entry) => entry.digest as string),
    metrics: arm.metrics,
    protectedMetrics: arm.protectedMetrics,
  });
}

function toArmRunRefs(arm: ExperimentArmInput): {
  readonly trajectories: readonly string[];
  readonly evaluations: readonly string[];
  readonly verifications: readonly string[];
} {
  return {
    trajectories: Object.freeze(arm.trajectories.map((entry) => entry.chainHead as string)),
    evaluations: Object.freeze(arm.evaluations.map((entry) => entry.digest as string)),
    verifications: Object.freeze(arm.verifications.map((entry) => entry.digest as string)),
  };
}

// ---------------------------------------------------------------------------
// Arm contract enforcement (REAL guards, never reimplemented)
// ---------------------------------------------------------------------------

function enforceArmContracts(
  armName: 'baseline' | 'intervention',
  arm: ExperimentArmInput,
  descriptor: ExperimentDescriptor,
): void {
  if (arm.trajectories.length === 0) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
      message: `${armName} arm: at least one trajectory record is required`,
    });
  }
  const chainHeads = new Set<string>();
  for (const trajectory of arm.trajectories) {
    if (!isTrajectoryRecord(trajectory)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
        message: `${armName} arm: every trajectory must be a structurally valid A011 TrajectoryRecord (REAL @arena/trajectory guard)`,
      });
    }
    if (!isTrajectoryCompleted(trajectory)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
        message: `${armName} arm: trajectory ${trajectory.header.trajectoryId} has no completion entry — only trajectories frozen at completion are stable experiment inputs`,
        details: { trajectoryId: trajectory.header.trajectoryId, chainHead: trajectory.chainHead },
      });
    }
    const chainHead = trajectory.chainHead as string;
    if (chainHeads.has(chainHead)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
        message: `${armName} arm: duplicate trajectory chain head ${chainHead}`,
      });
    }
    chainHeads.add(chainHead);

    // Pinned population (Q1.0 condition 1) — task version pinning.
    const taskVersion = trajectory.header.run.taskVersion;
    const pinned = descriptor.taskPopulation.some(
      (entry) => entry.taskId === taskVersion.taskId && entry.version === taskVersion.version,
    );
    if (!pinned) {
      throw new LearningError(LEARNING_ERROR_CODES.PINNED_POPULATION_MISMATCH, {
        message: `${armName} arm: trajectory ${trajectory.header.trajectoryId} ran task ${taskVersion.taskId}@${taskVersion.version}, which is NOT in the experiment's pinned task population (Q1.0 condition 1: improvement is measured on a PINNED evaluation population)`,
        details: {
          trajectoryId: trajectory.header.trajectoryId,
          task: `${taskVersion.taskId}@${taskVersion.version}`,
          pinned: descriptor.taskPopulation.map(
            (entry) => `${entry.taskId}@${entry.version}`,
          ),
        },
      });
    }

    // Pinned environment versions.
    const environmentDigest = trajectory.header.run.environmentVersion.digest as string;
    const environmentPinned = descriptor.environmentVersions.some(
      (entry) => (entry.digest as string) === environmentDigest,
    );
    if (!environmentPinned) {
      throw new LearningError(LEARNING_ERROR_CODES.ENVIRONMENT_MISMATCH, {
        message: `${armName} arm: trajectory ${trajectory.header.trajectoryId} ran in environment digest ${environmentDigest}, which is NOT among the experiment's pinned environment versions`,
        details: { environmentDigest, pinned: descriptor.environmentVersions.map((e) => e.digest) },
      });
    }

    // Baseline composition pins (declared Body/Model are enforced where the evidence tier carries them).
    if (armName === 'baseline') {
      if (
        descriptor.baseline.bodyRef !== null &&
        (trajectory.header.agentBodyRef as string) !== (descriptor.baseline.bodyRef as string)
      ) {
        throw new LearningError(LEARNING_ERROR_CODES.BASELINE_MISMATCH, {
          message: `${armName} arm: trajectory ${trajectory.header.trajectoryId} ran with body digest ${trajectory.header.agentBodyRef}, but the descriptor pins baseline body ${descriptor.baseline.bodyRef}`,
          details: {
            trajectoryId: trajectory.header.trajectoryId,
            actual: trajectory.header.agentBodyRef,
            pinned: descriptor.baseline.bodyRef,
          },
        });
      }
      if (
        descriptor.baseline.substrateRef !== null &&
        (trajectory.header.substrateRef as string) !== (descriptor.baseline.substrateRef as string)
      ) {
        throw new LearningError(LEARNING_ERROR_CODES.BASELINE_MISMATCH, {
          message: `${armName} arm: trajectory ${trajectory.header.trajectoryId} ran with substrate digest ${trajectory.header.substrateRef}, but the descriptor pins baseline substrate ${descriptor.baseline.substrateRef}`,
          details: {
            trajectoryId: trajectory.header.trajectoryId,
            actual: trajectory.header.substrateRef,
            pinned: descriptor.baseline.substrateRef,
          },
        });
      }
    }
  }

  for (const evaluation of arm.evaluations) {
    if (!isEvaluationRecord(evaluation)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
        message: `${armName} arm: every evaluation must be a structurally valid A012 EvaluationRecord (REAL @arena/evaluation guard)`,
      });
    }
    if (!chainHeads.has(evaluation.trajectoryRef as string)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
        message: `${armName} arm: evaluation record ${evaluation.digest} judges trajectory ${evaluation.trajectoryRef}, not one of this arm's trajectories (an evaluation of a different trajectory establishes nothing here)`,
        details: { evaluationDigest: evaluation.digest, judged: evaluation.trajectoryRef },
      });
    }
  }

  for (const verification of arm.verifications) {
    if (!isVerificationRecord(verification)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
        message: `${armName} arm: every verification must be a structurally valid A013 VerificationRecord (REAL @arena/verification guard)`,
      });
    }
    const addressesArm = [...chainHeads].some((chainHead) =>
      verificationReferencesTrajectory(verification, chainHead),
    );
    if (!addressesArm) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
        message: `${armName} arm: verification record ${verification.digest} does not reference any of this arm's trajectories in its evidence bundle (a verification of other evidence establishes nothing here)`,
        details: { verificationDigest: verification.digest },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** The in-process reference learning experiment engine. */
export class ExperimentEngine {
  readonly registry: Registry;

  /** Run records by digest — the append-only, content-addressed ledger. */
  private readonly recordsByDigest = new Map<string, ExperimentRunRecord>();
  /** descriptor digest → record digests. */
  private readonly descriptorIndex = new Map<string, string[]>();
  /** correlation id → record digests. */
  private readonly correlationIndex = new Map<string, string[]>();
  /** Insertion-ordered ledger. */
  private readonly ledger: ExperimentRunRecord[] = [];
  /** Experiment keys → the runs they authorized. */
  private readonly experimentKeys = new Map<string, IdempotencyBinding>();
  /** Proposals by digest — the append-only proposal store. */
  private readonly proposalsByDigest = new Map<string, LearningProposal>();

  constructor(registry: Registry = new ExperimentRegistry()) {
    this.registry = registry;
  }

  /** Register an experiment descriptor (delegates to the registry). */
  async registerExperiment(
    descriptor: ExperimentDescriptor,
  ): Promise<ExperimentDescriptor> {
    return this.registry.registerExperiment(descriptor);
  }

  // -------------------------------------------------------------------------
  // The runner: resolve → enforce arm contracts → freeze → compute → record
  // -------------------------------------------------------------------------

  async run(
    descriptorRef: string,
    arms: ExperimentArmsInput,
    options: RunExperimentOptions,
  ): Promise<ExperimentRunRecord> {
    if (!isIdempotencyKey(options.experimentKey)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
        message: `run requires a valid experiment key (idempotency key): ${JSON.stringify(options.experimentKey)}`,
      });
    }

    const descriptor = this.registry.getExperiment(descriptorRef);
    if (descriptor === undefined) {
      throw new LearningError(LEARNING_ERROR_CODES.NOT_FOUND, {
        message: `no experiment descriptor registered at digest ${JSON.stringify(descriptorRef)}`,
        details: {
          descriptorRef,
          registered: this.registry.listExperiments().map((entry) => entry.digest),
        },
      });
    }

    // 2. Enforce the arm contracts (REAL sibling guards + pinning).
    enforceArmContracts('baseline', arms.baseline, descriptor);
    enforceArmContracts('intervention', arms.intervention, descriptor);

    // 3. Freeze the historical inputs — the learning boundary layer 1
    // (read-only over the evidence tier; measurements are not records).
    const baselineFrozen = freezeHistoricalInputs({
      trajectories: arms.baseline.trajectories,
      evaluations: arms.baseline.evaluations,
      verifications: arms.baseline.verifications,
    });
    const interventionFrozen = freezeHistoricalInputs({
      trajectories: arms.intervention.trajectories,
      evaluations: arms.intervention.evaluations,
      verifications: arms.intervention.verifications,
    });

    // Idempotency address: descriptor digest + both arm input digests.
    const baselineDigest = await armInputDigest(arms.baseline);
    const interventionDigest = await armInputDigest(arms.intervention);
    const command = JSON.stringify([
      descriptor.digest as string,
      baselineDigest,
      interventionDigest,
    ]);

    const binding = this.experimentKeys.get(options.experimentKey);
    if (binding !== undefined) {
      if (binding.commandCanonical !== command) {
        throw new LearningError(LEARNING_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `experiment key ${JSON.stringify(options.experimentKey)} is already bound to a different run command (same key + different descriptor/arms is a conflict, not a rerun)`,
          details: {
            experimentKey: options.experimentKey,
            bound: binding.commandCanonical,
            attempted: command,
          },
        });
      }
      const stored = this.recordsByDigest.get(binding.recordDigest);
      if (stored !== undefined) return stored;
    }

    // 4. Pure computations (the package's deterministic core).
    const comparison = compareOutcomeMetrics(
      descriptor.outcomeMetrics,
      arms.baseline.metrics,
      arms.intervention.metrics,
    );
    const protectedChecks = checkProtectedCapabilities(
      descriptor.protectedCapabilities,
      arms.baseline.protectedMetrics,
      arms.intervention.protectedMetrics,
    );
    const uncertainty = computeUncertaintyReport(
      descriptor.uncertainty,
      arms.baseline.metrics,
      arms.intervention.metrics,
    );
    const attribution: AttributionResultView = attributeExperiment(
      descriptor,
      baselineFrozen,
      interventionFrozen,
      uncertainty,
    );
    const verdict: CapabilityLiftVerdict = decideCapabilityLift(
      descriptor,
      comparison,
      uncertainty,
      attribution,
      protectedChecks,
      arms.intervention.verifications,
    );

    // 5. Build + append the run record.
    const recordedAt = options.recordedAt ?? nowIso();
    const record = await createExperimentRunRecord({
      experimentKey: options.experimentKey,
      correlationId: options.correlationId,
      descriptorRef: descriptor.digest as string,
      baseline: toArmRunRefs(arms.baseline),
      intervention: toArmRunRefs(arms.intervention),
      baselineMetrics: [...arms.baseline.metrics] as MetricMeasurement[],
      interventionMetrics: [...arms.intervention.metrics] as MetricMeasurement[],
      comparison: [...comparison],
      uncertainty,
      protectedCapabilityChecks: [...protectedChecks],
      attribution,
      verdict,
      provenance: {
        executedBy: 'arena-learning-fabric',
        recordedAt,
        notes: options.provenanceNotes === undefined ? null : options.provenanceNotes,
      },
    });

    this.append(record);
    this.experimentKeys.set(options.experimentKey, {
      commandCanonical: command,
      recordDigest: record.digest,
    });
    return record;
  }

  /** Append a record to the ledgers (content-addressed, append-only). */
  private append(record: ExperimentRunRecord): void {
    if (this.recordsByDigest.has(record.digest)) return; // content-addressed dedup
    this.recordsByDigest.set(record.digest, record);
    this.ledger.push(record);
    const descriptorList = this.descriptorIndex.get(record.descriptorRef as string) ?? [];
    descriptorList.push(record.digest);
    this.descriptorIndex.set(record.descriptorRef as string, descriptorList);
    const correlationList = this.correlationIndex.get(record.correlationId as string) ?? [];
    correlationList.push(record.digest);
    this.correlationIndex.set(record.correlationId as string, correlationList);
  }

  // -------------------------------------------------------------------------
  // Proposals (the learning boundary: new content-addressed objects only)
  // -------------------------------------------------------------------------

  /**
   * Propose a NEW learning artifact from a completed run — e.g. an
   * A019 SkillDraft bound by digest. The proposal is validated and
   * boundary-checked: proposing an artifact digest that IS a
   * historical digest the experiment consumed is REJECTED with
   * LEARNING_REWRITE_ATTEMPT (lock rule 6 — learning never rewrites
   * historical records).
   */
  async proposeArtifact(
    runRecord: ExperimentRunRecord,
    input: {
      readonly proposalId: string;
      readonly version: string;
      readonly proposedArtifactRef: string;
      readonly changedSurface: string;
      readonly supersedes: string | null;
      readonly provenance: {
        readonly proposedBy: string;
        readonly proposedAt: string;
        readonly notes: string | null;
      };
    },
    arms: ExperimentArmsInput,
  ): Promise<LearningProposal> {
    const descriptor = this.registry.getExperiment(runRecord.descriptorRef as string);
    if (descriptor === undefined) {
      throw new LearningError(LEARNING_ERROR_CODES.NOT_FOUND, {
        message: `proposal construction requires the motivating run's descriptor at digest ${JSON.stringify(runRecord.descriptorRef)}`,
      });
    }
    const historical = historicalDigestsOfRun({
      descriptorRef: descriptor.digest as string,
      baseline: freezeHistoricalInputs({
        trajectories: arms.baseline.trajectories,
        evaluations: arms.baseline.evaluations,
        verifications: arms.baseline.verifications,
      }),
      intervention: freezeHistoricalInputs({
        trajectories: arms.intervention.trajectories,
        evaluations: arms.intervention.evaluations,
        verifications: arms.intervention.verifications,
      }),
    });
    const proposal = await proposeLearningArtifact(
      {
        ...input,
        basisExperimentRef: runRecord.digest as string,
      },
      historical,
    );
    this.proposalsByDigest.set(proposal.digest as string, proposal);
    return proposal;
  }

  // -------------------------------------------------------------------------
  // Queries (pure projections)
  // -------------------------------------------------------------------------

  /** Get a run record by its digest (exact, historical, forever). */
  getRunRecord(digest: string): ExperimentRunRecord | undefined {
    return this.recordsByDigest.get(digest);
  }

  /** All run records of one descriptor digest (insertion order). */
  listRunsByDescriptor(descriptorRef: string): readonly ExperimentRunRecord[] {
    const digests = this.descriptorIndex.get(descriptorRef);
    if (digests === undefined) return [];
    return digests
      .map((digest) => this.recordsByDigest.get(digest))
      .filter((record): record is ExperimentRunRecord => record !== undefined);
  }

  /** All run records of one correlation id (insertion order). */
  listRunsByCorrelation(correlationId: string): readonly ExperimentRunRecord[] {
    const digests = this.correlationIndex.get(correlationId);
    if (digests === undefined) return [];
    return digests
      .map((digest) => this.recordsByDigest.get(digest))
      .filter((record): record is ExperimentRunRecord => record !== undefined);
  }

  /** The full run ledger (insertion order) — observability dump. */
  listRuns(): readonly ExperimentRunRecord[] {
    return [...this.ledger];
  }

  /** Get a proposal by its digest. */
  getProposal(digest: string): LearningProposal | undefined {
    return this.proposalsByDigest.get(digest);
  }

  /** All emitted proposals (emission order) — observability dump. */
  listProposals(): readonly LearningProposal[] {
    return [...this.proposalsByDigest.values()];
  }
}

export type { ProtectedMeasurement };
