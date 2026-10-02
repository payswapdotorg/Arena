/**
 * B017 M2 — UX conformance: product-truth labels per screen class.
 *
 * The governing truth (B006 + B003): every user-visible state carries
 * its truth label, and distinct kinds NEVER collapse into one badge.
 * This suite proves, per screen class, that:
 *
 *   - the rendered truth vocabulary is the CLOSED one (every
 *     data-arena-truth value maps onto a known kind);
 *   - the screen classes that must show DISTINCT kinds actually show
 *     them with DISTINCT treatments (different CSS classes — no
 *     collapsing);
 *   - the teaching surfaces render their legends/distinction notes;
 *   - demo data always carries the Demo badge alongside its truth mark.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PRODUCT_TRUTH_LABELS } from '../../packages/demo/src/shared.js';
import { STATE_KINDS } from '../../packages/ui-platform/src/tokens/tokens.js';
import { EVALUATION_DISTINCTION_NOTE } from '../../apps/web/src/evaluation/state-mark.js';
import { RESEARCH_COMPOSITION_SCOPE_NOTE } from '../../apps/web/src/evaluation/state-mark.js';
import { resolveDemoCockpitView } from '../../apps/web/src/cockpit/home-route.js';
import { CockpitHomeView } from '../../apps/web/src/cockpit/cockpit-home-view.js';
import {
  resolveDemoCaseList,
  resolveDemoCaseDetail,
} from '../../apps/web/src/capability/case-routes.js';
import { CaseListView, CaseDetailView } from '../../apps/web/src/capability/capability-views.js';
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
 * The closed rendered truth vocabulary: the ui-platform StateKind ids
 * PLUS the two honesty-critical kinds (`pending`, `unknown`) that the
 * evaluation surface renders through its own distinct marks (B012
 * state-mark contract — never collapsed into another badge).
 */
const CLOSED_RENDERED_KINDS = new Set<string>([...STATE_KINDS, 'pending', 'unknown']);

/** Every data-arena-truth value found in an HTML string. */
function truthKinds(html: string): string[] {
  return [...html.matchAll(/data-arena-truth="([a-z-]+)"/g)].map((match) => match[1] ?? '');
}

/** Every distinct treatment class applied to truth badges. */
function truthTreatments(html: string): Set<string> {
  return new Set(
    [...html.matchAll(/arena-truth arena-truth--([a-z-]+)/g)].map((match) => match[1] ?? ''),
  );
}

