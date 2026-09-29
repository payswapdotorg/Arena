/**
 * VerificationFabric — the in-process reference RUNNER, artifact store
 * and record ledger (Work Order A013; requirements R13, R14, R27, R28;
 * mirrors the A012 reference fabric structurally).
 *
 * Pure TypeScript, ZERO external runtime dependencies (only
 * @arena/protocol-core + @arena/verification + @arena/artifact-protocol —
 * the REAL A002 MaterialArtifact store anchors evidence resolution to
 * the REAL artifact protocol, exactly like the A012 fabric anchors its
 * input contract to the REAL CapabilityCase/TrajectoryRecord guards).
 *
 * `verify(verifierRef, evidence, options)` is PURE ORCHESTRATION:
 *   1. resolve refs — the verifier descriptor by digest from the
 *      registry (VERIFICATION_NOT_FOUND when absent);
 *   2. validate the evidence bundle (package primitives): structural
 *      validation, kind matching, resolution against the artifact
 *      store, digest verification and provenance-chain validation
 *      (A002 verifyArtifact / verifyArtifactTree) — every requirement
 *      ends up `missing`, `present-unverified` or `verified`;
 *   3. invoke the verifier hook ONLY for verified requirements (the
 *      ONLY pluggable seam — hooks never construct records and never
 *      see unverified evidence); hook verdicts are strict-shape
 *      validated against the closed verdict vocabulary;
 *   4. merge: validation states + hook verdicts → the evidence-support
 *      summary (missing / present-unverified stand; verified becomes
 *      present-supported / present-unsupported / present-indeterminate);
 *   5. build the VerificationRecord through the domain constructor
 *      (which derives the outcome + unknown cause, computes the input
 *      digest and freezes the record), and append it to the ledger.
 *
 * Idempotency (architecture-lock rule 17): `verify` accepts an
 * idempotency key. The same key + the same command tuple (verifier,
 * evidence) replays as a no-op returning the stored record; the same
 * key + a different tuple is an IDEMPOTENCY_CONFLICT.
 *
 * Records are append-only content-addressed entries: no update/delete
 * APIs exist, every record stays addressable by digest forever, and
 * queries are pure projections (by verifier, by correlation id, by
 * time range, by outcome).
 */

import {
  VERIFICATION_ERROR_CODES,
  VerificationError,
  assessEvidenceForRequirements,
  createVerificationRecord,
  expectFields,
  isVerificationRecord,
  toEvidenceBundle,
} from '@arena/verification';
import type { EvidenceReferenceInput, VerificationRecord } from '@arena/verification';
import { isMaterialArtifact } from '@arena/artifact-protocol';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { VerifierRegistry } from './registry.js';
import type { VerifierRegistry as Registry } from './registry.js';
import type { RequirementVerdictInput } from './verifiers.js';
import { HOOK_VERDICTS } from './verifiers.js';

/** Options for one verification run. */
export interface VerifyOptions {
  /** REQUIRED: the run's correlation id (protocol-core, lock rule 17). */
  readonly correlationId: string;
  /** REQUIRED: the idempotency key of the command authorizing the run. */
  readonly idempotencyKey: string;
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

function commandCanonicalOf(verifierRef: string, evidence: readonly EvidenceReferenceInput[]): string {
  return JSON.stringify([
    verifierRef,
    evidence.map((entry) => `${entry.evidenceKind}:${entry.artifact.namespace}/${entry.artifact.name}@${entry.artifact.version}#${entry.artifact.digest}`),
  ]);
}

/**
 * The in-process reference fabric: registry + artifact store + runner +
 * record ledger. Construct with `new VerificationFabric()` (fresh
 * registry) or pass a pre-populated registry.
 */
export class VerificationFabric {
  readonly registry: Registry;

  /** The in-process A002 artifact store: digest → material artifact. */
  private readonly artifacts = new Map<string, MaterialArtifact<unknown>>();
  /** Records by digest — the append-only, content-addressed ledger. */
  private readonly recordsByDigest = new Map<string, VerificationRecord>();
  /** Verifier digest → record digests. */
  private readonly verifierIndex = new Map<string, Set<string>>();
  /** Correlation id → record digests. */
  private readonly correlationIndex = new Map<string, Set<string>>();
  /** Insertion-ordered ledger for time-range queries. */
  private readonly ledger: VerificationRecord[] = [];
  /** Run idempotency keys → the run they authorized. */
  private readonly runKeys = new Map<string, IdempotencyBinding>();

  constructor(registry: Registry = new VerifierRegistry()) {
    this.registry = registry;
  }

  // -------------------------------------------------------------------------
  // The artifact store (REAL A002 MaterialArtifacts)
  // -------------------------------------------------------------------------

