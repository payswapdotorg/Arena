/**
 * LandingView — the Level 0 first-run experience (UX1.0 §Shell "First
 * run"): a calm three-step introduction with exactly ONE primary action,
 * `Explore a capability`. This is the product's default entry point;
 * engineering diagnostics live behind `pnpm start:console` and are no
 * longer the default experience.
 *
 * Pure server component — rendered directly by the app smoke tests.
 */

import { PrimaryAction } from '@arena/ui-platform';

export interface LandingViewProps {
  /** Destination of the single primary CTA (default "/cases"). */
  readonly ctaHref?: string;
}

const STEPS: ReadonlyArray<{
  readonly index: string;
  readonly title: string;
  readonly body: string;
}> = [
  {
    index: '1',
    title: 'What Arena is',
    body: 'A workspace for professional AI capability. Capability cases define the outcome you need; agent bodies, environments and evaluation/verification do the work and prove it — end to end, inspectable at every step.',
  },
  {
    index: '2',
    title: 'What an Agent Body is',
    body: 'An Agent Body composes skills, knowledge, tools and policies around a mission. It runs on a cognitive substrate — but a body is never just a model, and certification covers the tested composition, not the model alone.',
  },
  {
    index: '3',
    title: 'Start with a guided scenario',
    body: 'Follow one capability from case to certified release. Every stage keeps its evidence open: what was run, what was measured, what was verified, and by whom.',
  },
];

export function LandingView({ ctaHref = '/cases' }: LandingViewProps) {
  return (
    <section className="landing" aria-labelledby="landing-title" data-arena-route="landing">
      <div className="landing__intro">
        <h1 id="landing-title" className="landing__title">
          Professional AI capability, kept inspectable
        </h1>
        <p className="landing__lede">
          Arena turns desired outcomes into certified agent capability —
          with the engineering evidence always in reach.
        </p>
      </div>
      <ol className="landing__steps">
        {STEPS.map((step) => (
          <li key={step.index} className="landing__step">
            <span className="landing__step-index" aria-hidden="true">
              {step.index}
            </span>
            <div className="landing__step-body">
              <h2 className="landing__step-title">{step.title}</h2>
              <p className="landing__step-text">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="landing__actions">
        <PrimaryAction href={ctaHref} testId="landing-cta">
          Explore a capability
        </PrimaryAction>
        <a className="landing__secondary" href="/bodies">
          See how an Agent Body works
        </a>
      </div>
    </section>
  );
}
