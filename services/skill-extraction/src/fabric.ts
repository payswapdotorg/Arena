/**
 * ExtractionService — the in-process reference EXTRACTION FABRIC (Work
 * Order A019 item 6; requirement R17): the policy registry, the
 * extraction runner, the append-only run-record ledger and the draft
 * store.
 *
 * Pure TypeScript, ZERO external runtime dependencies (only
 * @arena/protocol-core + @arena/skill-extraction — the domain package
 * whose pure mining core and REAL guards anchor the fabric to the
 * protocol). In-process only: no network, no database (the A019
 * reference slice, mirroring the A012/A013 reference fabrics).
 *
 * `extract(policyRef, refs, options)` is PURE ORCHESTRATION:
 *   1. resolve the policy by digest from the registry
 *      (NOT_FOUND when absent);
 *   2. enforce the validated-input contract — every ref must pass the
 *      package's toValidatedTrajectoryRef guard (unvalidated
 *      trajectories are REFUSED — the R17 gate never bypasses);
 *   3. run the pure mining core (validation gates → eligibility →
 *      signatures → thresholds → candidates) with the run's
 *      correlation id + timestamps as the deterministic context;
 *   4. build the SkillDrafts for accepted candidates (A004-ready by
 *      construction; supersession by append via options.supersessions);
 *   5. build the ExtractionRunRecord through its constructor (which
 *      validates the full decision log + candidate/draft pairing) and
 *      append it to the ledger.
 *
 * Idempotency (architecture-lock rule 17): the same run key + the same
 * command tuple (policy, inputs) replays as a no-op returning the
 * STORED record — byte-identical, never duplicated; the same key + a
 * different tuple is an IDEMPOTENCY_CONFLICT.
 *
 * The ledger is append-only and content-addressed: no update/delete
 * APIs, every record stays addressable by digest forever, queries are
 * pure projections (by policy, by correlation id, by time range).
 */

import {
  EXTRACTION_IMPLEMENTATION_VERSION,
  SKILL_EXTRACTION_ERROR_CODES,
  SkillExtractionError,
  buildSkillDraft,
  mineSkillCandidates,
  toValidatedTrajectoryRef,
} from '@arena/skill-extraction';
import type {
  ExtractionPolicy,
  SkillDraft,
  ValidatedTrajectoryRef,
} from '@arena/skill-extraction';
import type { CorrelationId } from '@arena/protocol-core';
import { isIdempotencyKey } from '@arena/protocol-core';
import { ExtractionPolicyRegistry } from './registry.js';
import type { ExtractionPolicyRegistry as Registry } from './registry.js';
import { createExtractionRunRecord } from './record.js';
import type { ExtractionRunRecord } from './record.js';

/** Options for one extraction run. */
export interface ExtractOptions {
  /** REQUIRED idempotency key — the run key (architecture-lock rule 17). */
  readonly runKey: string;
  /** REQUIRED correlation id of the causal flow. */
  readonly correlationId: string;
  /** Fixed started-at (ms-precision UTC); defaults to the run clock. */
  readonly startedAt?: string;
  /** Fixed finished-at; defaults to the run clock after mining. */
  readonly finishedAt?: string;
  /**
   * Optional supersession map: candidate digest → the digest of the
   * PRIOR skill-node version the emitted draft should supersede
   * (append-only supersession) plus its bumped skill-node version.
   */
  readonly supersessions?: ReadonlyMap<
    string,
    { readonly supersedes: string; readonly skillVersion?: string }
  >;
  /** Free-form provenance notes recorded onto the run record. */
  readonly provenanceNotes?: string | null;
}

/** Inclusive finished-at bounds; both ends optional. */
export interface RunTimeRange {
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

function commandCanonicalOf(policyRef: string, inputDigests: readonly string[]): string {
  return JSON.stringify([policyRef, inputDigests]);
}

/** The in-process reference extraction fabric. */
export class ExtractionService {
  readonly registry: Registry;

