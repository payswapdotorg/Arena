import { describe, expect, it } from 'vitest';
import {
  LINEAGE_RELATIONS,
  PROVENANCE_RECORD_VERSION,
  VERIFICATION_KINDS,
  createProvenanceRecord,
  isProvenanceRecord,
  provenanceRecordDigest,
} from './record.js';
import { PROVENANCE_ERROR_CODES, ProvenanceError } from './errors.js';

const CREATOR = { type: 'expert', tenant: 'acme', principalId: 'expert-42' };
const RIGHTS = {
  license: 'CC-BY-4.0',
  commercialUse: 'allowed',
  redistribution: 'tenant-only',
  customerData: 'derived',
};
const TRANSFORM = {
  namespace: 'acme',
  name: 'clean-and-normalize',
  version: '3.1.0',
  digest: 'e'.repeat(64),
};

function ref(name: string, digest: string): {
  namespace: string;
  name: string;
  version: string;
  digest: string;
} {
  return { namespace: 'acme', name, version: '1.0.0', digest };
}

function baseInput() {
  const corpus = ref('source-corpus', 'a'.repeat(64));
  return {
    artifact: ref('reference-dataset', 'b'.repeat(64)),
    creator: CREATOR,
    createdAt: '2026-09-26T12:00:00.000Z',
    parents: [{ parent: corpus, relation: 'derived-from' }],
    transformation: { transform: TRANSFORM, inputs: [corpus] },
    rights: RIGHTS,
    verification: [
      { kind: 'evaluation', evidence: ref('eval-suite', 'c'.repeat(64)) },
    ],
  };
}

describe('ProvenanceRecord (positive)', () => {
  it('creates a complete, frozen record per architecture.md §15', () => {
    const record = createProvenanceRecord(baseInput());
    expect(record.recordVersion).toBe(PROVENANCE_RECORD_VERSION);
    expect(record.artifact).toEqual(ref('reference-dataset', 'b'.repeat(64)));
    expect(record.creator).toEqual(CREATOR);
    expect(record.createdAt).toBe('2026-09-26T12:00:00.000Z');
    expect(record.recordedAt).toBe('2026-09-26T12:00:00.000Z'); // defaults to createdAt
    expect(record.parents).toHaveLength(1);
    expect(record.parents[0]?.relation).toBe('derived-from');
    expect(record.transformation.transform).toEqual(TRANSFORM);
    expect(record.transformation.inputs).toEqual([ref('source-corpus', 'a'.repeat(64))]);
    expect(record.rights.license).toBe('CC-BY-4.0');
    expect(record.verification[0]?.kind).toBe('evaluation');
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.parents[0])).toBe(true);
    expect(Object.isFrozen(record.transformation)).toBe(true);
    expect(isProvenanceRecord(record)).toBe(true);
  });

  it('accepts an explicit recordedAt distinct from createdAt', () => {
    const record = createProvenanceRecord({
      ...baseInput(),
      recordedAt: '2026-09-26T12:05:00.000Z',
    });
    expect(record.createdAt).toBe('2026-09-26T12:00:00.000Z');
    expect(record.recordedAt).toBe('2026-09-26T12:05:00.000Z');
  });

  it('accepts records with no parents (roots) and no verification', () => {
    const record = createProvenanceRecord({
      ...baseInput(),
      parents: [],
      transformation: { transform: TRANSFORM, inputs: [] },
      verification: [],
    });
    expect(record.parents).toEqual([]);
    expect(record.verification).toEqual([]);
  });

  it('exposes the closed relation and verification-kind sets', () => {
    expect([...LINEAGE_RELATIONS]).toEqual([
      'adapted-from',
      'composed-of',
      'derived-from',
      'extracted-from',
    ]);
    expect([...VERIFICATION_KINDS]).toEqual([
      'attestation',
      'certification',
      'evaluation',
      'verification',
    ]);
  });

  it('is content-addressed (canonical record digest)', async () => {
    const record = createProvenanceRecord(baseInput());
    const digest = await provenanceRecordDigest(record);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await provenanceRecordDigest(record)).toBe(digest);
  });
});

