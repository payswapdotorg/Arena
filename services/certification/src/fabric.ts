/**
 * CertificationFabric — the in-process reference RUNNER, evidence
 * ledger and certification record ledger (Work Order A023; mirrors the
 * A013 VerificationFabric structurally).
 *
 * Pure TypeScript, ZERO external runtime dependencies (only
 * @arena/protocol-core + @arena/certification + the consumed sibling
 * protocol packages whose evidence records the ledger stores — the
 * REAL public guards anchor evidence resolution to the REAL protocols,
 * exactly like the A013 fabric anchors its evidence to the REAL A002
 * artifact store).
 *
 * `certify(suiteRef, subject, evidenceRefs, options)` is PURE
 * ORCHESTRATION:
 *   1. resolve refs — the suite by digest from the registry
 *      (CERTIFICATION_NOT_FOUND when absent) and every evidence record
 *      by digest from the evidence stores (missing refs are REJECTED —
 *      fail-closed; a certification run may never silently ignore an
 *      evidence ref it was given);
 *   2. evaluate — every declared suite stage through the domain
 *      engine's closed conditions over the resolved evidence;
 *   3. record — build the CertificationRecord through the domain
 *      constructor (which derives the verdict / unknown cause /
 *      granted level / scoped statement, computes the input digest and
 *      freezes), and append it to the ledger.
 *
 * Idempotency (architecture-lock rule 17): `certify` accepts an
 * idempotency key. The same key + the same command tuple (suite,
 * subject, evidence refs) replays as a no-op returning the stored
 * record; the same key + a different tuple is an
 * IDEMPOTENCY_CONFLICT.
 *
 * Records are append-only content-addressed entries: no update/delete
 * APIs exist, every record stays addressable by digest forever, and
 * queries are pure projections. SUPERSESSION and REVOCATION are
 * append-only too: a recertification may supersede a prior record, a
 * revocation record may revoke one; the ledger PROJECTS the effective
 * status ('active' | 'superseded' | 'revoked') without ever mutating a
 * stored record (quality-model level REVOKED).
 */

import {
  CERTIFICATION_ERROR_CODES,
  CertificationError,
  certificationSubjectKey,
  evaluateCertificationRun,
} from '@arena/certification';
import type { CertificationEvidence, CertificationRecord, CertificationSubject } from '@arena/certification';
import { isCertificationRecord } from '@arena/certification';
import { createRevocationRecord } from '@arena/certification';
import { isVerificationRecord } from '@arena/verification';
import { isEvaluationRecord } from '@arena/evaluation';
import { isCompatibilityRecord } from '@arena/compatibility';
import { isDatasetManifest } from '@arena/datasets';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { CertificationSuiteRegistry } from './registry.js';
import type { CertificationSuiteRegistry as Registry } from './registry.js';

/** Options for one certification run. */
export interface CertifyOptions {
  /** REQUIRED: the run's correlation id (protocol-core, lock rule 17). */
  readonly correlationId: string;
  /** REQUIRED: the idempotency key of the command authorizing the run. */
  readonly idempotencyKey: string;
  /** Fixed started-at (ms-precision UTC); defaults to the run clock. */
  readonly startedAt?: string;
  /** Fixed finished-at; defaults to the run clock after the stages ran. */
  readonly finishedAt?: string;
  /** Free-form provenance notes recorded onto the record. */
  readonly provenanceNotes?: string | null;
  /** The digest of the prior record this run supersedes (recertification). */
  readonly supersedes?: string | null;
}

/** The projected lifecycle status of a stored record. */
export type EffectiveStatus = 'active' | 'superseded' | 'revoked';

interface IdempotencyBinding {
  readonly commandCanonical: string;
  readonly recordDigest: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** The in-process evidence stores: digest → the stored sibling record. */
interface EvidenceStores {
  readonly verifications: Map<string, unknown>;
  readonly evaluations: Map<string, unknown>;
  readonly compatibility: Map<string, unknown>;
  readonly datasets: Map<string, unknown>;
}

/**
 * The in-process reference fabric: suite registry + evidence stores +
 * runner + record ledger with supersession/revocation projections.
 * Construct with `new CertificationFabric()` (fresh registry) or pass a
 * pre-populated registry.
 */
export class CertificationFabric {
  readonly registry: Registry;

