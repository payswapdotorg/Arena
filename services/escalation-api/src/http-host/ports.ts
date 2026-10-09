/**
 * services/escalation-api/src/http-host/ports.ts — the P003 HTTP transport
 * ports (Work Order P003; issue #155; ADR-P001-07 §4 + ADR-P001-08).
 *
 * These are STRUCTURAL MIRRORS of the frozen host surfaces the P002
 * composition root serves (`packages/runtime-host/src/surfaces.ts`:
 * `HostEscalationsSurface`, `LensStampedStatus`, `EscalationCreateOutcome`
 * and `packages/runtime-host/src/health.ts`: `RuntimeHostHealth`), typed on
 * the packages THIS service already declares (@arena/escalation,
 * @arena/job-protocol, @arena/protocol-core) — exactly the mirroring
 * discipline `packages/runtime-host/src/ports.ts` documents: a typed seam
 * stays consumer-owned and frozen, and the REAL host satisfies it
 * STRUCTURALLY at the composition site (apps/api — the P003 wiring
 * surface). tests/api-host pins that parity against the real
 * `RuntimeHostService` (the tests/runtime-host composition-parity
 * precedent).
 *
 * The boundary law (ADR-P001-08 rule 1): one authority, two transports —
 * the HTTP host and the MCP host below (../mcp-host) ride the SAME
 * `HostEscalationsTransport` surface; neither is a second semantic
 * authority.
 */

import type { Envelope } from '@arena/protocol-core';
import type {
  CreateEscalationRequestInput,
  EscalationRecord,
  EscalationResponse,
} from '@arena/escalation';

// ---------------------------------------------------------------------------
// Escalation lifecycle surface (mirror of the frozen HostEscalationsSurface)
// ---------------------------------------------------------------------------

/**
 * The outcome of POST /v1/escalations — mirror of the frozen package's
 * `EscalationCreateOutcome` (machine-readable tri-state: `created` vs
 * `replay`; the replay carries the recorded outcome VERBATIM with the
 * replay marker in the serialized response).
 */
export interface HostCreateOutcome {
  readonly outcome: 'created' | 'replay';
  readonly requestId: string;
  readonly duplicate: boolean;
  readonly record: EscalationRecord;
  /** The events appended to the durable outbox by this call. */
  readonly emittedEvents: readonly unknown[];
  /** The serialized escalation-response payload (the wire form). */
  readonly serializedResponse: string;
  readonly response: Envelope<EscalationResponse>;
}

/**
 * The lens-stamped status result of GET /v1/escalations/{request_id} —
 * mirror of the frozen package's `LensStampedStatus`. The lens mirrors
 * `@arena/runtime-host`'s two-value `TruthLens` (ADR-P001-02) as a local
 * string union; tests/api-host pins the vocabulary parity.
 */
export interface HostStatusResult {
  readonly record: EscalationRecord;
  readonly response: Envelope<EscalationResponse>;
  readonly serializedResponse: string;
  readonly lens: HostTruthLens;
}

/**
 * The tenant-gated escalation surface the HTTP/MCP transports bind onto —
 * mirror of the frozen `HostEscalationsSurface`. Every operation carries
 * the CALLER's tenant id (derived from the authenticated API key at this
 * boundary — never from a client-claimed field); the host enforces
 * tenant/lens fail-closed semantics underneath.
 */
export interface HostEscalationsTransport {
  /** POST /v1/escalations (tenant-gated). */
  create(tenantId: string, input: CreateEscalationRequestInput): Promise<HostCreateOutcome>;
  /** GET /v1/escalations/{request_id} (tenant-gated, lens-stamped). */
  status(tenantId: string, requestId: string): Promise<HostStatusResult>;
}

// ---------------------------------------------------------------------------
// Truth lens (mirror of the frozen two-value vocabulary, ADR-P001-02)
// ---------------------------------------------------------------------------

/** Exactly two truth lenses — mirror of `@arena/runtime-host`'s TruthLens. */
export const HOST_TRUTH_LENSES = Object.freeze(['demo', 'customer'] as const);
export type HostTruthLens = (typeof HOST_TRUTH_LENSES)[number];

// ---------------------------------------------------------------------------
// Health / readiness (mirror of the frozen RuntimeHostHealth)
// ---------------------------------------------------------------------------

/** Mirror of the FT2.0 capacity status vocabulary (@arena/persistence). */
export const HOST_CAPACITY_STATUSES = Object.freeze([
  'AVAILABLE',
  'DEGRADED',
  'EXHAUSTED',
  'DISABLED',
] as const);
export type HostCapacityStatus = (typeof HOST_CAPACITY_STATUSES)[number];

