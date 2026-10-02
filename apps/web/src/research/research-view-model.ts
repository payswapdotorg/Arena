/**
 * Research view-models (Work Order B012; issue #87;
 * apps/web/src/research). Pure projection layer — no React, no I/O.
 *
 * The A030 benchmark/research posture as it must render (R43/R44):
 *
 *   - a benchmark result is a statement of the form "body B version V,
 *     possessed by substrate M, under environment E and runtime R,
 *     scored S on benchmark X at revision Y, verified by evidence" —
 *     NEVER a statement about the model alone. Every run view carries
 *     the full subject composition and the composition-scope note;
 *   - benchmark scores are EVALUATION RESULTS (their own truth class) —
 *     a leaderboard never renders as verified fact, and a benchmark is
 *     distinct from a body certification (R43);
 *   - comparison tables are composition-scoped: rows are RUNS over
 *     pinned compositions, cells carry per-criterion scores with the
 *     methodology (aggregation policy + pass bar) visible, and
 *     supersession renders as supersession (append-only ledger
 *     posture, never silent deletion);
 *   - dataset lineage renders as lineage: content-addressed manifests
 *     with parent edges and derivation relations, each an `evidence`
 *     truth class — packaging provenance, never a claim.
 *
 * The deterministic data comes from packages/datasets' PUBLIC API
 * (DatasetManifest / deriveDatasetManifest — relative imports) and the
 * B012 evaluation corpus; malformed inputs degrade truthfully.
 */

import { isDatasetManifest } from '../../../../packages/datasets/src/index.js';
import type { DatasetManifest } from '../../../../packages/datasets/src/index.js';
import { RESEARCH_COMPOSITION_SCOPE_NOTE } from '../evaluation/state-mark.js';

/** Version of the research view surface (bump on breaking changes). */
export const RESEARCH_VIEW_VERSION = 1 as const;

/** The benchmark identity + methodology a run is meaningless without. */
export interface BenchmarkIdentityView {
  readonly benchmarkId: string;
  readonly version: string;
  /** Publication lifecycle (draft | published | retired) — the A030 posture. */
  readonly status: 'draft' | 'published' | 'retired' | 'unknown';
  /** The scoring methodology: the A012 aggregation policy REUSED by reference, plus the pass bar. */
  readonly methodology: { readonly aggregation: string; readonly passAt: number };
}

/** The pinned subject composition every benchmark statement is scoped to. */
export interface BenchmarkSubjectView {
  readonly bodyVersion: {
    readonly tenant: string;
    readonly name: string;
    readonly version: string;
  };
  readonly substrate: { readonly substrateId: string; readonly substrateVersion: string };
  readonly environment: { readonly environmentId: string; readonly environmentVersion: string };
  readonly runtime: { readonly runtimeId: string; readonly runtimeVersion: string };
}

/** One research benchmark run: a composition-scoped, evidence-chained, append-once score. */
export interface BenchmarkRunView {
  readonly viewVersion: typeof RESEARCH_VIEW_VERSION;
  readonly runId: string;
  /** ALWAYS 'evaluation-result' — a benchmark score is never a verified fact, never a certification. */
  readonly truthClass: 'evaluation-result';
  readonly benchmark: BenchmarkIdentityView;
  readonly subject: BenchmarkSubjectView;
  readonly run: {
    readonly seed: string;
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly runner: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  };
  readonly scores: readonly { readonly criterionId: string; readonly score: number }[];
  readonly aggregate: { readonly score: number; readonly outcome: 'pass' | 'fail' | 'indeterminate' } | null;
  /** The verification-checked evidence chain (digest refs to the A012/A013/A023 objects). */
  readonly evidence: {
    readonly evaluationRecordDigest: string | undefined;
    readonly verificationRecordDigest: string | undefined;
    readonly certificationRecordDigest: string | undefined;
  };
  /** Supersession: the run id that replaced this one (null when current), never a silent deletion. */
  readonly supersession: { readonly supersededBy: string | null; readonly note: string };
  readonly confidence: number | undefined;
  readonly limitations: string | undefined;
  readonly compositionScopeNote: string;
}

