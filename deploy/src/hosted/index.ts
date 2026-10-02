/**
 * B015 hosted-preview wiring — public surface.
 *
 * Production provider wiring and deployment automation for the Arena
 * hosted preview: env-driven, placeholder-safe, free-tier-compatible by
 * construction, fail-closed on quota exhaustion. Composes the B002 hosted
 * adapters (Neon / R2 / Upstash) and the persistence composition fabric —
 * no new adapter code.
 *
 * Entry points:
 *   - `resolveHostedWiring(env, mode)` — strict fail-fast / dry-run resolution;
 *   - `composeHostedPersistenceStack()` / `composeHostedBootstrap()` — glue;
 *   - `runHostedWiringDryRun(env)` — the credential-free wiring self-test;
 *   - quota ceilings, env contract, Vercel profile, optional Apify wiring,
 *     the fail-closed guard and the local fakes re-export.
 */

export * from './quotas.js';
export * from './env-contract.js';
export * from './vercel.js';
export * from './apify.js';
export * from './wiring.js';
export * from './fail-closed.js';
export * from './fakes.js';
export * from './dry-run.js';
