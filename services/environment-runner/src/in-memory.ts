/**
 * In-memory port implementations for tests and the reference demo
 * (Work Order A010 gate 10) — zero external infrastructure, mirroring
 * services/job-orchestrator's in-memory.ts.
 *
 *   - ManualClock / SystemClock — deterministic and wall-clock time;
 *   - InMemoryEnvironmentRegistry — content-addressed environment
 *     definitions (A009), registered by digest;
 *   - InMemoryRunRecordStore — run submissions with the idempotent
 *     submission index;
 *   - InMemoryEventSink — the append-only EnvironmentEventLog (per-run
 *     ordering enforced by the protocol's log at the persistence
 *     boundary).
 */

import type { Envelope } from '@arena/protocol-core';
import type { EnvironmentDefinition } from '@arena/environment-protocol';
import {
  appendRuntimeEventEnvelope,
  createEnvironmentEventLog,
  EnvironmentRuntimeError,
  ENVIRONMENT_RUNTIME_ERROR_CODES,
} from '@arena/environment-runtime';
import type { EnvironmentEventLog, RunRecord, RuntimeEvent } from '@arena/environment-runtime';
import type {
  Clock,
  EnvironmentRegistry,
  EventSink,
  RunRecordStore,
  RunSubmission,
} from './ports.js';

/** Deterministic clock for tests and the demo (epoch ms). */
export class ManualClock implements Clock {
  private current: number;

  constructor(startMs: number) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError('advance requires ms >= 0');
    this.current += ms;
  }

  set(ms: number): void {
    this.current = ms;
  }
}

/** Wall-clock time (production default). */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** Content-addressed environment registry (digest → definition). */
export class InMemoryEnvironmentRegistry implements EnvironmentRegistry {
  private readonly byDigest = new Map<string, EnvironmentDefinition>();

  async register(definition: EnvironmentDefinition): Promise<void> {
    const existing = this.byDigest.get(definition.digest);
    if (existing !== undefined && existing.digest === definition.digest) {
      // Idempotent re-registration of the SAME content is a no-op;
      // a digest collision with different content is impossible by
      // construction (sha256 over the canonical view).
      return;
    }
    this.byDigest.set(definition.digest, definition);
  }

  async findByDigest(digest: string): Promise<EnvironmentDefinition | undefined> {
    return this.byDigest.get(digest);
  }
}

/** Run submissions with the idempotent submission index. */
export class InMemoryRunRecordStore implements RunRecordStore {
  private readonly byRunId = new Map<string, RunSubmission>();
  private readonly bySubmissionKey = new Map<string, RunSubmission>();

  async insert(submission: RunSubmission): Promise<void> {
    if (this.byRunId.has(submission.record.runId)) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `run id ${JSON.stringify(submission.record.runId)} is already submitted (run ids are unique per tenant)`,
        details: { runId: submission.record.runId },
      });
    }
    this.byRunId.set(submission.record.runId, submission);
  }

  async get(runId: string): Promise<RunSubmission | undefined> {
    return this.byRunId.get(runId);
  }

  async findByIdempotencyKey(submissionKey: string): Promise<RunSubmission | undefined> {
    return this.bySubmissionKey.get(submissionKey);
  }

  async bindSubmissionKey(submissionKey: string, submission: RunSubmission): Promise<void> {
    const existing = this.bySubmissionKey.get(submissionKey);
    if (existing !== undefined && existing.record.digest !== submission.record.digest) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `idempotency key ${JSON.stringify(submissionKey)} is already bound to a different run record digest (lock rule 17: conflicting re-submissions are rejected)`,
        details: {
          submissionKey,
          existingDigest: existing.record.digest,
          attemptedDigest: submission.record.digest,
        },
      });
    }
    this.bySubmissionKey.set(submissionKey, submission);
  }

  async list(): Promise<readonly RunSubmission[]> {
    return Object.freeze([...this.byRunId.values()]);
  }
}

/** The append-only EnvironmentEventLog at the persistence boundary. */
export class InMemoryEventSink implements EventSink {
  private current: EnvironmentEventLog = createEnvironmentEventLog();

  async append(envelope: Envelope<RuntimeEvent>): Promise<void> {
    this.current = appendRuntimeEventEnvelope(this.current, envelope);
  }

  async log(): Promise<EnvironmentEventLog> {
    return this.current;
  }
}

/** Convenience record type re-export for callers building stores. */
export type { RunSubmission, RunRecord };