/** The comparison table: composition-scoped rows over a shared methodology. */
export interface BenchmarkComparisonView {
  readonly viewVersion: typeof RESEARCH_VIEW_VERSION;
  readonly benchmarkId: string | undefined;
  readonly methodology: { readonly aggregation: string | undefined; readonly passAt: number | undefined };
  /** The per-criterion columns (first-seen order across runs). */
  readonly columns: readonly string[];
  readonly rows: readonly {
    readonly runId: string;
    readonly subjectLabel: string;
    readonly superseded: boolean;
    readonly aggregate: { readonly score: number; readonly outcome: string } | null;
    readonly cells: readonly { readonly criterionId: string; readonly score: number | null }[];
  }[];
  /** Run ids whose payloads failed the structural guard — listed, never rendered as data. */
  readonly unreadableRuns: readonly string[];
  readonly scopeNote: string;
}

/** Structural guard for one benchmark run payload (malformed -> excluded, named). */
function isBenchmarkRunLike(value: unknown): value is BenchmarkRunView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['runId'] === 'string' &&
    candidate['runId'].length > 0 &&
    typeof candidate['viewVersion'] === 'number' &&
    candidate['truthClass'] === 'evaluation-result' &&
    typeof candidate['benchmark'] === 'object' &&
    candidate['benchmark'] !== null &&
    Array.isArray(candidate['scores']) &&
    (candidate['aggregate'] === null ||
      (typeof candidate['aggregate'] === 'object' && candidate['aggregate'] !== null))
  );
}

/** The one-line composition label of a benchmark subject (never just the model). */
export function benchmarkSubjectLabel(subject: BenchmarkSubjectView): string {
  return [
    `${subject.bodyVersion.tenant}/${subject.bodyVersion.name}@${subject.bodyVersion.version}`,
    `substrate ${subject.substrate.substrateId}@${subject.substrate.substrateVersion}`,
    `env ${subject.environment.environmentId}@${subject.environment.environmentVersion}`,
    `runtime ${subject.runtime.runtimeId}@${subject.runtime.runtimeVersion}`,
  ].join(' × ');
}

/**
 * Build the composition-scoped comparison table over benchmark runs.
 * DETERMINISTIC: rows preserve input order; columns are the first-seen
 * criterion ids. Runs whose payloads fail the structural guard are listed
 * in `unreadableRuns` — they never render as data. A missing cell score
 * renders as null (Unknown), never a guessed value.
 */
export function buildBenchmarkComparison(runs: readonly unknown[]): BenchmarkComparisonView {
  const readable = runs.filter(isBenchmarkRunLike);
  const unreadableRuns: string[] = [];
  runs.forEach((run, index) => {
    if (!isBenchmarkRunLike(run)) {
      unreadableRuns.push(
        typeof (run as { runId?: unknown })?.runId === 'string'
          ? String((run as { runId: string }).runId)
          : `run[${String(index)}]`,
      );
    }
  });

  const columns: string[] = [];
  for (const run of readable) {
    for (const score of run.scores) {
      if (!columns.includes(score.criterionId)) columns.push(score.criterionId);
    }
  }

  const benchmark = readable[0]?.benchmark;

  const rows = readable.map((run) =>
    Object.freeze({
      runId: run.runId,
      subjectLabel: benchmarkSubjectLabel(run.subject),
      // A run is superseded when ITS OWN supersession names a successor
      // (the append-only ledger posture — the successor is never marked).
      superseded: run.supersession.supersededBy !== null,
      aggregate:
        run.aggregate !== null
          ? Object.freeze({ score: run.aggregate.score, outcome: run.aggregate.outcome })
          : null,
      cells: Object.freeze(
        columns.map((criterionId) => {
          const cell = run.scores.find((score) => score.criterionId === criterionId);
          return Object.freeze({
            criterionId,
            score: cell !== undefined ? cell.score : null,
          });
        }),
      ),
    }),
  );

  return Object.freeze({
    viewVersion: RESEARCH_VIEW_VERSION,
    benchmarkId: benchmark?.benchmarkId,
    methodology: Object.freeze({
      aggregation: benchmark?.methodology.aggregation,
      passAt: benchmark?.methodology.passAt,
    }),
    columns: Object.freeze(columns),
    rows: Object.freeze(rows),
    unreadableRuns: Object.freeze(unreadableRuns),
    scopeNote: RESEARCH_COMPOSITION_SCOPE_NOTE,
  } satisfies BenchmarkComparisonView);
}

