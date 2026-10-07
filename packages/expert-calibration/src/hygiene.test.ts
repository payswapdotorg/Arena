/**
 * Hygiene tests (Work Order C004): the authority/PII field-name screen,
<arg_value>closed vocabularies and envelope validation.
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { screenFieldNames } from './shared.js';
import { EXPERT_CALIBRATION_ERROR_CODES, ExpertCalibrationError } from './errors.js';
import { makeRegisterProgramCommand, makeVerdictDerivedEvent } from './envelopes.js';

const CORR = toCorrelationId('corr-1');
const KEY = toIdempotencyKey('key-1');

describe('screenFieldNames (lock rule 9 — masquerade defense at the data boundary)', () => {
  it('rejects authority-shaped field names at any depth', () => {
    expect(() => screenFieldNames({ permission: 'grant' }, 'payload')).toThrow(ExpertCalibrationError);
    expect(() => screenFieldNames({ nested: { adminFlag: true } }, 'payload')).toThrow(
      ExpertCalibrationError,
    );
    expect(() => screenFieldNames([{ authorized: 'yes' }], 'payload')).toThrow(ExpertCalibrationError);
  });

  it('rejects PII-shaped field names', () => {
    expect(() => screenFieldNames({ email: 'x' }, 'payload')).toThrow(ExpertCalibrationError);
  });

  it('admits neutral calibration field names', () => {
    expect(() =>
      screenFieldNames({ verdict: 'calibrated', freshDecidedCount: 3 }, 'payload'),
    ).not.toThrow();
  });

  it('carries the MASQUERADE_REJECTED code for authority-shaped fields', () => {
    try {
      screenFieldNames({ clearance: 'high' }, 'payload');
      expect.unreachable('authority-shaped fields must fail closed');
    } catch (error) {
      expect((error as ExpertCalibrationError).code).toBe(
        EXPERT_CALIBRATION_ERROR_CODES.MASQUERADE_REJECTED,
      );
    }
  });
});

describe('envelopes', () => {
  it('commands require a valid idempotency-keyed payload (malformed ids fail closed)', () => {
    expect(() =>
      makeRegisterProgramCommand(
        { programId: 'NOT_KEBAB', tenant: 't', seed: 's', at: '2026-10-01T00:00:00.000Z' },
        { correlationId: CORR, idempotencyKey: KEY },
      ),
    ).toThrow(ExpertCalibrationError);
  });

  it('events validate the closed verdict vocabulary', () => {
    expect(() =>
      makeVerdictDerivedEvent(
        {
          verdictId: 'cal-verdict-1',
          programDigest: 'a'.repeat(64),
          expertId: 'expert-1',
          verdict: 'sorta-calibrated',
          freshDecidedCount: 1,
          at: '2026-10-01T00:00:00.000Z',
        },
        { correlationId: CORR },
      ),
    ).toThrow(ExpertCalibrationError);
    const envelope = makeVerdictDerivedEvent(
      {
        verdictId: 'cal-verdict-1',
        programDigest: 'a'.repeat(64),
        expertId: 'expert-1',
        verdict: 'calibrated',
        freshDecidedCount: 1,
        at: '2026-10-01T00:00:00.000Z',
      },
      { correlationId: CORR },
    );
    expect(envelope.kind).toBe('event');
    expect(envelope.schema).toContain('expert-calibration/verdict-derived-event@1.0.0');
  });
});
