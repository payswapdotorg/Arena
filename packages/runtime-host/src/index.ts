/**
 * @arena/runtime-host — the Arena durable host runtime interface package
 * (Work Order P002; issue #154; ADR-P001-01/02/07).
 *
 * The FROZEN composition-root contract surface:
 *   - lens       — the canonical demo/customer truth lens (ADR-P001-02)
 *   - lifecycle  — host lifecycle states + fail-closed transitions
 *   - health     — the aggregate health/readiness snapshot (FT2.0 posture)
 *   - ports      — the injected port contracts as pure data (A015 law)
 *   - surfaces   — the structural service surfaces the host composes
 *                  (escalation lifecycle; the shared durable job runner)
 *   - jobs       — the registered host job kinds (ADR-P001-01/06)
 *   - config     — the env-var-name contract (values stay server-side)
 *   - runtime-host — the RuntimeHostApi (construct/start/stop + gates)
 *
 * ZERO I/O in this package: implementations live in services/runtime-host
 * (composition root) and adapters/hosted/neon-postgres (durable stores).
 */

export * from './lens.js';
export * from './lifecycle.js';
export * from './health.js';
export * from './ports.js';
export * from './surfaces.js';
export * from './jobs.js';
export * from './config.js';
export * from './runtime-host.js';

/** Version of this package's interface surface. */
export const RUNTIME_HOST_INTERFACE_VERSION = 1 as const;
