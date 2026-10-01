/**
 * MarketplaceArtifactsService — the envelope-wired reference service
 * facade for the dataset/evaluation/environment marketplace (Work
 * Order A032; mirrors services/api's ApiService and services/security's
 * SecurityService wiring discipline).
 *
 * Pure reference fabric: the fabric is constructor-injected, every
 * failure is normalized into the typed marketplace taxonomy (fail
 * closed; nothing partial is returned), and there is NO network/HTTP
 * layer (the A032 reference slice).
 *
 * Wire round trips:
 *
 *   register-offer-command / supersede-offer-command /
 *   retire-offer-command / grant-access-command /
 *   revoke-grant-command / submit-review-command
 *     (envelope kind `command`, REQUIRED idempotency key)
 *     → fabric (gate → idempotency → identity binding → append)
 *     → *-event envelope (kind `event`, SAME correlation id, NULL
 *       idempotency key)
 *
 *   marketplace-query-request (kind `query`, NULL idempotency key —
 *   reads are not commands)
 *     → fabric.handleQueryRequest (scope-checked dispatch)
 *     → marketplace-query-response (kind `response`, SAME correlation
 *       id, echoed query kind).
 */

import {
  makeAccessGrantedEvent,
  makeGrantRevokedEvent,
  makeMarketplaceQueryRequest,
  makeMarketplaceQueryResponse,
  makeOfferRegisteredEvent,
  makeOfferRetiredEvent,
  makeOfferSupersededEvent,
  makeReviewSubmittedEvent,
  makeRegisterOfferCommand,
  makeRetireOfferCommand,
  makeRevokeGrantCommand,
  makeSubmitReviewCommand,
  makeSupersedeOfferCommand,
  makeGrantAccessCommand,
  parseGrantAccessCommand,
  parseMarketplaceQueryRequest,
  parseMarketplaceQueryResponse,
  parseMarketplaceQueryResponseFor,
  parseRegisterOfferCommand,
  parseRetireOfferCommand,
  parseRevokeGrantCommand,
  parseSubmitReviewCommand,
  parseSupersedeOfferCommand,
  serializeEnvelope,
  toCorrelationId,
} from './envelopes.js';
import type {
  Envelope,
  RegisterOfferCommandPayload,
  RetireOfferCommandPayload,
  GrantAccessCommandPayload,
  RevokeGrantCommandPayload,
  SubmitReviewCommandPayload,
} from './envelopes.js';
import type {
  MarketplaceQueryRequest,
  MarketplaceQueryResponse,
} from './queries.js';
import { normalizeToMarketplaceError } from './errors.js';
import {
  MarketplaceArtifactsFabric,
  createMarketplaceArtifactsFabric,
  type OfferCommandResult,
  type OfferCandidateInput,
  type GrantCommandResult,
  type GrantRevocationResult,
  type ReviewCommandResult,
} from './fabric.js';
import { marketplaceQueryRequest } from './queries.js';
import type { MarketplaceQueryResultValue } from './queries.js';

/** Service configuration (all injected; defaults are fresh instances). */
export interface MarketplaceArtifactsServiceConfig {
  readonly fabric?: MarketplaceArtifactsFabric;
}

/** The result of one handled offer command. */
export interface OfferCommandOutcome {
  readonly command: Envelope<unknown>;
  readonly event: Envelope<unknown>;
  readonly serializedEvent: string;
  readonly result: OfferCommandResult;
}

/** The result of one handled grant command. */
export interface GrantCommandOutcome {
  readonly command: Envelope<unknown>;
  readonly event: Envelope<unknown>;
  readonly serializedEvent: string;
  readonly result: GrantCommandResult;
}

/** The result of one handled grant revocation. */
export interface GrantRevocationOutcome {
  readonly command: Envelope<unknown>;
  readonly event: Envelope<unknown>;
  readonly serializedEvent: string;
  readonly result: GrantRevocationResult;
}

/** The result of one handled review command. */
export interface ReviewCommandOutcome {
  readonly command: Envelope<unknown>;
  readonly event: Envelope<unknown>;
  readonly serializedEvent: string;
  readonly result: ReviewCommandResult;
}

/** The result of one handled marketplace query. */
export interface MarketplaceQueryOutcome {
  readonly request: Envelope<MarketplaceQueryRequest>;
  readonly response: Envelope<MarketplaceQueryResponse>;
  readonly serializedResponse: string;
  readonly result: MarketplaceQueryResultValue;
}

/**
 * The envelope-wired marketplace service. Construct with
 * `new MarketplaceArtifactsService()` or inject a pre-populated fabric.
 */
export class MarketplaceArtifactsService {
  readonly fabric: MarketplaceArtifactsFabric;

  constructor(config: MarketplaceArtifactsServiceConfig = {}) {
    this.fabric = config.fabric ?? createMarketplaceArtifactsFabric();
  }

