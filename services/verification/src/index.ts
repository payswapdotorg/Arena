/**
 * @arena/verification-fabric — the A013 reference verifier fabric
 * (in-process registry + artifact store + runner + record ledger).
 *
 * Public surface:
 *   - VerifierRegistry / RegisteredVerifier (registry.ts);
 *   - VerifierHook + the two reference verifier implementations
 *     (verifiers.ts): makeConstraintCheckVerifier (content-based),
 *     makeEvidenceProvenanceValidationVerifier (producer/lineage-based);
 *   - VerificationFabric / createVerificationFabric (fabric.ts).
 */

export * from './registry.js';
export * from './verifiers.js';
export * from './fabric.js';