/** One host component's health report (mirror of RuntimeComponentHealth). */
export interface HostComponentHealth {
  readonly component: string;
  readonly state: 'ready' | 'disabled' | 'degraded' | 'failed';
  readonly reasons: readonly { readonly code: string }[];
}

/**
 * The aggregate host health snapshot — mirror of the frozen
 * `RuntimeHostHealth`. `ready` is the fail-closed aggregate (ready iff
 * started AND every component ready AND capacity AVAILABLE).
 */
export interface HostHealthSnapshot {
  readonly state: string;
  readonly capacityStatus: HostCapacityStatus;
  readonly components: readonly HostComponentHealth[];
  readonly ready: boolean;
  readonly checkedAt: number;
}

/** The health provider the HTTP host polls for /healthz + /readyz. */
export type HostHealthProvider = () => Promise<HostHealthSnapshot>;

// ---------------------------------------------------------------------------
// Scoped API-key authentication (the developer-platform key model)
// ---------------------------------------------------------------------------

/**
 * The closed client-application scope vocabulary — MIRROR of
 * `@arena/developer-platform`'s `DEVELOPER_KEY_SCOPES` (there is no
 * `keys:manage` scope BY DESIGN: a key can never mint another key).
 * tests/api-host pins this mirror against the real vocabulary.
 */
export const API_KEY_SCOPES = Object.freeze([
  'escalations:create',
  'escalations:read',
  'sandbox:run',
  'webhooks:manage',
  'observability:read',
] as const);
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** The two key environments — mirror of DeveloperKeyEnvironment. */
export const API_KEY_ENVIRONMENTS = Object.freeze(['sandbox', 'live'] as const);
export type ApiKeyEnvironment = (typeof API_KEY_ENVIRONMENTS)[number];

/**
 * The closed denial vocabulary — MIRROR of
 * `@arena/developer-platform`'s `DEVELOPER_KEY_DENIAL_REASONS`. Every
 * authorization failure at this boundary carries one of these reasons and
 * renders onto the existing typed developer-platform code set (never a
 * bare boolean, never an improvised code).
 */
export const API_KEY_DENIAL_REASONS = Object.freeze([
  'key-not-found',
  'secret-invalid',
  'key-revoked',
  'key-rotated',
  'tenant-mismatch',
  'environment-mismatch',
  'scope-missing',
] as const);
export type ApiKeyDenialReason = (typeof API_KEY_DENIAL_REASONS)[number];

/** The authenticated client-application identity (never secret material). */
export interface ApiKeyIdentity {
  readonly keyId: string;
  readonly clientAppId: string;
  readonly tenantId: string;
  readonly environment: ApiKeyEnvironment;
  readonly scopes: readonly ApiKeyScope[];
}

/** The fail-closed authorization verdict (machine-readable). */
export type ApiKeyAuthorization =
  | { readonly outcome: 'authorized'; readonly identity: ApiKeyIdentity }
  | { readonly outcome: 'denied'; readonly reason: ApiKeyDenialReason };

/**
 * The boundary authenticator port — satisfied at the composition site by
 * the developer-platform key model (issueDeveloperKey /
 * authorizeDeveloperKey over the host's key registry). The transport never
 * sees key records or secret material; it sees verdicts.
 */
export interface ApiKeyAuthenticator {
  authenticate(input: {
    readonly presentedSecret: string;
    readonly scope: ApiKeyScope;
    readonly environment: ApiKeyEnvironment;
  }): Promise<ApiKeyAuthorization>;
}

// ---------------------------------------------------------------------------
// Clock (A015 law: time is injected — never a wall clock)
// ---------------------------------------------------------------------------

/** Injected time source (epoch milliseconds). */
export interface HttpHostClock {
  now(): number;
}

/** Wire header names for the public transport (closed, lowercase). */
export const HTTP_HOST_HEADER_NAMES = Object.freeze({
  authorization: 'authorization',
  contentType: 'content-type',
  requestId: 'x-arena-request-id',
  retryAfter: 'retry-after',
} as const);

/** The public routes the HTTP host serves (closed vocabulary). */
export const HTTP_HOST_ROUTES = Object.freeze({
  health: '/healthz',
  readiness: '/readyz',
  createEscalation: '/v1/escalations',
  mcp: '/mcp',
} as const);
