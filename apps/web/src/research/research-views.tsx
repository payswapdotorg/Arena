/**
 * ResearchHomeView — the presentational `/research` surface (Work Order
 * B012; issue #87; apps/web/src/research).
 *
 * SYNC presentational component (renderable through react-dom/server in
 * the house test style).
 *
 * THE governing truths rendered here (the A030 posture):
 *   - a benchmark result is a statement about a body version, possessed
 *     by a substrate, under an environment and runtime, scored on a
 *     named benchmark at a pinned revision — NEVER about the model alone
 *     (the composition-scope banner is ALWAYS visible);
 *   - benchmark scores are EVALUATION RESULTS (their own truth class) —
 *     a leaderboard row never renders as a verified fact and never as a
 *     certification;
 *   - supersession renders as supersession (the append-only ledger
 *     posture — no silent deletion);
 *   - dataset lineage renders as evidence: content-addressed manifests
 *     with parent edges and derivation relations;
 *   - demo mode renders under the B006 labelling contract.
 */

import {
  DemoDataBadge,
  EmptyState,
  PageHeader,
  TruthBadge,
} from '@arena/ui-platform';
import { DEMO_LABELLING } from '@arena/demo';
import { EvaluationTruthMark, Maybe } from '../evaluation/evaluation-home-view.js';
import type { ResearchHomeViewModel } from './research-route.js';