  /** Handle one register-offer-command wire message. */
  async handleRegisterOfferCommand(raw: string): Promise<OfferCommandOutcome> {
    let command: Envelope<unknown>;
    try {
      command = parseRegisterOfferCommand(raw);
    } catch (error) {
      throw normalizeToMarketplaceError(error);
    }
    try {
      const payload = command.payload as RegisterOfferCommandPayload;
      const result = await this.fabric.registerOffer({
        candidate: payload.candidate as unknown as OfferCandidateInput,
        correlationId: command.correlationId,
        idempotencyKey: command.idempotencyKey as string,
        evidence: payload.evidence,
      });
      const event = makeOfferRegisteredEvent(
        {
          offerId: result.record.offerId,
          offerDigest: result.record.digest,
          admitted: true,
          rejectionCount: 0,
        },
        command.correlationId,
      );
      return {
        command,
        event,
        serializedEvent: serializeEnvelope(event),
        result,
      };
    } catch (error) {
      throw normalizeToMarketplaceError(error, command.correlationId);
    }
  }

  /** Handle one supersede-offer-command wire message. */
  async handleSupersedeOfferCommand(raw: string): Promise<OfferCommandOutcome> {
    let command: Envelope<unknown>;
    try {
      command = parseSupersedeOfferCommand(raw);
    } catch (error) {
      throw normalizeToMarketplaceError(error);
    }
    try {
      const payload = command.payload as RegisterOfferCommandPayload;
      const result = await this.fabric.supersedeOffer({
        candidate: payload.candidate as unknown as OfferCandidateInput,
        correlationId: command.correlationId,
        idempotencyKey: command.idempotencyKey as string,
        evidence: payload.evidence,
      });
      const event = makeOfferSupersededEvent(
        {
          offerId: result.record.offerId,
          offerDigest: result.record.digest,
          supersedes: result.record.supersedes ?? '',
        },
        command.correlationId,
      );
      return { command, event, serializedEvent: serializeEnvelope(event), result };
    } catch (error) {
      throw normalizeToMarketplaceError(error, command.correlationId);
    }
  }

  /** Handle one retire-offer-command wire message. */
  async handleRetireOfferCommand(raw: string): Promise<OfferCommandOutcome> {
    let command: Envelope<unknown>;
    try {
      command = parseRetireOfferCommand(raw);
    } catch (error) {
      throw normalizeToMarketplaceError(error);
    }
    try {
      const payload = command.payload as RetireOfferCommandPayload;
      const result = await this.fabric.retireOffer({
        offerId: payload.offerId,
        retires: payload.retires,
        grounds: payload.grounds,
        provenance: payload.provenance,
        correlationId: command.correlationId,
        idempotencyKey: command.idempotencyKey as string,
      });
      const event = makeOfferRetiredEvent(
        { offerId: result.record.offerId, retires: payload.retires },
        command.correlationId,
      );
      return { command, event, serializedEvent: serializeEnvelope(event), result };
    } catch (error) {
      throw normalizeToMarketplaceError(error, command.correlationId);
    }
  }

  /** Handle one grant-access-command wire message. */
  async handleGrantAccessCommand(raw: string): Promise<GrantCommandOutcome> {
    let command: Envelope<unknown>;
    try {
      command = parseGrantAccessCommand(raw);
    } catch (error) {
      throw normalizeToMarketplaceError(error);
    }
    try {
      const payload = command.payload as GrantAccessCommandPayload;
      const result = await this.fabric.grantAccess({
        grantId: payload.grantId,
        offerId: payload.offerId,
        grantee: payload.grantee,
        permittedUse: payload.permittedUse,
        asOf: payload.asOf,
        expiresAt: payload.expiresAt,
        correlationId: command.correlationId,
        idempotencyKey: command.idempotencyKey as string,
      });
      const event = makeAccessGrantedEvent(
        {
          grantId: result.record.grantId,
          grantDigest: result.record.digest,
          offerId: payload.offerId,
          permittedUse: payload.permittedUse,
        },
        command.correlationId,
      );
      return { command, event, serializedEvent: serializeEnvelope(event), result };
    } catch (error) {
      throw normalizeToMarketplaceError(error, command.correlationId);
    }
  }

  /** Handle one revoke-grant-command wire message. */
  async handleRevokeGrantCommand(raw: string): Promise<GrantRevocationOutcome> {
    let command: Envelope<unknown>;
    try {
      command = parseRevokeGrantCommand(raw);
    } catch (error) {
      throw normalizeToMarketplaceError(error);
    }
    try {
      const payload = command.payload as RevokeGrantCommandPayload;
      const result = await this.fabric.revokeGrant({
        grantId: payload.grantId,
        grounds: payload.grounds,
        revoker: payload.revoker,
        revokedAt: payload.revokedAt,
        correlationId: command.correlationId,
        idempotencyKey: command.idempotencyKey as string,
      });
      const event = makeGrantRevokedEvent(
        { grantId: payload.grantId, revokes: result.record.revokes ?? '' },
        command.correlationId,
      );
      return { command, event, serializedEvent: serializeEnvelope(event), result };
    } catch (error) {
      throw normalizeToMarketplaceError(error, command.correlationId);
    }
  }

