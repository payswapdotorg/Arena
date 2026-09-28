/**
 * EnvironmentEventLog — the structured, append-only, observable event
 * stream of environment runs (Work Order A010 gate 7; requirement R33 —
 * observability for jobs, environments and certification runs).
 *
 * The log is the DURABLE SOURCE OF TRUTH: every lifecycle transition,
 * admission decision, checkpoint record, workload step and cleanup is
 * appended as an enveloped RuntimeEvent (gate 4 — Envelope<RuntimeEvent>
 * with correlation id + idempotency key) and NEVER rewritten.
 *
 * Append invariants (enforced at the boundary, mirrored by the
 * run-state fold):
 *   - payloads are structurally valid runtime events;
 *   - per-run sequences are exactly 1..n, contiguous (gap / duplicate /
 *     regression rejected);
 *   - the first event of every run is `run-submitted`;
 *   - event kinds follow the closed adjacency (nextRuntimeEventKinds)
 *     PLUS the terminal-aware rule: after a transition into an outcome
 *     state only the run result and the cleanup transition may follow;
 *     after `cleaned` NOTHING may follow;
 *   - per-run timestamps are monotonically non-decreasing;
 *   - an event's tenant must match its run id's tenant half.
 *
 * Queries are PURE functions over the frozen log (mirroring
 * @arena/capability-graph's query conventions): by run, by tenant, by
 * state (see queries.ts for the run-state projections).
 */

import type { Envelope } from '@arena/protocol-core';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import type { RuntimeEvent, RuntimeEventKind } from './events.js';
import { isRuntimeEvent, nextRuntimeEventKinds } from './events.js';
import { isRunOutcomeState } from './lifecycle.js';
import { runIdTenant } from './run-id.js';
import { isRunId } from './shared.js';
import type { RunId } from './shared.js';

/** The append-only, cross-run environment event log (frozen snapshots). */
export interface EnvironmentEventLog {
  readonly entries: readonly Envelope<RuntimeEvent>[];
}

export function createEnvironmentEventLog(): EnvironmentEventLog {
  return Object.freeze({ entries: Object.freeze([]) });
}

/** Structural (non-throwing) check for a whole log. */
export function isEnvironmentEventLog(value: unknown): value is EnvironmentEventLog {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['entries']) &&
    candidate['entries'].every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        isRuntimeEvent((entry as { payload: unknown }).payload),
    )
  );
}

interface RunTail {
  readonly count: number;
  readonly lastKind: RuntimeEventKind;
  readonly lastOccurredAt: string;
  /** State after the last transition event (`null` before the first). */
  readonly lastTransitionTo: string | null;
}

/** Compute the per-run tail index of a log (pure). */
function runTails(log: EnvironmentEventLog): Map<string, RunTail> {
  const tails = new Map<string, RunTail>();
  for (const envelope of log.entries) {
    const payload = envelope.payload;
    const current: RunTail = {
      count: (tails.get(payload.runId)?.count ?? 0) + 1,
      lastKind: payload.kind,
      lastOccurredAt: payload.occurredAt,
      lastTransitionTo:
        payload.kind === 'state-transitioned'
          ? payload.to
          : (tails.get(payload.runId)?.lastTransitionTo ?? null),
    };
    tails.set(payload.runId, current);
  }
  return tails;
}

/**
 * Validate + append: returns a NEW frozen log; the input log is never
 * modified. Enforces every invariant documented on the module.
 */