  private readonly evidence: EvidenceStores = {
    verifications: new Map<string, unknown>(),
    evaluations: new Map<string, unknown>(),
    compatibility: new Map<string, unknown>(),
    datasets: new Map<string, unknown>(),
  };
  /** Records by digest — the append-only, content-addressed ledger. */
  private readonly recordsByDigest = new Map<string, CertificationRecord>();
  /** Subject key → record digests. */
  private readonly subjectIndex = new Map<string, Set<string>>();
  /** Suite digest → record digests. */
  private readonly suiteIndex = new Map<string, Set<string>>();
  /** Tenant id → record digests. */
  private readonly tenantIndex = new Map<string, Set<string>>();
  /** Insertion-ordered ledger for range queries. */
  private readonly ledger: CertificationRecord[] = [];
  /** Run idempotency keys → the run they authorized. */
  private readonly runKeys = new Map<string, IdempotencyBinding>();
  /** Superseded digest → the superseding digest. */
  private readonly supersededBy = new Map<string, string>();
  /** Revoked digest → the revocation record digest. */
  private readonly revokedBy = new Map<string, string>();

  constructor(registry: Registry = new CertificationSuiteRegistry()) {
    this.registry = registry;
  }

  // -------------------------------------------------------------------------
  // The evidence stores (REAL sibling-protocol records, guard-validated)
  // -------------------------------------------------------------------------