describe('ProvenanceRecord (negative — construction fails closed)', () => {
  const rejects = (
    mutate: (input: ReturnType<typeof baseInput>) => unknown,
    code: string,
  ) => {
    const input = baseInput();
    const bad = mutate(input);
    try {
      createProvenanceRecord(bad as Parameters<typeof createProvenanceRecord>[0]);
      expect.unreachable(`expected rejection (${code})`);
    } catch (error) {
      expect(error).toBeInstanceOf(ProvenanceError);
      expect((error as ProvenanceError).code).toBe(code);
    }
  };

  it('rejects MISSING rights metadata', () => {
    rejects((input) => ({ ...input, rights: undefined }), PROVENANCE_ERROR_CODES.MISSING_RIGHTS);
    rejects((input) => ({ ...input, rights: null }), PROVENANCE_ERROR_CODES.MISSING_RIGHTS);
  });

  it('rejects malformed rights metadata', () => {
    rejects(
      (input) => ({ ...input, rights: { ...RIGHTS, commercialUse: 'maybe' } }),
      PROVENANCE_ERROR_CODES.INVALID_RIGHTS,
    );
  });

  it('rejects UNKNOWN principal types', () => {
    rejects(
      (input) => ({ ...input, creator: { ...CREATOR, type: 'model' } }),
      PROVENANCE_ERROR_CODES.INVALID_PRINCIPAL,
    );
    rejects(
      (input) => ({ ...input, creator: { ...CREATOR, type: 'openai' } }),
      PROVENANCE_ERROR_CODES.INVALID_PRINCIPAL,
    );
  });

  it('rejects raw provider identity shapes for creators', () => {
    rejects(
      (input) => ({ ...input, creator: { ...CREATOR, principalId: 'user@provider.example' } }),
      PROVENANCE_ERROR_CODES.INVALID_PRINCIPAL,
    );
  });

  it('rejects MALFORMED timestamps', () => {
    for (const bad of [
      '2026-09-26T12:00:00Z',
      '2026-09-26T12:00:00.7891Z',
      '2026-09-26T12:00:00.000+02:00',
      '2026-02-30T00:00:00.000Z',
      'not-a-date',
    ]) {
      rejects(
        (input) => ({ ...input, createdAt: bad }),
        PROVENANCE_ERROR_CODES.INVALID_TIMESTAMP,
      );
    }
    rejects(
      (input) => ({ ...input, recordedAt: '2026-09-26T12:00:00Z' }),
      PROVENANCE_ERROR_CODES.INVALID_TIMESTAMP,
    );
  });

  it('rejects SELF-REFERENCES (artifact as its own parent)', () => {
    rejects((input) => {
      const self = { ...input.artifact };
      return {
        ...input,
        parents: [{ parent: self, relation: 'derived-from' }],
        transformation: { transform: TRANSFORM, inputs: [self] },
      };
    }, PROVENANCE_ERROR_CODES.CYCLE_DETECTED);
  });

  it('rejects duplicate parent edges', () => {
    rejects((input) => ({
      ...input,
      parents: [
        { parent: input.parents[0]!.parent, relation: 'derived-from' },
        { parent: input.parents[0]!.parent, relation: 'composed-of' },
      ],
    }), PROVENANCE_ERROR_CODES.INVALID_RECORD);
  });

  it('rejects unknown lineage relations', () => {
    rejects(
      (input) => ({
        ...input,
        parents: [{ parent: input.parents[0]!.parent, relation: 'depends-on' }],
        transformation: { transform: TRANSFORM, inputs: [input.parents[0]!.parent] },
      }),
      PROVENANCE_ERROR_CODES.INVALID_RECORD,
    );
  });

  it('rejects transformation inputs that are not parents', () => {
    rejects(
      (input) => ({
        ...input,
        transformation: {
          transform: TRANSFORM,
          inputs: [ref('secret-input', 'd'.repeat(64))],
        },
      }),
      PROVENANCE_ERROR_CODES.INVALID_RECORD,
    );
  });

  it('rejects unknown verification kinds and malformed evidence refs', () => {
    rejects(
      (input) => ({
        ...input,
        verification: [{ kind: 'benchmark', evidence: ref('eval-suite', 'c'.repeat(64)) }],
      }),
      PROVENANCE_ERROR_CODES.INVALID_RECORD,
    );
    rejects(
      (input) => ({
        ...input,
        verification: [{ kind: 'evaluation', evidence: ref('bad', 'nothex') }],
      }),
      PROVENANCE_ERROR_CODES.INVALID_REF,
    );
  });

  it('rejects malformed artifact references', () => {
    rejects(
      (input) => ({ ...input, artifact: ref('Bad Name', 'b'.repeat(64)) }),
      PROVENANCE_ERROR_CODES.INVALID_REF,
    );
    rejects(
      (input) => ({ ...input, artifact: ref('dataset', 'NOTHEX') }),
      PROVENANCE_ERROR_CODES.INVALID_REF,
    );
  });

  it('rejects a missing transformation and non-array parents', () => {
    rejects(
      (input) => ({ ...input, transformation: undefined }),
      PROVENANCE_ERROR_CODES.INVALID_RECORD,
    );
    rejects(
      (input) => ({ ...input, parents: 'none' as unknown as [] }),
      PROVENANCE_ERROR_CODES.INVALID_RECORD,
    );
  });

  it('isProvenanceRecord rejects malformed shapes structurally', () => {
    expect(isProvenanceRecord(null)).toBe(false);
    expect(isProvenanceRecord('record')).toBe(false);
    expect(isProvenanceRecord({ recordVersion: 2 })).toBe(false);
    expect(isProvenanceRecord({ recordVersion: 1 })).toBe(false);
  });
});
