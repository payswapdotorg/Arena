/**
 * ExpertMatchingFabric — the in-process reference ORCHESTRATOR over the
 * pool and the pure engine (Work Order A007; requirements R7, R8;
 * architecture-lock rules 6, 17, 18; mirrors the A012/A013 reference
 * fabrics structurally).
 *
 * Pure TypeScript, ZERO external runtime dependencies (only
 * @arena/expert-qualification + @arena/protocol-core — the REAL A007
 * qualification protocol constructors, engine and envelope wiring are the
 * substrate, exactly like the A013 fabric runs the REAL A002
 * MaterialArtifacts).
 *
 * `qualifyClaim` (a COMMAND, idempotency key REQUIRED — lock rule 17):
 *   1. resolve refs — the claim and the policy by digest from the pool
 *      (NOT_FOUND when absent);
 *   2. resolve the claim's evidence records by digest (MISSING_EVIDENCE
 *      when any is absent — fail loudly, never partial evidence);
 *   3. run the PURE engine (evaluateCompetencyClaim) with the latest
 *      record as priorRecord when renewing;
 *   4. append the record to the pool (append-only; no update/delete APIs)
 *      and emit qualification-recorded-event.
 *
 * `recordQualificationExpiry` (a COMMAND): appends the decay record for a
 * lapsed qualification — expiry never rewrites history (lock rule 6).
 *
 * `matchExperts` (a QUERY — pure, no idempotency key): runs the engine
 * and emits the match-experts-query / match-completed-response envelope
 * round trip.
 *
 * Idempotency (lock rule 17): the same key + the same command tuple
 * replays as a no-op returning the stored record; the same key + a
 * different tuple is an IDEMPOTENCY_CONFLICT.
 */

import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import {
  EXPERT_QUALIFICATION_ERROR_CODES,
  ExpertQualificationError,
  evaluateCompetencyClaim,
  makeMatchCompletedResponse,
  makeMatchExpertsQuery,
  makeQualificationRecordedEvent,
  makeQualifyClaimCommand,
  makeRecordQualificationExpiryCommand,
  recordQualificationExpiry,
} from '@arena/expert-qualification';
import type {
  MatchCompletedResponsePayload,
  MatchExpertsQueryPayload,
  MatchRequest,
  MatchResult,
  MatchingPolicy,
  QualificationRecord,
  QualificationRecordedEventPayload,
} from '@arena/expert-qualification';
import { QualifiedExpertPool } from './pool.js';
import { ExpertMatchingEngine } from './matcher.js';

/** Options for one fabric command run. */
export interface CommandOptions {
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

/** Options for one fabric query run (pure — no idempotency key). */
export interface QueryOptions {
  readonly correlationId: string;
}

interface IdempotencyBinding {
  readonly commandCanonical: string;
  readonly recordDigest: string;
}

function commandCanonicalOf(
  kind: 'qualify' | 'expiry',
  claimRef: string,
  policyRef: string | null,
  evaluatedAt: string,
  renew: boolean,
): string {
  return JSON.stringify([kind, claimRef, policyRef, evaluatedAt, renew]);
}

/**
 * The in-process reference fabric: pool + engine + command orchestration +
 * event log. Construct with `new ExpertMatchingFabric()` (fresh pool) or
 * pass a pre-populated pool.
 */
export class ExpertMatchingFabric {
  readonly pool: QualifiedExpertPool;
  readonly engine: ExpertMatchingEngine;

  /** Insertion-ordered event log (append-only). */
  private readonly events: Array<{
    readonly kind: 'qualification-recorded';
    readonly envelope: Envelope<QualificationRecordedEventPayload>;
  }> = [];
  /** Run idempotency keys → the run they authorized. */
  private readonly runKeys = new Map<string, IdempotencyBinding>();

  // Registration pass-through (the pool enforces the discipline).
  registerExpertCard: QualifiedExpertPool['registerExpertCard'];
  registerEvidence: QualifiedExpertPool['registerEvidence'];
  registerQualificationPolicy: QualifiedExpertPool['registerQualificationPolicy'];
  registerClaim: QualifiedExpertPool['registerClaim'];
  registerQualificationRecord: QualifiedExpertPool['registerQualificationRecord'];

