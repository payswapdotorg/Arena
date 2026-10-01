/**
 * @arena/billing-service — the reference billing service for the Arena
 * epoch-consumption stage (Work Order A033; requirements R31, R34, R48).
 *
 * Public surface (dependency order):
 *   errors        — closed BILLING_* error taxonomy (fail-closed parser)
 *   shared        — usage/statement records, closed vocabularies, window math
 *   ports         — injected-dependency seams (clock, grants, prices, stores)
 *   in-memory     — deterministic reference implementations of the ports
 *   service       — the BillingService fabric (ingestion, enforcement,
 *                   aggregation, immutable statements)
 *
 * Workspace dependencies: @arena/protocol-core (protocol layer),
 * @arena/entitlements and @arena/job-protocol (domain contracts the
 * service consumes read-only) — never a sibling service.
 */

export * from './errors.js';
export * from './shared.js';
export * from './ports.js';
export * from './in-memory.js';
export * from './service.js';

import { BILLING_RECORD_VERSION } from './shared.js';

/** Version of this package's record surface. */
export const BILLING_SERVICE_VERSION = BILLING_RECORD_VERSION;
