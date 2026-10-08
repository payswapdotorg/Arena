/**
 * @arena/capability-learning-service — the Arena capability-learning
 * REFERENCE COMPILER SERVICE (Work Order C022; issue #128).
 *
 * Candidate ingestion → program compilation → experiment orchestration →
 * gated proposal dispatch as durable idempotent jobs over injected ports
 * on the A015 fabric: intervention-derived improvement candidates
 * (C008/C009/C013/C014 surfaces, projected by the host) are ingested and
 * deduplicated, compiled deterministically into typed ImprovementPrograms
 * (one per LE1.0 intervention class; blocked outcomes audited, never
 * silently dropped), each program's A020 experiment executes through the
 * injected engine seam, the Q1.0 five-condition capability-lift gate
 * decides adoption (typed verdicts), and ONLY adopted improvements are
 * dispatched as gated proposals into the A021 Body Forge / A022
 * compatibility / A023 certification surfaces. Every decision lands in
 * the append-only tamper-evident audit stream.
 */

export * from './errors.js';
export * from './ports.js';
export * from './fabric.js';
export * from './service.js';
