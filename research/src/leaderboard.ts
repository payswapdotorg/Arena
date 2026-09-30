/**
 * LeaderboardLedger -- the append-only, supersession-aware ledger of
 * benchmark result records (Work Order A030: "leaderboard-style result
 * records (typed, versioned, append-only)").
 *
 * Semantics (mirroring the house append-only disciplines of A021's
 * forge lineage and A024's release records):
 *
 *   - APPEND-ONLY: records are immutable, stay addressable by digest
 *     forever, and there is NO update/delete API;
 *   - IDEMPOTENT APPEND: appending an already-known digest is a no-op
 *     that returns the stored record (content addressing makes
 *     re-submission of identical bytes harmless);
 *   - SUPERSESSION: a NEW result for the same (benchmark, body-version
 *     subject) SUPERSEDES the previous one -- the previous record stays
 *     in the ledger, but the ranking projection only counts the
 *     latest per subject. A superseding result must have a LATER OR
 *     EQUAL finishedAt (non-monotonic supersession is rejected);
 *   - TAMPER CHECK: every appended record is digest-recomputed over
 *     its digest-free view (tampered scoring inputs are rejected
 *     before they ever rank);
 *   - DETERMINISTIC RANKING: rank by aggregate score descending;
 *     ties break by digest ascending (byte-deterministic, never by
 *     insertion order). 'indeterminate' outcomes rank BELOW pass/fail
 *     (an unverified result never outranks a verified one).
 */

import { RESEARCH_ERROR_CODES, ResearchError } from './errors.js';
import { researchSchemaRef } from './schemas.js';
import { isBenchmarkResult, recomputeBenchmarkResultDigest, resultSubjectKey } from './result.js';
import type { BenchmarkResult } from './result.js';
import { digestCanonical } from '@arena/protocol-core';
import type { SchemaRef } from '@arena/protocol-core';
import { isContentDigest, deepFreeze } from './shared.js';
import type { ResearchContentDigest } from './shared.js';

/** Wire version of the leaderboard state snapshot shape. */
export const LEADERBOARD_VERSION = 1 as const;

/** One ranked leaderboard row (a pure projection, never stored). */
export interface LeaderboardRow {
  readonly rank: number;
  readonly result: BenchmarkResult;
  readonly supersededBy: ResearchContentDigest | null;
}

/** A frozen, content-addressed snapshot of the visible leaderboard. */
export interface LeaderboardSnapshot {
  readonly leaderboardVersion: typeof LEADERBOARD_VERSION;
  readonly benchmark: ResearchContentDigest | null;
  readonly rows: readonly LeaderboardRow[];
  readonly outputSchema: SchemaRef;
  readonly digest: ResearchContentDigest;
}

/** Outcome ranking classes: verified results outrank indeterminate ones. */
function outcomeClass(outcome: string): number {
  if (outcome === 'pass' || outcome === 'fail') return 0;
  return 1;
}

/**
 * The append-only leaderboard ledger. Construct with `new
 * LeaderboardLedger()`; append validated results; project rankings.
 */
export class LeaderboardLedger {
  /** Records by digest -- the append-only, content-addressed ledger. */
  private readonly recordsByDigest = new Map<ResearchContentDigest, BenchmarkResult>();
  /** Subject key → the currently visible (non-superseded) record digest. */
  private readonly currentByKey = new Map<string, ResearchContentDigest>();
  /** Superseded record digest → the superseding record digest. */
  private readonly supersededBy = new Map<ResearchContentDigest, ResearchContentDigest>();
  /** Insertion order (the audit trail). */
  private readonly order: ResearchContentDigest[] = [];

  /** The number of appended records (including superseded ones). */
  get size(): number {
    return this.order.length;
  }

  /** True iff the digest is already appended (pure lookup). */
  has(digest: string): boolean {
    return isContentDigest(digest) && this.recordsByDigest.has(digest);
  }

  /** The record for a digest (or null). */
  get(digest: string): BenchmarkResult | null {
    return isContentDigest(digest) ? (this.recordsByDigest.get(digest) ?? null) : null;
  }

  /** The superseding digest of a record (or null when visible). */
  supersessionOf(digest: string): ResearchContentDigest | null {
    return isContentDigest(digest) ? (this.supersededBy.get(digest) ?? null) : null;
  }