  /** Put an A013 VerificationRecord into the store (idempotent by digest). */
  putVerificationRecord(record: unknown): string {
    if (!isVerificationRecord(record)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
        message: 'the verification evidence store only accepts structurally valid A013 VerificationRecords',
      });
    }
    const digest = (record as { digest: string }).digest;
    this.evidence.verifications.set(digest, record);
    return digest;
  }

  /** Put an A012 EvaluationRecord into the store (idempotent by digest). */
  putEvaluationRecord(record: unknown): string {
    if (!isEvaluationRecord(record)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
        message: 'the evaluation evidence store only accepts structurally valid A012 EvaluationRecords',
      });
    }
    const digest = (record as { digest: string }).digest;
    this.evidence.evaluations.set(digest, record);
    return digest;
  }

  /** Put an A022 CompatibilityRecord into the store (idempotent by digest). */
  putCompatibilityRecord(record: unknown): string {
    if (!isCompatibilityRecord(record)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
        message: 'the compatibility evidence store only accepts structurally valid A022 CompatibilityRecords',
      });
    }
    const digest = (record as { recordDigest: string }).recordDigest;
    this.evidence.compatibility.set(digest, record);
    return digest;
  }

  /** Put an A014 DatasetManifest into the store (idempotent by digest). */
  putDatasetManifest(record: unknown): string {
    if (!isDatasetManifest(record)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
        message: 'the dataset evidence store only accepts structurally valid A014 DatasetManifests',
      });
    }
    const digest = (record as { digest: string }).digest;
    this.evidence.datasets.set(digest, record);
    return digest;
  }

  /** Count of stored evidence records per store (observability). */
  evidenceCounts(): Readonly<Record<string, number>> {
    return Object.freeze({
      verifications: this.evidence.verifications.size,
      evaluations: this.evidence.evaluations.size,
      compatibility: this.evidence.compatibility.size,
      datasets: this.evidence.datasets.size,
    });
  }

  // -------------------------------------------------------------------------
  // The runner: resolve → evaluate → record
  // -------------------------------------------------------------------------

  async certify(
    suiteRef: string,
    subject: CertificationSubject,
    evidenceRefs: readonly string[],
    options: CertifyOptions,
  ): Promise<CertificationRecord> {
    if (typeof options?.correlationId !== 'string') {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_IDENTITY, {
        message: 'certification runs require a correlation id (architecture-lock rule 17)',
      });
    }
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const subjectKey = certificationSubjectKey(subject);
    const commandCanonical = JSON.stringify([
      suiteRef,
      subjectKey,
      [...evidenceRefs],
      options.supersedes ?? null,
    ]);

    // Idempotent replay: same key + same command ⇒ the stored record.
    const binding = this.runKeys.get(idempotencyKey);
    if (binding !== undefined) {
      if (binding.commandCanonical !== commandCanonical) {
        throw new CertificationError(CERTIFICATION_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${JSON.stringify(idempotencyKey)} is already bound to a different run-certification command (same key + different suite/subject/evidence is a conflict, not a rerun)`,
          details: { idempotencyKey, bound: binding.commandCanonical, attempted: commandCanonical },
        });
      }
      const stored = this.recordsByDigest.get(binding.recordDigest);
      if (stored !== undefined) return stored;
    }

    // 1. Resolve the suite.
    const suite = this.registry.getSuite(suiteRef);
    if (suite === undefined) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.NOT_FOUND, {
        message: `no certification suite registered at digest ${JSON.stringify(suiteRef)}`,
        details: { suiteRef, registered: this.registry.listSuites().map((entry) => entry.digest) },
      });
    }

    // 2. Resolve EVERY evidence ref — a missing ref is REJECTED
    //    (fail-closed: no silently ignored evidence).
    const verifications: unknown[] = [];
    const evaluations: unknown[] = [];
    const compatibility: unknown[] = [];
    const datasets: unknown[] = [];
    const bundle: CertificationEvidence = { verifications, evaluations, compatibility, datasets };
    const seen = new Set<string>();
    for (const ref of evidenceRefs) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const stored =
        this.evidence.verifications.get(ref) ??
        this.evidence.evaluations.get(ref) ??
        this.evidence.compatibility.get(ref) ??
        this.evidence.datasets.get(ref);
      if (stored === undefined) {
        throw new CertificationError(CERTIFICATION_ERROR_CODES.NOT_FOUND, {
          message: `evidence ref ${JSON.stringify(ref)} resolves to no stored record (a certification run may never silently ignore evidence)`,
          details: { ref },
        });
      }
      if (isVerificationRecord(stored)) verifications.push(stored);
      else if (isEvaluationRecord(stored)) evaluations.push(stored);
      else if (isCompatibilityRecord(stored)) compatibility.push(stored);
      else if (isDatasetManifest(stored)) datasets.push(stored);
      else {
        throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
          message: `evidence ref ${JSON.stringify(ref)} stored an unrecognized record kind`,
          details: { ref },
        });
      }
    }

    // Supersession validation: the superseded record must exist and be
    // an active certification run (superseding a phantom or a revoked
    // record is a lineage violation).
    if (options.supersedes !== undefined && options.supersedes !== null) {
      const target = this.recordsByDigest.get(options.supersedes);
      if (target === undefined || target.kind !== 'certification-run') {
        throw new CertificationError(CERTIFICATION_ERROR_CODES.SUPERSESSION_CONFLICT, {
          message: `supersession target ${JSON.stringify(options.supersedes)} is not a stored certification-run record`,
          details: { supersedes: options.supersedes },
        });
      }
      if (this.revokedBy.has(options.supersedes)) {
        throw new CertificationError(CERTIFICATION_ERROR_CODES.SUPERSESSION_CONFLICT, {
          message: `supersession target ${JSON.stringify(options.supersedes)} is already revoked — a revoked claim cannot be superseded, only re-issued as a fresh run`,
          details: { supersedes: options.supersedes },
        });
      }
    }

    // 3. Evaluate + record through the domain engine.
    const record = await evaluateCertificationRun(suite, subject, bundle, {
      correlationId,
      idempotencyKey,
      ...(options.startedAt !== undefined ? { startedAt: options.startedAt } : {}),
      ...(options.finishedAt !== undefined ? { finishedAt: options.finishedAt } : {}),
      provenanceNotes: options.provenanceNotes ?? null,
      supersedes: options.supersedes ?? null,
    });

    this.append(record);
    if (options.supersedes !== undefined && options.supersedes !== null) {
      this.supersededBy.set(options.supersedes, record.digest);
    }
    this.runKeys.set(idempotencyKey, {
      commandCanonical,
      recordDigest: record.digest,
    });
    return record;
  }

  /**
   * Revoke a prior certification record (append-only governance fact;
   * quality-model level REVOKED). The revoked record itself is never
   * mutated — the ledger projects its effective status.
   */
  async revoke(
    recordDigest: string,
    grounds: string,
    options: {
      readonly correlationId: string;
      readonly idempotencyKey: string;
      readonly tenantId?: string | null;
      readonly workspaceId?: string | null;
      readonly startedAt?: string;
      readonly finishedAt?: string | null;
    },
  ): Promise<CertificationRecord> {
    const target = this.recordsByDigest.get(recordDigest);
    if (target === undefined) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.NOT_FOUND, {
        message: `revocation target ${JSON.stringify(recordDigest)} is not a stored record`,
        details: { recordDigest },
      });
    }
    if (target.kind !== 'certification-run') {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
        message: 'only certification-run records can be revoked',
      });
    }
    if (this.revokedBy.has(recordDigest)) {
      // Idempotent re-revocation: return the stored revocation.
      const existing = this.recordsByDigest.get(this.revokedBy.get(recordDigest)!);
      if (existing !== undefined) return existing;
    }
    const startedAt = options.startedAt ?? nowIso();
    const finishedAt = options.finishedAt ?? startedAt;
    const revocation = await createRevocationRecord({
      revokes: recordDigest,
      grounds,
      correlationId: options.correlationId,
      idempotencyKey: options.idempotencyKey,
      tenantId: options.tenantId ?? target.tenantId,
      workspaceId: options.workspaceId ?? target.workspaceId,
      startedAt,
      finishedAt,
      provenance: {
        executedBy: 'certification-fabric',
        recordedAt: finishedAt,
        notes: null,
      },
    });
    this.append(revocation);
    this.revokedBy.set(recordDigest, revocation.digest);
    return revocation;
  }

  /** Append a record to the ledger (content-addressed; no update/delete). */
  private append(record: CertificationRecord): void {
    if (!isCertificationRecord(record)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
        message: 'the ledger only accepts structurally valid certification records',
      });
    }
    if (this.recordsByDigest.has(record.digest)) return; // content-addressed dedup
    this.recordsByDigest.set(record.digest, record);
    this.ledger.push(record);
    if (record.kind === 'certification-run' && record.subject !== null) {
      const key = certificationSubjectKey(record.subject);
      const set = this.subjectIndex.get(key) ?? new Set<string>();
      set.add(record.digest);
      this.subjectIndex.set(key, set);
    }
    if (record.kind === 'certification-run' && record.suiteRef !== null) {
      const set = this.suiteIndex.get(record.suiteRef) ?? new Set<string>();
      set.add(record.digest);
      this.suiteIndex.set(record.suiteRef, set);
    }
    if (record.tenantId !== null) {
      const set = this.tenantIndex.get(record.tenantId) ?? new Set<string>();
      set.add(record.digest);
      this.tenantIndex.set(record.tenantId, set);
    }
  }

  // -------------------------------------------------------------------------
  // Queries (pure projections)
  // -------------------------------------------------------------------------

  /** Get a record by its digest (exact, historical, forever). */
  getRecord(ref: string): CertificationRecord | undefined {
    return this.recordsByDigest.get(ref);
  }

  /**
   * The projected lifecycle status of a stored record: active |
   * superseded | revoked. Revocation dominates supersession.
   */
  effectiveStatus(ref: string): EffectiveStatus | undefined {
    if (!this.recordsByDigest.has(ref)) return undefined;
    if (this.revokedBy.has(ref)) return 'revoked';
    if (this.supersededBy.has(ref)) return 'superseded';
    return 'active';
  }

  /** All run records for one subject key (insertion order). */
  listRecordsBySubject(subject: CertificationSubject): readonly CertificationRecord[] {
    const digests = this.subjectIndex.get(certificationSubjectKey(subject));
    if (digests === undefined) return [];
    return [...digests]
      .map((digest) => this.recordsByDigest.get(digest))
      .filter((record): record is CertificationRecord => record !== undefined)
      .filter((record) => record.kind === 'certification-run');
  }

  /** All run records produced against one suite digest (insertion order). */
  listRecordsBySuite(suiteRef: string): readonly CertificationRecord[] {
    const digests = this.suiteIndex.get(suiteRef);
    if (digests === undefined) return [];
    return [...digests]
      .map((digest) => this.recordsByDigest.get(digest))
      .filter((record): record is CertificationRecord => record !== undefined)
      .filter((record) => record.kind === 'certification-run');
  }

  /** All records of one tenant (insertion order). */
  listRecordsByTenant(tenantId: string): readonly CertificationRecord[] {
    const digests = this.tenantIndex.get(tenantId);
    if (digests === undefined) return [];
    return [...digests]
      .map((digest) => this.recordsByDigest.get(digest))
      .filter((record): record is CertificationRecord => record !== undefined);
  }

  /** Run records with a given verdict (satisfied | not-satisfied | unknown). */
  listRecordsByVerdict(verdict: string): readonly CertificationRecord[] {
    return this.ledger.filter(
      (record) => record.kind === 'certification-run' && record.verdict === verdict,
    );
  }

  /**
   * The CURRENT effective certification of a subject: the latest run
   * record whose projected status is 'active' (superseded and revoked
   * claims are history), or undefined when none stands.
   */
  currentCertification(subject: CertificationSubject): CertificationRecord | undefined {
    const runs = this.listRecordsBySubject(subject);
    for (const record of [...runs].reverse()) {
      if (this.effectiveStatus(record.digest) === 'active') return record;
    }
    return undefined;
  }

  /** The full ledger (insertion order) — observability dump. */
  listRecords(): readonly CertificationRecord[] {
    return [...this.ledger];
  }
}

/** Construct a fresh fabric with its own registry and evidence stores. */
export function createCertificationFabric(): CertificationFabric {
  return new CertificationFabric();
}
