/**
 * @arena/human-data — the HUMAN-DATA PRODUCTION STUDIO domain core
 * (Work Order C012; issue #118: human-data production studio for customer
 * AI pipelines).
 *
 * Pure TypeScript domain package over the MERGED dependency surfaces
 * (consume public ports only — never an edit, never a reimplementation):
 *   - @arena/escalation (C001) — the commission COMPILES to ES1.0
 *     EscalationRequests through createEscalationRequest (one seam, no new
 *     lifecycle);
 *   - @arena/escalation-validation (C009) — deliverables derive ONLY from
 *     ACCEPTED adjudication outcomes (the validation gate: no
 *     self-certified deliverables);
 *   - @arena/expert-session (C006) — the EES1.0 replay law and the
 *     consent/rights statement shape (structurally mirrored);
 *   - @arena/artifact-protocol + @arena/datasets (A014/A002) — rights
 *     metadata, content addressing, and the versioned immutable
 *     DatasetManifest vocabulary bundles are assembled through;
 *   - @arena/protocol-core — canonical JSON + sha256 digests.
 *
 * Core objects:
 *   - HumanDataCommission — the customer's declared dataset shape
 *     (capability need, modes, per-item output schema, quantity,
 *     acceptance criteria, budget/urgency, learning permissions, rights
 *     posture + retention), with the studio production lifecycle
 *     DRAFT → SUBMITTED → IN_PRODUCTION → ASSEMBLING → DELIVERED
 *     (+ ABANDONED / FAILED) and typed transition verdicts;
 *   - DeliverableRecord — the four per-item record kinds (correction
 *     pairs, demonstration trajectories, evaluation cases, scoped
 *     knowledge artifacts), each rights-carrying, provenance-addressed,
 *     tenant-scoped, content-addressed;
 *   - THE RIGHTS WALL — requireGrantedConsent /
 *     assertDeliverableRightsGated: a deliverable without an explicit
 *     GRANTED consent/rights statement can NEVER enter a dataset bundle
 *     (enforced AND tested adversarially);
 *   - THE REPLAY LAW — demonstration records carry the EES1.0
 *     bounded-session replay trace and reject any record masquerading as
 *     a live-world mutation;
 *   - assembleHumanDataset — deterministic, immutable, supersession-aware
 *     dataset assembly over the A014 manifest vocabulary.
 *
 * The REFERENCE SERVICE (commission lifecycle as durable idempotent jobs,
 * escalations through injected C001 ports, deliverable collection from
 * C009-accepted results) lives in services/human-data. The studio web
 * routes live in apps/web/src/human-data.
 */

export * from './errors.js';
export * from './shared.js';
export * from './rights.js';
export * from './commission.js';
export * from './deliverables.js';
export * from './bundles.js';

import { HUMAN_DATA_ERROR_CODES } from './errors.js';

/** Version of this package's protocol surface. */
export const HUMAN_DATA_PROTOCOL_VERSION = 1 as const;

/** The human-data error codes this build understands. */
export const SUPPORTED_HUMAN_DATA_ERROR_CODES: readonly string[] = Object.freeze([
  ...Object.values(HUMAN_DATA_ERROR_CODES),
]);
