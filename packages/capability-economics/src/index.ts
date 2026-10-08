/**
 * @arena/capability-economics — the ARENA CAPABILITY ECONOMICS /
 * INTERVENTION UNIT ECONOMICS domain core (Work Order C016; issue #122;
 * spec/human-escalation-work-items.md C016 row; handoff §8 commercial
 * model + spec/quality-model.md Q1.0).
 *
 * The ECONOMIC VIEW over the escalation network — never the money
 * truth (C010 owns the ledger; fee-split formulas stay C010-owned):
 *
 *   - UnitEconomicsRecord — typed, append-only, provenance-addressed,
 *     content-addressed per-intervention economics records whose cost
 *     figures are folded ONLY out of real C010 PaymentLedger state
 *     (integrity-verified through the C010 sha256 digest chain; a cost
 *     figure with no C010 backing is UNREPRESENTABLE — there is no
 *     constructor that accepts free-standing amounts), joined to effort
 *     signals, C009 validation outcomes and the C015 routing class
 *     through structurally-mirrored input views (the service binds the
 *     merged dep records onto them);
 *   - EconomicsPolicy — versioned, deterministic view policies
 *     (small-sample thresholds, metric allow-lists, disclosure notes);
 *     policy changes are SUPERSESSIONS by version, never silent
 *     restatements;
 *   - CapabilityLiftValueRecord — the Q1.0 value side: capability-lift
 *     figures gated by the five capability-lift conditions (pinned
 *     evaluation population, verification audit, evaluator/version
 *     attribution, protected-capability regression, reported
 *     uncertainty), with LE1.0 attribution separation — a changed
 *     evaluator score is never an economics gain;
 *   - EconomicsAggregate — dimensional read models (per capability,
 *     domain, tenant lens, resource class, validation outcome) that
 *     disclose formula, sample sizes, small-sample status and known
 *     limitations — NO collapsed "ROI score" (the no-single-collapse
 *     law is structural: score-shaped keys are typed rejections);
 *   - the truth-label law rides every record and aggregate (demo money
 *     is not customer money; they never mix);
 *   - tenant isolation at the domain level; deterministic folds given
 *     identical inputs.
 *
 * Pure TypeScript; runtime dependencies are the merged domain packages
 * @arena/protocol-core (canonical JSON + sha256 digests) and
 * @arena/payments (the C010 Money primitives, ledger fold +
 * integrity verification — composed, never forked). Zero service
 * imports. The REFERENCE SERVICE (injected C009/C010/C015 source ports
 * + durable idempotent recomputation jobs on the A015 fabric) lives in
 * services/capability-economics.
 */

export * from './errors.js';
export * from './shared.js';
export * from './cost.js';
export * from './policy.js';
export * from './value.js';
export * from './record.js';
export * from './aggregate.js';

import { CAPABILITY_ECONOMICS_ERROR_CODES } from './errors.js';
import { CAPABILITY_ECONOMICS_WIRE_VERSION } from './shared.js';

/** Version of this package's protocol surface. */
export const CAPABILITY_ECONOMICS_PACKAGE_VERSION = CAPABILITY_ECONOMICS_WIRE_VERSION;

/** The capability-economics error codes this build understands. */
export const SUPPORTED_CAPABILITY_ECONOMICS_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(CAPABILITY_ECONOMICS_ERROR_CODES),
);