  constructor(pool: QualifiedExpertPool = new QualifiedExpertPool()) {
    this.pool = pool;
    this.engine = new ExpertMatchingEngine();
    this.registerExpertCard = pool.registerExpertCard.bind(pool);
    this.registerEvidence = pool.registerEvidence.bind(pool);
    this.registerQualificationPolicy = pool.registerQualificationPolicy.bind(pool);
    this.registerClaim = pool.registerClaim.bind(pool);
    this.registerQualificationRecord = pool.registerQualificationRecord.bind(pool);
  }

  // -------------------------------------------------------------------------
  // qualifyClaim (command — idempotency key REQUIRED)
  // -------------------------------------------------------------------------

  /**
   * Evaluate one claim under one policy at one fixed time and append the
   * resulting record. Idempotent per (idempotencyKey, command tuple).
   */
  async qualifyClaim(
    command: { claimRef: string; policyRef: string; evaluatedAt: string; renew: boolean },
    options: CommandOptions,
  ): Promise<{
    record: QualificationRecord;
    event: Envelope<QualificationRecordedEventPayload>;
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    // Wire-shape validation first (digests, timestamps, boolean renew).
    void makeQualifyClaimCommand(command, { correlationId, idempotencyKey });

    const canonical = commandCanonicalOf(
      'qualify',
      command.claimRef,
      command.policyRef,
      command.evaluatedAt,
      command.renew,
    );
    const binding = this.runKeys.get(idempotencyKey);
    if (binding !== undefined) {
      if (binding.commandCanonical !== canonical) {
        throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${JSON.stringify(idempotencyKey)} is already bound to a different qualify-claim command (same key + different claim/policy/time is a conflict, not a rerun)`,
          details: { idempotencyKey, bound: binding.commandCanonical, attempted: canonical },
        });
      }
      const stored = this.pool.getQualificationRecord(binding.recordDigest);
      if (stored !== undefined) {
        const replayEvent = makeQualificationRecordedEvent(
          { record: stored },
          { correlationId, idempotencyKey },
        );
        return { record: stored, event: replayEvent };
      }
    }

    const claim = this.pool.getClaim(command.claimRef);
    if (claim === undefined) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.NOT_FOUND, {
        message: `no competency claim registered at digest ${JSON.stringify(command.claimRef)}`,
        details: { claimRef: command.claimRef },
      });
    }
    const policy = this.pool.getQualificationPolicy(command.policyRef);
    if (policy === undefined) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.NOT_FOUND, {
        message: `no qualification policy registered at digest ${JSON.stringify(command.policyRef)}`,
        details: { policyRef: command.policyRef },
      });
    }

    // Resolve EVERY evidence record the claim references — fail loudly.
    const evidence = claim.evidence.map((digest) => {
      const record = this.pool.getEvidence(digest);
      if (record === undefined) {
        throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.MISSING_EVIDENCE, {
          message: `claim ${claim.digest} references evidence digest ${digest} but no such record is registered`,
          details: { claimDigest: claim.digest, missing: digest },
        });
      }
      return record;
    });

    const priorRecord = command.renew ? this.pool.latestRecordForClaim(claim.digest) : undefined;
    if (command.renew && priorRecord !== undefined && priorRecord.claimDigest !== claim.digest) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.SUPERSESSION_CONFLICT, {
        message: 'renewal requires the latest record of the SAME claim',
        details: { claimDigest: claim.digest, priorClaimDigest: priorRecord.claimDigest },
      });
    }

    const record = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence,
      evaluatedAt: command.evaluatedAt,
      ...(priorRecord !== undefined ? { priorRecord } : {}),
    });
    await this.pool.registerQualificationRecord(record);
    this.runKeys.set(idempotencyKey, { commandCanonical: canonical, recordDigest: record.digest });
    const event = makeQualificationRecordedEvent({ record }, { correlationId, idempotencyKey });
    this.events.push({ kind: 'qualification-recorded', envelope: event });
    return { record, event };
  }

  // -------------------------------------------------------------------------
  // recordQualificationExpiry (command — decay appends, never rewrites)
  // -------------------------------------------------------------------------

  /**
   * Append the decay record for a claim whose latest qualification has
   * lapsed. Fails loudly when the latest record is not a lapsed
   * qualified record.
   */
  async recordQualificationExpiry(
    command: { claimRef: string; evaluatedAt: string },
    options: CommandOptions,
  ): Promise<{
    record: QualificationRecord;
    event: Envelope<QualificationRecordedEventPayload>;
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    void makeRecordQualificationExpiryCommand(command, { correlationId, idempotencyKey });

    const canonical = commandCanonicalOf(
      'expiry',
      command.claimRef,
      null,
      command.evaluatedAt,
      false,
    );
    const binding = this.runKeys.get(idempotencyKey);
    if (binding !== undefined) {
      if (binding.commandCanonical !== canonical) {
        throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${JSON.stringify(idempotencyKey)} is already bound to a different record-qualification-expiry command`,
          details: { idempotencyKey, bound: binding.commandCanonical, attempted: canonical },
        });
      }
      const stored = this.pool.getQualificationRecord(binding.recordDigest);
      if (stored !== undefined) {
        return {
          record: stored,
          event: makeQualificationRecordedEvent({ record: stored }, { correlationId, idempotencyKey }),
        };
      }
    }