  /** Run records by digest — the append-only, content-addressed ledger. */
  private readonly recordsByDigest = new Map<string, ExtractionRunRecord>();
  /** policy digest → record digests. */
  private readonly policyIndex = new Map<string, string[]>();
  /** correlation id → record digests. */
  private readonly correlationIndex = new Map<string, string[]>();
  /** Insertion-ordered ledger for time-range queries. */
  private readonly ledger: ExtractionRunRecord[] = [];
  /** Run keys → the runs they authorized. */
  private readonly runKeys = new Map<string, IdempotencyBinding>();
  /** Drafts by digest — the append-only draft store. */
  private readonly draftsByDigest = new Map<string, SkillDraft>();
  /** Candidate digest → the draft that packages it. */
  private readonly draftByCandidate = new Map<string, string>();

  constructor(registry: Registry = new ExtractionPolicyRegistry()) {
    this.registry = registry;
  }

  /** Register an extraction policy (delegates to the registry). */
  async registerPolicy(policy: ExtractionPolicy): Promise<ExtractionPolicy> {
    return this.registry.registerPolicy(policy);
  }

  // -------------------------------------------------------------------------
  // The runner: resolve → enforce contracts → mine → draft → record
  // -------------------------------------------------------------------------

  async extract(
    policyRef: string,
    refs: readonly ValidatedTrajectoryRef[],
    options: ExtractOptions,
  ): Promise<ExtractionRunRecord> {
    if (!isIdempotencyKey(options.runKey)) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, {
        message: `extract requires a valid run key (idempotency key): ${JSON.stringify(options.runKey)}`,
      });
    }
    if (refs.length === 0) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_REF, {
        message: 'extract requires at least one validated trajectory ref',
      });
    }

    // Re-validate every ref through the package guard — the R17 gate
    // never bypasses, even for callers holding typed objects. The ref
    // view is unfolded into the guard's input shape so the full
    // validation (trajectory completion, record bindings, verification
    // presence) runs again against the CURRENT content.
    const validated: ValidatedTrajectoryRef[] = [];
    for (const ref of refs) {
      validated.push(
        await toValidatedTrajectoryRef({
          trajectory: ref.trajectory,
          evaluations: [...ref.evaluations],
          verifications: [...ref.verifications],
        }),
      );
    }
    const inputDigests = validated.map((ref) => ref.digest as string);
    const command = commandCanonicalOf(policyRef, inputDigests);

    // Idempotent replay: same key + same command ⇒ the stored record.
    const binding = this.runKeys.get(options.runKey);
    if (binding !== undefined) {
      if (binding.commandCanonical !== command) {
        throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `run key ${JSON.stringify(options.runKey)} is already bound to a different extraction command (same key + different policy/inputs is a conflict, not a rerun)`,
          details: { runKey: options.runKey, bound: binding.commandCanonical, attempted: command },
        });
      }
      const stored = this.recordsByDigest.get(binding.recordDigest);
      if (stored !== undefined) return stored;
    }

    // 1. Resolve the policy.
    const policy = this.registry.getPolicy(policyRef);
    if (policy === undefined) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.NOT_FOUND, {
        message: `no extraction policy registered at digest ${JSON.stringify(policyRef)}`,
        details: { policyRef, registered: this.registry.listPolicies().map((p) => p.digest) },
      });
    }

    // 2-3. Run the pure mining core with the deterministic context.
    const startedAt = options.startedAt ?? nowIso();
    const mining = await mineSkillCandidates(validated, policy, {
      correlationId: options.correlationId as CorrelationId,
      extractedAt: startedAt,
    });

    // 4. Build the drafts for accepted candidates (A004-ready).
    const drafts: SkillDraft[] = [];
    for (const candidate of mining.candidates) {
      const supersession = options.supersessions?.get(candidate.digest as string);
      drafts.push(
        await buildSkillDraft(candidate, policy, validated, {
          ...(supersession === undefined
            ? {}
            : {
                supersedes: supersession.supersedes,
                ...(supersession.skillVersion === undefined
                  ? {}
                  : { skillVersion: supersession.skillVersion }),
              }),
        }),
      );
    }
    const finishedAt = options.finishedAt ?? nowIso();

    // 5. Build + append the run record.
    const record = await createExtractionRunRecord({
      runKey: options.runKey,
      correlationId: options.correlationId,
      extractorVersion: EXTRACTION_IMPLEMENTATION_VERSION,
      policyRef: policy.digest,
      inputs: inputDigests,
      trajectoryDecisions: [...mining.trajectoryDecisions],
      patternDecisions: [...mining.patternDecisions],
      candidates: [...mining.candidates],
      drafts,
      startedAt,
      finishedAt,
      provenance: {
        executedBy: 'arena-skill-extraction-fabric',
        recordedAt: finishedAt,
        notes: options.provenanceNotes === undefined ? null : options.provenanceNotes,
      },
    });

    this.append(record, mining.candidates.map((candidate) => candidate.digest as string), drafts);
    this.runKeys.set(options.runKey, {
      commandCanonical: command,
      recordDigest: record.digest,
    });
    return record;
  }

  /** Append a record + its drafts to the ledgers (content-addressed). */
  private append(
    record: ExtractionRunRecord,
    candidateDigests: readonly string[],
    drafts: readonly SkillDraft[],
  ): void {
    if (this.recordsByDigest.has(record.digest)) return; // content-addressed dedup
    this.recordsByDigest.set(record.digest, record);
    this.ledger.push(record);
    const policyList = this.policyIndex.get(record.policyRef) ?? [];
    policyList.push(record.digest);
    this.policyIndex.set(record.policyRef, policyList);
    const correlationList = this.correlationIndex.get(record.correlationId as string) ?? [];
    correlationList.push(record.digest);
    this.correlationIndex.set(record.correlationId as string, correlationList);
    for (const [index, digest] of candidateDigests.entries()) {
      const draft = drafts[index];
      if (draft === undefined) continue;
      this.draftsByDigest.set(draft.digest as string, draft);
      this.draftByCandidate.set(digest, draft.digest as string);
    }
  }

  // -------------------------------------------------------------------------
  // Queries (pure projections)
  // -------------------------------------------------------------------------

  /** Get a run record by its digest (exact, historical, forever). */
  getRunRecord(digest: string): ExtractionRunRecord | undefined {
    return this.recordsByDigest.get(digest);
  }

  /** All run records of one policy digest (insertion order). */
  listRunsByPolicy(policyRef: string): readonly ExtractionRunRecord[] {
    const digests = this.policyIndex.get(policyRef);
    if (digests === undefined) return [];
    return digests
      .map((digest) => this.recordsByDigest.get(digest))
      .filter((record): record is ExtractionRunRecord => record !== undefined);
  }

  /** All run records of one correlation id (insertion order). */
  listRunsByCorrelation(correlationId: string): readonly ExtractionRunRecord[] {
    const digests = this.correlationIndex.get(correlationId);
    if (digests === undefined) return [];
    return digests
      .map((digest) => this.recordsByDigest.get(digest))
      .filter((record): record is ExtractionRunRecord => record !== undefined);
  }

  /**
   * Run records whose finishedAt lies within the inclusive [from, to]
   * range (both ends optional), in ledger insertion order.
   */
  listRunsByTimeRange(range: RunTimeRange = {}): readonly ExtractionRunRecord[] {
    const from = range.from === undefined ? null : Date.parse(range.from);
    const to = range.to === undefined ? null : Date.parse(range.to);
    if (from !== null && Number.isNaN(from)) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_TIMESTAMP, {
        message: `time-range query: invalid 'from' timestamp: ${JSON.stringify(range.from)}`,
      });
    }
    if (to !== null && Number.isNaN(to)) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_TIMESTAMP, {
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

  /** The full run ledger (insertion order) — observability dump. */
  listRuns(): readonly ExtractionRunRecord[] {
    return [...this.ledger];
  }

  /** Get an emitted draft by its digest. */
  getDraft(digest: string): SkillDraft | undefined {
    return this.draftsByDigest.get(digest);
  }

  /** The draft packaging a given candidate digest, when emitted. */
  getDraftForCandidate(candidateDigest: string): SkillDraft | undefined {
    const draftDigest = this.draftByCandidate.get(candidateDigest);
    return draftDigest === undefined ? undefined : this.draftsByDigest.get(draftDigest);
  }

  /** All emitted drafts (emission order) — observability dump. */
  listDrafts(): readonly SkillDraft[] {
    return [...this.draftsByDigest.values()];
  }
}
