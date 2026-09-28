/**
 * EvaluationFabric — the in-process reference RUNNER and record ledger
 * (Work Order A012 gate 6; requirements R12, R23).
 *
 * Pure TypeScript, ZERO external runtime dependencies (only
 * @arena/protocol-core + @arena/evaluation + the two judged-object
 * domain packages @arena/capability-case / @arena/trajectory, whose
 * real structural guards anchor the input contract to the REAL
 * packages — the digest refs are not just strings here).
 *
 * `evaluate(evaluatorRef, caseRecord, trajectoryRecord, options)` is
 * PURE ORCHESTRATION (gate 6):
 *   1. resolve refs — evaluator by descriptor digest and criteria by
 *      the descriptor's criteriaRef, both from the registry
 *      (EVALUATION_NOT_FOUND when absent);
 *   2. enforce the input contract — the A005 CapabilityCase and A011
 *      TrajectoryRecord are checked with their REAL structural guards,
 *      then digest-bound: case.digest === inputs.caseRef,
 *      chainHead === inputs.trajectoryRef, and the optional
 *      body/substrate pins against the trajectory header's
 *      agentBodyRef/substrateRef;
 *   3. enforce the seed contract — a seeded evaluator requires a seed
 *      (score stability under rerun is seed-addressed);
 *   4. invoke the evaluator hook (the ONLY pluggable seam — hooks
 *      never construct records);
 *   5. build the EvaluationRecord through the domain constructor
 *      (which validates the verdict set against the criteria, computes
 *      the aggregate per the aggregation policy and freezes the
 *      record), and record it in the ledger.
 *
 * Idempotency (architecture-lock rule 17): `evaluate` accepts an
 * idempotency key. The same key + the same command tuple
 * (evaluator, case, trajectory, seed) replays as a no-op returning
 * the stored record; the same key + a different tuple is an
 * IDEMPOTENCY_CONFLICT.
 *
 * Records are append-only content-addressed entries: no update/delete
 * APIs exist, every record stays addressable by digest forever, and
 * queries are pure projections (by case, by trajectory, by time range).
 */

import {
  EVALUATION_ERROR_CODES,
  EvaluationError,
  createEvaluationRecord,
  isEvaluationRecord,
} from '@arena/evaluation';
import type { EvaluationRecord } from '@arena/evaluation';
import { isCapabilityCase } from '@arena/capability-case';
import type { CapabilityCase } from '@arena/capability-case';
import { isTrajectoryRecord } from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';
import { EvaluatorRegistry } from './registry.js';
import type { EvaluatorRegistry as Registry } from './registry.js';
import type { EvaluatorDescriptor } from '@arena/evaluation';

/** Options for one evaluation run. */
export interface EvaluateOptions {
  /** Idempotency key (architecture-lock rule 17). */
  readonly idempotencyKey?: string;
  /**
   * The run seed (null when the evaluator is unseeded). REQUIRED for
   * evaluators whose reproducibility declares seeded: true.
   */
  readonly seed?: string | null;
  /** Fixed started-at (ms-precision UTC); defaults to the run clock. */
  readonly startedAt?: string;
  /** Fixed finished-at; defaults to the run clock after the hook returns. */
  readonly finishedAt?: string;
  /** Free-form provenance notes recorded onto the record. */
  readonly provenanceNotes?: string | null;
}

/** Inclusive finished-at bounds; both ends optional. */
export interface RecordTimeRange {
  readonly from?: string;
  readonly to?: string;
}

interface IdempotencyBinding {
  readonly commandCanonical: string;
  readonly recordDigest: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function commandCanonicalOf(
  evaluatorRef: string,
  caseRef: string,
  trajectoryRef: string,
  seed: string | null,
): string {
  return JSON.stringify([evaluatorRef, caseRef, trajectoryRef, seed]);
}

/**
 * The in-process reference fabric: registry + runner + record ledger.
 * Construct with `new EvaluationFabric()` (fresh registry) or pass a
 * pre-populated registry.
 */
export class EvaluationFabric {
  readonly registry: Registry;

  /** Records by digest — the append-only, content-addressed ledger. */
  private readonly recordsByDigest = new Map<string, EvaluationRecord>();
  /** case digest → record digests. */
  private readonly caseIndex = new Map<string, Set<string>>();
  /** trajectory digest → record digests. */
  private readonly trajectoryIndex = new Map<string, Set<string>>();
  /** Insertion-ordered ledger for time-range queries. */
  private readonly ledger: EvaluationRecord[] = [];
  /** Run idempotency keys → the run they authorized. */
  private readonly runKeys = new Map<string, IdempotencyBinding>();

  constructor(registry: Registry = new EvaluatorRegistry()) {
    this.registry = registry;
  }

  // -------------------------------------------------------------------------
  // The runner (gate 6): resolve refs → enforce contracts → hook → record
  // -------------------------------------------------------------------------

