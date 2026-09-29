/**
 * CertificationFabric — the in-process reference ENGINE, suite registry,
 * and record ledger (Work Order A023; mirrors the A013 VerificationFabric
 * + A012 EvaluationFabric + A021 ForgeFabric patterns).
 *
 * Pure TypeScript, ZERO external runtime dependencies (only
 * @arena/protocol-core + @arena/certification workspace packages). The
 * engine resolves the suite descriptor by digest, validates set-equality
 * between the supplied component-verdict summary and the suite
 * declaration (the package-level gate), then builds the CertificationRecord
 * through the domain constructor (which derives the verdict/unknown cause/
 * constraints/statement, computes the input digest, and freezes the
 * record). Idempotency (lock rule 17): the same idempotency key + the same
 * command tuple replays as a no-op returning the stored record; the same
 * key + a different tuple is an IDEMPOTENCY_CONFLICT.
 *
 * Records are append-only content-addressed entries: no update/delete APIs
 * exist, every record stays addressable by digest forever, and queries are
 * pure projections (by suite, by correlation id, by time range, by verdict).
 */

import {
  CERTIFICATION_ERROR_CODES,
  CertificationError,
  createCertificationRecord,
  isCertificationRecord,
  isCertificationSuiteDescriptor,
  suiteComponentRefs,
  toComponentVerdictSummary,
} from '@arena/certification';
import type {
  CertificationRecord,
  ComponentVerdictSummary,
} from '@arena/certification';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { CertificationRegistry } from './registry.js';
import type { CertificationRegistry as Registry } from './registry.js';

/** Options for one certification run. */
export interface CertifyOptions {
  /** REQUIRED: the run's correlation id (protocol-core, lock rule 17). */
  readonly correlationId: string;
  /** REQUIRED: the idempotency key of the command authorizing the run. */
  readonly idempotencyKey: string;
  /** Fixed started-at (ms-precision UTC); defaults to the run clock. */
  readonly startedAt?: string;
  /** Fixed finished-at; defaults to the run clock after the run completes. */
  readonly finishedAt?: string;
  /** Free-form provenance notes recorded onto the record. */
  readonly provenanceNotes?: string | null;
  /** The neutral id of the executing principal (default: 'arena-reference-fabric'). */
  readonly executedBy?: string;
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
  suiteRef: string,
  possessionRef: string,
  componentVerdicts: ComponentVerdictSummary,
): string {
  return JSON.stringify([
    suiteRef,
    possessionRef,
    componentVerdicts.map((entry) => `${entry.refKind}:${entry.refDigest}:${entry.verdict}`),
  ]);
}

/**
 * The in-process reference fabric: registry + engine + record ledger.
 * Construct with `new CertificationFabric()` (fresh registry) or pass a
 * pre-populated registry.
 */
export class CertificationFabric {
  readonly registry: Registry;

  /** Records by digest — the append-only, content-addressed ledger. */
  private readonly recordsByDigest = new Map<string, CertificationRecord>();
  /** Suite digest → record digests. */
  private readonly suiteIndex = new Map<string, Set<string>>();
  /** Correlation id → record digests. */
  private readonly correlationIndex = new Map<string, Set<string>>();
  /** Insertion-ordered ledger for time-range queries. */
  private readonly ledger: CertificationRecord[] = [];
  /** Run idempotency keys → the run they authorized. */
  private readonly runKeys = new Map<string, IdempotencyBinding>();

  constructor(registry: Registry = new CertificationRegistry()) {
    this.registry = registry;
  }

  // -------------------------------------------------------------------------
  // The engine: resolve suite → validate summary → derive → record
  // -------------------------------------------------------------------------

  async certify(
    suiteRef: string,
    possessionRef: string,
    scopeRefs: {
      readonly bodyVersionRef: string;
      readonly substrateRef: string;
      readonly environmentRef: string;
      readonly runtimeProfileRef: string;
    },
    componentVerdicts: ComponentVerdictSummary,
    options: CertifyOptions,
  ): Promise<CertificationRecord> {
    if (typeof options?.correlationId !== 'string') {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_IDENTITY, {
        message: 'certification runs require a correlation id (architecture-lock rule 17)',
      });
    }
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    // Structural pre-validation of the summary (full validation happens
    // in createCertificationRecord via toComponentVerdictSummary).
    const summary = toComponentVerdictSummary(componentVerdicts);
    const command = commandCanonicalOf(suiteRef, possessionRef, summary);

