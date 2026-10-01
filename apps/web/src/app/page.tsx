import { LandingView } from './_lib/landing-view.js';

/**
 * Level 0 — the first-run landing (UX1.0 §Shell "First run"): a calm
 * three-step introduction with the single primary CTA "Explore a
 * capability". This is the DEFAULT product experience; the engineering
 * console is a separate surface (`pnpm start:console`).
 */
export default function HomePage() {
  return <LandingView />;
}
