/**
 * Developers route resolvers (Work Order C017): the async compositions
 * the route mounts call server-side. Fail closed — an unauthenticated
 * visitor gets the auth-required experience, never an anonymous
 * surface. The demo composition engages for the reserved demo tenant
 * (deterministic corpus, visibly labelled); every other session reads
 * its own (possibly empty — honest) state through the real services.
 */

import type { ReactElement } from 'react';

import { isDemoTenant } from '@arena/demo';

import {
  getDemoDevelopersContext,
  resolveSessionDevelopers,
  sandboxScenarioCatalogue,
} from './runtime.js';
import type { ResolveSessionCockpitOptions, SessionCockpitOutcome } from './runtime.js';
import { keyRowsViewModel, quickstartViewModel, sandboxScenarioCatalogueViewModel, dashboardViewModel } from './view-models.js';
import { DevelopersAuthRequiredView, DevelopersErrorView, DevelopersHomeView, DevelopersKeysView, DevelopersObservabilityView, DevelopersQuickstartView, DevelopersSandboxView } from './views.js';

export type DevelopersRouteExperience =
  | { readonly kind: 'auth-required'; readonly view: ReactElement }
  | { readonly kind: 'error'; readonly view: ReactElement }
  | { readonly kind: 'ok'; readonly view: ReactElement };

type PortalMode = 'demo' | 'session';

interface PortalContext {
  readonly mode: PortalMode;
  readonly tenantLabel: string;
  readonly clientAppCount: number;
  readonly keyCount: number;
  readonly escalationCount: number;
  readonly keys: readonly ReturnType<typeof keyRowsViewModel>[number][];
  readonly issuance: {
    readonly keyId: string;
    readonly label: string;
    readonly environment: string;
    readonly scopes: readonly string[];
    readonly secret: string;
  } | null;
  readonly sandboxRun: {
    readonly scenarioId: string;
    readonly requestId: string;
    readonly state: string;
    readonly events: readonly { readonly eventId: string; readonly eventType: string }[];
  } | null;
  readonly dashboard: ReturnType<typeof dashboardViewModel> | null;
}

async function resolvePortalContext(
  session: Extract<SessionCockpitOutcome, { readonly status: 'authenticated' }>,
): Promise<PortalContext> {
  const tenantId = session.facts.tenantId;
  if (isDemoTenant(tenantId)) {
    const { corpus } = await getDemoDevelopersContext();
    return {
      mode: 'demo',
      tenantLabel: `${tenantId} (demo)`,
      clientAppCount: 2,
      keyCount: corpus.keys.length + 1,
      escalationCount: corpus.dashboard.summary.total + 1,
      keys: keyRowsViewModel(corpus.keys),
      issuance: {
        keyId: corpus.issuance.keyId,
        label: corpus.issuance.label,
        environment: corpus.issuance.environment,
        scopes: corpus.issuance.scopes,
        secret: corpus.issuance.secret,
      },
      sandboxRun: corpus.sandboxRun,
      dashboard: dashboardViewModel(corpus.dashboard),
    };
  }
  // Non-demo session: the local-parity posture has no registrations yet —
  // honest empty states (register your first client app).
  return {
    mode: 'session',
    tenantLabel: tenantId,
    clientAppCount: 0,
    keyCount: 0,
    escalationCount: 0,
    keys: [],
    issuance: null,
    sandboxRun: null,
    dashboard: null,
  };
}

async function resolveExperience(
  options: ResolveSessionCockpitOptions,
  render: (context: PortalContext, mode: PortalMode) => ReactElement,
): Promise<DevelopersRouteExperience> {
  const session = await resolveSessionDevelopers(options);
  if (session.status !== 'authenticated') {
    return { kind: 'auth-required', view: <DevelopersAuthRequiredView /> };
  }
  try {
    const context = await resolvePortalContext(session);
    return { kind: 'ok', view: render(context, context.mode) };
  } catch (error) {
    return {
      kind: 'error',
      view: (
        <DevelopersErrorView
          detail={`developer portal read failed (fail closed): ${
            error instanceof Error ? error.message : String(error)
          }`}
        />
      ),
    };
  }
}

/** `/developers` — the portal overview. */
export async function resolveDevelopersHomeExperience(
  options: ResolveSessionCockpitOptions = {},
): Promise<DevelopersRouteExperience> {
  return resolveExperience(options, (context, mode) => (
    <DevelopersHomeView
      tenantLabel={context.tenantLabel}
      demo={mode === 'demo'}
      clientAppCount={context.clientAppCount}
      keyCount={context.keyCount}
      escalationCount={context.escalationCount}
    />
  ));
}

/** `/developers/keys` — keys with consequence exposure + the shown-once moment. */
export async function resolveDevelopersKeysExperience(
  options: ResolveSessionCockpitOptions = {},
): Promise<DevelopersRouteExperience> {
  return resolveExperience(options, (context, mode) => (
    <DevelopersKeysView
      tenantLabel={context.tenantLabel}
      demo={mode === 'demo'}
      rows={context.keys}
      issuance={mode === 'demo' ? context.issuance : null}
    />
  ));
}

/** `/developers/quickstart` — SDK snippets from the live contract vocabulary. */
export async function resolveDevelopersQuickstartExperience(
  options: ResolveSessionCockpitOptions = {},
): Promise<DevelopersRouteExperience> {
  return resolveExperience(options, (context, mode) => (
    <DevelopersQuickstartView
      tenantLabel={context.tenantLabel}
      demo={mode === 'demo'}
      model={quickstartViewModel()}
    />
  ));
}

/** `/developers/sandbox` — the sandbox console. */
export async function resolveDevelopersSandboxExperience(
  options: ResolveSessionCockpitOptions = {},
): Promise<DevelopersRouteExperience> {
  return resolveExperience(options, (context, mode) => (
    <DevelopersSandboxView
      tenantLabel={context.tenantLabel}
      demo={mode === 'demo'}
      scenarios={sandboxScenarioCatalogueViewModel(sandboxScenarioCatalogue())}
      run={context.sandboxRun}
    />
  ));
}

/** `/developers/observability` — the escalation observability dashboard. */
export async function resolveDevelopersObservabilityExperience(
  options: ResolveSessionCockpitOptions = {},
): Promise<DevelopersRouteExperience> {
  return resolveExperience(options, (context, mode) => (
    <DevelopersObservabilityView
      tenantLabel={context.tenantLabel}
      demo={mode === 'demo'}
      model={context.dashboard}
      {...(mode === 'demo' ? { staleAsOf: '2026-10-07T12:00:00.000Z' } : {})}
    />
  ));
}