// ---------------------------------------------------------------------------
// Dataset lineage (the A014 packaging provenance as research evidence)
// ---------------------------------------------------------------------------

/** One content-addressed dataset manifest node with its lineage edges. */
export interface DatasetLineageNodeView {
  readonly key: string;
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string | undefined;
  /** The entry roles the manifest declares (input | output | eval | split). */
  readonly entryRoles: readonly string[];
  /** The parent edges (parent manifest ref + derivation relation). */
  readonly parents: readonly { readonly key: string; readonly relation: string }[];
  readonly creator: string | undefined;
  readonly createdAt: string | undefined;
  readonly rights: { readonly license: string | undefined } | undefined;
  /** Datasets are research EVIDENCE: packaging provenance, never a claim. */
  readonly truthClass: 'evidence';
}

/** The lineage view over a set of dataset manifests (the honest provenance graph). */
export interface DatasetLineageView {
  readonly viewVersion: typeof RESEARCH_VIEW_VERSION;
  readonly nodes: readonly DatasetLineageNodeView[];
  /** Indices of payloads that failed the structural guard — listed, never rendered as data. */
  readonly unreadable: readonly number[];
}

/**
 * Project dataset manifests into the lineage view. Guarded: a malformed
 * manifest is listed by index, never rendered as a node. Parent edges
 * render with their derivation relation (derived-from | extracted-from |
 * composed-of), verbatim.
 */
export function toDatasetLineageView(manifests: readonly unknown[]): DatasetLineageView {
  const nodes: DatasetLineageNodeView[] = [];
  const unreadable: number[] = [];
  manifests.forEach((manifest, index) => {
    if (!isDatasetManifest(manifest)) {
      unreadable.push(index);
      return;
    }
    const typed = manifest as DatasetManifest;
    nodes.push(
      Object.freeze({
        key: `${typed.identity.namespace}/${typed.identity.name}@${typed.identity.version}#${typed.digest}`,
        namespace: typed.identity.namespace,
        name: typed.identity.name,
        version: typed.identity.version,
        digest: typed.digest,
        entryRoles: Object.freeze(typed.entries.map((entry) => String(entry.role))),
        parents: Object.freeze(
          typed.provenance.parents.map((edge) =>
            Object.freeze({
              key: `${edge.parent.namespace}/${edge.parent.name}@${edge.parent.version}#${edge.parent.digest}`,
              relation: String(edge.relation),
            }),
          ),
        ),
        creator:
          'principalId' in typed.provenance.creator
            ? String(typed.provenance.creator.principalId)
            : undefined,
        createdAt: String(typed.provenance.createdAt),
        rights: Object.freeze({
          license: String((typed.provenance.rights as { license?: unknown }).license ?? 'unknown'),
        }),
        truthClass: 'evidence',
      } satisfies DatasetLineageNodeView),
    );
  });
  return Object.freeze({
    viewVersion: RESEARCH_VIEW_VERSION,
    nodes: Object.freeze(nodes),
    unreadable: Object.freeze(unreadable),
  } satisfies DatasetLineageView);
}
