/**
 * Body-marketplace route resolvers (Work Order C014): the async
 * compositions the route mounts call server-side. Fail closed — an
 * unauthenticated visitor gets the auth-required experience, never an
 * anonymous marketplace. The demo composition engages for the reserved
 * demo tenant (deterministic corpus, visibly labelled); every other
 * session reads its own (possibly empty — honest) state through the
 * REAL C014 service fabric.
 */

import type { ReactElement } from 'react';

import { isDemoTenant } from '@arena/demo';

import {
  getDemoBodyMarketplaceContext,
  projectBodyMarketplace,
  resolveBodyMarketplaceSession,
} from './runtime.js';
import type { BodyMarketplaceSessionProbe } from './runtime.js';
import {
  browseView,
  listingDetail,
  myListingsView,
  toRoleLens,
} from './view-models.js';
import {
  BodyMarketplaceAuthRequiredView,
  BodyMarketplaceBrowseView,
  BodyMarketplaceDetailView,
  BodyMarketplaceErrorView,
  BodyMarketplaceMyListingsView,
  BodyMarketplaceRequestPretrainingView,
} from './views.js';

/** The typed route experience (the shared state vocabulary). */
export type BodyMarketplaceRouteExperience =
  | { readonly kind: 'auth-required'; readonly view: ReactElement }
  | { readonly kind: 'error'; readonly view: ReactElement }
  | { readonly kind: 'ok'; readonly view: ReactElement };

export interface ResolveBodyMarketplaceOptions {
  /** Session probe override (test seam); default: the auth boundary. */
  readonly probe?: BodyMarketplaceSessionProbe;
  /** The role lens (explicit query state — B007 pattern; NOT permission). */
  readonly lens?: string;
}

async function resolveExperience(
  options: ResolveBodyMarketplaceOptions,
  render: (facts: { tenantId: string; principalLabel: string; roles: readonly string[] }) => Promise<ReactElement>,
): Promise<BodyMarketplaceRouteExperience> {
  const probe: BodyMarketplaceSessionProbe =
    options.probe ??
    ({
      cookieValue: () => Promise.resolve(null),
      validate: () => Promise.reject(new Error('unreachable')),
    } satisfies BodyMarketplaceSessionProbe);
  const session = await resolveBodyMarketplaceSession(probe);
  if (session.status !== 'authenticated') {
    return { kind: 'auth-required', view: <BodyMarketplaceAuthRequiredView /> };
  }
  try {
    return { kind: 'ok', view: await render(session.facts) };
  } catch (error) {
    return {
      kind: 'error',
      view: (
        <BodyMarketplaceErrorView
          detail={`capability-body marketplace read failed (fail closed): ${
            error instanceof Error ? error.message : String(error)
          }`}
        />
      ),
    };
  }
}

/** `/body-marketplace` — browse capability bodies. */
export async function resolveBodyMarketplaceBrowseExperience(
  options: ResolveBodyMarketplaceOptions = {},
): Promise<BodyMarketplaceRouteExperience> {
  return resolveExperience(options, (facts) => resolveBrowseView(facts, options.lens));
}

/** `/body-marketplace/request-pretraining` — the pretraining request flow. */
export async function resolveBodyMarketplaceRequestPretrainingExperience(
  options: ResolveBodyMarketplaceOptions = {},
): Promise<BodyMarketplaceRouteExperience> {
  return resolveExperience(options, (facts) => resolveRequestPretrainingView(facts));
}

/** `/body-marketplace/my-listings` — the publish/my-listings flow. */
export async function resolveBodyMarketplaceMyListingsExperience(
  options: ResolveBodyMarketplaceOptions = {},
): Promise<BodyMarketplaceRouteExperience> {
  return resolveExperience(options, (facts) => resolveMyListingsView(facts));
}

/** `/body-marketplace/listings/[listingId]` — the listing detail. */
export async function resolveBodyMarketplaceDetailExperience(
  options: ResolveBodyMarketplaceOptions & { readonly listingId?: string } = {},
): Promise<BodyMarketplaceRouteExperience> {
  const listingId = options.listingId ?? '';
  return resolveExperience(options, (facts) => resolveListingDetailView(facts, listingId));
}

/** The full compositions (used by the route mounts + tests). */
export async function resolveBrowseView(
  facts: { tenantId: string; principalLabel: string; roles: readonly string[] },
  lens: string | undefined,
): Promise<ReactElement> {
  const projection = await projectBodyMarketplace(facts);
  return <BodyMarketplaceBrowseView model={browseView(projection, toRoleLens(lens))} />;
}

export async function resolveMyListingsView(
  facts: { tenantId: string; principalLabel: string; roles: readonly string[] },
): Promise<ReactElement> {
  const projection = await projectBodyMarketplace(facts);
  return <BodyMarketplaceMyListingsView model={myListingsView(projection)} />;
}

export async function resolveRequestPretrainingView(
  facts: { tenantId: string; principalLabel: string; roles: readonly string[] },
): Promise<ReactElement> {
  const projection = await projectBodyMarketplace(facts);
  return (
    <BodyMarketplaceRequestPretrainingView
      mode={projection.mode}
      tenantLabel={projection.tenantId}
      runs={projection.runs.map((run) => ({
        runId: run.runId,
        outcome: run.outcome,
        blockedReasons: run.blockedReasons.map((reason) => `${reason.code}: ${reason.detail}`),
      }))}
    />
  );
}

export async function resolveListingDetailView(
  facts: { tenantId: string; principalLabel: string; roles: readonly string[] },
  listingId: string,
): Promise<ReactElement> {
  const demo = isDemoTenant(facts.tenantId);
  if (!demo) {
    // Session tenants have no listings in the local-parity posture — the
    // honest not-found experience.
    return <BodyMarketplaceDetailView outcome={{ state: 'empty', model: null }} />;
  }
  const corpus = await getDemoBodyMarketplaceContext();
  try {
    const listing = corpus.fabric.getListing(listingId, facts.tenantId);
    const posture = await corpus.fabric.deriveCertificationPosture(listing);
    return (
      <BodyMarketplaceDetailView
        outcome={listingDetail(listing, {
          state: posture.state,
          strongestGrant: posture.state === 'record-backed' ? posture.strongestGrant : null,
        })}
      />
    );
  } catch {
    return <BodyMarketplaceDetailView outcome={{ state: 'empty', model: null }} />;
  }
}
