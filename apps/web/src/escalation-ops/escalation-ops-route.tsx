/**
 * Escalation-ops route resolvers (Work Order C021; apps/web/src/escalation-ops):
 * the async compositions the route mounts call server-side. Fail closed —
 * an unauthenticated visitor gets the auth-required experience, never an
 * anonymous surface. The demo composition engages for the reserved demo
 * tenant (deterministic corpus, visibly labelled); every other session
 * reads its own (possibly empty — honest) state.
 */

import type { ReactElement } from 'react';

import { isDemoTenant } from '@arena/demo';

import {
  getDemoEscalationOpsContext,
  resolveSessionEscalationOps,
} from './runtime.js';
import type { ResolveSessionCockpitOptions, SessionCockpitOutcome } from './runtime.js';
import type { TimelineStepViewModel } from './view-models.js';
import {
  toAlertRuleRowViewModel,
  toEscalationRowViewModel,
  toEscalationOpsRoleLensView,
  toNetworkHealthBoardViewModel,
  toSlaRecordViewModel,
  toSloRollupRowViewModel,
  toTimelineViewModel,
} from './view-models.js';
import {
  EscalationOpsAuthRequiredView,
  EscalationOpsBoardView,
  EscalationOpsErrorView,
} from './views.js';

export type EscalationOpsRouteExperience =
  | { readonly kind: 'auth-required'; readonly view: ReactElement }
  | { readonly kind: 'error'; readonly view: ReactElement }
  | { readonly kind: 'ok'; readonly view: ReactElement };

const SLO_WINDOW = {
  windowStart: Date.parse('2026-10-01T00:00:00.000Z'),
  windowEnd: Date.parse('2026-10-02T00:00:00.000Z'),
};

interface BoardContext {
  readonly mode: 'demo' | 'session';
  readonly tenantLabel: string;
  readonly grantedRoleIds: readonly string[];
  readonly rows: readonly ReturnType<typeof toEscalationRowViewModel>[];
  readonly timelines: Readonly<Record<string, readonly TimelineStepViewModel[]>>;
  readonly slaRecords: readonly ReturnType<typeof toSlaRecordViewModel>[];
  readonly sloRows: readonly ReturnType<typeof toSloRollupRowViewModel>[];
  readonly networkHealth: ReturnType<typeof toNetworkHealthBoardViewModel> | null;
  readonly alertRules: readonly ReturnType<typeof toAlertRuleRowViewModel>[];
}

async function resolveBoardContext(
  session: Extract<SessionCockpitOutcome, { readonly status: 'authenticated' }>,
): Promise<BoardContext> {
  const tenantId = session.facts.tenantId;
  const grantedRoleIds = session.facts.grantedRoleIds ?? [];
  if (isDemoTenant(tenantId)) {
    const demo = await getDemoEscalationOpsContext();
    const summaries = await demo.service.listEscalationSummaries(
      { tenant: demo.tenant },
      { correlationId: 'web-demo-list', at: demo.at },
    );
    const slaOverview = await demo.service.getSlaOverview(
      { tenant: demo.tenant },
      { correlationId: 'web-demo-sla', at: demo.at },
    );
    const sloCells = await demo.service.getSloRollups(
      {
        tenant: demo.tenant,
        dimension: 'capability',
        window: SLO_WINDOW,
        targetRatio: 0.5,
      },
      { correlationId: 'web-demo-slo', at: demo.at },
    );
    const health = await demo.service.getNetworkHealth(
      {
        tenant: demo.tenant,
        availabilityWindows: [{ declaredCapacity: 4, remainingCapacity: 3 }],
      },
      { correlationId: 'web-demo-health', at: demo.at },
    );
    // A MUTABLE accumulator (frozen by construction into the board context
    // through the Readonly board-context type below).
    const timelines: Record<string, readonly TimelineStepViewModel[]> = {};
    for (const summary of summaries) {
      const timeline = await demo.service.getEscalationTimeline(
        { tenant: demo.tenant, requestId: summary.requestId },
        { correlationId: 'web-demo-timeline', at: demo.at },
      );
      timelines[summary.requestId] = toTimelineViewModel(timeline);
    }
    return {
      mode: 'demo',
      tenantLabel: `${tenantId} (demo)`,
      grantedRoleIds,
      rows: summaries.map((summary) => toEscalationRowViewModel(summary)),
      timelines,
      slaRecords: slaOverview.records.map((record) => toSlaRecordViewModel(record)),
      sloRows: sloCells.map((cell) => toSloRollupRowViewModel(cell)),
      networkHealth: toNetworkHealthBoardViewModel(health),
      alertRules: slaOverview.alertRules
        .concat(health.alertRules)
        .map((rule) => toAlertRuleRowViewModel(rule)),
    };
  }
  // Non-demo session: the local-parity posture has no escalation
  // projections yet — honest empty states (no orchestrator composed).
  return {
    mode: 'session',
    tenantLabel: tenantId,
    grantedRoleIds,
    rows: [],
    timelines: {},
    slaRecords: [],
    sloRows: [],
    networkHealth: null,
    alertRules: [],
  };
}

/** `/escalation-ops` — the operator board (list + timelines + SLA/SLO + health). */
export async function resolveEscalationOpsBoardExperience(
  options: ResolveSessionCockpitOptions = {},
): Promise<EscalationOpsRouteExperience> {
  const session = await resolveSessionEscalationOps(options);
  if (session.status !== 'authenticated') {
    return { kind: 'auth-required', view: <EscalationOpsAuthRequiredView /> };
  }
  try {
    const context = await resolveBoardContext(session);
    const roleLens = toEscalationOpsRoleLensView(context.grantedRoleIds);
    return {
      kind: 'ok',
      view: (
        <EscalationOpsBoardView
          tenantLabel={context.tenantLabel}
          demo={context.mode === 'demo'}
          roleLens={roleLens}
          rows={context.rows}
          timelines={context.timelines}
          slaRecords={context.slaRecords}
          sloRows={context.sloRows}
          networkHealth={context.networkHealth}
          alertRules={context.alertRules}
        />
      ),
    };
  } catch (error) {
    return {
      kind: 'error',
      view: (
        <EscalationOpsErrorView
          detail={`escalation-ops read failed (fail closed): ${
            error instanceof Error ? error.message : String(error)
          }`}
        />
      ),
    };
  }
}
