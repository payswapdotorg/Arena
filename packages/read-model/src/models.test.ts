import { describe, expect, it } from 'vitest';
import type { ControlPlaneRecord } from '@arena/persistence';
import { READ_MODEL_ERROR_CODES, ReadModelError } from './errors.js';
import {
  READ_MODEL_KINDS,
  READ_MODEL_RECORD_VERSION,
  isControlPlaneRecordLike,
  isReadModelKind,
  toAgentBodyRead,
  toCanonicalRead,
  toKindedRead,
  toSessionRecordRead,
} from './models.js';

const READ_AT = 1_000_000;

function record(overrides: Partial<ControlPlaneRecord> = {}): ControlPlaneRecord {
  return {
    recordId: 'cap-1',
    tenantId: 'tenant-a',
    kind: 'capability-case',
    version: 3,
    revision: 7,
    data: { title: 'Draft a thing', steps: [] },
    createdAt: 100,
    updatedAt: 400,
    ...overrides,
  };
}

describe('kind vocabulary', () => {
  it('discloses the bounded kind set', () => {
    expect(READ_MODEL_KINDS).toContain('arena-session');
    expect(READ_MODEL_KINDS).toContain('arena-session-epoch');
    expect(READ_MODEL_KINDS).toContain('capability-case');
    expect(READ_MODEL_KINDS).toContain('agent-body');
    expect(READ_MODEL_KINDS).toContain('expert-qualification');
    expect(READ_MODEL_KINDS).toContain('certification');
    expect(Object.isFrozen(READ_MODEL_KINDS)).toBe(true);
  });

  it('narrows kinds', () => {
    expect(isReadModelKind('capability-case')).toBe(true);
    expect(isReadModelKind('nope')).toBe(false);
    expect(isReadModelKind(1)).toBe(false);
  });
});

describe('runtime record validation', () => {
  it('accepts well-formed control-plane records', () => {
    expect(isControlPlaneRecordLike(record())).toBe(true);
  });

  it('rejects malformed records', () => {
    expect(isControlPlaneRecordLike(null)).toBe(false);
    expect(isControlPlaneRecordLike('nope')).toBe(false);
    expect(isControlPlaneRecordLike([])).toBe(false);
    expect(isControlPlaneRecordLike({ ...record(), recordId: '' })).toBe(false);
    expect(isControlPlaneRecordLike({ ...record(), tenantId: 5 })).toBe(false);
    expect(isControlPlaneRecordLike({ ...record(), kind: undefined })).toBe(false);
    expect(isControlPlaneRecordLike({ ...record(), version: 0 })).toBe(false);
    expect(isControlPlaneRecordLike({ ...record(), revision: 1.5 })).toBe(false);
    expect(isControlPlaneRecordLike({ ...record(), data: () => 1 })).toBe(false);
    expect(isControlPlaneRecordLike({ ...record(), createdAt: -1 })).toBe(false);
    expect(isControlPlaneRecordLike({ ...record(), updatedAt: 99 })).toBe(false);
  });
});

describe('toCanonicalRead', () => {
  it('projects identity, versioning, provenance and injected read-at verbatim', () => {
    const source = record();
    const read = toCanonicalRead(source, READ_AT);
    expect(read.recordVersion).toBe(READ_MODEL_RECORD_VERSION);
    expect(read.recordId).toBe('cap-1');
    expect(read.tenantId).toBe('tenant-a');
    expect(read.kind).toBe('capability-case');
    expect(read.sourceVersion).toBe(3);
    expect(read.sourceRevision).toBe(7);
    expect(read.data).toEqual({ title: 'Draft a thing', steps: [] });
    expect(read.provenance).toEqual({ createdAt: 100, updatedAt: 400 });
    expect(read.readAt).toBe(READ_AT);
  });

  it('is deterministic: same record + same readAt → deep-equal projections', () => {
    expect(toCanonicalRead(record(), READ_AT)).toEqual(toCanonicalRead(record(), READ_AT));
  });

  it('deep-freezes the projection', () => {
    const read = toCanonicalRead(record(), READ_AT);
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read.provenance)).toBe(true);
    expect(() => {
      (read as { recordId: string }).recordId = 'mutated';
    }).toThrow();
  });

  it('does not mutate or store the source record (no state captured)', () => {
    const source = record();
    const read1 = toCanonicalRead(source, READ_AT);
    const read2 = toCanonicalRead({ ...source, revision: 8 }, READ_AT + 1);
    expect(read1.sourceRevision).toBe(7);
    expect(read2.sourceRevision).toBe(8);
    expect(read1.readAt).toBe(READ_AT);
    expect(read2.readAt).toBe(READ_AT + 1);
  });

  it('fails closed on invalid records', () => {
    let error: unknown;
    try {
      toCanonicalRead({ recordId: 'x' }, READ_AT);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(ReadModelError);
    expect((error as ReadModelError).code).toBe(READ_MODEL_ERROR_CODES.INVALID_RECORD);
  });

  it('fails closed on invalid injected readAt', () => {
    expect(() => toCanonicalRead(record(), -1)).toThrowError(ReadModelError);
    expect(() => toCanonicalRead(record(), 1.5)).toThrowError(ReadModelError);
    expect(() => toCanonicalRead(record(), Number.NaN)).toThrowError(ReadModelError);
  });
});

describe('toKindedRead', () => {
  it('narrows to the expected kind', () => {
    const read = toKindedRead(record(), READ_AT, 'capability-case');
    expect(read.kind).toBe('capability-case');
  });

  it('throws a typed KIND_MISMATCH when the stored kind differs', () => {
    let error: unknown;
    try {
      toKindedRead(record({ kind: 'agent-body' }), READ_AT, 'capability-case');
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(ReadModelError);
    expect((error as ReadModelError).code).toBe(READ_MODEL_ERROR_CODES.KIND_MISMATCH);
    expect((error as ReadModelError).details).toMatchObject({
      expectedKind: 'capability-case',
      actualKind: 'agent-body',
    });
  });

  it('per-kind mappers enforce their kind', () => {
    expect(toSessionRecordRead(record({ kind: 'arena-session' }), READ_AT).kind).toBe('arena-session');
    expect(toAgentBodyRead(record({ kind: 'agent-body' }), READ_AT).kind).toBe('agent-body');
    expect(() => toSessionRecordRead(record(), READ_AT)).toThrowError(ReadModelError);
  });

  it('generic projection accepts kinds outside the disclosed vocabulary (never silently dropped)', () => {
    const read = toCanonicalRead(record({ kind: 'future-kind' }), READ_AT);
    expect(read.kind).toBe('future-kind');
  });
});
