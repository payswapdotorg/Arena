/**
 * Hygiene tests (Work Order C005): the authority/PII field-name screen,
 * envelope validation and the no-score-shaped-wire defense.
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { screenFieldNames } from './shared.js';
import { EXPERT_PERFORMANCE_ERROR_CODES, ExpertPerformanceError } from './errors.js';
import {
  EXPERT_PERFORMANCE_SCHEMAS,
  makeAppendEvidenceCommand,
  makeEvidenceAppendedEvent,
  makeGetDimensionAggregateQuery,
  makeGetRoutingInputQuery,
  makeGetRoutingInputResponse,
} from './envelopes.js';

const CORR = toCorrelationId('corr-1');
const KEY = toIdempotencyKey('key-1');
const DIGEST = 'a'.repeat(64);

describe('screenFieldNames (lock rule 9 — masquerade defense at the data boundary)', () => {
  it('rejects authority-shaped field names at any depth', () => {
    expect(() => screenFieldNames({ permission: 'grant' }, 'payload')).toThrow(
      ExpertPerformanceError,
    );
    expect(() => screenFieldNames({ nested: { adminFlag: true } }, 'payload')).toThrow(
      ExpertPerformanceError,
    );
    expect(() => screenFieldNames([{ authorized: 'yes' }], 'payload')).toThrow(
      ExpertPerformanceError,
    );
  });

  it('rejects PII-shaped field names', () => {
    expect(() => screenFieldNames({ email: 'x' }, 'payload')).toThrow(ExpertPerformanceError);
  });

  it('admits neutral performance field names', () => {
    expect(() =>
      screenFieldNames({ dimension: 'recency', outcome: 'active', sampleSize: 2 }, 'payload'),
    ).not.toThrow();
  });

  it('carries the MASQUERADE_REJECTED code for authority-shaped fields', () => {
    try {
      screenFieldNames({ clearance: 'high' }, 'payload');
      expect.unreachable('authority-shaped fields must fail closed');
    } catch (error) {
      expect((error as ExpertPerformanceError).code).toBe(
        EXPERT_PERFORMANCE_ERROR_CODES.MASQUERADE_REJECTED,
      );
    }
  });
});

describe('envelopes', () => {
  it('commands require a valid idempotency-keyed payload (malformed ids fail closed)', () => {
    expect(() =>
      makeAppendEvidenceCommand(
        {
          recordId: 'NOT-PERF',
          tenant: 'tenant-1',
          expertId: 'expert-1',
          family: 'skill-extraction-outcome',
          dimension: 'skill-competency',
          refDigest: DIGEST,
          at: '2026-10-01T00:00:00.000Z',
        },
        { correlationId: CORR, idempotencyKey: KEY },
      ),
    ).toThrow(ExpertPerformanceError);
    const envelope = makeAppendEvidenceCommand(
      {
        recordId: 'perf-001',
        tenant: 'tenant-1',
        expertId: 'expert-1',
        family: 'skill-extraction-outcome',
        dimension: 'skill-competency',
        refDigest: DIGEST,
        at: '2026-10-01T00:00:00.000Z',
      },
      { correlationId: CORR, idempotencyKey: KEY },
    );
    expect(envelope.kind).toBe('command');
    expect(envelope.idempotencyKey).toBe(KEY);
    expect(envelope.schema).toContain('expert-performance/append-evidence-command@1.0.0');
  });

  it('queries are pure reads (no idempotency key) with closed dimension validation', () => {
    const query = makeGetRoutingInputQuery(
      { tenant: 'tenant-1', expertId: 'expert-1', at: '2026-10-01T00:00:00.000Z' },
      { correlationId: CORR },
    );
    expect(query.kind).toBe('query');
    expect(query.idempotencyKey).toBeNull();

    expect(() =>
      makeGetDimensionAggregateQuery(
        { tenant: 'tenant-1', expertId: 'expert-1', dimension: 'all-dimensions', at: '2026-10-01T00:00:00.000Z' },
        { correlationId: CORR },
      ),
    ).toThrow(ExpertPerformanceError);
  });

  it('events validate the closed attribution vocabulary', () => {
    expect(() =>
      makeEvidenceAppendedEvent(
        {
          recordId: 'perf-001',
          tenant: 'tenant-1',
          expertId: 'expert-1',
          dimension: 'skill-competency',
          outcome: 'demonstrated',
          attributionKind: 'vibe-change',
          recordDigest: DIGEST,
          at: '2026-10-01T00:00:00.000Z',
        },
        { correlationId: CORR },
      ),
    ).toThrow(ExpertPerformanceError);
  });

  it('response payloads validate the eight-dimension routing shape', () => {
    expect(() =>
      makeGetRoutingInputResponse(
        {
          tenant: 'tenant-1',
          expertId: 'expert-1',
          asOf: '2026-10-01T00:00:00.000Z',
          profileDigest: DIGEST,
          dimensions: [],
        },
        { correlationId: CORR },
      ),
    ).toThrow(ExpertPerformanceError);
  });

  it('owns a closed schema registry with NO score-shaped schema', () => {
    const names = Object.keys(EXPERT_PERFORMANCE_SCHEMAS);
    expect(names.length).toBeGreaterThanOrEqual(11);
    for (const name of names) {
      expect(name.includes('global-score')).toBe(false);
      expect(name.includes('overall-score')).toBe(false);
      expect(name.includes('expert-rating')).toBe(false);
    }
  });
});
