import { describe, expect, it } from 'vitest';
import {
  EMPTY_PUBLICATION_LEDGER,
  type PublicationLedger,
  type PublicationRecord,
  PUBLICATION_ACTIONS,
  PUBLICATION_RECORD_VERSION,
  appendPublicationRecord,
  isPublicationRecord,
  publicationRecordDigest,
  publishArtifact,
  resolvePublication,
  retractPublication,
} from './publication.js';
import { createMaterialArtifact, type MaterialArtifact } from './artifact.js';
import { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.js';
import type { PrincipalRef } from './principal.js';
import { toPrincipalRef } from './principal.js';
import { toRightsMetadata } from './rights.js';

const PUBLISHER: PrincipalRef = toPrincipalRef({
  type: 'service',
  tenant: 'acme',
  principalId: 'registry-control-plane',
});

const RIGHTS = toRightsMetadata({
  license: 'CC-BY-4.0',
  commercialUse: 'allowed',
  redistribution: 'allowed',
  customerData: 'none',
});

const IDENTITY = { namespace: 'acme', name: 'reference-dataset', version: '1.4.2' };

async function sampleArtifact(content: unknown): Promise<MaterialArtifact<unknown>> {
  return createMaterialArtifact({ identity: IDENTITY, content });
}

async function publishedLedger(
  artifact: MaterialArtifact<unknown>,
): Promise<{ ledger: PublicationLedger; record: PublicationRecord }> {
  const record = await publishArtifact({ artifact, publisher: PUBLISHER, rights: RIGHTS });
  const ledger = await appendPublicationRecord(EMPTY_PUBLICATION_LEDGER, record);
  return { ledger, record };
}

describe('Publication model (positive)', () => {
  it('artifacts are private by default (lock rule 12)', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    const status = await resolvePublication(EMPTY_PUBLICATION_LEDGER, IDENTITY);
    expect(status).toEqual({ visibility: 'private' });
    expect(artifact).toBeDefined();
  });

  it('publishing creates an immutable, versioned publication record', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    const record = await publishArtifact({ artifact, publisher: PUBLISHER, rights: RIGHTS });
    expect(record.recordVersion).toBe(PUBLICATION_RECORD_VERSION);
    expect(record.action).toBe('publish');
    expect(record.artifact).toEqual({
      namespace: 'acme',
      name: 'reference-dataset',
      version: '1.4.2',
      digest: artifact.digest,
    });
    expect(record.publisher).toEqual(PUBLISHER);
    expect(record.rights).toEqual(RIGHTS);
    expect(record.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Object.isFrozen(record)).toBe(true);
    expect(isPublicationRecord(record)).toBe(true);
    expect(PUBLICATION_ACTIONS).toContain('publish');
    expect(PUBLICATION_ACTIONS).toContain('retract');
  });

  it('an appended publish record makes the artifact public', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    const { ledger, record } = await publishedLedger(artifact);
    const status = await resolvePublication(ledger, IDENTITY);
    expect(status.visibility).toBe('public');
    if (status.visibility === 'public') {
      expect(status.publication).toEqual(record);
    }
  });

  it('retraction appends a NEW record and never edits the original', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    const { ledger, record } = await publishedLedger(artifact);
    const retraction = await retractPublication({ publication: record, publisher: PUBLISHER });
    expect(retraction.action).toBe('retract');
    expect(retraction.supersedes).toBe(await publicationRecordDigest(record));
    expect(retraction.artifact).toEqual(record.artifact);
    expect(Object.isFrozen(retraction)).toBe(true);

    // The original record is untouched (same content, still frozen).
    expect(record.action).toBe('publish');
    expect(record.supersedes).toBeUndefined();
    const originalSnapshot = JSON.parse(JSON.stringify(record)) as PublicationRecord;

    const ledger2 = await appendPublicationRecord(ledger, retraction);
    // Append-only: the input ledger is unchanged; the new ledger has both.
    expect(ledger.records).toHaveLength(1);
    expect(ledger2.records).toHaveLength(2);
    expect(ledger2.records[0]).toEqual(originalSnapshot);
    expect(ledger2.records[1]).toEqual(retraction);

    const status = await resolvePublication(ledger2, IDENTITY);
    expect(status.visibility).toBe('private');
  });

  it('republishing the SAME immutable artifact after retraction is allowed', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    const { ledger, record } = await publishedLedger(artifact);
    const retraction = await retractPublication({ publication: record, publisher: PUBLISHER });
    const ledger2 = await appendPublicationRecord(ledger, retraction);

    // A republication is a NEW publication event: it necessarily carries a
    // later timestamp, hence a distinct record digest.
    const republication = await publishArtifact({
      artifact,
      publisher: PUBLISHER,
      rights: RIGHTS,
      publishedAt: '2026-09-26T12:00:00.001Z',
    });
    const ledger3 = await appendPublicationRecord(ledger2, republication);
    const status = await resolvePublication(ledger3, IDENTITY);
    expect(status.visibility).toBe('public');
  });

  it('records are content-addressed: a bit-identical re-assertion of a retracted publication stays retracted', async () => {
    // Publication records are identified by their content digest. If a
    // republication carries IDENTICAL content (same publisher, rights and
    // millisecond timestamp) to a retracted publication, it IS the same
    // record — and the retraction of that digest stands. A new publication
    // event therefore requires a new record (in practice: a later
    // timestamp). This is the append-only, never-rewritten semantic of lock
    // rule 6 applied to content-addressed records.
    const artifact = await sampleArtifact({ rows: 1 });
    const record = await publishArtifact({
      artifact,
      publisher: PUBLISHER,
      rights: RIGHTS,
      publishedAt: '2026-09-26T12:00:00.000Z',
    });
    const ledger = await appendPublicationRecord(EMPTY_PUBLICATION_LEDGER, record);
    const retraction = await retractPublication({ publication: record, publisher: PUBLISHER });
    const ledger2 = await appendPublicationRecord(ledger, retraction);

    const identical = await publishArtifact({
      artifact,
      publisher: PUBLISHER,
      rights: RIGHTS,
      publishedAt: '2026-09-26T12:00:00.000Z',
    });
    const ledger3 = await appendPublicationRecord(ledger2, identical);
    const status = await resolvePublication(ledger3, IDENTITY);
    expect(status.visibility).toBe('private');
  });

  it('appending an identical publish record is idempotent', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    const { ledger, record } = await publishedLedger(artifact);
    const again = await appendPublicationRecord(ledger, record);
    expect(again.records).toHaveLength(1);
  });

  it('publication records are content-addressed (stable record digest)', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    const record = await publishArtifact({ artifact, publisher: PUBLISHER, rights: RIGHTS });
    const d1 = await publicationRecordDigest(record);
    const d2 = await publicationRecordDigest(record);
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Publication model (negative — fail closed)', () => {
  it('publishing a digest-mismatched (tampered) artifact fails', async () => {
    const honest = await sampleArtifact({ rows: 1 });
    const tampered = await createMaterialArtifact({
      identity: IDENTITY,
      content: { rows: 999 },
    });
    const forged = { ...tampered, digest: honest.digest } as MaterialArtifact<unknown>;
    await expect(
      publishArtifact({ artifact: forged, publisher: PUBLISHER, rights: RIGHTS }),
    ).rejects.toMatchObject({ code: ARTIFACT_ERROR_CODES.TAMPERED });
  });

  it('publishing an already-published-but-MODIFIED artifact fails (identity conflict)', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    const { ledger } = await publishedLedger(artifact);
    // Same identity, different content → different digest.
    const modified = await createMaterialArtifact({ identity: IDENTITY, content: { rows: 2 } });
    const modifiedRecord = await publishArtifact({
      artifact: modified,
      publisher: PUBLISHER,
      rights: RIGHTS,
    });
    await expect(appendPublicationRecord(ledger, modifiedRecord)).rejects.toMatchObject({
      code: ARTIFACT_ERROR_CODES.IDENTITY_CONFLICT,
    });
  });

  it('identity/digest binding survives retraction (immutable forever)', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    const { ledger, record } = await publishedLedger(artifact);
    const retraction = await retractPublication({ publication: record, publisher: PUBLISHER });
    const ledger2 = await appendPublicationRecord(ledger, retraction);
    expect((await resolvePublication(ledger2, IDENTITY)).visibility).toBe('private');

    const modified = await createMaterialArtifact({ identity: IDENTITY, content: { rows: 2 } });
    const modifiedRecord = await publishArtifact({
      artifact: modified,
      publisher: PUBLISHER,
      rights: RIGHTS,
    });
    await expect(appendPublicationRecord(ledger2, modifiedRecord)).rejects.toMatchObject({
      code: ARTIFACT_ERROR_CODES.IDENTITY_CONFLICT,
    });
  });

  it('publishing without rights metadata fails', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    await expect(
      publishArtifact({ artifact, publisher: PUBLISHER, rights: undefined }),
    ).rejects.toMatchObject({ code: ARTIFACT_ERROR_CODES.MISSING_RIGHTS });
  });

  it('a conflicting publish statement for an active publication is rejected', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    const { ledger } = await publishedLedger(artifact);
    const differentRights = await publishArtifact({
      artifact,
      publisher: PUBLISHER,
      rights: toRightsMetadata({
        license: 'MIT',
        commercialUse: 'prohibited',
        redistribution: 'tenant-only',
        customerData: 'none',
      }),
    });
    await expect(appendPublicationRecord(ledger, differentRights)).rejects.toMatchObject({
      code: ARTIFACT_ERROR_CODES.ALREADY_PUBLISHED,
    });
  });

  it('retracting an unknown publication fails', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    const record = await publishArtifact({ artifact, publisher: PUBLISHER, rights: RIGHTS });
    const retraction = await retractPublication({ publication: record, publisher: PUBLISHER });
    // Ledger never contained the original publication.
    await expect(
      appendPublicationRecord(EMPTY_PUBLICATION_LEDGER, retraction),
    ).rejects.toMatchObject({ code: ARTIFACT_ERROR_CODES.INVALID_PUBLICATION });
  });

  it('double retraction fails (append-only, no rewrites)', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    const { ledger, record } = await publishedLedger(artifact);
    const first = await retractPublication({ publication: record, publisher: PUBLISHER });
    const ledger2 = await appendPublicationRecord(ledger, first);
    const second = await retractPublication({ publication: record, publisher: PUBLISHER });
    await expect(appendPublicationRecord(ledger2, second)).rejects.toMatchObject({
      code: ARTIFACT_ERROR_CODES.INVALID_PUBLICATION,
    });
  });

  it('a retraction cannot be retracted', async () => {
    const artifact = await sampleArtifact({ rows: 1 });
    const { record } = await publishedLedger(artifact);
    const retraction = await retractPublication({ publication: record, publisher: PUBLISHER });
    await expect(
      retractPublication({ publication: retraction, publisher: PUBLISHER }),
    ).rejects.toMatchObject({ code: ARTIFACT_ERROR_CODES.INVALID_PUBLICATION });
  });

  it('rejects malformed publication records structurally', async () => {
    const malformed: unknown[] = [
      null,
      'publish',
      { action: 'publish' },
      { ...EMPTY_PUBLICATION_LEDGER },
    ];
    for (const bad of malformed) {
      expect(isPublicationRecord(bad)).toBe(false);
    }
    const artifact = await sampleArtifact({ rows: 1 });
    const record = await publishArtifact({ artifact, publisher: PUBLISHER, rights: RIGHTS });
    const badVersion = { ...record, recordVersion: 2 } as unknown as PublicationRecord;
    await expect(appendPublicationRecord(EMPTY_PUBLICATION_LEDGER, badVersion)).rejects.toThrow(
      ArtifactError,
    );
  });
});
