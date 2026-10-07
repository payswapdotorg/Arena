/**
 * @arena/example-generic-ai-client — the C019 reference integrations
 * example project (Work Order C019; issue #125).
 *
 * NOT a pnpm workspace project (the A027 examples/epoch-e2e precedent:
 * examples/* is outside the workspace globs; adding it would be a
 * root-manifest edit C019 must not make). Workspace package imports
 * resolve through vitest/tsconfig aliases to the REAL TypeScript
 * sources, so the walkthroughs exercise the REAL protocol code.
 *
 * Public surface:
 *   - client.ts    — the provider-neutral generic AI application client
 *                    (public contracts only: REST transport + signed
 *                    webhooks + own-authority result application);
 *   - fabric.ts    — the reference Arena fabric (C001 escalation API +
 *                    C001 signed webhook delivery + C010 payments +
 *                    C017 developer platform, wired from the real seams);
 *   - loop.ts      — runBoqEscalationLoop(): the deterministic §15/§16
 *                    Accra-house BOQ walkthrough;
 *   - epoch-loop.ts— runEpochEscalationLoop(): the Epoch client driving
 *                    the SAME loop through adapters/epoch-escalation;
 *   - arena-side.ts— the shared Arena-side lifecycle driver.
 */

export * from './client.js';
export * from './fabric.js';
export * from './loop.js';
export * from './epoch-loop.js';
export * from './arena-side.js';
