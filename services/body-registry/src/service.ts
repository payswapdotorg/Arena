/**
 * BodyRegistryEnvelopeService — the envelope-wired reference service
 * facade (Work Order A024; architecture-lock rules 17, 18, 22; mirrors
 * the sibling reference services' envelope wiring, e.g.
 * services/certification CertificationService).
 *
 * Pure reference fabric: injected dependencies (the fabric is
 * constructor-injected), fail-closed error normalization, NO
 * network/HTTP layer (the A024 reference slice).
 *
 * Wire round trip:
 *   register-release-command (envelope, REQUIRED idempotency key)
 *     → fabric.register (gate → idempotency → identity binding → append)
 *     → release-registered-event (envelope carrying the authoritative,
 *       content-addressed ReleaseRecord digest + the citable release
 *       artifact ref)
 *   publish-release-command (envelope, REQUIRED idempotency key)
 *     → fabric.publish (idempotent, reproducible publication)
 *     → release-published-event (envelope carrying the content-addressed
 *       publication record digest + the citable release artifact ref)
 */

import {
  BODY_REGISTRY_ERROR_CODES,
  makePublishReleaseCommand,
  makeReleasePublishedEvent,
  makeReleaseRegisteredEvent,
  normalizeToBodyRegistryError,
  parsePublishReleaseCommand,
  parseRegisterReleaseCommand,
} from '@arena/body-registry';
import type { ReleasePublicationRecord, ReleaseRecord } from '@arena/body-registry';
import { serializeEnvelope } from '@arena/protocol-core';
import type { Envelope } from '@arena/protocol-core';
import { BodyRegistryService } from './fabric.js';
import type { RegisterOptions } from './fabric.js';

/** The non-wire portions of a registration (releaseVersion comes from the command payload). */
export type RegisterWireOptions = Omit<RegisterOptions, 'correlationId' | 'idempotencyKey' | 'releaseVersion'>;

/** Service configuration (all injected). */
export interface BodyRegistryServiceConfig {
  readonly fabric?: BodyRegistryService;
}

/** The result of one handled register-release-command. */
export interface RegisterReleaseOutcome {
  /** The deserialized command envelope that was handled. */
  readonly command: Envelope<unknown>;
  /** The emitted release-registered-event envelope. */
  readonly event: Envelope<unknown>;
  /** The serialized event (canonical JSON — the wire form). */
  readonly serializedEvent: string;
  /** The authoritative registration record the event carries (by digest). */
  readonly record: ReleaseRecord;
}

/** The result of one handled publish-release-command. */
export interface PublishReleaseOutcome {
  /** The deserialized command envelope that was handled. */
  readonly command: Envelope<unknown>;
  /** The emitted release-published-event envelope. */
  readonly event: Envelope<unknown>;
  /** The serialized event (canonical JSON — the wire form). */
  readonly serializedEvent: string;
  /** The authoritative publication record the event carries (by digest). */
  readonly publication: ReleasePublicationRecord;
}

/**
 * The envelope-wired body-registry service. Construct with
 * `new BodyRegistryEnvelopeService({ fabric })`.
 */
export class BodyRegistryEnvelopeService {
  readonly fabric: BodyRegistryService;

  constructor(config: BodyRegistryServiceConfig = {}) {
    this.fabric = config.fabric ?? new BodyRegistryService({ stores: { bodyVersions: () => null, certificationRecords: () => null, compatibilityRecords: () => null } });
  }

  /**
   * Handle one register-release-command wire message: strict-parse the
   * envelope (REQUIRED idempotency key; body-registry schema; payload
   * shape), run the fabric, and return the release-registered-event.
   *
   * Any failure — malformed envelope, gate rejection, idempotency or
   * identity conflict — is normalized into a typed BodyRegistryError
   * (fail-closed; nothing partial is returned).
   */
  async handleRegisterReleaseCommand(
    raw: string,
    options: RegisterWireOptions,
  ): Promise<RegisterReleaseOutcome> {
    let command;
    try {
      command = parseRegisterReleaseCommand(raw);
    } catch (error) {
      throw normalizeToBodyRegistryError(error);
    }
    const payload = command.payload;
    try {
      const record = await this.fabric.register(
        {
          bodyVersionRef: payload.bodyVersionRef,
          channel: payload.channel,
          certificationRefs: payload.certificationRefs,
          compatibilityRefs: payload.compatibilityRefs,
          forgeRecordDigest: payload.forgeRecordDigest,
        },
        {
          correlationId: command.correlationId,
          idempotencyKey: command.idempotencyKey!,
          releaseVersion: payload.releaseVersion,
          ...options,
          ...(payload.tags !== undefined && payload.tags.length > 0 ? { tags: payload.tags } : {}),
        },
      );
      const event = makeReleaseRegisteredEvent(
        {
          releaseRecordDigest: record.digest,
          release: {
            namespace: record.release!.namespace,
            name: record.release!.name,
            version: record.release!.version,
            digest: record.release!.digest,
          },
        },
        { correlationId: command.correlationId, idempotencyKey: command.idempotencyKey! },
      );
      return {
        command,
        event,
        serializedEvent: serializeEnvelope(event),
        record,
      };
    } catch (error) {
      throw normalizeToBodyRegistryError(error);
    }
  }

  /**
   * Handle one publish-release-command wire message: strict-parse the
   * envelope (REQUIRED idempotency key; body-registry schema), run the
   * fabric, and return the release-published-event.
   */
  async handlePublishReleaseCommand(raw: string): Promise<PublishReleaseOutcome> {
    let command;
    try {
      command = parsePublishReleaseCommand(raw);
    } catch (error) {
      throw normalizeToBodyRegistryError(error);
    }
    const payload = command.payload;
    try {
      const publication = await this.fabric.publish(payload.releaseRecordDigest, {
        publisher: payload.publisher,
        rights: payload.rights,
        publishedAt: payload.publishedAt,
      });
      const event = makeReleasePublishedEvent(
        {
          publicationRecordDigest: publication.digest,
          release: {
            namespace: publication.release.namespace,
            name: publication.release.name,
            version: publication.release.version,
            digest: publication.release.digest,
          },
        },
        { correlationId: command.correlationId, idempotencyKey: command.idempotencyKey! },
      );
      return {
        command,
        event,
        serializedEvent: serializeEnvelope(event),
        publication,
      };
    } catch (error) {
      throw normalizeToBodyRegistryError(error);
    }
  }
}

export { BODY_REGISTRY_ERROR_CODES, makePublishReleaseCommand };
