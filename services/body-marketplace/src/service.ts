/**
 * The envelope-wired body-marketplace service facade (Work Order C014) —
 * mirrors services/marketplace-artifacts's wiring discipline: every wire
 * round trip is command (REQUIRED idempotency key) → fabric → event
 * (SAME correlation id, NULL idempotency key); queries are kind `query`
 * (NULL idempotency key — reads are not commands) → scope-checked
 * dispatch → response (SAME correlation id, echoed query kind). Every
 * failure normalizes into the typed BodyMarketplaceError taxonomy
 * (fail closed; nothing partial is returned).
 */

import {
  makeBodyMarketplaceQueryRequest,
  makeBodyMarketplaceQueryResponse,
  makeCreateListingCommand,
  makeGrantListingAccessCommand,
  makeListingAccessGrantedEvent,
  makeListingTransitionCommand,
  makeListingTransitionedEvent,
  makePretrainingRunEvent,
  makeRequestPretrainingCommand,
  parseBodyMarketplaceQueryRequest,
  parseBodyMarketplaceQueryResponse,
  parseBodyMarketplaceQueryResponseFor,
  parseCreateListingCommand,
  parseGrantListingAccessCommand,
  parseListingTransitionCommand,
  parseRequestPretrainingCommand,
  serialize,
} from './envelopes.js';
import type {
  BodyMarketplaceQueryRequestPayload,
  BodyMarketplaceQueryResponsePayload,
  CreateListingCommandPayload,
  GrantListingAccessCommandPayload,
  ListingTransitionCommandPayload,
  RequestPretrainingCommandPayload,
} from './envelopes.js';
import { normalizeToBodyMarketplaceError } from './errors.js';
import type { BodyMarketplaceError } from './errors.js';
import {
  BodyMarketplaceService,
  createBodyMarketplaceFabric,
} from './fabric.js';
import type {
  BodyMarketplaceServiceConfig,
  CapabilityBodyListing,
  CreateListingCommand,
  GrantListingAccessCommand,
  ListingTransitionCommand,
  RequestPretrainingCommand,
} from './fabric.js';

/** The outcome of one handled command (command + event + result). */
export interface CommandOutcome<TResult> {
  readonly command: unknown;
  readonly event: unknown;
  readonly serializedEvent: string;
  readonly result: TResult;
}

/** The outcome of one handled query (request + response + result). */
export interface QueryOutcome {
  readonly request: unknown;
  readonly response: unknown;
  readonly serializedResponse: string;
  readonly result: unknown;
}

/** The envelope-wired body-marketplace service. */
export class BodyMarketplaceFacade {
  readonly fabric: BodyMarketplaceService;

  constructor(config: BodyMarketplaceServiceConfig = {}) {
    this.fabric = createBodyMarketplaceFabric(config);
  }

  /** Handle one request-pretraining-command wire message. */
  async handleRequestPretrainingCommand(raw: string): Promise<CommandOutcome<unknown>> {
    let envelope: ReturnType<typeof parseRequestPretrainingCommand>;
    try {
      envelope = parseRequestPretrainingCommand(raw);
    } catch (error) {
      throw normalizeToBodyMarketplaceError(error);
    }
    const payload = envelope.payload as RequestPretrainingCommandPayload;
    const command: RequestPretrainingCommand = {
      request: payload.request,
      composition: payload.composition as unknown as RequestPretrainingCommand['composition'],
      baseBodyVersionRef: payload.baseBodyVersionRef,
      releaseChannel: payload.releaseChannel,
      runId: payload.runId,
      idempotencyKey: envelope.idempotencyKey as string,
      correlationId: envelope.correlationId,
    };
    try {
      const result = await this.fabric.requestPretraining(command);
      const event = makePretrainingRunEvent(
        {
          runId: result.runId,
          outcome: result.outcome,
          bodyVersionDigest: result.bodyVersionRef === null ? null : result.bodyVersionRef.digest,
          releaseDigest: result.releaseDigest,
        },
        envelope.correlationId,
      );
      return { command: envelope, event, serializedEvent: serialize(event), result };
    } catch (error) {
      throw this.normalize(error, envelope.correlationId);
    }
  }

  /** Handle one create-listing-command wire message. */
  async handleCreateListingCommand(raw: string): Promise<CommandOutcome<CapabilityBodyListing>> {
    let envelope: ReturnType<typeof parseCreateListingCommand>;
    try {
      envelope = parseCreateListingCommand(raw);
    } catch (error) {
      throw normalizeToBodyMarketplaceError(error);
    }
    const payload = envelope.payload as CreateListingCommandPayload;
    const command: CreateListingCommand = {
      listingId: payload.listingId,
      tenantId: payload.tenantId,
      releaseDigest: payload.releaseDigest,
      title: payload.title,
      summary: payload.summary,
      capabilityEvidenceRefs: payload.capabilityEvidenceRefs,
      pretrainingRunId: payload.pretrainingRunId,
      rights: payload.rights,
      substrateCompatibility: payload.substrateCompatibility,
      pricing: payload.pricing,
      createdBy: payload.createdBy,
      createdAt: payload.createdAt,
      idempotencyKey: envelope.idempotencyKey as string,
      correlationId: envelope.correlationId,
    };
    try {
      const result = await this.fabric.createListing(command);
      const event = makeListingTransitionedEvent(
        {
          listingId: result.listingId,
          from: 'draft',
          to: result.state,
          version: result.version,
          reason: 'listing-created',
        },
        envelope.correlationId,
      );
      return { command: envelope, event, serializedEvent: serialize(event), result };
    } catch (error) {
      throw this.normalize(error, envelope.correlationId);
    }
  }