  /** Handle one submit-review-command wire message. */
  async handleSubmitReviewCommand(raw: string): Promise<ReviewCommandOutcome> {
    let command: Envelope<unknown>;
    try {
      command = parseSubmitReviewCommand(raw);
    } catch (error) {
      throw normalizeToMarketplaceError(error);
    }
    try {
      const payload = command.payload as SubmitReviewCommandPayload;
      const result = await this.fabric.submitReview({
        reviewId: payload.reviewId,
        offerId: payload.offerId,
        reviewer: payload.reviewer,
        rating: payload.rating,
        verdict: payload.verdict,
        body: payload.body,
        submittedAt: payload.submittedAt,
        correlationId: command.correlationId,
        idempotencyKey: command.idempotencyKey as string,
      });
      const event = makeReviewSubmittedEvent(
        {
          reviewId: result.record.reviewId,
          reviewDigest: result.record.digest,
          offerId: payload.offerId,
          rating: result.record.rating,
        },
        command.correlationId,
      );
      return { command, event, serializedEvent: serializeEnvelope(event), result };
    } catch (error) {
      throw normalizeToMarketplaceError(error, command.correlationId);
    }
  }

  /** Handle one marketplace-query-request wire message. */
  async handleQueryRequest(raw: string): Promise<MarketplaceQueryOutcome> {
    let request: Envelope<MarketplaceQueryRequest>;
    try {
      request = parseMarketplaceQueryRequest(raw);
    } catch (error) {
      throw normalizeToMarketplaceError(error);
    }
    let responsePayload: MarketplaceQueryResponse;
    try {
      responsePayload = await this.fabric.handleQueryRequest(request.payload);
    } catch (error) {
      throw normalizeToMarketplaceError(error, request.correlationId);
    }
    let response: Envelope<MarketplaceQueryResponse>;
    try {
      response = makeMarketplaceQueryResponse(responsePayload, request.correlationId);
    } catch (error) {
      throw normalizeToMarketplaceError(error, request.correlationId);
    }
    return {
      request,
      response,
      serializedResponse: serializeEnvelope(response),
      result: responsePayload.result,
    };
  }

  /** Build (but do not handle) a marketplace query envelope. */
  makeQuery(
    kind: Parameters<typeof marketplaceQueryRequest>[0],
    params: unknown,
    tenant: string,
    correlationId: string,
  ): Envelope<MarketplaceQueryRequest> {
    const scope = { tenant };
    const payload = marketplaceQueryRequest(kind, params, scope);
    return makeMarketplaceQueryRequest(payload, correlationId);
  }

  /** Strict-parse a query response (consumer side). */
  readQueryResponse(raw: string): MarketplaceQueryResultValue {
    const response = parseMarketplaceQueryResponse(raw);
    return response.payload.result;
  }

  /** FAIL-CLOSED pairing guard (consumer side). */
  readQueryResponseFor(
    raw: string,
    request: Envelope<MarketplaceQueryRequest>,
  ): MarketplaceQueryResultValue {
    const response = parseMarketplaceQueryResponseFor(raw, request);
    return response.payload.result;
  }

  /** Client-side command builders (build but do not handle). */
  buildRegisterOfferCommand(
    payload: RegisterOfferCommandPayload,
    correlationId: string,
    idempotencyKey: string,
  ): Envelope<RegisterOfferCommandPayload> {
    return makeRegisterOfferCommand(payload, correlationId, idempotencyKey);
  }

  buildGrantAccessCommand(
    payload: GrantAccessCommandPayload,
    correlationId: string,
    idempotencyKey: string,
  ): Envelope<GrantAccessCommandPayload> {
    return makeGrantAccessCommand(payload, correlationId, idempotencyKey);
  }

  buildSubmitReviewCommand(
    payload: SubmitReviewCommandPayload,
    correlationId: string,
    idempotencyKey: string,
  ): Envelope<SubmitReviewCommandPayload> {
    return makeSubmitReviewCommand(payload, correlationId, idempotencyKey);
  }

  buildRetireOfferCommand(
    payload: RetireOfferCommandPayload,
    correlationId: string,
    idempotencyKey: string,
  ): Envelope<RetireOfferCommandPayload> {
    return makeRetireOfferCommand(payload, correlationId, idempotencyKey);
  }

  buildRevokeGrantCommand(
    payload: RevokeGrantCommandPayload,
    correlationId: string,
    idempotencyKey: string,
  ): Envelope<RevokeGrantCommandPayload> {
    return makeRevokeGrantCommand(payload, correlationId, idempotencyKey);
  }

  buildSupersedeOfferCommand(
    payload: RegisterOfferCommandPayload,
    correlationId: string,
    idempotencyKey: string,
  ): Envelope<RegisterOfferCommandPayload> {
    return makeSupersedeOfferCommand(payload, correlationId, idempotencyKey);
  }
}

/** Construct a fresh envelope-wired marketplace service. */
export function createMarketplaceArtifactsService(
  config: MarketplaceArtifactsServiceConfig = {},
): MarketplaceArtifactsService {
  return new MarketplaceArtifactsService(config);
}

export { toCorrelationId };
