/**
 * Escalation-ops views (Work Order C021; apps/web/src/escalation-ops).
 * The Operator/Admin lens over the escalation-observability projections:
 * escalation list + timelines (state dwell, validation/payment refs),
 * SLA/SLO board (met/at-risk/breached vocabulary, disclosed formulas),
 * network health + alert-rule projections. Every state renders honestly
 * — loading/empty/error/permission-denied/demo-data/success — nothing
 * is fabricated to fill the space.
 */

import type { ReactElement } from 'react';

import type {
  AlertRuleRowViewModel,
  EscalationOpsRoleLensView,
  EscalationRowViewModel,
  NetworkHealthBoardViewModel,
  SlaRecordViewModel,
  SloRollupRowViewModel,
  TimelineStepViewModel,
} from './view-models.js';
import { formatDwell } from './view-models.js';

function Mark({ state }: { readonly state: string }): ReactElement {
  const palette: Readonly<Record<string, string>> = {
    loading: 'bg-slate-100 text-slate-700',
    empty: 'bg-slate-100 text-slate-600',
    error: 'bg-red-100 text-red-800',
    'permission-denied': 'bg-amber-100 text-amber-900',
    'demo-data': 'bg-violet-100 text-violet-900',
    success: 'bg-emerald-100 text-emerald-900',
  };
  return (
    <span
      data-testid="escalation-ops-state-mark"
      data-state={state}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${palette[state] ?? 'bg-slate-100 text-slate-700'}`}
    >
      {state}
    </span>
  );
}

function Section({
  title,
  note,
  children,
}: {
  readonly title: string;
  readonly note?: string;
  readonly children: React.ReactNode;
}): ReactElement {
  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {note !== undefined ? (
        <p className="mt-1 text-xs text-slate-500">{note}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** The auth-required notice (fail closed — never an anonymous surface). */
export function EscalationOpsAuthRequiredView(): ReactElement {
  return (
    <div className="mx-auto max-w-3xl p-8" data-arena-surface-auth="required">
      <Mark state="permission-denied" />
      <h1 className="mt-2 text-lg font-semibold text-slate-900">
        Escalation operations require a session
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        This surface projects tenant-scoped escalation lifecycles, SLA measurements and SLO
        rollups through the authenticated session (B004 session boundary). Sign in through
        the console to continue — an unauthenticated visitor never sees an anonymous
        escalation surface.
      </p>
    </div>
  );
}

/** The error view (fail closed with the typed detail). */
export function EscalationOpsErrorView({ detail }: { readonly detail: string }): ReactElement {
  return (
    <div className="mx-auto max-w-3xl p-8" data-arena-state="error">
      <Mark state="error" />
      <h1 className="mt-2 text-lg font-semibold text-slate-900">
        Escalation operations read failed
      </h1>
      <p className="mt-2 text-sm text-red-700">{detail}</p>
    </div>
  );
}

/** The loading view. */
export function EscalationOpsLoadingView(): ReactElement {
  return (
    <div className="mx-auto max-w-5xl p-8" data-arena-state="loading">
      <Mark state="loading" />
      <p className="mt-2 text-sm text-slate-600">Projecting escalation timelines…</p>
    </div>
  );
}

export interface EscalationOpsBoardProps {
  readonly tenantLabel: string;
  readonly demo: boolean;
  readonly roleLens: EscalationOpsRoleLensView;
  readonly rows: readonly EscalationRowViewModel[];
  readonly timelines: Readonly<Record<string, readonly TimelineStepViewModel[]>>;
  readonly slaRecords: readonly SlaRecordViewModel[];
  readonly sloRows: readonly SloRollupRowViewModel[];
  readonly networkHealth: NetworkHealthBoardViewModel | null;
  readonly alertRules: readonly AlertRuleRowViewModel[];
}

/** The escalation-ops board (the success/demo-data state). */
export function EscalationOpsBoardView(props: EscalationOpsBoardProps): ReactElement {
  return (
    <div
      className="mx-auto max-w-5xl space-y-4 p-8"
      data-arena-demo={props.demo ? 'true' : 'false'}
    >
      <header className="flex items-center gap-3">
        <Mark state={props.demo ? 'demo-data' : 'success'} />
        <h1 className="text-lg font-semibold text-slate-900">Escalation operations</h1>
        <span className="text-xs text-slate-500">tenant: {props.tenantLabel}</span>
      </header>
      {props.demo ? (
        <p className="rounded bg-violet-50 p-2 text-xs text-violet-900">
          Demo data — deterministic corpus over the real projection service with a fixed
          clock. Demo state is never customer state.
        </p>
      ) : null}
      <p className="text-xs text-slate-500">
        {props.roleLens.lensNote}
        {props.roleLens.operatorLens
          ? ' Operator lens: queue health, matching latency, validation backlog and SLA/SLO states are framed for you.'
          : ''}
        {props.roleLens.administratorLens
          ? ' Administrator lens: aggregate scope (cross-tenant SLO rollups with small-sample suppression) is framed for you.'
          : ''}
      </p>

      <Section
        title="Escalations"
        note="Lifecycle projections over the C001 event fabric — state dwell, validation-verdict refs, payment-state refs, replacement events."
      >
        {props.rows.length === 0 ? (
          <p className="text-sm text-slate-500">
            No projected escalations yet — the honest empty state.
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1">Escalation</th>
                <th>State</th>
                <th>Urgency</th>
                <th>Capability</th>
                <th>Replacements</th>
                <th>Observed dwell</th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row) => (
                <tr key={row.requestId} className="border-t border-slate-100">
                  <td className="py-1 font-mono">{row.requestId.slice(0, 12)}…</td>
                  <td>{row.currentState}</td>
                  <td>{row.urgency ?? '—'}</td>
                  <td>{row.capabilityNeed ?? '—'}</td>
                  <td>{row.replacementCount}</td>
                  <td>{formatDwell(row.observedDwellMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title="Timelines"
        note="Per-escalation state history with dwell times (append-only — projections never rewrite history)."
      >
        {Object.keys(props.timelines).length === 0 ? (
          <p className="text-sm text-slate-500">No timelines projected yet.</p>
        ) : (
          Object.entries(props.timelines).map(([requestId, steps]) => (
            <div key={requestId} className="mb-3">
              <p className="font-mono text-xs text-slate-700">{requestId.slice(0, 12)}…</p>
              <ol className="mt-1 space-y-1">
                {steps.map((step) => (
                  <li
                    key={step.sequence}
                    className="flex items-center gap-2 text-xs text-slate-600"
                  >
                    <span className="w-6 text-slate-400">#{step.sequence}</span>
                    <span className="w-40">{step.state}</span>
                    <span className="w-44 font-mono text-[10px]">{step.eventType}</span>
                    <span>{step.occurredAt}</span>
                    <span className="text-slate-400">dwell {formatDwell(step.dwellMs)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))
        )}
      </Section>

      <Section
        title="SLA measurement"
        note="Measured over the C011 clocks — met / pending / at-risk / breached with machine-readable reasons; corrections are supersessions."
      >
        {props.slaRecords.length === 0 ? (
          <p className="text-sm text-slate-500">No measured SLA records yet.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1">Escalation</th>
                <th>Clock</th>
                <th>State</th>
                <th>Due</th>
                <th>Milestone</th>
                <th>Reasons</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {props.slaRecords.map((record) => (
                <tr
                  key={`${record.requestId}:${record.clock}`}
                  className="border-t border-slate-100"
                >
                  <td className="py-1 font-mono">{record.requestId.slice(0, 12)}…</td>
                  <td>{record.clock}-by</td>
                  <td
                    className={
                      record.stateLabel.startsWith('breached')
                        ? 'text-red-700'
                        : record.stateLabel.startsWith('at-risk')
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                    }
                  >
                    {record.stateLabel}
                  </td>
                  <td className="font-mono text-[10px]">{record.dueAt}</td>
                  <td className="font-mono text-[10px]">{record.milestoneAt ?? '—'}</td>
                  <td>{record.reasons.join(', ')}</td>
                  <td>{record.evidenceCount} events</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title="SLO rollups"
        note="A035-vocabulary rollups with disclosed formulas, sample sizes and explicit small-sample status (no-data fails closed)."
      >
        {props.sloRows.length === 0 ? (
          <p className="text-sm text-slate-500">No completed-outcome samples in the window yet.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1">Capability</th>
                <th>Verdict</th>
                <th>Samples</th>
                <th>Achieved</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {props.sloRows.map((row) => (
                <tr key={row.key} className="border-t border-slate-100">
                  <td className="py-1">{row.key}</td>
                  <td
                    className={
                      row.verdict === 'breached'
                        ? 'text-red-700'
                        : row.verdict === 'no-data'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                    }
                  >
                    {row.verdict}
                    {row.smallSample ? ' (small sample)' : ''}
                  </td>
                  <td>
                    {row.sampleCount} ({row.goodCount} good)
                  </td>
                  <td>{row.achievedRatio}</td>
                  <td>{row.targetRatio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {props.sloRows.length > 0 ? (
          <p className="mt-2 text-[10px] text-slate-500">{props.sloRows[0]?.formula}</p>
        ) : null}
      </Section>

      <Section
        title="Network health"
        note="Matching latency, queue depth, validation backlog, replacement rate, availability coverage — deterministic given identical event inputs."
      >
        {props.networkHealth === null ? (
          <p className="text-sm text-slate-500">
            No health signals measured yet (no availability windows declared).
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-xs text-slate-700 md:grid-cols-3">
            <div>
              <dt className="text-slate-500">Matching latency (median)</dt>
              <dd>{formatDwell(props.networkHealth.matchingLatencyMedianMs)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Matching latency (p95)</dt>
              <dd>{formatDwell(props.networkHealth.matchingLatencyP95Ms)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Queue depth</dt>
              <dd>{props.networkHealth.queueDepth}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Validation backlog</dt>
              <dd>{props.networkHealth.validationBacklog}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Replacement rate</dt>
              <dd>{props.networkHealth.replacementRate}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Availability coverage</dt>
              <dd>{props.networkHealth.availabilityCoverage ?? '—'}</dd>
            </div>
          </dl>
        )}
      </Section>

      <Section
        title="Alert-rule projections"
        note="Mapped onto the docs/operations/alert-catalog.md closed condition vocabulary — the catalog itself is A035-owned."
      >
        {props.alertRules.length === 0 ? (
          <p className="text-sm text-slate-500">
            No projected alert rules — the honest quiet (nothing is fabricated to fill the space).
          </p>
        ) : (
          <ul className="space-y-1 text-xs">
            {props.alertRules.map((rule) => (
              <li key={rule.ruleId} className="border-t border-slate-100 py-1">
                <span className="font-mono">{rule.ruleId}</span> · {rule.conditionKind} ·{' '}
                <span className="font-medium">{rule.severity}</span> · {rule.escalationCondition}
                <p className="text-[10px] text-slate-500">{rule.catalogAncestry}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
