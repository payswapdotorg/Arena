/**
 * Host runtime configuration contract (Work Order P002; issue #154;
 * ADR-P001-07 §5 — configuration values are read from server-side env
 * vars and injected by the host; no domain service or web surface
 * ever sees the values).
 *
 * This module is PURE DATA: the env-var NAMES the host reads (never the
 * values), the discovery posture, and the fail-closed rules. The actual
 * env discovery for the persistence connection is owned by
 * @arena/hosted-neon-postgres's env reader (DATABASE_URL /
 * NEON_CONNECTION_STRING — the adapter stays DISABLED and fails closed
 * before any network call when neither is usable). The host simply
 * documents what it needs and forwards the env source.
 */

/** The env-var NAMES the host runtime reads (values stay server-side). */
export const RUNTIME_HOST_ENV_VARS = Object.freeze([
  'DATABASE_URL',
  'NEON_CONNECTION_STRING',
  /**
   * Optional dedicated live-evidence project id (P004/P002 evidence
   * discipline): when set, the evidence battery refuses to touch any
   * other Neon project. Never a connection value.
   */
  'ARENA_RUNTIME_EVIDENCE_PROJECT_ID',
] as const);
export type RuntimeHostEnvVarName = (typeof RUNTIME_HOST_ENV_VARS)[number];

/** The host runtime's configuration (pure data; no values, only shapes). */
export interface RuntimeHostConfig {
  /**
   * The env source handed to the hosted persistence adapter. Defaults
   * to process.env at the composition site (deploy/runtime wiring), NOT
   * inside a domain package (no ambient reads here).
   */
  readonly env?: Record<string, string | undefined>;
  /**
   * The injected clock (A015 law). Required — the host refuses to
   * construct without one (fail closed; no wall-clock fallback is
   * representable in the interface).
   */
  readonly clock: { now(): number };
  /** The persistence capacity probe (fail-closed DISABLED posture). */
  readonly capacityProbe: { capacityProbe(): Promise<unknown> };
}

/**
 * The documented names-only configuration summary (safe to render in
 * health/evidence output — carries NO values).
 */
export interface RuntimeHostConfigSummary {
  readonly envVarNames: readonly string[];
  readonly persistenceAdapter: '@arena/hosted-neon-postgres';
  readonly jobRunner: '@arena/job-orchestrator';
}

/** The constant, value-free configuration summary. */
export const RUNTIME_HOST_CONFIG_SUMMARY: RuntimeHostConfigSummary = Object.freeze({
  envVarNames: [...RUNTIME_HOST_ENV_VARS],
  persistenceAdapter: '@arena/hosted-neon-postgres',
  jobRunner: '@arena/job-orchestrator',
});
