/**
 * OperationsHomeView — the presentational `/operations` overview (Work
 * Order B014; apps/web/src/operations).
 *
 * SYNC presentational component (renderable through react-dom/server in
 * the house test style): the async composition (session probe, protocol
 * reads, capacity contracts) happens in the operations-route helpers,
 * and this component renders the resulting view model deterministically.
 *
 * THE governing truths rendered here:
 *   - the operating law is visible: SLOs are measurements (not promises),
 *     capacity fails closed (no billable fallback), audit is append-only
 *     evidence, and jobs render their recorded state — never an
 *     optimistic completion;
 *   - every row carries its truth class (verified fact / evaluation
 *     result / evidence / unknown) — never one generic badge;
 *   - the SLO board renders no-data verdicts as no-data (never a pass);
 *     the capacity board renders DISABLED/EXHAUSTED postures explicitly
 *     with their structured reasons;
 *   - the role lens frames (operator: jobs/SLO/quota; administrator:
 *     audit scope) without authorizing anything, and absent admin-only
 *     capabilities render as absent — never as disabled controls;
 *   - demo mode renders under the B006 labelling contract.
 */

import { DemoDataBadge, EmptyState, PageHeader, TruthBadge } from '@arena/ui-platform';
import type { StateKind } from '@arena/ui-platform';
import { DEMO_LABELLING } from '@arena/demo';
import { isBadgeTreatment, OPERATIONS_SLO_MEASUREMENT_NOTE } from './state-mark.js';
import type { TruthTreatment } from './state-mark.js';
import type { OperationsHomeViewModel } from './operations-route.js';
import type { SloRowView } from './slo-view-model.js';
import type { JobSummaryView } from './jobs-view-model.js';
import type { AuditEventView } from './audit-view-model.js';
import type { ProviderCapacityView } from './capacity-view-model.js';

/** Render one maybe-unknown value (unknown stays unknown — never guessed). */
export function Maybe(props: { readonly value: string | undefined }) {
  if (props.value === undefined) {
    return (
      <span className="operations-unknown" data-arena-unknown="true">
        Unknown
      </span>
    );
  }
  return <span>{props.value}</span>;
}

/** The distinct mark for the honesty-critical kinds B001 has no badge for (pending/unknown). */
export function OperationsTruthMark(props: {
  readonly treatment: TruthTreatment;
  readonly label: string;
  readonly meaning: string;
}) {
  const { treatment, label, meaning } = props;
  if (isBadgeTreatment(treatment)) {
    return <TruthBadge kind={treatment as StateKind} />;
  }
  return (
    <span
      className="operations-truth operations-truth--pending-unknown"
      data-arena-truth={treatment}
      title={meaning}
    >
      <span className="operations-truth__marker" aria-hidden="true" />
      <span className="operations-truth__label">{label}</span>
    </span>
  );
}

/** One SLO board row: the target + window + verdict + measured values (or the no-data posture). */
function SloRow(props: { readonly row: SloRowView; readonly demo: boolean }) {
  const { row, demo } = props;
  return (
    <tr
      className="operations-slo-row"
      data-arena-slo={row.sloId ?? 'unknown'}
      data-arena-slo-verdict={row.verdict}
      data-arena-slo-posture={row.posture}
    >
      <td>
        <strong>{row.sloId ?? 'unknown SLO'}</strong>
        {demo ? <DemoDataBadge /> : null}
        <span className="operations-slo-row__service">
          {' '}
          service <Maybe value={row.service} />
        </span>
      </td>
      <td>
        {row.targetRatio !== undefined ? String(row.targetRatio) : '—'}{' '}
        <span className="operations-slo-row__window">over <Maybe value={row.windowLabel} /></span>
      </td>
      <td>
        <span
          className={`operations-verdict operations-verdict--${row.verdict}`}
          data-arena-slo-verdict={row.verdict}
          title={row.posture === 'no-data' ? row.noDataNote : OPERATIONS_SLO_MEASUREMENT_NOTE}
        >
          {row.verdict}
        </span>
        {row.posture === 'measured' && row.measured !== null ? (
          <span className="operations-slo-row__measured">
            {' '}
            {String(row.measured.achievedRatio)} achieved · {String(row.measured.goodCount)}/
            {String(row.measured.sampleCount)} good · budget{' '}
            {String(Math.round(row.measured.budgetConsumedRatio * 100))}% burned
          </span>
        ) : (
          <span className="operations-slo-row__nodata"> {row.noDataNote}</span>
        )}
      </td>
      <td>
        <TruthBadge kind={row.truthClass === 'evaluation-result' ? 'evaluation' : 'model-output'} />
      </td>
    </tr>
  );
}

