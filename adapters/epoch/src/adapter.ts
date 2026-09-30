/**
 * The provider-neutral Epoch capability-development adapter (Work Order
 * A026; spec/epoch-integration.md EPI1.0).
 *
 * Direction 1 — Epoch → Arena (typed translation):
 *   a validated EPI1.0 CapabilityDevelopmentRequest is translated into an
 *   Arena Capability Case via the A005 constructor (@arena/capability-case
 *   createCapabilityCase — the authoritative validator and content
 *   addresser), and emitted as a typed run-capability-development COMMAND
 *   envelope (idempotency key REQUIRED) for the Arena write surface.
 *
 * Direction 2 — Arena → Epoch (typed outputs):
 *   the EPI1.0 output refs (the spec's eleven kinds) are validated,
 *   content-addressed and frozen; the three kinds the A025 public read
 *   surface exposes (agent-body-version, compatibility-report,
 *   certification) are resolvable through the injected ArenaApiClient.
 *
 * Asynchronous contract: every job carries job id, correlation id,
 * causation id, idempotency key, artifact digests, authorization
 * metadata and an explicit lifecycle, with the A015 idempotent
 * submission discipline (same key + same request digest = replay of the
 * SAME job; different digest = conflict, never a silent rebind).
 *
 * AUTHORITY BOUNDARY (EPI1.0 "Arena does not"): enforced structurally.
 * The adapter exposes NO Epoch World-Model mutation surface of any
 * kind — no method accepts, returns or mutates Epoch World Model,
 * action, constraint, baseline or delivery-state state. The exported
 * surface is declaration + translation + Arena reads only; the hygiene
 * suite scans the public surface for forbidden mutation vocabulary.
 */

import { ArenaApiClient } from '@arena/arena-sdk';
import { CHANNEL_GRANT_REQUIREMENTS } from '@arena/body-registry';
import { createCapabilityCase } from '@arena/capability-case';
import type { CapabilityCase, CreateCapabilityCaseInput } from '@arena/capability-case';
import { jobSubmissionKey, toNeutralId } from '@arena/job-protocol';
import {
  digestCanonical,
  newCorrelationId,
} from '@arena/protocol-core';
import type { CorrelationId } from '@arena/protocol-core';
import { EPOCH_ADAPTER_ERROR_CODES, EpochAdapterError } from './errors.js';
import {
  epochOutputRefFromCapabilityCase,
  epochOutputRefKey,
  isQueryableEpochOutputRefKind,
  isEpochOutputRef,
  toEpochOutputRef,
} from './refs.js';
import type { EpochOutputRef } from './refs.js';
import {
  epochJobSubmissionKey,
  hasCrossKindDigestCollision,
  makeEpochJob,
  normalizeArtifactDigests,
  toCausationId,
  transitionEpochJob,
} from './job.js';
import type { EpochJobRecord } from './job.js';
import { toCapabilityDevelopmentRequest } from './request.js';
import type { CapabilityDevelopmentRequest } from './request.js';
import { makeJobCompletedEvent, makeRunCapabilityDevelopmentCommand } from './schemas.js';
import type { Envelope } from '@arena/protocol-core';

/** The provider-neutral adapter identity. */
export const EPOCH_ADAPTER_ID = 'epoch' as const;
export const EPOCH_ADAPTER_PROTOCOL_LABEL = 'EPI1.0' as const;

/** The EPI1.0 authority clauses — Arena NEVER crosses these (declared, frozen). */
export const EPOCH_AUTHORITY_BOUNDARY: readonly string[] = Object.freeze([
  'mutate Epoch World Model',
  'execute Epoch actions',
  'alter Epoch constraints',
  'change approved baselines',
  'alter Epoch delivery state',
  'become Epoch semantic authority',
]);

export interface EpochAdapterConfig {
  /** The typed Arena API client (A025) every read executes through. */
  readonly client: ArenaApiClient;
  /** Deterministic clock for reproducible job timestamps. */
  readonly clock?: () => string;
  readonly adapterVersion?: string;
}

export interface EpochSubmissionResult {
  readonly job: EpochJobRecord;
  /**
   * The typed command envelope for the Arena write surface. NULL on an
   * idempotent replay — a replayed submission MUST NOT execute again
   * (A015 discipline); the caller receives the original job instead.
   */
  readonly command: Envelope<CapabilityDevelopmentRequest> | null;
  readonly caseRecord: CapabilityCase;
  readonly replayed: boolean;
}

