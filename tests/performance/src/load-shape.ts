/**
 * Deterministic load shapes over the reference Arena api fabric
 * (A025): the request stream a release must survive.
 *
 * Every request is a REAL wire message: a serialized api-query-request
 * envelope (`list-release-records` over the public tenant scope)
 * handled by the real `ApiService`. Malformed requests — valid JSON
 * that fails strict envelope parsing — model client faults; the
 * fabric must reject them (fail-closed), which consumes error
 * budget.
 *
 * The request ORDER of malformed entries is derived from the seed: a
 * pure function of (shapeId, seed) — never ambient, never clock.
 */

import {
  apiQueryRequest,
  toApiReadScope,
  PUBLIC_TENANT,
} from '@arena/arena-sdk';
import { serializeEnvelope } from '@arena/protocol-core';
import { ApiService } from '@arena/api-fabric';
import { intBetween, mulberry32 } from './rng.js';
import { PERF_ERROR_CODES, PerfError, isLoadShapeId } from './shared.js';
import type { LoadShapeId } from './shared.js';

/** One planned request of a load shape. */
export interface PlannedRequest {
  readonly index: number;
  readonly correlationId: string;
  /** Serialized wire message (valid or malformed by design). */
  readonly raw: string;
  readonly malformed: boolean;
}

/** A deterministic load shape. */
export interface LoadShape {
  readonly shapeVersion: 1;
  readonly shapeId: LoadShapeId;
  readonly seed: number;
  readonly totalRequests: number;
  /** Number of malformed requests injected (chosen by shape). */
  readonly malformedCount: number;
}

/** The frozen evaluation window every run uses (logical time). */
export const WINDOW_START = 1_791_232_000_000;

const SHAPE_TABLE: Readonly<Record<LoadShapeId, { total: number; malformed: number }>> = {
  // 120 valid requests: ≥ minSampleCount 100 of slo-console-availability.
  'steady-baseline': { total: 120, malformed: 0 },
  // 6 malformed of 120 → observed bad ratio 0.05 ≫ allowed 0.005: breach.
  'fault-injection': { total: 120, malformed: 6 },
  // 20 requests < minSampleCount 100 → no-data → fail-closed.
  'sparse-no-data': { total: 20, malformed: 0 },
};

/** Build the canonical load shape for an id (deterministic). */
export function loadShape(shapeId: LoadShapeId, seed: number): LoadShape {
  if (!isLoadShapeId(shapeId)) {
    throw new PerfError(
      PERF_ERROR_CODES.INVALID_LOAD_SHAPE,
      `unknown load shape: ${String(shapeId)}`,
    );
  }
  const entry = SHAPE_TABLE[shapeId];
  return {
    shapeVersion: 1,
    shapeId,
    seed,
    totalRequests: entry.total,
    malformedCount: entry.malformed,
  };
}

/** A deliberately malformed wire message (fails strict parsing). */
function malformedRaw(correlationId: string): string {
  // Valid JSON, but the payload omits the REQUIRED read scope —
  // strict envelope parsing must reject it (fail-closed).
  return JSON.stringify({
    envelopeVersion: 1,
    kind: 'query',
    schema: 'api-query-request.v1',
    messageId: `msg-${correlationId}`,
    correlationId,
    idempotencyKey: null,
    issuedAt: WINDOW_START,
    payload: {
      requestVersion: 1,
      kind: 'list-release-records',
      params: {},
      // scope: MISSING on purpose.
    },
  });
}

/** Build the full deterministic request stream for a shape. */
export function buildLoad(shape: LoadShape): readonly PlannedRequest[] {
  const rng = mulberry32(shape.seed);
  const service = new ApiService();
  const malformedIndexes = new Set<number>();
  while (malformedIndexes.size < shape.malformedCount) {
    malformedIndexes.add(intBetween(rng, 0, shape.totalRequests));
  }
  const requests: PlannedRequest[] = [];
  for (let i = 0; i < shape.totalRequests; i += 1) {
    const correlationId = `perf-${shape.shapeId}-${shape.seed}-${i}`;
    const malformed = malformedIndexes.has(i);
    if (malformed) {
      requests.push({ index: i, correlationId, raw: malformedRaw(correlationId), malformed: true });
    } else {
      const payload = apiQueryRequest('list-release-records', {}, toApiReadScope(PUBLIC_TENANT));
      const envelope = service.makeQuery(payload, correlationId);
      requests.push({
        index: i,
        correlationId,
        raw: serializeEnvelope(envelope),
        malformed: false,
      });
    }
  }
  return requests;
}