/** One job summary row: the recorded lifecycle state as a verified fact (or unknown). */
function JobRow(props: { readonly view: OperationsHomeViewModel; readonly job: JobSummaryView }) {
  const { view, job } = props;
  return (
    <tr
      className="operations-job-row"
      data-arena-job={job.jobId ?? 'unknown'}
      data-arena-job-state={job.state}
      data-arena-job-readable={job.readable ? 'true' : 'false'}
    >
      <td>
        {job.jobId !== undefined ? (
          <a href={`${view.jobHrefBase}/${encodeURIComponent(job.jobId)}`}>{job.jobId}</a>
        ) : (
          <Maybe value={job.jobId} />
        )}
      </td>
      <td>
        <Maybe value={job.kindKey} />
      </td>
      <td data-arena-job-state={job.state}>
        {job.truthClass === 'verified-fact' ? (
          <TruthBadge kind="verified" />
        ) : (
          <OperationsTruthMark
            treatment="unknown"
            label="Unknown"
            meaning="The record state cannot be read — rendered as unknown, never guessed."
          />
        )}{' '}
        <span className={`operations-job-state operations-job-state--${job.state}`}>{job.state}</span>
        {job.outcomeNote !== undefined ? (
          <span className="operations-job-row__outcome"> {job.outcomeNote}</span>
        ) : null}
      </td>
      <td>{job.attempts !== undefined ? String(job.attempts) : '—'}</td>
      <td>
        <Maybe value={job.updatedAt} />
      </td>
    </tr>
  );
}

/** One capacity provider row (compact overview form). */
function CapacityProviderRow(props: { readonly provider: ProviderCapacityView; readonly demo: boolean }) {
  const { provider, demo } = props;
  return (
    <tr
      className="operations-capacity-row"
      data-arena-provider={provider.providerId ?? 'unknown'}
      data-arena-provider-status={provider.status}
      data-arena-provider-fail-closed={provider.failClosed ? 'true' : 'false'}
    >
      <td>
        <strong>{provider.providerId ?? 'unknown provider'}</strong>
        {demo ? <DemoDataBadge /> : null}
        <span className="operations-capacity-row__role"> {provider.role}</span>
      </td>
      <td>
        <span className={`operations-capacity-status operations-capacity-status--${provider.status}`}>
          {provider.status}
        </span>
      </td>
      <td>{provider.failClosed ? 'fail closed' : 'usable'}</td>
      <td>
        {provider.reasons.length > 0
          ? provider.reasons.map((reason) => reason.code).join(', ')
          : 'none'}
      </td>
      <td>
        {provider.truthClass === 'verified-fact' ? (
          <TruthBadge kind="verified" />
        ) : (
          <OperationsTruthMark
            treatment="unknown"
            label="Unknown"
            meaning="The posture cannot be read — rendered as unknown and fail closed, never guessed healthy."
          />
        )}
      </td>
    </tr>
  );
}

/** One audit preview row (append-only evidence, projected verbatim). */
function AuditPreviewRow(props: { readonly event: AuditEventView; readonly demo: boolean }) {
  const { event, demo } = props;
  return (
    <li
      className="operations-audit-event"
      data-arena-audit-sequence={event.sequence ?? 'unknown'}
      data-arena-audit-kind={event.kind ?? 'unknown'}
    >
      <div className="operations-audit-event__head">
        <strong>#{event.sequence !== undefined ? String(event.sequence) : 'unknown'}</strong>{' '}
        <code>{event.kind ?? 'unknown kind'}</code>
        <TruthBadge kind="evidence" />
        {demo ? <DemoDataBadge /> : null}
      </div>
      <p className="operations-audit-event__actor">
        Actor: <Maybe value={event.actorTenantId} /> / <Maybe value={event.actorPrincipalId} /> ·{' '}
        <Maybe value={event.action} /> @ <Maybe value={event.boundaryClass} /> →{' '}
        <Maybe value={event.effect} />
        {event.reason !== undefined ? ` (${event.reason})` : ''}
      </p>
      <p className="operations-audit-event__address">
        correlation <code>{event.correlationId ?? 'unknown'}</code> ·{' '}
        {event.occurredAt ?? 'unknown time'}
      </p>
    </li>
  );
}