  /**
   * Append one result record. Verifies the digest over the digest-free
   * view (tampered inputs are rejected), treats identical re-submission
   * as an idempotent no-op, and applies the supersession rule for a
   * new result of the same subject. Returns the appended (or stored)
   * record.
   */
  async append(record: BenchmarkResult): Promise<BenchmarkResult> {
    if (!isBenchmarkResult(record)) {
      throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
        message: 'leaderboard append requires a structurally valid benchmark result',
      });
    }
    await recomputeBenchmarkResultDigest(record);

    const stored = this.recordsByDigest.get(record.digest);
    if (stored !== undefined) {
      return stored; // idempotent re-submission of identical bytes
    }

    const key = resultSubjectKey(record);
    const previousDigest = this.currentByKey.get(key);
    if (previousDigest !== undefined) {
      const previous = this.recordsByDigest.get(previousDigest);
      if (previous !== undefined && Date.parse(record.run.finishedAt) < Date.parse(previous.run.finishedAt)) {
        throw new ResearchError(RESEARCH_ERROR_CODES.NON_MONOTONIC, {
          message: 'leaderboard append: a superseding result must not finish before the result it supersedes (non-monotonic supersession rejected)',
          details: {
            subject: key,
            previousFinishedAt: previous.run.finishedAt,
            attemptedFinishedAt: record.run.finishedAt,
          },
        });
      }
      this.supersededBy.set(previousDigest, record.digest);
    }

    this.recordsByDigest.set(record.digest, record);
    this.currentByKey.set(key, record.digest);
    this.order.push(record.digest);
    return record;
  }

  /**
   * The deterministic ranking for one benchmark (or the union ledger
   * when null): visible results only, score descending, outcome class
   * ascending, digest ascending. Rank is 1-based.
   */
  ranking(benchmark: string | null = null): readonly LeaderboardRow[] {
    const visible: BenchmarkResult[] = [];
    for (const digest of this.order) {
      if (this.supersededBy.has(digest)) continue;
      const record = this.recordsByDigest.get(digest);
      if (record === undefined) continue;
      if (benchmark !== null && record.benchmark.digest !== benchmark) continue;
      visible.push(record);
    }
    visible.sort((a, b) => {
      const classDelta = outcomeClass(a.aggregate.outcome) - outcomeClass(b.aggregate.outcome);
      if (classDelta !== 0) return classDelta;
      if (b.aggregate.score !== a.aggregate.score) return b.aggregate.score - a.aggregate.score;
      return a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0;
    });
    return deepFreeze(
      visible.map((result, index) =>
        Object.freeze({
          rank: index + 1,
          result,
          supersededBy: null,
        }),
      ),
    ) as readonly LeaderboardRow[];
  }

  /** All appended records in insertion order (the audit trail). */
  history(): readonly BenchmarkResult[] {
    return deepFreeze(
      this.order
        .map((digest) => this.recordsByDigest.get(digest))
        .filter((record): record is BenchmarkResult => record !== undefined),
    );
  }

  /** The superseded digests, in insertion order (the full lineage). */
  supersededDigests(): readonly ResearchContentDigest[] {
    return deepFreeze(this.order.filter((digest) => this.supersededBy.has(digest)));
  }

  /**
   * A frozen, content-addressed snapshot of the current ranking (the
   * citable leaderboard artifact): canonical JSON over the ranked
   * record digests + outcome classes, sha256-digested.
   */
  async snapshot(benchmark: string | null = null): Promise<LeaderboardSnapshot> {
    const rows = this.ranking(benchmark);
    const view = {
      leaderboardVersion: LEADERBOARD_VERSION,
      benchmark,
      rows: rows.map((row) => ({
        rank: row.rank,
        digest: row.result.digest,
        outcome: row.result.aggregate.outcome,
        score: row.result.aggregate.score,
      })),
      outputSchema: researchSchemaRef('research/leaderboard'),
    };
    const digest = await digestCanonical(view);
    return deepFreeze({
      leaderboardVersion: LEADERBOARD_VERSION,
      benchmark,
      rows,
      outputSchema: view.outputSchema,
      digest,
    }) as LeaderboardSnapshot;
  }
}
