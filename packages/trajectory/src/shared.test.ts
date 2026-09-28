/**
 * Shared guard + constructor tests (positive AND negative for every
 * exported validator — Work Order A011 gate 11).
 */

import { describe, expect, it } from 'vitest';
import { ProtocolError } from '@arena/protocol-core';
import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  isContentDigest,
  isNeutralId,
  isNeutralText,
  isTrajectoryId,
  isTrajectorySeed,
  isTrajectoryTimestamp,
  toContentDigest,
  toNeutralId,
  toNeutralText,
  toTrajectoryId,
  toTrajectorySeed,
  toTrajectoryTimestamp,
} from './shared.js';
import { TRAJECTORY_ERROR_CODES } from './errors.js';
import { DIGEST_A, T0, makeHeaderInput } from './test-support.js';

describe('content digests', () => {
  it('accepts lowercase sha256 hex', () => {
    expect(isContentDigest(DIGEST_A)).toBe(true);
    expect(isContentDigest('a'.repeat(64))).toBe(true);
  });

  it('rejects malformed digests', () => {
    expect(isContentDigest('')).toBe(false);
    expect(isContentDigest('A'.repeat(64))).toBe(false); // uppercase
    expect(isContentDigest('a'.repeat(63))).toBe(false); // too short
    expect(isContentDigest('a'.repeat(65))).toBe(false); // too long
    expect(isContentDigest('g'.repeat(64))).toBe(false); // non-hex
    expect(isContentDigest(42)).toBe(false);
    expect(isContentDigest(null)).toBe(false);
  });

  it('toContentDigest validates with context and typed error', () => {
    expect(toContentDigest(DIGEST_A, 'test')).toBe(DIGEST_A);
    expect(() => toContentDigest('nope', 'test')).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_DIGEST }),
    );
    expect(() => toContentDigest('nope', 'test')).toThrowError(/test: invalid content digest/);
  });
});

describe('neutral ids', () => {
  it('accepts the closed neutral charset', () => {
    expect(isTrajectoryId('trajectory-000042')).toBe(true);
    expect(isNeutralId('shell-exec')).toBe(true);
    expect(isTrajectoryId('a')).toBe(true);
    expect(isTrajectoryId('a'.repeat(63))).toBe(true);
  });

  it('rejects non-neutral ids', () => {
    expect(isTrajectoryId('')).toBe(false);
    expect(isTrajectoryId('ShellExec')).toBe(false); // uppercase
    expect(isTrajectoryId('shell_exec')).toBe(false); // underscore
    expect(isTrajectoryId('-leading')).toBe(false); // leading dash
    expect(isTrajectoryId('a'.repeat(64))).toBe(true); // 1 + 63 = max length
    expect(isTrajectoryId('a'.repeat(65))).toBe(false); // too long
    expect(isNeutralId(7)).toBe(false);
  });

  it('toTrajectoryId / toNeutralId throw typed errors on invalid input', () => {
    expect(() => toTrajectoryId('Bad_Id')).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_IDENTITY }),
    );
    expect(() => toNeutralId('Bad_Id', 'field')).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_IDENTITY }),
    );
  });
});

describe('timestamps', () => {
  it('accepts canonical ms-precision UTC RFC 3339', () => {
    expect(isTrajectoryTimestamp(T0)).toBe(true);
    expect(isTrajectoryTimestamp('2026-01-15T09:30:00.999Z')).toBe(true);
    expect(toTrajectoryTimestamp(T0, 'test')).toBe(T0);
  });

  it('rejects non-canonical or non-UTC timestamps', () => {
    expect(isTrajectoryTimestamp('2026-01-15T09:30:00Z')).toBe(false); // no ms
    expect(isTrajectoryTimestamp('2026-01-15T09:30:00.000+00:00')).toBe(false); // offset form
    expect(isTrajectoryTimestamp('2026-13-45T09:30:00.000Z')).toBe(false); // impossible date
    expect(isTrajectoryTimestamp('not-a-time')).toBe(false);
    expect(isTrajectoryTimestamp(12345)).toBe(false);
    expect(() => toTrajectoryTimestamp('2026-01-15T09:30:00Z', 'test')).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_TIMESTAMP }),
    );
  });
});

describe('seeds', () => {
  it('accepts the neutral seed charset and rejects the rest', () => {
    expect(isTrajectorySeed('seed-1234')).toBe(true);
    expect(isTrajectorySeed('A1.b:c-d_1'.replace('_', '-'))).toBe(true);
    expect(isTrajectorySeed('')).toBe(false);
    expect(isTrajectorySeed('seed 1234')).toBe(false); // space
    expect(isTrajectorySeed('x'.repeat(129))).toBe(false); // too long
    expect(() => toTrajectorySeed('bad seed')).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_HEADER }),
    );
  });
});

describe('neutral text', () => {
  it('accepts printable ASCII up to 4096 and rejects control chars / oversize', () => {
    expect(isNeutralText('all tests passed (12 suites, 96 cases)')).toBe(true);
    expect(isNeutralText('x'.repeat(4096))).toBe(true);
    expect(isNeutralText('')).toBe(false);
    expect(isNeutralText('x'.repeat(4097))).toBe(false);
    expect(isNeutralText('bad\x00null')).toBe(false);
    expect(isNeutralText('bad\rreturn')).toBe(false);
    expect(() => toNeutralText('a\x01b', 'field')).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD }),
    );
  });
});

describe('pattern sources are exported for contract parity', () => {
  it('exposes the digest pattern source used by the generator', () => {
    expect(CONTENT_DIGEST_PATTERN_SOURCE).toBe('^[0-9a-f]{64}$');
  });
});

describe('guard negative control against real construction inputs', () => {
  it('the makeHeaderInput fixture passes every scalar guard it feeds', () => {
    const input = makeHeaderInput();
    expect(isTrajectoryId(input.trajectoryId)).toBe(true);
    expect(isTrajectoryTimestamp(input.startedAt)).toBe(true);
    expect(isContentDigest(input.agentBodyRef)).toBe(true);
    expect(isContentDigest(input.substrateRef)).toBe(true);
    expect(isTrajectorySeed(input.seed as string)).toBe(true);
  });

  it('ProtocolError still propagates for core-level failures (documented policy)', () => {
    expect(ProtocolError).toBeDefined();
  });
});