    const claim = this.pool.getClaim(command.claimRef);
    if (claim === undefined) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.NOT_FOUND, {
        message: `no competency claim registered at digest ${JSON.stringify(command.claimRef)}`,
        details: { claimRef: command.claimRef },
      });
    }
    const latest = this.pool.latestRecordForClaim(claim.digest);
    if (latest === undefined) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.NOT_FOUND, {
        message: `claim ${claim.digest} has no qualification record to decay`,
        details: { claimDigest: claim.digest },
      });
    }
    const record = await recordQualificationExpiry(latest, command.evaluatedAt);
    await this.pool.registerQualificationRecord(record);
    this.runKeys.set(idempotencyKey, { commandCanonical: canonical, recordDigest: record.digest });
    const event = makeQualificationRecordedEvent({ record }, { correlationId, idempotencyKey });
    this.events.push({ kind: 'qualification-recorded', envelope: event });
    return { record, event };
  }

  // -------------------------------------------------------------------------
  // matchExperts (query — pure, no idempotency key)
  // -------------------------------------------------------------------------

  /**
   * Match one request under one matching policy. Returns the result plus
   * the query/response envelope round trip.
   */
  async matchExperts(
    request: MatchRequest,
    policy: MatchingPolicy,
    options: QueryOptions,
  ): Promise<{
    result: MatchResult;
    query: Envelope<MatchExpertsQueryPayload>;
    response: Envelope<MatchCompletedResponsePayload>;
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const query = makeMatchExpertsQuery({ request, policy }, { correlationId });
    const result = await this.engine.match(request, policy, this.pool);
    const response = makeMatchCompletedResponse({ result }, { correlationId });
    return { result, query, response };
  }

  // -------------------------------------------------------------------------
  // Observability
  // -------------------------------------------------------------------------

  /** The append-only event log (insertion order). */
  listEvents(): readonly Envelope<QualificationRecordedEventPayload>[] {
    return this.events.map((entry) => entry.envelope);
  }

  /** A deterministic observability dump of the pool state. */
  describe(): {
    cards: number;
    evidenceRecords: number;
    claims: number;
    policies: number;
    qualificationRecords: number;
    events: number;
    runKeys: number;
  } {
    return {
      cards: this.pool.listCards().length,
      evidenceRecords: this.pool.listEvidence().length,
      claims: this.pool.listClaims().length,
      policies: this.pool.listQualificationPolicies().length,
      qualificationRecords: this.pool.listQualificationRecords().length,
      events: this.events.length,
      runKeys: this.runKeys.size,
    };
  }
}

/** Construct a fresh fabric (convenience). */
export function createExpertMatchingFabric(pool?: QualifiedExpertPool): ExpertMatchingFabric {
  return new ExpertMatchingFabric(pool);
}