export function appendRuntimeEventEnvelope(
  log: EnvironmentEventLog,
  envelope: Envelope<RuntimeEvent>,
): EnvironmentEventLog {
  if (typeof envelope !== 'object' || envelope === null) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'environment event log appends require an envelope object',
    });
  }
  const payload = envelope.payload;
  if (!isRuntimeEvent(payload)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'environment event log appends require a structurally valid runtime event payload',
    });
  }
  if (envelope.kind !== 'event') {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: `environment event log appends require event envelopes, got kind '${envelope.kind}'`,
    });
  }
  if (payload.tenantId !== runIdTenant(payload.runId)) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.TENANT_ISOLATION_VIOLATION,
      {
        message: `event tenant ${JSON.stringify(payload.tenantId)} does not match its run id's tenant ${JSON.stringify(runIdTenant(payload.runId))} (tenant-scoped streams)`,
        details: { runId: payload.runId, tenant: payload.tenantId },
      },
    );
  }
  const tail = runTails(log).get(payload.runId);
  const expected = (tail?.count ?? 0) + 1;
  if (payload.sequence < expected) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_SEQUENCE_DUPLICATE,
      {
        message: `event sequence ${String(payload.sequence)} duplicates or regresses behind the expected next sequence ${String(expected)} (append-only logs never rewrite history)`,
        details: { expected, actual: payload.sequence, kind: payload.kind, runId: payload.runId },
      },
    );
  }
  if (payload.sequence > expected) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_SEQUENCE_GAP, {
      message: `event sequence ${String(payload.sequence)} leaves a gap before the expected next sequence ${String(expected)} (per-run sequences must be contiguous and monotonically increasing)`,
      details: { expected, actual: payload.sequence, kind: payload.kind, runId: payload.runId },
    });
  }
  if (tail === undefined) {
    if (payload.kind !== 'run-submitted') {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_OUT_OF_ORDER, {
        message: `a run event stream must start with run-submitted, got ${payload.kind}`,
        details: { attemptedKind: payload.kind, runId: payload.runId },
      });
    }
  } else {
    // Terminal-aware adjacency: after `cleaned` nothing may follow;
    // after an outcome transition only the result / cleanup transition.
    if (tail.lastTransitionTo === 'cleaned') {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_OUT_OF_ORDER, {
        message: `run ${payload.runId} is cleaned — nothing may be appended after cleanup`,
        details: { attemptedKind: payload.kind, runId: payload.runId },
      });
    }
    if (
      isRunOutcomeState(tail.lastTransitionTo) &&
      payload.kind !== 'run-result-produced' &&
      payload.kind !== 'state-transitioned'
    ) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_OUT_OF_ORDER, {
        message: `run ${payload.runId} is in outcome state '${tail.lastTransitionTo}' — only the run result or the cleanup transition may follow, got ${payload.kind}`,
        details: { attemptedKind: payload.kind, status: tail.lastTransitionTo, runId: payload.runId },
      });
    }
    const allowed = nextRuntimeEventKinds(tail.lastKind);
    if (!allowed.includes(payload.kind)) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_OUT_OF_ORDER, {
        message: `event kind ${payload.kind} cannot follow ${tail.lastKind} (out-of-order append rejected; allowed next: ${allowed.join(', ') || 'nothing (terminal)'})`,
        details: { lastKind: tail.lastKind, attemptedKind: payload.kind, allowed: [...allowed], runId: payload.runId },
      });
    }
    if (tail.lastOccurredAt > payload.occurredAt) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_OUT_OF_ORDER, {
        message: `event timestamps must be monotonically non-decreasing (last: ${tail.lastOccurredAt}, attempted: ${payload.occurredAt})`,
        details: { last: tail.lastOccurredAt, attempted: payload.occurredAt, runId: payload.runId },
      });
    }
  }
  return Object.freeze({
    entries: Object.freeze([...log.entries, envelope]),
  });
}

/**
 * Re-validate an entire log (contiguity, adjacency, monotonic
 * timestamps, tenant scoping, structural payloads). Throws on any
 * violation — the verification entry point for persisted logs.
 */
export function verifyEnvironmentEventLog(log: EnvironmentEventLog): void {
  if (!isEnvironmentEventLog(log)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'environment event log verification requires a structurally valid log',
    });
  }
  let reconstructed = createEnvironmentEventLog();
  for (const envelope of log.entries) {
    reconstructed = appendRuntimeEventEnvelope(reconstructed, envelope);
  }
  if (reconstructed.entries.length !== log.entries.length) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_OUT_OF_ORDER, {
      message: 'environment event log revalidation mismatch',
    });
  }
}

/** All events of one run, in sequence order (pure query). */
export function eventsForRun(
  log: EnvironmentEventLog,
  runId: string,
): readonly Envelope<RuntimeEvent>[] {
  if (!isRunId(runId)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_ID, {
      message: `eventsForRun: invalid tenant-scoped run id: ${JSON.stringify(runId)}`,
    });
  }
  return Object.freeze(log.entries.filter((envelope) => envelope.payload.runId === runId));
}

/** All events of one tenant, in append order (pure query). */
export function eventsForTenant(
  log: EnvironmentEventLog,
  tenantId: string,
): readonly Envelope<RuntimeEvent>[] {
  return Object.freeze(
    log.entries.filter((envelope) => envelope.payload.tenantId === tenantId),
  );
}

/** All transition events that ENTERED a given state (pure query). */
export function eventsEnteringState(
  log: EnvironmentEventLog,
  state: string,
): readonly Envelope<RuntimeEvent>[] {
  return Object.freeze(
    log.entries.filter(
      (envelope) =>
        envelope.payload.kind === 'state-transitioned' && envelope.payload.to === state,
    ),
  );
}

/** Every run id the log knows about, in first-appearance order (pure query). */
export function loggedRunIds(log: EnvironmentEventLog): readonly RunId[] {
  const seen: string[] = [];
  for (const envelope of log.entries) {
    if (!seen.includes(envelope.payload.runId)) seen.push(envelope.payload.runId);
  }
  return Object.freeze(seen as RunId[]);
}
