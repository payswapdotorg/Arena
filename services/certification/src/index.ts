/**
 * @arena/certification-fabric — the A023 reference certification fabric
 * (in-process registry + engine + record ledger).
 *
 * Public surface:
 *   - CertificationRegistry / createCertificationRegistry (registry.ts);
 *   - CertificationFabric / createCertificationFabric (fabric.ts).
 *
 * The fabric's `certify(suiteRef, possessionRef, scopeRefs,
 * componentVerdicts, options)` is pure orchestration: resolve the suite,
 * validate set-equality, build the CertificationRecord through the domain
 * constructor (which derives the verdict/unknown cause/constraints/
 * statement, computes the input digest, freezes the record), append it
 * to the ledger, and return it. Idempotent by idempotency key + command
 * tuple.
 */

export * from './registry.js';
export * from './fabric.js';