export function ResearchHomeView({ view }: { readonly view: ResearchHomeViewModel }) {
  return (
    <div className="research-surface" data-arena-route="research" data-arena-surface-mode={view.mode}>
      <PageHeader
        title="Research"
        description="Benchmark Agent Body compositions, study capability lift, and publish reusable, lineage-recorded research artifacts."
      />

      {view.demo.isDemo ? (
        <section className="research-demo-banner" aria-label="Demo mode notice" data-arena-demo-banner="true">
          <DemoDataBadge note="deterministic seed" />
          <p>
            <strong>{DEMO_LABELLING.bannerTitle}.</strong> {DEMO_LABELLING.bannerText}
          </p>
        </section>
      ) : null}

      <section
        className="research-distinction"
        aria-label="Composition scope"
        data-arena-research-distinction="true"
      >
        <p>{view.distinctionNote}</p>
      </section>

      <section className="research-benchmarks" aria-labelledby="research-benchmarks-title" data-arena-benchmarks-section="true">
        <h2 id="research-benchmarks-title">Benchmark comparison</h2>
        {view.comparison.rows.length === 0 ? (
          <EmptyState
            title="No benchmark runs recorded yet"
            hint="Benchmark results are composition-scoped, evidence-chained, append-once records. None are recorded in this posture — nothing is fabricated to fill the space."
          />
        ) : (
          <>
            <p className="research-benchmarks__methodology" data-arena-benchmark-methodology="true">
              {view.comparison.benchmarkId !== undefined ? (
                <>
                  Benchmark <code>{view.comparison.benchmarkId}</code> · methodology{' '}
                  <Maybe value={view.comparison.methodology.aggregation} /> · pass bar{' '}
                  {view.comparison.methodology.passAt !== undefined ? String(view.comparison.methodology.passAt) : 'unknown'}
                </>
              ) : (
                'Benchmark identity unknown.'
              )}
            </p>
            <div className="research-benchmarks__scroll" role="region" aria-label="Benchmark comparison table" tabIndex={0}>
              <table className="research-benchmarks__table" data-arena-benchmark-table="true">
                <thead>
                  <tr>
                    <th scope="col">Run</th>
                    <th scope="col">Subject composition</th>
                    {view.comparison.columns.map((column) => (
                      <th key={column} scope="col">{column}</th>
                    ))}
                    <th scope="col">Aggregate</th>
                  </tr>
                </thead>
                <tbody>
                  {view.comparison.rows.map((row) => (
                    <tr
                      key={row.runId}
                      data-arena-benchmark-run={row.runId}
                      data-arena-benchmark-superseded={row.superseded ? 'true' : 'false'}
                    >
                      <td>
                        <code>{row.runId}</code>
                        {row.superseded ? (
                          <p className="research-benchmarks__superseded" data-arena-supersession="true">
                            Superseded — the append-only ledger keeps the row.
                          </p>
                        ) : null}
                      </td>
                      <td data-arena-benchmark-subject={row.subjectLabel}>
                        <span className="research-subject-label">{row.subjectLabel}</span>
                      </td>
                      {row.cells.map((cell) => (
                        <td
                          key={cell.criterionId}
                          data-arena-benchmark-cell={`${cell.criterionId}:${cell.score === null ? 'unknown' : String(cell.score)}`}
                        >
                          {cell.score === null ? <Maybe value={undefined} /> : String(cell.score)}
                        </td>
                      ))}
                      <td data-arena-benchmark-aggregate={row.aggregate !== null ? String(row.aggregate.score) : 'unknown'}>
                        {row.aggregate !== null ? (
                          <>
                            <TruthBadge kind="evaluation" />
                            {view.demo.isDemo ? <DemoDataBadge /> : null}{' '}
                            {String(row.aggregate.score)} ({String(row.aggregate.outcome)})
                          </>
                        ) : (
                          <Maybe value={undefined} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {view.comparison.unreadableRuns.length > 0 ? (
              <p className="research-benchmarks__unreadable" data-arena-benchmark-unreadable="true">
                Unreadable run payloads (listed, never rendered as data):{' '}
                {view.comparison.unreadableRuns.join(', ')}.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="research-runs" aria-labelledby="research-runs-title" data-arena-research-runs="true">
        <h2 id="research-runs-title">Run evidence chains</h2>
        {view.runs.length === 0 ? (
          <EmptyState
            title="No run evidence to show"
            hint="Each benchmark run binds its A012 evaluation, A013 verification and (when present) A023 certification digests."
          />
        ) : (
          <ul className="research-runs__list">
            {view.runs.map((run) => (
              <li key={run.runId} className="research-run" data-arena-research-run={run.runId}>
                <div className="research-run__head">
                  <strong>{run.runId}</strong>
                  <TruthBadge kind="evaluation" />
                  {view.demo.isDemo ? <DemoDataBadge /> : null}
                </div>
                <p className="research-run__scope">
                  {run.benchmark.benchmarkId}@{run.benchmark.version} ({run.benchmark.status}) ·{' '}
                  seed <code>{run.run.seed}</code> · runner {run.run.runner}
                </p>
                <dl className="research-run__evidence" data-arena-research-evidence="true">
                  <div><dt>Evaluation record</dt><dd><code><Maybe value={run.evidence.evaluationRecordDigest} /></code></dd></div>
                  <div><dt>Verification record</dt><dd><code><Maybe value={run.evidence.verificationRecordDigest} /></code></dd></div>
                  <div><dt>Certification record</dt><dd><code><Maybe value={run.evidence.certificationRecordDigest} /></code></dd></div>
                  <div><dt>Confidence</dt><dd>{run.confidence !== undefined ? String(run.confidence) : <Maybe value={undefined} />}</dd></div>
                </dl>
                {run.limitations !== undefined ? (
                  <p className="research-run__limitations">Limitations: {run.limitations}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="research-lineage" aria-labelledby="research-lineage-title" data-arena-lineage-section="true">
        <h2 id="research-lineage-title">Dataset lineage</h2>
        {view.lineage.nodes.length === 0 ? (
          <EmptyState
            title="No published datasets yet"
            hint="Dataset manifests are content-addressed A014 objects with lineage-recorded derivations. None are published in this posture."
          />
        ) : (
          <ul className="research-lineage__list">
            {view.lineage.nodes.map((node) => (
              <li key={node.key} className="research-lineage-node" data-arena-lineage-node={node.name}>
                <div className="research-lineage-node__head">
                  <code>{node.namespace}/{node.name}@{node.version}</code>
                  <TruthBadge kind="evidence" />
                  {view.demo.isDemo ? <DemoDataBadge /> : null}
                </div>
                <p className="research-lineage-node__digest">
                  digest <code>{node.digest ?? 'unknown'}</code> · entries{' '}
                  {node.entryRoles.join(', ')} · license {String(node.rights?.license ?? 'unknown')} ·
                  created {String(node.createdAt ?? 'unknown')}
                </p>
                {node.parents.length > 0 ? (
                  <ul className="research-lineage-node__parents" data-arena-lineage-parents="true">
                    {node.parents.map((parent) => (
                      <li key={parent.key} data-arena-lineage-relation={parent.relation}>
                        {parent.relation}: <code>{parent.key}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="research-lineage-node__root" data-arena-lineage-root="true">
                    Root manifest (no parents).
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {view.lineage.unreadable.length > 0 ? (
          <p className="research-lineage__unreadable" data-arena-lineage-unreadable="true">
            Unreadable manifests (listed by index, never rendered as data):{' '}
            {view.lineage.unreadable.join(', ')}.
          </p>
        ) : null}
      </section>

      <section className="research-legend" aria-labelledby="research-legend-title" data-arena-truth-legend="true">
        <h2 id="research-legend-title">Truth classes on this surface</h2>
        <p className="research-legend__note">
          Every datum carries one of these classes — no generic "AI result" badge exists.
        </p>
        <ul className="research-legend__list">
          {view.legend.map((mark) => (
            <li key={mark.truthClass} className="research-legend__row" data-arena-truth-class={mark.truthClass}>
              <EvaluationTruthMark treatment={mark.treatment} label={mark.label} meaning={mark.meaning} />
              <span className="research-legend__meaning">{mark.meaning}</span>
            </li>
          ))}
        </ul>
      </section>

      <aside className="research-inspector" aria-label="Surface facts" data-arena-surface-inspector="true">
        <h2>Surface facts</h2>
        <dl className="research-inspector__facts">
          <div><dt>Tenant</dt><dd><code>{view.tenantId}</code></dd></div>
          <div><dt>Workspace</dt><dd><code>{view.workspaceId}</code></dd></div>
          <div><dt>Benchmark runs</dt><dd>{String(view.runs.length)}</dd></div>
          <div><dt>Comparison rows</dt><dd>{String(view.comparison.rows.length)}</dd></div>
          <div><dt>Dataset manifests</dt><dd>{String(view.lineage.nodes.length)}</dd></div>
        </dl>
        {view.demo.isDemo && view.demo.corpusHash !== undefined ? (
          <p className="research-inspector__hash" data-arena-corpus-hash="true">
            Demo corpus hash: <code>{view.demo.corpusHash.slice(0, 72)}…</code>
          </p>
        ) : null}
      </aside>
    </div>
  );
}