  async evaluate(
    evaluatorRef: string,
    caseRecord: CapabilityCase,
    trajectoryRecord: TrajectoryRecord,
    options: EvaluateOptions = {},
  ): Promise<EvaluationRecord> {
    const seed = options.seed === undefined ? null : options.seed;
    const command = commandCanonicalOf(
      evaluatorRef,
      isCapabilityCase(caseRecord) ? caseRecord.digest : 'invalid-case',
      isTrajectoryRecord(trajectoryRecord) ? trajectoryRecord.chainHead : 'invalid-trajectory',
      seed,
    );

    // Idempotent replay: same key + same command ⇒ the stored record.
    if (options.idempotencyKey !== undefined) {
      const binding = this.runKeys.get(options.idempotencyKey);
      if (binding !== undefined) {
        if (binding.commandCanonical !== command) {
          throw new EvaluationError(EVALUATION_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
            message: `idempotency key ${JSON.stringify(options.idempotencyKey)} is already bound to a different run-evaluation command (same key + different refs/seed is a conflict, not a rerun)`,
            details: { idempotencyKey: options.idempotencyKey, bound: binding.commandCanonical, attempted: command },
          });
        }
        const stored = this.recordsByDigest.get(binding.recordDigest);
        if (stored !== undefined) return stored;
      }
    }

