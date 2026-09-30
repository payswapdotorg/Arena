import { describe, expect, it } from 'vitest';
import {
  EPOCH_OUTPUT_REF_KINDS,
  EPOCH_OUTPUT_REF_VERSION,
  epochOutputRefFromBodyVersion,
  epochOutputRefKey,
  isEpochOutputRef,
  isEpochOutputRefKind,
  isQueryableEpochOutputRefKind,
  toEpochOutputRef,
} from './refs.js';
import { isEpochAdapterError } from './errors.js';
import { EPOCH_ADAPTER_ERROR_CODES } from './errors.js';
import { buildOutputRef, DIGESTS } from './test-support.js';

const VALID = buildOutputRef(
  'certification',
  DIGESTS.certification,
  `arena:certification/${DIGESTS.certification}`,
);

describe('epoch adapter — EPI1.0 output refs', () => {
  it('validates and freezes a well-formed ref', () => {
    const ref = toEpochOutputRef(VALID);
    expect(ref.kind).toBe('certification');
    expect(ref.digest).toBe(DIGESTS.certification);
    expect(Object.isFrozen(ref)).toBe(true);
    expect(isEpochOutputRef(ref)).toBe(true);
  });

  it('exposes exactly the spec\'s eleven Arena-output ref kinds', () => {
    expect(EPOCH_OUTPUT_REF_KINDS).toHaveLength(11);
    expect([...EPOCH_OUTPUT_REF_KINDS]).toEqual([
      'capability-case',
      'task-spec',
      'environment',
      'expert-work',
      'trajectory-set',
      'evaluator',
      'verifier',
      'skill-artifact',
      'agent-body-version',
      'compatibility-report',
      'certification',
    ]);
    expect(isEpochOutputRefKind('capability-case')).toBe(true);
    expect(isEpochOutputRefKind('world-model')).toBe(false);
  });

  it('content-addresses refs by kind + digest (A002 discipline)', () => {
    const ref = toEpochOutputRef(VALID);
    expect(epochOutputRefKey(ref)).toBe(`epoch-output/certification#${DIGESTS.certification}`);
  });

  it('cites an A003 body version as the AgentBodyVersionRef', () => {
    const ref = epochOutputRefFromBodyVersion({
      tenant: 'acme',
      name: 'structural-engineer',
      version: '1.2.0',
      digest: DIGESTS.bodyVersion,
    });
    expect(ref.kind).toBe('agent-body-version');
    expect(ref.address).toBe(`acme/structural-engineer@1.2.0#${DIGESTS.bodyVersion}`);
  });

  it('rejects unknown ref kinds (closed vocabulary)', () => {
    expect(() =>
      toEpochOutputRef(buildOutputRef('world-model', DIGESTS.certification, 'arena:x')),
    ).toThrow(/unknown epoch output ref kind/);
  });

  it('rejects non-hex and short digests', () => {
    expect(() =>
      toEpochOutputRef(buildOutputRef('certification', 'XYZ', 'arena:x')),
    ).toThrow(/digest/);
    expect(() =>
      toEpochOutputRef(buildOutputRef('certification', 'a'.repeat(63), 'arena:x')),
    ).toThrow(/digest/);
  });

  it('rejects malformed addresses (addressable-identity charset)', () => {
    expect(() =>
      toEpochOutputRef(buildOutputRef('certification', DIGESTS.certification, 'not valid!')),
    ).toThrow(/address/);
  });

  it('rejects unknown fields and wrong ref versions (closed shape)', () => {
    expect(() => toEpochOutputRef({ ...VALID, extra: 1 })).toThrow(/unknown field/);
    expect(() =>
      toEpochOutputRef({ ...VALID, refVersion: 2 }),
    ).toThrow(EPOCH_ADAPTER_ERROR_CODES.UNSUPPORTED_VERSION);
  });

  it('only the three A025-readable kinds are queryable', () => {
    expect(isQueryableEpochOutputRefKind('agent-body-version')).toBe(true);
    expect(isQueryableEpochOutputRefKind('compatibility-report')).toBe(true);
    expect(isQueryableEpochOutputRefKind('certification')).toBe(true);
    expect(isQueryableEpochOutputRefKind('task-spec')).toBe(false);
    expect(() =>
      toEpochOutputRef(buildOutputRef('task-spec', DIGESTS.certification, `arena:task/${DIGESTS.certification}`)),
    ).not.toThrow();
  });

  it('guards are non-throwing', () => {
    expect(isEpochOutputRef(VALID)).toBe(true);
    expect(isEpochOutputRef(null)).toBe(false);
    expect(isEpochOutputRef({ ...VALID, digest: 'oops' })).toBe(false);
    expect(isEpochOutputRef({ ...VALID, refVersion: 99 })).toBe(false);
  });

  it('ref errors are typed EpochAdapterErrors', () => {
    try {
      toEpochOutputRef({ kind: 'nope', digest: 'x', address: 'y' });
      expect.unreachable('must throw');
    } catch (error) {
      expect(isEpochAdapterError(error)).toBe(true);
      expect((error as { code?: string }).code).toBe(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF);
    }
    expect(EPOCH_OUTPUT_REF_VERSION).toBe(1);
  });
});
