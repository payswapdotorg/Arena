/**
 * @arena/expert-intake-service — the C003 reference service (in-process
 * store + injected ports + fail-closed orchestration over the
 * @arena/expert-intake engine).
 *
 * Public surface:
 *   - ExpertRegistryProposalPort / QualificationClaimPort /
 *     RegistryProposalData / QualificationClaimCandidateData (ports.ts);
 *   - ExpertIntakeService / createExpertIntakeService (fabric.ts) —
 *     start/ask/answer/submit/abandon/timeout/assess + transcript query;
 *   - fakes for the A006/A007 ports (test-support.ts).
 */

export * from './ports.js';
export * from './fabric.js';
export * from './test-support.js';