export function OperationsHomeView({ view }: { readonly view: OperationsHomeViewModel }) {
  return (
    <div
      className="operations-surface"
      data-arena-route="operations"
      data-arena-surface-mode={view.mode}
    >
      <PageHeader
        title="Operations"
        description="Jobs, SLOs, quotas and audit — the operational health of the workspace, rendered as measured facts, fail-closed capacity and append-only evidence."
      />

      {view.demo.isDemo ? (
        <section className="operations-demo-banner" aria-label="Demo mode notice" data-arena-demo-banner="true">
          <DemoDataBadge note="deterministic seed" />
          <p>
            <strong>{DEMO_LABELLING.bannerTitle}.</strong> {DEMO_LABELLING.bannerText}
          </p>
        </section>
      ) : null}

      <section
        className="operations-law"
        aria-label="The operating law of this surface"
        data-arena-operations-law="true"
      >
        <h2>How to read this surface</h2>
        <ul className="operations-law__list">
          <li data-arena-law="slo">{view.sloNote}</li>
          <li data-arena-law="capacity">{view.capacity.guaranteeNote}</li>
          <li data-arena-law="audit">{view.auditPreviewNote}</li>
          <li data-arena-law="jobs">{view.honestyNote}</li>
        </ul>
      </section>

      <section
        className="operations-lens"
        aria-labelledby="operations-lens-title"
        data-arena-role-lens="true"
      >
        <h2 id="operations-lens-title">Role lens</h2>
        <p className="operations-lens__note">{view.lens.lensNote}</p>
        <p className="operations-lens__grants" data-arena-lens-grants={view.lens.grantedRoleIds.join(',')}>
          Granted roles (facts of the validated session):{' '}
          {view.lens.grantedRoleIds.length > 0 ? (
            <code>{view.lens.grantedRoleIds.join(', ')}</code>
          ) : (
            'none'
          )}
          {view.lens.operatorLens ? ' — operator lens: jobs, SLOs and quotas are framed for you.' : ''}
          {view.lens.administratorLens ? ' — administrator lens: the audit scope is framed for you.' : ''}
        </p>
        <p className="operations-lens__absent" data-arena-lens-absent="true">
          {view.lens.absentNote}
        </p>
      </section>

      <section
        className="operations-jobs"
        aria-labelledby="operations-jobs-title"
        data-arena-jobs-section="true"
      >
        <h2 id="operations-jobs-title">Jobs</h2>
        <p className="operations-jobs__counts" data-arena-job-counts={Object.entries(view.jobLifecycleCounts).map(([state, count]) => `${state}:${String(count)}`).join(',')}>
          {Object.entries(view.jobLifecycleCounts)
            .map(([state, count]) => `${state}: ${String(count)}`)
            .join(' · ')}
        </p>
        {view.jobs.length === 0 ? (
          <EmptyState title="No job records" hint={view.jobsNote} />
        ) : (
          <div className="operations-jobs__scroll" role="region" aria-label="Jobs table" tabIndex={0}>
            <table className="operations-jobs__table">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Kind</th>
                  <th scope="col">State</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {view.jobs.map((job) => (
                  <JobRow
                    key={job.jobId ?? 'unknown'}
                    view={view}
                    job={job}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className="operations-slos"
        aria-labelledby="operations-slos-title"
        data-arena-slo-section="true"
      >
        <h2 id="operations-slos-title">Service level objectives</h2>
        <p className="operations-slos__note">{view.sloNote}</p>
        <div className="operations-slos__scroll" role="region" aria-label="SLO board table" tabIndex={0}>
          <table className="operations-slos__table">
            <thead>
              <tr>
                <th scope="col">SLO</th>
                <th scope="col">Target / window</th>
                <th scope="col">Verdict (measured)</th>
                <th scope="col">Truth class</th>
              </tr>
            </thead>
            <tbody>
              {view.sloRows.map((row) => (
                <SloRow key={row.sloId ?? 'unknown'} row={row} demo={view.demo.isDemo} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="operations-capacity"
        aria-labelledby="operations-capacity-title"
        data-arena-capacity-section="true"
      >
        <h2 id="operations-capacity-title">Provider capacity (free tier)</h2>
        <p className="operations-capacity__guarantee" data-arena-capacity-guarantee="true">
          {view.capacity.guaranteeNote}
        </p>
        <p className="operations-capacity__overall" data-arena-capacity-overall={view.capacity.overall}>
          Overall posture: <strong>{view.capacity.overall}</strong>
          {view.capacity.boardNote !== undefined ? ` — ${view.capacity.boardNote}` : ''}
        </p>
        <div className="operations-capacity__scroll" role="region" aria-label="Provider capacity table" tabIndex={0}>
          <table className="operations-capacity__table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Posture</th>
                <th scope="col">Operations</th>
                <th scope="col">Reasons</th>
                <th scope="col">Truth class</th>
              </tr>
            </thead>
            <tbody>
              {view.capacity.providers.map((provider) => (
                <CapacityProviderRow
                  key={provider.providerId ?? 'unknown'}
                  provider={provider}
                  demo={view.demo.isDemo}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="operations-audit"
        aria-labelledby="operations-audit-title"
        data-arena-audit-section="true"
      >
        <h2 id="operations-audit-title">Audit stream (preview)</h2>
        {view.auditPreview.length === 0 ? (
          <EmptyState title="No audit events" hint="No audit events are recorded in this posture — the stream renders the record store as it is, never a fabricated trail." />
        ) : (
          <ul className="operations-audit__list">
            {view.auditPreview.map((event) => (
              <AuditPreviewRow
                key={event.eventId ?? event.sequence ?? 'unknown'}
                event={event}
                demo={view.demo.isDemo}
              />
            ))}
          </ul>
        )}
        <p className="operations-audit__full-link">
          <a href={view.auditHrefBase}>Open the full audit stream</a> (append-only, digest-chained).
        </p>
      </section>

      <section className="operations-legend" aria-labelledby="operations-legend-title" data-arena-truth-legend="true">
        <h2 id="operations-legend-title">Truth classes on this surface</h2>
        <p className="operations-legend__note">
          Every datum carries one of these classes — no generic "AI result" badge exists.
        </p>
        <ul className="operations-legend__list">
          {view.legend.map((mark) => (
            <li key={mark.truthClass} className="operations-legend__row" data-arena-truth-class={mark.truthClass}>
              <OperationsTruthMark treatment={mark.treatment} label={mark.label} meaning={mark.meaning} />
              <span className="operations-legend__meaning">{mark.meaning}</span>
            </li>
          ))}
        </ul>
      </section>

      <aside className="operations-inspector" aria-label="Surface facts" data-arena-surface-inspector="true">
        <h2>Surface facts</h2>
        <dl className="operations-inspector__facts">
          <div><dt>Tenant</dt><dd><code>{view.tenantId}</code></dd></div>
          <div><dt>Workspace</dt><dd><code>{view.workspaceId}</code></dd></div>
          <div><dt>Principal</dt><dd><code>{view.principalLabel}</code></dd></div>
          <div><dt>Jobs</dt><dd>{String(view.jobs.length)}</dd></div>
          <div><dt>SLOs</dt><dd>{String(view.sloRows.length)}</dd></div>
          <div><dt>Providers</dt><dd>{String(view.capacity.providers.length)}</dd></div>
          <div><dt>Audit events</dt><dd>{String(view.auditPreview.length)} (preview)</dd></div>
          <div><dt>Checked at</dt><dd>{view.capacity.checkedAt !== undefined ? new Date(view.capacity.checkedAt).toISOString() : 'Unknown'}</dd></div>
        </dl>
        {view.demo.isDemo && view.demo.corpusHash !== undefined ? (
          <p className="operations-inspector__hash" data-arena-corpus-hash="true">
            Demo corpus hash: <code>{view.demo.corpusHash.slice(0, 72)}…</code>
          </p>
        ) : null}
      </aside>
    </div>
  );
}
