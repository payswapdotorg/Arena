/**
 * CertificationService — the envelope-wired reference service facade
 * (Work Order A023; architecture-lock rules 17, 18, 22; mirrors the
 * sibling reference services' envelope wiring).
 *
 * Pure reference fabric: injected dependencies (the fabric + registry
 * are constructor-injected), fail-closed error normalization, NO
 * network/HTTP layer (the A023 reference slice, like the A013 fabric).
 *
 * Wire round trip:
 *   run-certification-command (envelope, REQUIRED idempotency key)
 *     → fabric.certify (resolve suite → resolve evidence → evaluate
 *       every stage → derive verdict/level/statement → append)
 *     → certification-recorded-event (envelope carrying the ledger's
 *       authoritative, content-addressed CertificationRecord).
 */

import {
  CERTIFICATION_ERROR_CODES,
  CertificationError,
  makeCertificationRecordedEvent,
  makeRunCertificationCommand,
  normalizeToCertificationError,
  parseCertificationRecordedEvent,
  parseRunCertificationCommand,
} from '@arena/certification';
import type { CertificationRecord, CertificationSubject } from '@arena/certification';
import { serializeEnvelope, toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { Envelope } from '@arena/protocol-core';
import { CertificationFabric } from './fabric.js';

/** Service configuration (all injected; defaults are fresh instances). */
export interface CertificationServiceConfig {
  readonly fabric?: CertificationFabric;
}

/** The result of one handled run-certification-command. */
export interface RunCertificationOutcome {
  /** The deserialized command envelope that was handled. */
  readonly command: Envelope<unknown>;
  /** The emitted certification-recorded-event envelope. */
  readonly event: Envelope<unknown>;
  /** The serialized event (canonical JSON — the wire form). */
  readonly serializedEvent: string;
  /** The authoritative record the event carries. */
  readonly record: CertificationRecord;
}

/**
 * The envelope-wired certification service. Construct with
 * `new CertificationService()` or inject a pre-populated fabric.
 */
export class CertificationService {
  readonly fabric: CertificationFabric;

  constructor(config: CertificationServiceConfig = {}) {
    this.fabric = config.fabric ?? new CertificationFabric();
  }

  /** Convenience passthrough: the injected suite registry. */
  get registry(): CertificationFabric['registry'] {
    return this.fabric.registry;
  }

  // -------------------------------------------------------------------------
  // Command handling (fail-closed, envelope-wired)
  // -------------------------------------------------------------------------

  /**
   * Handle one run-certification-command wire message: strict-parse the
   * envelope (REQUIRED idempotency key; certification-namespace schema),
   * run the fabric, and return the certification-recorded-event.
   *
   * Any failure — malformed envelope, unknown suite, unresolvable
   * evidence, idempotency conflict — is normalized into a typed
   * CertificationError (fail-closed; nothing partial is returned).
   */
  async handleRunCertificationCommand(raw: string): Promise<RunCertificationOutcome> {
    let command;
    try {
      command = parseRunCertificationCommand(raw);
    } catch (error) {
      throw normalizeToCertificationError(error);
    }
    const payload = command.payload;
    try {
      const record = await this.fabric.certify(
        payload.suiteRef,
        payload.subject,
        payload.evidenceRefs,
        {
          correlationId: command.correlationId,
          idempotencyKey: command.idempotencyKey!,
        },
      );
      const event = makeCertificationRecordedEvent(
        { record },
        command.correlationId,
        command.idempotencyKey,
      );
      return {
        command,
        event,
        serializedEvent: serializeEnvelope(event),
        record,
      };
    } catch (error) {
      throw normalizeToCertificationError(error);
    }
  }

  /**
   * Build (but do not handle) a run-certification-command envelope —
   * the client-side counterpart of handleRunCertificationCommand.
   */
  makeCommand(
    suiteRef: string,
    subject: CertificationSubject,
    evidenceRefs: readonly string[],
    correlationId: string,
    idempotencyKey: string,
  ): Envelope<unknown> {
    return makeRunCertificationCommand(
      { suiteRef, subject, evidenceRefs: [...evidenceRefs] },
      toCorrelationId(correlationId),
      toIdempotencyKey(idempotencyKey),
    ) as Envelope<unknown>;
  }

  /** Strict-parse a certification-recorded-event (consumer side). */
  readRecordedEvent(raw: string): CertificationRecord {
    try {
      const event = parseCertificationRecordedEvent(raw);
      return event.payload.record;
    } catch (error) {
      throw normalizeToCertificationError(error);
    }
  }

  /**
   * FAIL-CLOSED guard: a record that fails ledger lookup or structural
   * validation can never be treated as a certification claim.
   */
  assertAuthoritative(record: CertificationRecord): void {
    const stored = this.fabric.getRecord(record.digest);
    if (stored === undefined || stored.digest !== record.digest) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.NOT_FOUND, {
        message: `record ${JSON.stringify(record.digest)} is not in this ledger — foreign records cannot be asserted here`,
        details: { digest: record.digest },
      });
    }
  }
}

/** Construct a fresh certification service. */
export function createCertificationService(config: CertificationServiceConfig = {}): CertificationService {
  return new CertificationService(config);
}
