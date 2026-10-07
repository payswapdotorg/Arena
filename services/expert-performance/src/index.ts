/**
 * @arena/expert-performance-service — the C005 reference read/projection
 * service (in-memory append-only store + injected dep source ports +
 * fail-closed provenance verification over the @arena/expert-performance
 * domain).
 *
 * Public surface:
 *   - CalibrationVerdictSourcePort / QualificationHistorySourcePort /
 *     SkillExtractionSourcePort / LearningAttributionSourcePort (ports.ts
 *     — the C004/A007/A019/A020 seams);
 *   - ExpertPerformanceService / createExpertPerformanceService
 *     (fabric.ts) — append-only evidence ingestion (idempotent,
 *     provenance-verified, replay-defended) + the two read lenses over
 *     the same canonical profile (routing input for the C002 seam;
 *     expert-facing capability history) + the single-dimension aggregate
 *     + provenance-addressable record reads;
 *   - fakes for the four dep source ports (test-support.ts).
 */

export * from './ports.js';
export * from './fabric.js';
export * from './test-support.js';