    // 1. Resolve refs.
    const registration = this.registry.getEvaluator(evaluatorRef);
    if (registration === undefined) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.NOT_FOUND, {
        message: `no evaluator registered at descriptor digest ${JSON.stringify(evaluatorRef)}`,
        details: { evaluatorRef, registered: this.registry.listEvaluators().map((d) => d.digest) },
      });
    }
    const descriptor = registration.descriptor;
    const criteria = this.registry.getCriteria(descriptor.criteriaRef);
    if (criteria === undefined) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.NOT_FOUND, {
        message: `no criteria registered at digest ${JSON.stringify(descriptor.criteriaRef)} (referenced by evaluator ${JSON.stringify(evaluatorIdentity(descriptor))})`,
        details: { criteriaRef: descriptor.criteriaRef },
      });
    }

    // 2. Enforce the input contract against the REAL resolved objects.
    this.enforceInputContract(descriptor, caseRecord, trajectoryRecord);

    // 3. Enforce the seed contract.
    if (descriptor.reproducibility.seeded && seed === null) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_REPRODUCIBILITY, {
        message: `evaluator ${JSON.stringify(evaluatorIdentity(descriptor))} declares seeded reproducibility and requires a run seed (score stability under rerun is seed-addressed)`,
        details: { evaluatorRef, seeded: true },
      });
    }

    // 4. Invoke the evaluator hook.
    const startedAt = options.startedAt ?? nowIso();
    const verdicts = await registration.hook({
      descriptor,
      criteria,
      caseRecord,
      trajectoryRecord,
      seed,
    });
    const finishedAt = options.finishedAt ?? nowIso();

    // 5. Build the record through the domain constructor.
    const record = await createEvaluationRecord(
      {
        evaluatorRef: descriptor.digest,
        caseRef: caseRecord.digest,
        trajectoryRef: trajectoryRecord.chainHead,
        criteriaRef: criteria.digest,
        seed,
        verdicts,
        confidence: descriptor.confidence,
        limitations: null, // run-level caveats; the descriptor's limitations stand
        startedAt,
        finishedAt,
        provenance: {
          executedBy: descriptor.evaluatorId,
          recordedAt: finishedAt,
          notes: options.provenanceNotes === undefined ? null : options.provenanceNotes,
        },
      },
      criteria,
    );

    this.record(record);
    if (options.idempotencyKey !== undefined) {
      this.runKeys.set(options.idempotencyKey, {
        commandCanonical: command,
        recordDigest: record.digest,
      });
    }
    return record;
  }

  /** Validate the descriptor's input contract against the resolved objects. */
  private enforceInputContract(
    descriptor: EvaluatorDescriptor,
    caseRecord: CapabilityCase,
    trajectoryRecord: TrajectoryRecord,
  ): void {
    if (!isCapabilityCase(caseRecord)) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_INPUT_CONTRACT, {
        message: 'the resolved case record is not a structurally valid A005 CapabilityCase',
      });
    }
    if (!isTrajectoryRecord(trajectoryRecord)) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_INPUT_CONTRACT, {
        message: 'the resolved trajectory record is not a structurally valid A011 TrajectoryRecord',
      });
    }
    const caseDigest: string = caseRecord.digest;
    if (descriptor.inputs.caseRef !== caseDigest) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_INPUT_CONTRACT, {
        message: `input contract violation: evaluator pins case digest ${descriptor.inputs.caseRef} but the resolved case digest is ${caseDigest}`,
        details: { pinned: descriptor.inputs.caseRef, resolved: caseDigest },
      });
    }
    const trajectoryDigest: string = trajectoryRecord.chainHead;
    if (descriptor.inputs.trajectoryRef !== trajectoryDigest) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_INPUT_CONTRACT, {
        message: `input contract violation: evaluator pins trajectory digest ${descriptor.inputs.trajectoryRef} but the resolved trajectory chain head is ${trajectoryDigest}`,
        details: { pinned: descriptor.inputs.trajectoryRef, resolved: trajectoryDigest },
      });
    }
    if (
      descriptor.inputs.bodyRef !== null &&
      descriptor.inputs.bodyRef !== (trajectoryRecord.header.agentBodyRef as string)
    ) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_INPUT_CONTRACT, {
        message: `input contract violation: evaluator pins body digest ${descriptor.inputs.bodyRef} but the trajectory's agent/body ref is ${trajectoryRecord.header.agentBodyRef as string}`,
        details: { pinned: descriptor.inputs.bodyRef, resolved: trajectoryRecord.header.agentBodyRef },
      });
    }
    if (
      descriptor.inputs.substrateRef !== null &&
      descriptor.inputs.substrateRef !== (trajectoryRecord.header.substrateRef as string)
    ) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_INPUT_CONTRACT, {
        message: `input contract violation: evaluator pins substrate digest ${descriptor.inputs.substrateRef} but the trajectory's substrate ref is ${trajectoryRecord.header.substrateRef as string}`,
        details: { pinned: descriptor.inputs.substrateRef, resolved: trajectoryRecord.header.substrateRef },
      });
    }
  }

  /** Append a record to the ledger (content-addressed; no update/delete). */
  private record(evaluated: EvaluationRecord): void {
    if (!isEvaluationRecord(evaluated)) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_RECORD, {
        message: 'the ledger only accepts structurally valid evaluation records',
      });
    }
    if (this.recordsByDigest.has(evaluated.digest)) return; // content-addressed dedup
    this.recordsByDigest.set(evaluated.digest, evaluated);
    this.ledger.push(evaluated);
    const caseSet = this.caseIndex.get(evaluated.caseRef) ?? new Set<string>();
    caseSet.add(evaluated.digest);
    this.caseIndex.set(evaluated.caseRef, caseSet);
    const trajectorySet = this.trajectoryIndex.get(evaluated.trajectoryRef) ?? new Set<string>();
    trajectorySet.add(evaluated.digest);
    this.trajectoryIndex.set(evaluated.trajectoryRef, trajectorySet);
  }

  // -------------------------------------------------------------------------
  // Queries (gate 6: pure projections)
  // -------------------------------------------------------------------------

  /** Get a record by its digest (exact, historical, forever). */
  getRecord(ref: string): EvaluationRecord | undefined {
    return this.recordsByDigest.get(ref);
  }

  /** All records judging the given case digest (insertion order). */
  listRecordsByCase(caseRef: string): readonly EvaluationRecord[] {
    const digests = this.caseIndex.get(caseRef);
    if (digests === undefined) return [];
    return [...digests].map((digest) => this.recordsByDigest.get(digest)).filter(
      (record): record is EvaluationRecord => record !== undefined,
    );
  }

  /** All records judging the given trajectory digest (insertion order). */
  listRecordsByTrajectory(trajectoryRef: string): readonly EvaluationRecord[] {
    const digests = this.trajectoryIndex.get(trajectoryRef);
    if (digests === undefined) return [];
    return [...digests].map((digest) => this.recordsByDigest.get(digest)).filter(
      (record): record is EvaluationRecord => record !== undefined,
    );
  }

  /**
   * Records whose finishedAt lies within the inclusive [from, to] range
   * (both ends optional), in ledger insertion order.
   */
  listRecordsByTimeRange(range: RecordTimeRange = {}): readonly EvaluationRecord[] {
    const from = range.from === undefined ? null : Date.parse(range.from);
    const to = range.to === undefined ? null : Date.parse(range.to);
    if (from !== null && Number.isNaN(from)) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_TIMESTAMP, {
        message: `time-range query: invalid 'from' timestamp: ${JSON.stringify(range.from)}`,
      });
    }
    if (to !== null && Number.isNaN(to)) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_TIMESTAMP, {
        message: `time-range query: invalid 'to' timestamp: ${JSON.stringify(range.to)}`,
      });
    }
    return this.ledger.filter((record) => {
      const finished = Date.parse(record.finishedAt);
      if (from !== null && finished < from) return false;
      if (to !== null && finished > to) return false;
      return true;
    });
  }

  /** The full ledger (insertion order) — observability dump. */
  listRecords(): readonly EvaluationRecord[] {
    return [...this.ledger];
  }
}

function evaluatorIdentity(descriptor: { evaluatorId: string; version: string }): string {
  return `${descriptor.evaluatorId}@${descriptor.version}`;
}
