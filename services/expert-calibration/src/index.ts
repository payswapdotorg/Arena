/**
 * @arena/expert-calibration-service — the C004 reference service
 * (in-process store + injected ports + fail-closed orchestration over
 * the @arena/expert-calibration domain).
 *
 * Public surface:
 *   - IntakeGapSourcePort / WorkbenchAssignmentPort /
 *     ExpertQualificationPort (ports.ts — the C003/A017/A007 seams);
 *   - ExpertCalibrationService / createExpertCalibrationService
 *     (fabric.ts) — program lifecycle + drift-verdict runs, pre-training
 *     tracks + qualification-update proposals, durable idempotent
 *     requalification checks on the A015 job fabric, and the C002
 *     demonstrated-performance read surface;
 *   - fakes for the C003/A007/A017 ports (test-support.ts).
 */

export * from './ports.js';
export * from './fabric.js';
export * from './test-support.js';
