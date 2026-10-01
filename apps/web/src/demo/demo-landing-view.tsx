/**
 * DemoLandingView — the presentational demo landing (Work Order B006;
 * issue #73; apps/web/src/demo).
 *
 * SYNC presentational component (renderable through react-dom/server in
 * the house test style): the async composition (session, canonical
 * reads, narrative resolution) happens in apps/web/src/app/demo/page.tsx
 * through apps/web/src/demo composition helpers, and this component
 * renders the resulting view model deterministically — no Date.now(), no
 * randomness, no implicit time.
 *
 * THE governing product truth is rendered here: the demo banner (from
 * the labelling contract), the DemoDataBadge next to every
 * demo-rendered datum, the per-datum product-truth TruthBadge (distinct
 * visual semantics per label via @arena/ui-platform primitives), and
 * the reset affordance.
 */

import {
  DemoDataBadge,
  EmptyState,
  PageHeader,
  PrimaryAction,
  TruthBadge,
} from '@arena/ui-platform';

import {
  DEMO_BADGE_NOTE,
  DEMO_LABELLING,
  DEMO_RESET_HINT,
  DEMO_RESET_LABEL,
} from '@arena/demo';
import type { DemoLandingView } from './narrative-view.js';
import { truthStateKind } from './narrative-view.js';

export interface DemoLandingViewProps {
  readonly view: DemoLandingView;
}

export function DemoLandingView({ view }: DemoLandingViewProps) {
  return (
    <div className="demo-landing" data-arena-route="demo">
      <PageHeader
        title="Explore a capability — guided demo"
        description="A deterministic, zero-credential walkthrough of one Arena workspace. Every datum is labelled with the kind of truth it is."
      />

      <section className="demo-banner" data-arena-demo-banner="true" aria-label="Demo mode notice">
        <DemoDataBadge note={DEMO_BADGE_NOTE} />
        <p className="demo-banner__text">
          <strong>{DEMO_LABELLING.bannerTitle}.</strong> {DEMO_LABELLING.bannerText}
        </p>
      </section>

      <nav className="demo-lenses" aria-label="Demo role lenses" data-arena-demo-lenses="true">
        {view.roleLenses.map((lens) => (
          <a
            key={lens.href}
            href={lens.href}
            className={lens.active ? 'demo-lens demo-lens--active' : 'demo-lens'}
            aria-current={lens.active ? 'page' : undefined}
          >
            {lens.label}
          </a>
        ))}
      </nav>

      <section className="demo-lens-intro" data-arena-variant={view.variantId}>
        <h2>{view.variantTitle}</h2>
        <p>{view.variantIntro}</p>
        {view.roleGoal.length === 0 ? null : (
          <p className="demo-lens-intro__role">
            <em>{view.roleName}</em> — {view.roleGoal}
          </p>
        )}
      </section>

      <ol className="demo-steps" data-arena-demo-steps="true">
        {view.steps.map((step) => (
          <li key={step.stepId} className="demo-step" data-arena-step={step.stepId}>
            <div className="demo-step__header">
              <h3>
                {step.order}. {step.title}
              </h3>
              <TruthBadge kind={step.truthState} />
              <DemoDataBadge />
            </div>
            <p className="demo-step__body">{step.body}</p>
            <ul className="demo-step__reads">
              {step.summaries.map((summary) => (
                <li
                  key={summary.recordId}
                  className="demo-read"
                  data-arena-read={summary.recordId}
                >
                  <div className="demo-read__head">
                    <strong>{summary.title}</strong>
                    <TruthBadge kind={truthStateKind(summary.truth)} />
                    <DemoDataBadge note={DEMO_BADGE_NOTE} />
                  </div>
                  <p className="demo-read__summary">{summary.summary}</p>
                  <dl className="demo-read__facts">
                    {summary.facts.map((fact) => (
                      <div key={fact.label} className="demo-read__fact">
                        <dt>{fact.label}</dt>
                        <dd>{fact.text}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="demo-read__ref">
                    canonical read: <code>{summary.kind}</code> · <code>{summary.recordId}</code>
                  </p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <section className="demo-inventory" data-arena-demo-inventory="true">
        <h2>What is in the demo workspace</h2>
        <p>
          Read through the canonical read path, scoped to the reserved demo tenant:{' '}
          {view.inventory.kinds
            .map((entry) => `${entry.kind} (${String(entry.count)})`)
            .join(', ')}
          .
        </p>
        <p className="demo-inventory__hash">
          Corpus hash (identical on every load and after every reset):{' '}
          <code data-arena-corpus-hash="true">{view.corpusHash.slice(0, 72)}…</code>
        </p>
      </section>

      <section className="demo-reset" data-arena-demo-reset="true">
        <h2>{DEMO_RESET_LABEL}</h2>
        <p>{DEMO_RESET_HINT}</p>
        <form method="post" action="/demo/reset">
          <PrimaryAction>{DEMO_RESET_LABEL}</PrimaryAction>
        </form>
        <EmptyState
          title="This demo ends where the product begins"
          hint="Starting a real workspace needs your own credentials — nothing you did here touched any customer state."
        />
      </section>
    </div>
  );
}
