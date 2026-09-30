/**
 * @arena/observability-service — Arena reference observability service
 * fabric (Work Order A035; requirements R33, R26, R27, R28).
 *
 * A deterministic in-process service over @arena/observability with
 * pluggable persistence: the ONLY workspace imports are
 * @arena/observability and @arena/protocol-core (service layer →
 * domain + protocol layers, enforced by the boundary checker). Zero
 * external infrastructure and zero new runtime dependencies.
 *
 * Surfaces:
 *   - ObservabilityService — envelope-wired ingestion (idempotent
 *                            acknowledgement), telemetry queries, SLO
 *                            evaluation over the window fabric,
 *                            deterministic alert verdicts with persisted
 *                            state + flap cooldown, health aggregation;
 *   - ports                — Clock, TelemetryStore, AlertStateStore,
 *                            EventSink (inject everything);
 *   - in-memory adapters   — ManualClock, SystemClock,
 *                            InMemoryTelemetryStore (per-source sequence
 *                            discipline + signal-id dedup),
 *                            InMemoryAlertStateStore.
 */

export * from './ports.js';
export * from './in-memory.js';
export * from './service.js';