    // Idempotent replay: same key + same command ⇒ the stored record.
    const binding = this.runKeys.get(idempotencyKey);
    if (binding !== undefined) {
      if (binding.commandCanonical !== command) {
        throw new CertificationError(CERTIFICATION_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${JSON.stringify(idempotencyKey)} is already bound to a different run-certification command (same key + different suite/possession/component-summary is a conflict, not a rerun)`,
          details: {
            idempotencyKey,
            bound: binding.commandCanonical,
            attempted: command,
          },
        });
      }
      const stored = this.recordsByDigest.get(binding.recordDigest);
      if (stored !== undefined) return stored;
    }

    // 1. Resolve the suite.
    const suite = this.registry.getSuite(suiteRef);
    if (suite === undefined) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.NOT_FOUND, {
        message: `no certification suite registered at descriptor digest ${JSON.stringify(suiteRef)}`,
        details: {
          suiteRef,
          registered: this.registry.listSuites().map((s) => s.digest),
        },
      });
    }
    if (!isCertificationSuiteDescriptor(suite)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SUITE, {
        message: 'resolved suite is not structurally valid (registry corruption)',
      });
    }

    // 2. Cross-list set-equality: the summary MUST be set-equal to the
    // suite's declared component refs (every declared ref spoken for; no
    // invented refs). createCertificationRecord performs the same check,
    // but we pre-check here to surface a clearer COMPONENT_MISMATCH error
    // with the exact missing/extra refs.
    const declared = suiteComponentRefs(suite).map((entry) => `${entry.kind}:${entry.ref}`);
    const spoken = summary.map((entry) => `${entry.refKind}:${entry.refDigest}`);
    const declaredSet = new Set(declared);
    const spokenSet = new Set(spoken);
    const missing = declared.filter((k) => !spokenSet.has(k));
    const extra = spoken.filter((k) => !declaredSet.has(k));
    if (missing.length > 0 || extra.length > 0) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.COMPONENT_MISMATCH, {
        message: `component-verdict summary is not set-equal to the suite declaration (missing: ${missing.join(', ')}; extra: ${extra.join(', ')})`,
        details: { missing, extra, declared, spoken },
      });
    }

    // 3. Build the record through the domain constructor (derives the
    // verdict, unknown cause, constraints, statement; computes the input
    // digest; freezes the record).
    const startedAt = options.startedAt ?? nowIso();
    const finishedAt = options.finishedAt ?? nowIso();
    const record = await createCertificationRecord(
      {
        suiteRef: suite.digest,
        possessionRef,
        bodyVersionRef: scopeRefs.bodyVersionRef,
        substrateRef: scopeRefs.substrateRef,
        environmentRef: scopeRefs.environmentRef,
        runtimeProfileRef: scopeRefs.runtimeProfileRef,
        componentVerdicts: summary,
        correlationId,
        idempotencyKey,
        startedAt,
        finishedAt,
        provenance: {
          executedBy: options.executedBy ?? 'arena-reference-fabric',
          recordedAt: finishedAt,
          notes: options.provenanceNotes === undefined ? null : options.provenanceNotes,
        },
      },
      suite,
    );

    this.record(record);
    this.runKeys.set(idempotencyKey, {
      commandCanonical: command,
      recordDigest: record.digest,
    });
    return record;
  }

  /** Append a record to the ledger (content-addressed; no update/delete). */
  private record(result: CertificationRecord): void {
    if (!isCertificationRecord(result)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
        message: 'the ledger only accepts structurally valid certification records',
      });
    }
    if (this.recordsByDigest.has(result.digest)) return; // content-addressed dedup
    this.recordsByDigest.set(result.digest, result);
    this.ledger.push(result);
    const suiteSet = this.suiteIndex.get(result.suiteRef) ?? new Set<string>();
    suiteSet.add(result.digest);
    this.suiteIndex.set(result.suiteRef, suiteSet);
    const correlationSet =
      this.correlationIndex.get(result.correlationId) ?? new Set<string>();
    correlationSet.add(result.digest);
    this.correlationIndex.set(result.correlationId, correlationSet);
  }

  // -------------------------------------------------------------------------
  // Queries (pure projections)
  // -------------------------------------------------------------------------

  /** Get a record by its digest (exact, historical, forever). */
  getRecord(ref: string): CertificationRecord | undefined {
    return this.recordsByDigest.get(ref);
  }

  /** All records produced by the given suite digest (insertion order). */
  listRecordsBySuite(suiteRef: string): readonly CertificationRecord[] {
    const digests = this.suiteIndex.get(suiteRef);
    if (digests === undefined) return [];
    return [...digests]
      .map((digest) => this.recordsByDigest.get(digest))
      .filter((record): record is CertificationRecord => record !== undefined);
  }

  /** All records sharing a correlation id (insertion order). */
  listRecordsByCorrelation(correlationId: string): readonly CertificationRecord[] {
    const digests = this.correlationIndex.get(correlationId);
    if (digests === undefined) return [];
    return [...digests]
      .map((digest) => this.recordsByDigest.get(digest))
      .filter((record): record is CertificationRecord => record !== undefined);
  }

  /** Records with a given verdict (pass | conditional-pass | fail | unknown), insertion order. */
  listRecordsByVerdict(verdict: string): readonly CertificationRecord[] {
    return this.ledger.filter((record) => record.verdict === verdict);
  }

  /**
   * Records whose finishedAt lies within the inclusive [from, to] range
   * (both ends optional), in ledger insertion order.
   */
  listRecordsByTimeRange(range: RecordTimeRange = {}): readonly CertificationRecord[] {
    const from = range.from === undefined ? null : Date.parse(range.from);
    const to = range.to === undefined ? null : Date.parse(range.to);
    if (from !== null && Number.isNaN(from)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_TIMESTAMP, {
        message: `time-range query: invalid 'from' timestamp: ${JSON.stringify(range.from)}`,
      });
    }
    if (to !== null && Number.isNaN(to)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_TIMESTAMP, {
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
  listRecords(): readonly CertificationRecord[] {
    return [...this.ledger];
  }
}

/** Construct a fresh fabric with its own registry. */
export function createCertificationFabric(): CertificationFabric {
  return new CertificationFabric();
}