  /** Handle one listing-transition-command wire message. */
  async handleListingTransitionCommand(
    raw: string,
  ): Promise<CommandOutcome<CapabilityBodyListing>> {
    let envelope: ReturnType<typeof parseListingTransitionCommand>;
    try {
      envelope = parseListingTransitionCommand(raw);
    } catch (error) {
      throw normalizeToBodyMarketplaceError(error);
    }
    const payload = envelope.payload as ListingTransitionCommandPayload;
    const before = this.fabric.getListing(payload.listingId, payload.tenantId);
    const command: ListingTransitionCommand = {
      listingId: payload.listingId,
      tenantId: payload.tenantId,
      to: payload.to,
      reason: payload.reason,
      actor: payload.actor,
      at: payload.at,
      ...(payload.releasePublication === undefined
        ? {}
        : { releasePublication: payload.releasePublication }),
      idempotencyKey: envelope.idempotencyKey as string,
      correlationId: envelope.correlationId,
    };
    try {
      const result = await this.fabric.transitionListing(command);
      const event = makeListingTransitionedEvent(
        {
          listingId: result.listingId,
          from: before.state,
          to: result.state,
          version: result.version,
          reason: payload.reason,
        },
        envelope.correlationId,
      );
      return { command: envelope, event, serializedEvent: serialize(event), result };
    } catch (error) {
      throw this.normalize(error, envelope.correlationId);
    }
  }

  /** Handle one grant-listing-access-command wire message. */
  async handleGrantListingAccessCommand(raw: string): Promise<CommandOutcome<unknown>> {
    let envelope: ReturnType<typeof parseGrantListingAccessCommand>;
    try {
      envelope = parseGrantListingAccessCommand(raw);
    } catch (error) {
      throw normalizeToBodyMarketplaceError(error);
    }
    const payload = envelope.payload as GrantListingAccessCommandPayload;
    const command: GrantListingAccessCommand = {
      grantId: payload.grantId,
      listingId: payload.listingId,
      tenantId: payload.tenantId,
      grantee: payload.grantee,
      permittedUse: payload.permittedUse,
      expiresAt: payload.expiresAt,
      grantedBy: payload.grantedBy,
      grantedAt: payload.grantedAt,
      idempotencyKey: envelope.idempotencyKey as string,
      correlationId: envelope.correlationId,
    };
    try {
      const result = await this.fabric.grantListingAccess(command);
      const event = makeListingAccessGrantedEvent(
        {
          grantId: result.grantId,
          listingId: result.listingId,
          permittedUse: result.permittedUse,
        },
        envelope.correlationId,
      );
      return { command: envelope, event, serializedEvent: serialize(event), result };
    } catch (error) {
      throw this.normalize(error, envelope.correlationId);
    }
  }

  /** Handle one body-marketplace-query-request wire message. */
  async handleQueryRequest(raw: string): Promise<QueryOutcome> {
    let request: ReturnType<typeof parseBodyMarketplaceQueryRequest>;
    try {
      request = parseBodyMarketplaceQueryRequest(raw);
    } catch (error) {
      throw normalizeToBodyMarketplaceError(error);
    }
    const payload = request.payload as BodyMarketplaceQueryRequestPayload;
    const tenant = payload.scope.tenant;
    let result: unknown;
    try {
      switch (payload.kind) {
        case 'list-listings':
          result = this.fabric.listListings(tenant);
          break;
        case 'get-listing':
          result = this.fabric.getListing(
            String(payload.params['listingId'] ?? ''),
            tenant,
          );
          break;
        case 'certification-posture':
          result = await this.fabric.deriveCertificationPosture(
            this.fabric.getListing(String(payload.params['listingId'] ?? ''), tenant),
          );
          break;
        case 'certified-badge':
          result = await this.fabric.certifiedBadge(
            String(payload.params['listingId'] ?? ''),
            tenant,
          );
          break;
        case 'get-pretraining-run':
          result = this.fabric.getPretrainingRun(
            String(payload.params['runId'] ?? ''),
            tenant,
          );
          break;
        default:
          throw new Error(`unreachable query kind: ${String(payload.kind)}`);
      }
    } catch (error) {
      throw this.normalize(error, request.correlationId);
    }
    const responsePayload: BodyMarketplaceQueryResponsePayload = {
      kind: payload.kind,
      result,
    };
    const response = makeBodyMarketplaceQueryResponse(responsePayload, request.correlationId);
    return {
      request,
      response,
      serializedResponse: serialize(response),
      result,
    };
  }

  private normalize(error: unknown, correlationId: string): BodyMarketplaceError {
    return normalizeToBodyMarketplaceError(error, correlationId);
  }
}

/** Construct a fresh envelope-wired body-marketplace facade. */
export function createBodyMarketplaceService(
  config: BodyMarketplaceServiceConfig = {},
): BodyMarketplaceFacade {
  return new BodyMarketplaceFacade(config);
}

// Client-side builders (build but do not handle).
export {
  makeRequestPretrainingCommand,
  makeCreateListingCommand,
  makeListingTransitionCommand,
  makeGrantListingAccessCommand,
  makeBodyMarketplaceQueryRequest,
};

// Consumer-side strict readers.
export {
  parseBodyMarketplaceQueryResponse,
  parseBodyMarketplaceQueryResponseFor,
};
