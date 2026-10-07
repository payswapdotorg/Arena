/**
 * Competitions route resolvers (Work Order C013): the async
 * compositions the route mounts call server-side. Fail closed — an
 * unauthenticated visitor gets the auth-required experience, never an
 * anonymous surface. The demo composition engages for the reserved demo
 * tenant (deterministic corpus, visibly labelled); every other session
 * reads its own (possibly empty — honest) state.
 *
 * NOTE (ownership boundary): the Next.js app/ mounts for /competitions
 * live OUTSIDE this Work Order's owned surface (apps/web/src/
 * competitions only) — the resolvers below are the composition the TL
 * mounts; recording this in the PR as an architecture question.
 */

import type { ReactElement } from 'react';

import { isDemoTenant } from '@arena/demo';

import { resolveSessionCockpit } from '../cockpit/runtime.js';
import type { ResolveSessionCockpitOptions } from '../cockpit/runtime.js';

import { buildDemoCompetitionsCorpus } from './fixtures.js';
import { competitionDetailViewModel, competitionSummaryViewModel } from './view-models.js';
import {
  CompetitionDetailView,
  CompetitionsAuthRequiredView,
  CompetitionsErrorView,
  CompetitionsHomeView,
} from './views.js';

export type CompetitionsRouteExperience =
  | { readonly kind: 'auth-required'; readonly view: ReactElement }
  | { readonly kind: 'error'; readonly view: ReactElement }
  | { readonly kind: 'ok'; readonly view: ReactElement };

export async function resolveCompetitionsHomeExperience(
  options: ResolveSessionCockpitOptions = {},
): Promise<CompetitionsRouteExperience> {
  const session = await resolveSessionCockpit(options);
  if (session.status !== 'authenticated') {
    return { kind: 'auth-required', view: <CompetitionsAuthRequiredView /> };
  }
  try {
    const tenantId = session.facts.tenantId;
    if (isDemoTenant(tenantId)) {
      const corpus = buildDemoCompetitionsCorpus();
      return {
        kind: 'ok',
        view: (
          <CompetitionsHomeView
            tenantLabel={`${tenantId} (demo)`}
            demo={true}
            competitions={[
              competitionSummaryViewModel(corpus.competition, corpus.judgments.length, corpus.result),
            ]}
          />
        ),
      };
    }
    // Non-demo session: no competitions have been opened in the local
    // posture — the honest empty state.
    return {
      kind: 'ok',
      view: <CompetitionsHomeView tenantLabel={tenantId} demo={false} competitions={[]} />,
    };
  } catch (error) {
    return {
      kind: 'error',
      view: (
        <CompetitionsErrorView
          detail={`competitions read failed (fail closed): ${
            error instanceof Error ? error.message : String(error)
          }`}
        />
      ),
    };
  }
}

export async function resolveCompetitionDetailExperience(
  competitionId: string,
  options: ResolveSessionCockpitOptions = {},
): Promise<CompetitionsRouteExperience> {
  const session = await resolveSessionCockpit(options);
  if (session.status !== 'authenticated') {
    return { kind: 'auth-required', view: <CompetitionsAuthRequiredView /> };
  }
  try {
    const tenantId = session.facts.tenantId;
    if (isDemoTenant(tenantId)) {
      const corpus = buildDemoCompetitionsCorpus();
      if (corpus.competition.competitionId !== competitionId) {
        return {
          kind: 'error',
          view: (
            <CompetitionsErrorView
              detail={`competition ${competitionId} does not exist in the demo corpus (fail closed; no fabricated competition)`}
            />
          ),
        };
      }
      return {
        kind: 'ok',
        view: (
          <CompetitionDetailView
            tenantLabel={`${tenantId} (demo)`}
            demo={true}
            model={competitionDetailViewModel(corpus)}
          />
        ),
      };
    }
    // Non-demo session: no competitions exist yet — the honest empty
    // posture (rendered through the home experience's empty state).
    return {
      kind: 'ok',
      view: <CompetitionsHomeView tenantLabel={tenantId} demo={false} competitions={[]} />,
    };
  } catch (error) {
    return {
      kind: 'error',
      view: (
        <CompetitionsErrorView
          detail={`competition read failed (fail closed): ${
            error instanceof Error ? error.message : String(error)
          }`}
        />
      ),
    };
  }
}
