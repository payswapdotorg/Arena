/**
 * @arena/certification-fabric — the ARENA REFERENCE CERTIFICATION
 * FABRIC (Work Order A023; requirements R21, R22, R43; the README
 * design law; architecture-lock rules 4, 12, 16, 17, 18, 23).
 *
 * In-process, zero external runtime dependencies (only
 * @arena/protocol-core + @arena/certification + the consumed sibling
 * protocol packages). The reference slice — NO network/HTTP layer,
 * like the A012/A013 reference fabrics.
 *
 * Surface:
 *   - CertificationSuiteRegistry — the in-process suite registry:
 *     registerSuite idempotent by digest; a different digest under the
 *     same (suiteId, version) identity is an IDENTITY_CONFLICT;
 *   - CertificationFabric — suite registry + guard-validated evidence
 *     stores (A012/A013/A022/A014 records) + the runner + the
 *     append-only record ledger with supersession and revocation
 *     projections (effectiveStatus: active | superseded | revoked);
 *     idempotent certify() by command tuple;
 *   - CertificationService — the envelope-wired facade:
 *     run-certification-command → fabric.certify →
 *     certification-recorded-event, fail-closed error normalization.
 */

export * from './registry.js';
export * from './fabric.js';
export * from './service.js';