  /** Put a material artifact into the in-process store (idempotent by digest). */
  putArtifact(artifact: MaterialArtifact<unknown>): MaterialArtifact<unknown> {
    if (!isMaterialArtifact(artifact)) {
      throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
        message: 'the artifact store only accepts structurally valid A002 MaterialArtifacts',
      });
    }
    this.artifacts.set(artifact.digest, artifact);
    return artifact;
  }

  /** Look up a stored artifact by digest. */
  getArtifact(ref: string): MaterialArtifact<unknown> | undefined {
    return this.artifacts.get(ref);
  }

  /** All stored artifacts (insertion order). */
  listArtifacts(): readonly MaterialArtifact<unknown>[] {
    return [...this.artifacts.values()];
  }

  // -------------------------------------------------------------------------
  // The runner: resolve → validate → hook → merge → derive → record
  // -------------------------------------------------------------------------

  async verify(
    verifierRef: string,
    evidence: readonly EvidenceReferenceInput[],
    options: VerifyOptions,
  ): Promise<VerificationRecord> {
    if (typeof options?.correlationId !== 'string') {
      throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_IDENTITY, {
        message: 'verification runs require a correlation id (architecture-lock rule 17)',
      });
    }
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const bundle = toEvidenceBundle(evidence);
    const command = commandCanonicalOf(verifierRef, bundle as unknown as readonly EvidenceReferenceInput[]);

    // Idempotent replay: same key + same command ⇒ the stored record.
    const binding = this.runKeys.get(idempotencyKey);
    if (binding !== undefined) {
      if (binding.commandCanonical !== command) {
        throw new VerificationError(VERIFICATION_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${JSON.stringify(idempotencyKey)} is already bound to a different run-verification command (same key + different verifier/evidence is a conflict, not a rerun)`,
          details: { idempotencyKey, bound: binding.commandCanonical, attempted: command },
        });
      }
      const stored = this.recordsByDigest.get(binding.recordDigest);
      if (stored !== undefined) return stored;
    }

    // 1. Resolve the verifier.
    const registration = this.registry.getVerifier(verifierRef);
    if (registration === undefined) {
      throw new VerificationError(VERIFICATION_ERROR_CODES.NOT_FOUND, {
        message: `no verifier registered at descriptor digest ${JSON.stringify(verifierRef)}`,
        details: { verifierRef, registered: this.registry.listVerifiers().map((d) => d.digest) },
      });
    }
    const descriptor = registration.descriptor;

    // 2. Validate the evidence bundle with the package primitives.
    const assessments = await assessEvidenceForRequirements(
      descriptor.requiredEvidence,
      bundle,
      (ref) => this.artifacts.get(ref.digest) ?? null,
    );

    // 3+4. Invoke the hook for verified requirements; merge statuses.
    const startedAt = options.startedAt ?? nowIso();
    const support: Array<{
      requirementId: string;
      status: string;
      evidenceDigest: string | null;
      notes: string | null;
    }> = [];
    for (const assessment of assessments) {
      if (assessment.state === 'missing') {
        support.push({
          requirementId: assessment.requirement.requirementId,
          status: 'missing',
          evidenceDigest: null,
          notes: assessment.note,
        });
        continue;
      }
      if (assessment.state === 'present-unverified') {
        support.push({
          requirementId: assessment.requirement.requirementId,
          status: 'present-unverified',
          evidenceDigest: assessment.reference?.artifact.digest ?? null,
          notes: assessment.note,
        });
        continue;
      }
      // verified: hand the verified evidence to the hook.
      const verdicts = await registration.hook({
        descriptor,
        requirement: assessment.requirement,
        reference: assessment.reference!,
        artifact: assessment.artifact!,
      });
      const own = verdicts.filter(
        (verdictEntry) => (verdictEntry as RequirementVerdictInput).requirementId === assessment.requirement.requirementId,
      );
      const verdictEntry = own[0] as RequirementVerdictInput | undefined;
      if (verdictEntry === undefined) {
        // A hook that does not speak for a verified requirement cannot
        // establish it: method limitation (recorded, never guessed).
        support.push({
          requirementId: assessment.requirement.requirementId,
          status: 'present-indeterminate',
          evidenceDigest: assessment.reference?.artifact.digest ?? null,
          notes: 'the verifier hook returned no verdict for this requirement (method limitation)',
        });
        continue;
      }
      // STRICT SHAPE on every hook verdict entry: exactly
      // {requirementId, verdict, notes} — any extra member (a quantitative
      // field, a graded label, anything else) is an unknown-field rejection.
      // This is the construction-level gate that makes quantitative hook
      // outputs impossible (architecture-lock rule 7).
      expectFields(
        verdictEntry,
        ['requirementId', 'verdict', 'notes'],
        [],
        VERIFICATION_ERROR_CODES.INVALID_OUTCOME,
        `verifier hook verdict for ${JSON.stringify(assessment.requirement.requirementId)}`,
      );
      if (
        typeof verdictEntry.verdict !== 'string' ||
        !(HOOK_VERDICTS as readonly string[]).includes(verdictEntry.verdict)
      ) {
        throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_OUTCOME, {
          message: `verifier hook returned an illegal verdict ${JSON.stringify(verdictEntry.verdict)} for requirement ${JSON.stringify(assessment.requirement.requirementId)} (closed vocabulary: supported | unsupported | indeterminate)`,
          details: { verdict: verdictEntry.verdict, known: [...HOOK_VERDICTS] },
        });
      }
      const status =
        verdictEntry.verdict === 'supported'
          ? 'present-supported'
          : verdictEntry.verdict === 'unsupported'
            ? 'present-unsupported'
            : 'present-indeterminate';
      support.push({
        requirementId: assessment.requirement.requirementId,
        status,
        evidenceDigest: assessment.reference?.artifact.digest ?? null,
        notes: verdictEntry.notes === undefined ? null : verdictEntry.notes,
      });
    }
    const finishedAt = options.finishedAt ?? nowIso();

    // 5. Build the record through the domain constructor (derives the
    // outcome + unknown cause, computes the input digest, freezes).
    const record = await createVerificationRecord(
      {
        verifierRef: descriptor.digest,
        evidence: bundle as unknown as readonly EvidenceReferenceInput[],
        evidenceSupport: support,
        correlationId,
        idempotencyKey,
        startedAt,
        finishedAt,
        provenance: {
          executedBy: descriptor.verifierId,
          recordedAt: finishedAt,
          notes: options.provenanceNotes === undefined ? null : options.provenanceNotes,
        },
      },
      descriptor,
    );

    this.record(record);
    this.runKeys.set(idempotencyKey, {
      commandCanonical: command,
      recordDigest: record.digest,
    });
    return record;
  }

  /** Append a record to the ledger (content-addressed; no update/delete). */
  private record(result: VerificationRecord): void {
    if (!isVerificationRecord(result)) {
      throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_RECORD, {
        message: 'the ledger only accepts structurally valid verification records',
      });
    }
    if (this.recordsByDigest.has(result.digest)) return; // content-addressed dedup
    this.recordsByDigest.set(result.digest, result);
    this.ledger.push(result);
    const verifierSet = this.verifierIndex.get(result.verifierRef) ?? new Set<string>();
    verifierSet.add(result.digest);
    this.verifierIndex.set(result.verifierRef, verifierSet);
    const correlationSet = this.correlationIndex.get(result.correlationId) ?? new Set<string>();
    correlationSet.add(result.digest);
    this.correlationIndex.set(result.correlationId, correlationSet);
  }

  // -------------------------------------------------------------------------
  // Queries (pure projections)
  // -------------------------------------------------------------------------

  /** Get a record by its digest (exact, historical, forever). */
  getRecord(ref: string): VerificationRecord | undefined {
    return this.recordsByDigest.get(ref);
  }

  /** All records produced by the given verifier digest (insertion order). */
  listRecordsByVerifier(verifierRef: string): readonly VerificationRecord[] {
    const digests = this.verifierIndex.get(verifierRef);
    if (digests === undefined) return [];
    return [...digests].map((digest) => this.recordsByDigest.get(digest)).filter(
      (record): record is VerificationRecord => record !== undefined,
    );
  }

  /** All records sharing a correlation id (insertion order). */
  listRecordsByCorrelation(correlationId: string): readonly VerificationRecord[] {
    const digests = this.correlationIndex.get(correlationId);
    if (digests === undefined) return [];
    return [...digests].map((digest) => this.recordsByDigest.get(digest)).filter(
      (record): record is VerificationRecord => record !== undefined,
    );
  }

  /** Records with a given outcome (pass | fail | unknown), insertion order. */
  listRecordsByOutcome(outcome: string): readonly VerificationRecord[] {
    return this.ledger.filter((record) => record.outcome === outcome);
  }

  /**
   * Records whose finishedAt lies within the inclusive [from, to] range
   * (both ends optional), in ledger insertion order.
   */
  listRecordsByTimeRange(range: RecordTimeRange = {}): readonly VerificationRecord[] {
    const from = range.from === undefined ? null : Date.parse(range.from);
    const to = range.to === undefined ? null : Date.parse(range.to);
    if (from !== null && Number.isNaN(from)) {
      throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_TIMESTAMP, {
        message: `time-range query: invalid 'from' timestamp: ${JSON.stringify(range.from)}`,
      });
    }
    if (to !== null && Number.isNaN(to)) {
      throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_TIMESTAMP, {
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
  listRecords(): readonly VerificationRecord[] {
    return [...this.ledger];
  }
}

/** Construct a fresh fabric with its own registry and artifact store. */
export function createVerificationFabric(): VerificationFabric {
  return new VerificationFabric();
}
