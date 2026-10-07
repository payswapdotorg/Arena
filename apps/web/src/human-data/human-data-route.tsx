/**
 * Human-data studio route resolvers (Work Order C012): the async
 * compositions the route mounts call server-side. Fail closed — an
 * unauthenticated visitor gets the auth-required experience, never an
 * anonymous surface. The demo composition engages for the reserved demo
 * tenant (deterministic corpus, visibly labelled); every other session
 * reads its own (possibly empty — honest) state through the real service.
 */

import type { ReactElement } from 'react';

import { isDemoTenant } from '@arena/demo';

import { getDemoHumanDataContext, resolveSessionHumanData } from './runtime.js';
import type { ResolveSessionCockpitOptions, SessionCockpitOutcome } from './runtime.js';
import {
  commissionBuilderViewModel,
  datasetDeliveryViewModel,
  productionDashboardViewModel,
} from './view-models.js';
import {
  HumanDataAuthRequiredView,
  HumanDataDatasetsView,
  HumanDataErrorView,
  HumanDataHomeView,
  HumanDataProductionView,
} from './views.js';

export type HumanDataRouteExperience =
  | { readonly kind: 'auth-required'; readonly view: ReactElement }
  | { readonly kind: 'error'; readonly view: ReactElement }
  | { readonly kind: 'ok'; readonly view: ReactElement };

type StudioMode = 'demo' | 'session';

interface StudioContext {
  readonly mode: StudioMode;
  readonly tenantLabel: string;
  readonly builder: ReturnType<typeof commissionBuilderViewModel> | null;
  readonly dashboard: ReturnType<typeof productionDashboardViewModel> | null;
  readonly delivery: ReturnType<typeof datasetDeliveryViewModel> | null;
}

async function resolveStudioContext(
  session: Extract<SessionCockpitOutcome, { readonly status: 'authenticated' }>,
): Promise<StudioContext> {
  const tenantId = session.facts.tenantId;
  if (isDemoTenant(tenantId)) {
    const { corpus } = await getDemoHumanDataContext();
    return {
      mode: 'demo',
      tenantLabel: `${tenantId} (demo)`,
      builder: commissionBuilderViewModel(corpus.inProduction),
      dashboard: productionDashboardViewModel(corpus.inProductionProjection),
      delivery: datasetDeliveryViewModel(corpus.deliveredDescriptor),
    };
  }
  // Non-demo session: the local-parity posture has no commissions yet —
  // honest empty states (declare your first commission).
  return {
    mode: 'session',
    tenantLabel: tenantId,
    builder: null,
    dashboard: null,
    delivery: null,
  };
}

async function resolveExperience(
  options: ResolveSessionCockpitOptions,
  render: (context: StudioContext, mode: StudioMode) => ReactElement,
): Promise<HumanDataRouteExperience> {
  const session = await resolveSessionHumanData(options);
  if (session.status !== 'authenticated') {
    return { kind: 'auth-required', view: <HumanDataAuthRequiredView /> };
  }
  try {
    const context = await resolveStudioContext(session);
    return { kind: 'ok', view: render(context, context.mode) };
  } catch (error) {
    return {
      kind: 'error',
      view: (
        <HumanDataErrorView
          detail={`human-data studio read failed (fail closed): ${
            error instanceof Error ? error.message : String(error)
          }`}
        />
      ),
    };
  }
}

/** `/human-data` — the commission builder (declaration + consequence exposure). */
export async function resolveHumanDataHomeExperience(
  options: ResolveSessionCockpitOptions = {},
): Promise<HumanDataRouteExperience> {
  return resolveExperience(options, (context, mode) => (
    <HumanDataHomeView
      tenantLabel={context.tenantLabel}
      demo={mode === 'demo'}
      builder={context.builder}
    />
  ));
}

/** `/human-data/production` — the production dashboard (live C001 projections). */
export async function resolveHumanDataProductionExperience(
  options: ResolveSessionCockpitOptions = {},
): Promise<HumanDataRouteExperience> {
  return resolveExperience(options, (context, mode) => (
    <HumanDataProductionView
      tenantLabel={context.tenantLabel}
      demo={mode === 'demo'}
      dashboard={context.dashboard}
    />
  ));
}

/** `/human-data/datasets` — the dataset delivery page (manifest, rights, lineage, download gate). */
export async function resolveHumanDataDatasetsExperience(
  options: ResolveSessionCockpitOptions = {},
): Promise<HumanDataRouteExperience> {
  return resolveExperience(options, (context, mode) => (
    <HumanDataDatasetsView
      tenantLabel={context.tenantLabel}
      demo={mode === 'demo'}
      delivery={context.delivery}
    />
  ));
}