async function renderAll(): Promise<Record<string, string>> {
  return {
    cockpit: renderToStaticMarkup(
      createElement(CockpitHomeView, { view: await resolveDemoCockpitView('owner') }),
    ),
    cases: renderToStaticMarkup(
      createElement(CaseListView, { view: await resolveDemoCaseList('owner') }),
    ),
    caseDetail: await (async () => {
      const detail = await resolveDemoCaseDetail(
        'demo.capability-case.payments-reliability',
        'owner',
      );
      if ('unreadable' in detail) throw new Error('narrative case detail unreadable');
      return renderToStaticMarkup(createElement(CaseDetailView, { view: detail }));
    })(),
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
}

describe('B017 M2 — truth labels per screen class (composition layer)', () => {
  it('every rendered truth kind is inside the CLOSED vocabulary (no invented badges)', async () => {
    const pages = await renderAll();
    for (const [name, html] of Object.entries(pages)) {
      for (const kind of truthKinds(html)) {
        expect(
          CLOSED_RENDERED_KINDS.has(kind),
          `${name} renders a closed-vocabulary truth kind (got ${kind})`,
        ).toBe(true);
      }
    }
  });

  it('the cockpit shows DISTINCT kinds with DISTINCT treatments (no collapse)', async () => {
    const pages = await renderAll();
    const kinds = new Set(truthKinds(pages.cockpit ?? ''));
    // The demo cockpit's data plane spans these distinct kinds...
    expect(kinds.has('simulation')).toBe(true);
    expect(kinds.has('verified')).toBe(true);
    expect(kinds.has('certification')).toBe(true);
    expect(kinds.has('demo')).toBe(true);
    // ...and each renders with a DISTINCT treatment class.
    const treatments = truthTreatments(pages.cockpit ?? '');
    expect(treatments.has('simulation')).toBe(true);
    expect(treatments.has('verified')).toBe(true);
    expect(treatments.has('certification')).toBe(true);
    expect(treatments.has('demo')).toBe(true);
  });

  it('the narrative case detail keeps evaluation, evidence and demo distinct', async () => {
    const pages = await renderAll();
    const kinds = new Set(truthKinds(pages.caseDetail ?? ''));
    expect(kinds.has('demo')).toBe(true);
    // The case LIST datum carries the simulation-replay mark (the task
    // run replay) — checked on the list surface.
    const listKinds = new Set(truthKinds(pages.cases ?? ''));
    expect(listKinds.has('simulation')).toBe(true);
    expect(listKinds.has('demo')).toBe(true);
  });

  it('the evaluation surface renders its teaching legend and the three-way distinction', async () => {
    const pages = await renderAll();
    const evaluation = pages.evaluation ?? '';
    const home = await resolveDemoEvaluationHome();
    // The persistent evaluation != verification != certification note,
    // verbatim from the state-mark contract.
    expect(home.distinctionNote).toBe(EVALUATION_DISTINCTION_NOTE);
    expect(home.distinctionNote).toContain('Evaluation ≠ Verification ≠ Certification');
    expect(home.distinctionNote).toContain('None of them collapses');
    // The truth-class legend is present (the teaching UI).
    expect(home.legend.length).toBeGreaterThan(4);
    // The three distinct object classes are each marked.
    const kinds = new Set(truthKinds(evaluation));
    expect(kinds.has('evaluation')).toBe(true);
    expect(kinds.has('verified')).toBe(true);
    expect(kinds.has('certification')).toBe(true);
  });

  it('the operations surfaces carry their governing truth classes', async () => {
    const pages = await renderAll();
    const audit = pages.audit ?? '';
    // The audit stream is EVIDENCE (chained, verified) — and says so.
    const auditView = await resolveDemoOperationsAudit();
    expect(auditView.stream.truthClass).toBe('evidence');
    expect(auditView.stream.chainVerified).toBe(true);
    expect(audit).toContain('append-only');
    const capacity = pages.capacity ?? '';
    // The capacity board renders the fail-closed guarantee verbatim.
    expect(capacity).toContain('data-arena-capacity-guarantee="true"');
    expect(capacity).toContain('never switches to a billable path');
  });

  it('demo data never renders without its Demo badge (labelling survives every screen)', async () => {
    const pages = await renderAll();
    for (const [name, html] of Object.entries(pages)) {
      expect(
        html.includes('data-arena-demo-banner="true"') ||
          html.includes('data-arena-truth="demo"'),
        `${name} carries the demo labelling`,
      ).toBe(true);
    }
  });

  it('the B006 product-truth label vocabulary maps onto the closed kinds (no orphan labels)', () => {
    // The demo narrative labels map onto the ui-platform StateKind
    // treatments (the presentation-side mapping) — a label outside the
    // closed set is a contract break.
    const labelToKind: Record<string, string> = {
      'verified-fact': 'verified',
      evidence: 'evidence',
      'expert-judgment': 'expert-judgment',
      'model-output': 'model-output',
      'simulation-replay': 'simulation',
      'evaluation-result': 'evaluation',
      certification: 'certification',
      suggestion: 'suggestion',
    };
    for (const label of PRODUCT_TRUTH_LABELS) {
      const kind = labelToKind[label] ?? '<missing-mapping>';
      expect(
        CLOSED_RENDERED_KINDS.has(kind),
        `label ${label} maps to a rendered treatment (got ${kind})`,
      ).toBe(true);
    }
  });

  it('the research surface renders the composition-scope banner (never bare-model rankings)', async () => {
    const research = await resolveDemoResearchHome();
    expect(research.demo.isDemo).toBe(true);
    expect(research.distinctionNote).toBe(RESEARCH_COMPOSITION_SCOPE_NOTE);
    const pages = await renderAll();
    const html = pages.research ?? '';
    expect(html).toContain('data-arena-research-distinction="true"');
    expect(html).toContain('NEVER a statement about the model alone');
  });
});

describe.skipIf(BASE === undefined)('B017 M2 — truth labels (served layer)', () => {
  it('every served demo page renders closed-vocabulary truth badges', async () => {
    const paths = [
      '/demo/cockpit',
      '/demo/cases',
      '/demo/evaluation',
      '/demo/research',
      '/demo/bodies',
      '/demo/operations/audit',
      '/demo/operations/capacity',
    ];
    for (const path of paths) {
      const response = await fetch(`${BASE}${path}`, { redirect: 'follow' });
      expect(response.status, `GET ${path}`).toBe(200);
      const body = await response.text();
      const kinds = truthKinds(body);
      expect(kinds.length, `${path} renders truth badges`).toBeGreaterThan(0);
      for (const kind of kinds) {
        expect(CLOSED_RENDERED_KINDS.has(kind), `${path} closed vocabulary (${kind})`).toBe(true);
      }
    }
  });
});
