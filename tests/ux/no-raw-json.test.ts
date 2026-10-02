/**
 * B017 M2 — UX conformance: no raw JSON rendering.
 *
 * A user-visible screen must never dump a record payload as unprocessed
 * JSON — canonical data is rendered through the truth-labelled view
 * models, not serialized onto the page. This suite scans every served
 * demo page (entity-aware: HTML-escaped quotes) for JSON object/array
 * literals in the rendered CONTENT.
 *
 * One documented, intentional exception: the demo corpus-hash
 * determinism stamp (`data-arena-corpus-hash`), which displays the
 * canonical-JSON digest PREFIX inside a labelled <code> element as the
 * reproducibility proof. It is a digest display, not a data dump — and
 * it is the ONLY permitted instance (the count is asserted, so a
 * second JSON blob anywhere fails this check).
 *
 * The composition layer additionally renders every demo surface and
 * applies the same scan, so the check runs even without the server.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { resolveDemoCockpitView } from '../../apps/web/src/cockpit/home-route.js';
import { CockpitHomeView } from '../../apps/web/src/cockpit/cockpit-home-view.js';
import { resolveDemoCaseList } from '../../apps/web/src/capability/case-routes.js';
import { CaseListView } from '../../apps/web/src/capability/capability-views.js';
import { resolveDemoEvaluationHome } from '../../apps/web/src/evaluation/evaluation-route.js';
import { EvaluationHomeView } from '../../apps/web/src/evaluation/evaluation-home-view.js';
import { resolveDemoResearchHome } from '../../apps/web/src/research/research-route.js';
import { ResearchHomeView } from '../../apps/web/src/research/research-views.js';
import { resolveDemoBodiesStudioView } from '../../apps/web/src/bodies/bodies-route.js';
import { BodyStudioView } from '../../apps/web/src/bodies/bodies-home-view.js';
import {
  resolveDemoOperationsAudit,
  resolveDemoOperationsCapacity,
} from '../../apps/web/src/operations/operations-route.js';
import {
  AuditStreamScreenView,
  CapacityPanelView,
} from '../../apps/web/src/operations/operations-screens.js';

const BASE = process.env.ARENA_UX_BASE_URL;

/**
 * Find entity-escaped JSON literals in rendered HTML: an object or
 * array literal opening with a string key ({"…": or [{&quot;…&quot;:).
 * Returns the character offsets of every match.
 */
function rawJsonHits(html: string): number[] {
  return [
    ...html.matchAll(/\[\{&quot;[a-zA-Z][a-zA-Z0-9_-]*&quot;:|\{&quot;[a-zA-Z][a-zA-Z0-9_-]*&quot;:/g),
  ].map((match) => match.index ?? -1);
}

/** True when the offset sits inside the labelled corpus-hash digest display. */
function insideCorpusHashDisplay(html: string, offset: number): boolean {
  const marker = html.indexOf('data-arena-corpus-hash="true"');
  if (marker === -1) return false;
  // The digest renders as <code>…</code> within the same element,
  // shortly after the marker; bounded by the next closing </p>.
  const elementEnd = html.indexOf('</p>', marker);
  return offset > marker && offset < elementEnd;
}

function assertNoRawJson(page: string, html: string): void {
  const hits = rawJsonHits(html);
  const offenders = hits.filter((offset) => !insideCorpusHashDisplay(html, offset));
  expect(
    offenders,
    `${page} renders raw JSON payloads outside the labelled corpus-hash digest (offsets: ${String(offenders)})`,
  ).toHaveLength(0);
}

describe('B017 M2 — no raw JSON rendering (composition layer)', () => {
  it('no demo surface dumps record payloads as JSON', async () => {
    const pages: Record<string, string> = {
      cockpit: renderToStaticMarkup(
        createElement(CockpitHomeView, { view: await resolveDemoCockpitView('owner') }),
      ),
      cases: renderToStaticMarkup(
        createElement(CaseListView, { view: await resolveDemoCaseList('owner') }),
      ),
      evaluation: renderToStaticMarkup(
        createElement(EvaluationHomeView, { view: await resolveDemoEvaluationHome() }),
      ),
      research: renderToStaticMarkup(
        createElement(ResearchHomeView, { view: await resolveDemoResearchHome() }),
      ),
      bodies: renderToStaticMarkup(
        createElement(BodyStudioView, {
          view: await resolveDemoBodiesStudioView('agent-builder'),
        }),
      ),
      audit: renderToStaticMarkup(
        createElement(AuditStreamScreenView, { view: await resolveDemoOperationsAudit() }),
      ),
      capacity: renderToStaticMarkup(
        createElement(CapacityPanelView, { view: await resolveDemoOperationsCapacity() }),
      ),
    };
    for (const [page, html] of Object.entries(pages)) {
      assertNoRawJson(page, html);
      // The only permitted JSON text is the corpus-hash digest display,
      // and it appears at most once per page.
      const hashDisplays = html.match(/data-arena-corpus-hash="true"/g)?.length ?? 0;
      expect(hashDisplays).toBeLessThanOrEqual(1);
    }
  });
});

describe.skipIf(BASE === undefined)('B017 M2 — no raw JSON rendering (served layer)', () => {
  const PATHS = [
    '/demo',
    '/demo/cockpit',
    '/demo/cases',
    '/demo/bodies',
    '/demo/research',
    '/demo/evaluation',
    '/demo/operations',
    '/demo/operations/jobs',
    '/demo/operations/audit',
    '/demo/operations/capacity',
    '/',
    '/cases',
    '/settings',
    '/marketplace',
  ] as const;

  it('no served page dumps record payloads as JSON', async () => {
    for (const path of PATHS) {
      const response = await fetch(`${BASE}${path}`, { redirect: 'follow' });
      expect(response.status, `GET ${path}`).toBe(200);
      assertNoRawJson(path, await response.text());
    }
  });
});