export interface CompleteJobInput {
  /** Raw EPI1.0 output refs (validated fail-closed before acceptance). */
  readonly refs: readonly unknown[];
}

export interface EpochAdapterHealthReport {
  readonly adapterId: typeof EPOCH_ADAPTER_ID;
  readonly adapterVersion: string;
  readonly protocol: typeof EPOCH_ADAPTER_PROTOCOL_LABEL;
  readonly jobs: number;
  readonly ok: true;
}

const DEFAULT_VERSION = '1.0.0';

export class EpochAdapter {
  readonly adapterId = EPOCH_ADAPTER_ID;
  readonly adapterVersion: string;
  readonly protocol = EPOCH_ADAPTER_PROTOCOL_LABEL;
  readonly authorityBoundary: readonly string[] = EPOCH_AUTHORITY_BOUNDARY;

  private readonly client: ArenaApiClient;
  private readonly clock: () => string;
  private readonly jobsByKey = new Map<string, EpochJobRecord>();
  private readonly keyByJobId = new Map<string, string>();
  private readonly casesByKey = new Map<string, CapabilityCase>();

  constructor(config: EpochAdapterConfig) {
    if (
      typeof config !== 'object' ||
      config === null ||
      !(config.client instanceof ArenaApiClient)
    ) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
        message:
          'the epoch adapter requires an @arena/arena-sdk ArenaApiClient (the A025 typed read surface) — no unscoped, untyped access',
      });
    }
    this.client = config.client;
    this.clock = config.clock ?? (() => new Date().toISOString());
    this.adapterVersion = config.adapterVersion ?? DEFAULT_VERSION;
  }

  // -------------------------------------------------------------------------
  // Epoch → Arena: typed translation + provisioning + job creation
  // -------------------------------------------------------------------------

  async submitCapabilityDevelopmentRequest(
    raw: unknown,
  ): Promise<EpochSubmissionResult> {
    const request = toCapabilityDevelopmentRequest(raw);

    // Fail closed on cross-tenant authorization metadata: the request
    // tenant and the authorization tenant must be the same scope.
    if (request.tenant !== request.authorization.tenant) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.CROSS_TENANT, {
        message: `capability development request tenant ${JSON.stringify(request.tenant)} does not match authorization tenant ${JSON.stringify(request.authorization.tenant)} — cross-tenant requests are rejected fail-closed`,
        details: {
          requestTenant: request.tenant,
          authorizationTenant: request.authorization.tenant,
        },
      });
    }

    const requestDigest = await digestCanonical(request);

    const correlationId: CorrelationId =
      request.correlationId !== undefined ? request.correlationId : newCorrelationId();
    const submissionKey = jobSubmissionKey({
      idempotencyScope: toNeutralId(EPOCH_ADAPTER_ID),
      idempotencyKey: request.idempotencyKey,
      correlationId,
    });

    // Idempotent submission discipline (A015): same key + same request
    // digest ⇒ replay the SAME job (no re-execution); different digest ⇒
    // conflict — an idempotency key is never silently rebound.
    const existing = this.jobsByKey.get(submissionKey);
    if (existing !== undefined) {
      if (existing.requestDigest === requestDigest) {
        const existingCase = this.casesByKey.get(submissionKey);
        if (existingCase === undefined) {
          throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
            message: 'idempotent replay lost its provisioning record — failing closed rather than re-executing',
            details: { jobId: existing.jobId },
            correlationId,
          });
        }
        return Object.freeze({
          job: existing,
          command: null,
          caseRecord: existingCase,
          replayed: true,
        });
      }
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `idempotency key ${JSON.stringify(request.idempotencyKey)} is already bound to a different request digest — reusing it for DIFFERENT content is forbidden`,
        details: {
          idempotencyKey: request.idempotencyKey,
          idempotencyScope: EPOCH_ADAPTER_ID,
          bound: existing.requestDigest,
          attempted: requestDigest,
          jobId: existing.jobId,
        },
        correlationId,
      });
    }

    // Typed translation: the EPI1.0 case seed → the A005 case input.
    const caseInput = this.toCaseInput(request, requestDigest);
    let caseRecord: CapabilityCase;
    try {
      caseRecord = await createCapabilityCase(caseInput);
    } catch (error) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
        message: `the capability case seed was rejected by the A005 capability-case constructor: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          cause: error instanceof Error ? error.name : typeof error,
        },
        correlationId,
      });
    }

    const caseRef = epochOutputRefFromCapabilityCase(caseRecord);
    const job = makeEpochJob({
      jobId: globalThis.crypto.randomUUID(),
      idempotencyKey: request.idempotencyKey,
      correlationId,
      causationId: toCausationId(request.causationId ?? request.requestId),
      requestDigest,
      authorization: request.authorization,
      targetReleaseChannel: request.targetReleaseChannel,
      caseRef,
      submittedAt: this.clock(),
    });

    this.jobsByKey.set(submissionKey, job);
    this.keyByJobId.set(job.jobId, submissionKey);
    this.casesByKey.set(submissionKey, caseRecord);

    const command = makeRunCapabilityDevelopmentCommand(request, {
      correlationId,
      idempotencyKey: request.idempotencyKey,
      ...(request.causationId !== undefined
        ? { causationId: toCausationId(request.causationId) }
        : {}),
    });

    return Object.freeze({ job, command, caseRecord, replayed: false });
  }

  private toCaseInput(
    request: CapabilityDevelopmentRequest,
    requestDigest: string,
  ): CreateCapabilityCaseInput {
    const seed = request.caseSeed;
    return {
      identity: {
        tenant: request.tenant,
        caseId: request.requestId,
      },
      version: DEFAULT_VERSION,
      source: {
        // The A005 principal-type vocabulary is closed (agent-body,
        // expert, user, service, system); the epoch adapter is a service
        // principal acting on the request's behalf.
        type: 'service',
        tenant: request.authorization.tenant,
        principalId: request.authorization.principal,
      },
      problemStatement: seed.problemStatement,
      targetCapability: seed.targetCapability,
      domain: seed.domain,
      context: seed.context,
      observedFailure: seed.observedFailure,
      evidence: seed.evidence,
      unknowns: seed.unknowns,
      desiredOutcome: seed.desiredOutcome,
      expertRequirements: seed.expertRequirements,
      environmentRequirements: seed.environmentRequirements,
      taskRequirements: seed.taskRequirements,
      evaluationRequirements: seed.evaluationRequirements,
      verificationRequirements: seed.verificationRequirements,
      provenance: {
        recordDigest: requestDigest,
      },
      priority: seed.priority,
      risk: seed.risk,
      createdAt: this.clock(),
    };
  }

  // -------------------------------------------------------------------------
  // Explicit job lifecycle (EPI1.0: explicit lifecycle/status)
  // -------------------------------------------------------------------------

  /** Advance a queued job to running (the host forwarded the command). */
  startJob(jobId: string): EpochJobRecord {
    const job = this.requireJob(jobId);
    const next = transitionEpochJob(job, 'running', { updatedAt: this.clock() });
    this.store(next);
    return next;
  }

  /**
   * Complete a running job with its EPI1.0 output refs. Every ref is
   * validated fail-closed; artifact digests are the sorted unique digest
   * set of the case + every output; candidate/stable channels cite the
   * A024 release admission gate (certification-backed grants required).
   */
  completeJob(jobId: string, input: CompleteJobInput): EpochJobRecord {
    const job = this.requireJob(jobId);
    const refs: EpochOutputRef[] = [];
    for (const rawRef of input.refs) {
      refs.push(toEpochOutputRef(rawRef));
    }
    if (hasCrossKindDigestCollision(refs)) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF, {
        message: 'output refs claim the same digest under different kinds — a content digest never changes meaning',
        details: { jobId },
      });
    }
    const caseRef = job.caseRef;
    if (caseRef === null) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF, {
        message: 'the job carries no capability-case ref to complete against',
        details: { jobId },
      });
    }
    for (const ref of refs) {
      if (epochOutputRefKey(ref) === epochOutputRefKey(caseRef)) {
        throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF, {
          message: 'completion refs duplicate the job capability-case ref',
          details: { jobId, ref: epochOutputRefKey(ref) },
        });
      }
    }

    // A024 release admission gate citation: candidate/stable channels
    // admit only certification-backed capability artifacts.
    const channel = job.targetReleaseChannel;
    if (
      (channel === 'candidate' || channel === 'stable') &&
      !refs.some((ref) => ref.kind === 'certification')
    ) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.UNRESOLVED_ARTIFACT, {
        message: `target release channel ${JSON.stringify(channel)} requires a certification output ref (A024 channel grant requirements: ${CHANNEL_GRANT_REQUIREMENTS[channel].join(', ')})`,
        details: { jobId, channel, requiredKinds: ['certification'] },
      });
    }

    const outputs = Object.freeze([caseRef, ...refs]);
    const artifactDigests = normalizeArtifactDigests(outputs.map((ref) => ref.digest));
    const next = transitionEpochJob(job, 'succeeded', {
      updatedAt: this.clock(),
      outputs,
      artifactDigests,
    });
    this.store(next);
    return next;
  }

  failJob(jobId: string, failure: { code: string; message: string }): EpochJobRecord {
    if (typeof failure.code !== 'string' || failure.code.length === 0) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
        message: 'job failure requires a non-empty error code',
      });
    }
    if (typeof failure.message !== 'string' || failure.message.length === 0) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
        message: 'job failure requires a non-empty message',
      });
    }
    const job = this.requireJob(jobId);
    const next = transitionEpochJob(job, 'failed', {
      updatedAt: this.clock(),
      failure: Object.freeze({ code: failure.code, message: failure.message }),
    });
    this.store(next);
    return next;
  }

  cancelJob(jobId: string): EpochJobRecord {
    const job = this.requireJob(jobId);
    const next = transitionEpochJob(job, 'cancelled', { updatedAt: this.clock() });
    this.store(next);
    return next;
  }

  getJob(jobId: string): EpochJobRecord | null {
    const key = this.keyByJobId.get(jobId);
    if (key === undefined) return null;
    return this.jobsByKey.get(key) ?? null;
  }

  listJobs(): readonly EpochJobRecord[] {
    return Object.freeze([...this.jobsByKey.values()]);
  }

  /** The job-completed event envelope for a terminal job (kind 'event'). */
  jobCompletedEvent(jobId: string): Envelope<EpochJobRecord> {
    const job = this.requireJob(jobId);
    if (job.status !== 'succeeded' && job.status !== 'failed') {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_LIFECYCLE, {
        message: `job-completed events are only emitted for terminal succeeded/failed jobs (job is ${job.status})`,
        details: { jobId, status: job.status },
      });
    }
    return makeJobCompletedEvent(job, {
      correlationId: job.submission.correlationId,
    });
  }

  // -------------------------------------------------------------------------
  // Arena → Epoch: resolve output refs through the A025 read surface
  // -------------------------------------------------------------------------

  /**
   * Resolve an EPI1.0 output ref against the Arena public read surface.
   * The three queryable kinds round-trip through the ArenaApiClient's
   * envelope discipline; not-found is a VALUE (null), never an error.
   * Kinds the A025 surface does not yet expose resolve to null
   * (disclosed limitation — carried validated, awaiting a future surface).
   */
  async resolveOutputRef(ref: EpochOutputRef): Promise<unknown> {
    if (!isEpochOutputRef(ref)) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF, {
        message: 'resolveOutputRef requires a valid EPI1.0 output ref',
      });
    }
    if (!isQueryableEpochOutputRefKind(ref.kind)) {
      return null;
    }
    if (ref.kind === 'agent-body-version') {
      return this.client.getBodyVersion(ref.digest);
    }
    if (ref.kind === 'compatibility-report') {
      return this.client.getCompatibilityRecord(ref.digest);
    }
    return this.client.getCertificationRecord(ref.digest);
  }

  reportHealth(): EpochAdapterHealthReport {
    return Object.freeze({
      adapterId: EPOCH_ADAPTER_ID,
      adapterVersion: this.adapterVersion,
      protocol: EPOCH_ADAPTER_PROTOCOL_LABEL,
      jobs: this.jobsByKey.size,
      ok: true,
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireJob(jobId: string): EpochJobRecord {
    const key = this.keyByJobId.get(jobId);
    const job = key !== undefined ? this.jobsByKey.get(key) : undefined;
    if (job === undefined) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.JOB_NOT_FOUND, {
        message: `no epoch job with id ${JSON.stringify(jobId)}`,
        details: { jobId },
      });
    }
    return job;
  }

  private store(job: EpochJobRecord): void {
    const key = epochJobSubmissionKey(job);
    this.jobsByKey.set(key, job);
    this.keyByJobId.set(job.jobId, key);
  }
}

/** Construct the provider-neutral Epoch adapter. */
export function createEpochAdapter(config: EpochAdapterConfig): EpochAdapter {
  return new EpochAdapter(config);
}
