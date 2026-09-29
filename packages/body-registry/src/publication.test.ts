/**
 * Release publication tests (Work Order A024) — idempotent,
 * reproducible, content-addressed publication on an append-only
 * ledger (A002 PublicationRecord discipline applied to releases).
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_RELEASE_PUBLICATION_LEDGER,
  RELEASE_PUBLICATION_ACTIONS,
  RELEASE_PUBLICATION_FIELDS,
  RELEASE_PUBLICATION_VERSION,
  appendReleasePublication,
  isReleasePublicationAction,
  isReleasePublicationRecord,
  isReleasePublicationView,
  publishRelease,
  releasePublicationDigest,
  resolveReleasePublication,
  retractRelease,
} from './publication.js';
import { createReleaseRegistrationRecord, createReleaseSupersessionRecord } from './record.js';
import { evaluateReleaseGate } from './gate.js';
import { BODY_REGISTRY_ERROR_CODES, BodyRegistryError, isBodyRegistryError } from './errors.js';
import { CORRELATION_ID, DIGEST_A, IDEMPOTENCY_KEY, T1, T2, makeAdmittedScenario } from './test-support.js';

const PUBLISHER = { type: 'service', tenant: 'acme', principalId: 'release-bot' };
const RIGHTS = {
  license: 'Proprietary',
  commercialUse: 'requires-license',
  redistribution: 'tenant-only',
  customerData: 'derived',
  professionalLimitations: ['not a licensed engineering system'],
};

async function makeRegistration() {
  const scenario = await makeAdmittedScenario();
  const verdict = await evaluateReleaseGate(scenario.candidate, scenario.stores);
  if (!verdict.admitted || verdict.evidence === null) {
    throw new Error('fixture scenario must be admitted');
  }
  return createReleaseRegistrationRecord({
    bodyVersionRef: {
      tenant: verdict.evidence.bodyVersionRef.tenant,
      name: verdict.evidence.bodyVersionRef.name,
      version: verdict.evidence.bodyVersionRef.version,
      digest: verdict.evidence.bodyVersionRef.digest,
    },
    releaseVersion: '2.0.0',
    gate: verdict.evidence,
    tags: ['production'],
    releasedAt: T1,
    correlationId: CORRELATION_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    tenantId: null,
    workspaceId: null,
    provenance: { releasedBy: 'release-bot', recordedAt: T1, notes: null },
  });
}

async function makePublication() {
  const registration = await makeRegistration();
  return publishRelease({
    registration,
    publisher: PUBLISHER,
    rights: RIGHTS,
    publishedAt: T2,
  });
}

describe('publishRelease — positive', () => {
  it('creates a frozen, content-addressed publish record', async () => {
    const publication = await makePublication();
    expect(publication.action).toBe('publish');
    expect(publication.publicationVersion).toBe(RELEASE_PUBLICATION_VERSION);
    expect(publication.publisher.principalId).toBe('release-bot');
    expect(publication.rights.license).toBe('Proprietary');
    expect(publication.supersedes).toBeNull();
    expect(Object.isFrozen(publication)).toBe(true);
    expect(isReleasePublicationRecord(publication)).toBe(true);
    expect(isReleasePublicationView(publication)).toBe(true);
  });

  it('binds the registration record digest and the citable release ref', async () => {
    const registration = await makeRegistration();
    const publication = await publishRelease({
      registration,
      publisher: PUBLISHER,
      rights: RIGHTS,
      publishedAt: T2,
    });
    expect(publication.releaseRecordDigest).toBe(registration.digest);
    expect(publication.release).toEqual(registration.release);
  });

  it('is REPRODUCIBLE: identical inputs ⇒ identical digest (no clock reads)', async () => {
    const first = await makePublication();
    const second = await makePublication();
    expect(first.digest).toBe(second.digest);
  });

  it('the digest covers the full publication view', async () => {
    const publication = await makePublication();
    const digest = await releasePublicationDigest(publication);
    expect(digest).toBe(publication.digest);
  });

  it('distinct timestamps produce distinct records (content addressing)', async () => {
    const registration = await makeRegistration();
    const first = await publishRelease({ registration, publisher: PUBLISHER, rights: RIGHTS, publishedAt: T1 });
    const second = await publishRelease({ registration, publisher: PUBLISHER, rights: RIGHTS, publishedAt: T2 });
    expect(first.digest).not.toBe(second.digest);
  });
});

describe('publishRelease — negative', () => {
  it('rejects a non-registration record', async () => {
    const lineage = await createReleaseSupersessionRecord({
      target: DIGEST_A,
      grounds: 'superseded by release 2.1.0',
      correlationId: CORRELATION_ID,
      idempotencyKey: 'idem-supersede-1',
      tenantId: null,
      workspaceId: null,
      provenance: { releasedBy: 'release-bot', recordedAt: T2, notes: null },
    });
    await expect(
      publishRelease({ registration: lineage, publisher: PUBLISHER, rights: RIGHTS, publishedAt: T2 }),
    ).rejects.toSatisfy((error: unknown) => isBodyRegistryError(error));
  });

  it('rejects a TAMPERED registration record (fail closed)', async () => {
    const registration = await makeRegistration();
    const tampered = { ...registration, tags: ['tampered'] } as typeof registration;
    await expect(
      publishRelease({ registration: tampered, publisher: PUBLISHER, rights: RIGHTS, publishedAt: T2 }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isBodyRegistryError(error) && (error as BodyRegistryError).code === BODY_REGISTRY_ERROR_CODES.TAMPERED,
    );
  });

  it('wraps invalid rights metadata as INVALID_RIGHTS (lock rule 23 — rights are mandatory)', async () => {
    const registration = await makeRegistration();
    await expect(
      publishRelease({ registration, publisher: PUBLISHER, rights: { license: '' }, publishedAt: T2 }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isBodyRegistryError(error) && (error as BodyRegistryError).code === BODY_REGISTRY_ERROR_CODES.INVALID_RIGHTS,
    );
  });

  it('rejects a malformed publication timestamp', async () => {
    const registration = await makeRegistration();
    await expect(
      publishRelease({ registration, publisher: PUBLISHER, rights: RIGHTS, publishedAt: 'yesterday' }),
    ).rejects.toSatisfy((error: unknown) => isBodyRegistryError(error));
  });
});

describe('retractRelease', () => {
  it('appends a NEW record superseding the publication (never mutates the original)', async () => {
    const publication = await makePublication();
    const retraction = await retractRelease({
      publication,
      publisher: PUBLISHER,
      retractedAt: T2,
    });
    expect(retraction.action).toBe('retract');
    expect(retraction.supersedes).toBe(publication.digest);
    expect(retraction.release).toEqual(publication.release);
    expect(publication.action).toBe('publish'); // untouched
    expect(retraction.digest).not.toBe(publication.digest);
  });

  it('rejects retracting a retraction', async () => {
    const publication = await makePublication();
    const retraction = await retractRelease({ publication, publisher: PUBLISHER, retractedAt: T2 });
    await expect(
      retractRelease({ publication: retraction, publisher: PUBLISHER, retractedAt: T2 }),
    ).rejects.toSatisfy((error: unknown) => isBodyRegistryError(error));
  });
});

describe('publication ledger (append-only, idempotent, identity-immutable)', () => {
  it('a release is UNPUBLISHED by default', () => {
    const status = resolveReleasePublication(EMPTY_RELEASE_PUBLICATION_LEDGER, {
      namespace: 'acme',
      name: 'structural-engineer-body',
      version: '2.0.0',
    });
    expect(status.visibility).toBe('unpublished');
  });

  it('publish → visible; retract → unpublished (append-only)', async () => {
    const publication = await makePublication();
    let ledger = await appendReleasePublication(EMPTY_RELEASE_PUBLICATION_LEDGER, publication);
    expect(ledger.records).toHaveLength(1);
    const status = resolveReleasePublication(ledger, publication.release);
    expect(status.visibility).toBe('published');
    if (status.visibility === 'published') {
      expect(status.publication.digest).toBe(publication.digest);
    }

    const retraction = await retractRelease({ publication, publisher: PUBLISHER, retractedAt: T2 });
    ledger = await appendReleasePublication(ledger, retraction);
    expect(ledger.records).toHaveLength(2);
    const retracted = resolveReleasePublication(ledger, publication.release);
    expect(retracted.visibility).toBe('unpublished');
  });

  it('appending the IDENTICAL publish record is IDEMPOTENT (ledger unchanged)', async () => {
    const publication = await makePublication();
    const ledger = await appendReleasePublication(EMPTY_RELEASE_PUBLICATION_LEDGER, publication);
    const again = await appendReleasePublication(ledger, publication);
    expect(again).toBe(ledger); // same reference — no rewrite
    expect(again.records).toHaveLength(1);
  });

  it('rejects a SECOND, different publish record while one is active', async () => {
    const registration = await makeRegistration();
    const publication = await publishRelease({ registration, publisher: PUBLISHER, rights: RIGHTS, publishedAt: T1 });
    const conflicting = await publishRelease({ registration, publisher: PUBLISHER, rights: RIGHTS, publishedAt: T2 });
    const ledger = await appendReleasePublication(EMPTY_RELEASE_PUBLICATION_LEDGER, publication);
    await expect(appendReleasePublication(ledger, conflicting)).rejects.toSatisfy(
      (error: unknown) =>
        isBodyRegistryError(error) && (error as BodyRegistryError).code === BODY_REGISTRY_ERROR_CODES.PUBLICATION_CONFLICT,
    );
  });

  it('re-publication AFTER a retraction is allowed (append-only history)', async () => {
    const registration = await makeRegistration();
    const first = await publishRelease({ registration, publisher: PUBLISHER, rights: RIGHTS, publishedAt: T1 });
    let ledger = await appendReleasePublication(EMPTY_RELEASE_PUBLICATION_LEDGER, first);
    const retraction = await retractRelease({ publication: first, publisher: PUBLISHER, retractedAt: T2 });
    ledger = await appendReleasePublication(ledger, retraction);
    const republish = await publishRelease({ registration, publisher: PUBLISHER, rights: RIGHTS, publishedAt: T2 });
    ledger = await appendReleasePublication(ledger, republish);
    expect(ledger.records).toHaveLength(3);
    expect(resolveReleasePublication(ledger, first.release).visibility).toBe('published');
  });

  it('rejects publishing the SAME identity with a DIFFERENT digest (identity immutability)', async () => {
    const registration = await makeRegistration();
    const publication = await publishRelease({ registration, publisher: PUBLISHER, rights: RIGHTS, publishedAt: T1 });
    const ledger = await appendReleasePublication(EMPTY_RELEASE_PUBLICATION_LEDGER, publication);
    // Forge a different-content release record claiming the same identity.
    const conflicting = { ...publication, release: { ...publication.release, digest: DIGEST_A }, digest: DIGEST_A } as typeof publication;
    // Give the conflicting record a self-consistent digest over its own view.
    const { digest: _d, ...view } = conflicting as unknown as Record<string, unknown>;
    const { releasePublicationDigest: recompute } = await import('./publication.js');
    const digest = await recompute(view as unknown as Parameters<typeof recompute>[0]);
    const consistent = { ...conflicting, digest } as typeof publication;
    await expect(appendReleasePublication(ledger, consistent)).rejects.toSatisfy(
      (error: unknown) =>
        isBodyRegistryError(error) && (error as BodyRegistryError).code === BODY_REGISTRY_ERROR_CODES.IDENTITY_CONFLICT,
    );
  });

  it('rejects a retraction that matches no active publication', async () => {
    const publication = await makePublication();
    const orphan = await retractRelease({ publication, publisher: PUBLISHER, retractedAt: T2 });
    await expect(
      appendReleasePublication(EMPTY_RELEASE_PUBLICATION_LEDGER, orphan),
    ).rejects.toSatisfy((error: unknown) => isBodyRegistryError(error));
  });

  it('rejects retracting the same publication twice', async () => {
    const publication = await makePublication();
    const retraction = await retractRelease({ publication, publisher: PUBLISHER, retractedAt: T2 });
    let ledger = await appendReleasePublication(EMPTY_RELEASE_PUBLICATION_LEDGER, publication);
    ledger = await appendReleasePublication(ledger, retraction);
    await expect(appendReleasePublication(ledger, retraction)).rejects.toSatisfy(
      (error: unknown) => isBodyRegistryError(error),
    );
  });

  it('the ledger append is PURE (the input ledger is never modified)', async () => {
    const publication = await makePublication();
    const ledger = await appendReleasePublication(EMPTY_RELEASE_PUBLICATION_LEDGER, publication);
    expect(EMPTY_RELEASE_PUBLICATION_LEDGER.records).toHaveLength(0);
    expect(Object.isFrozen(ledger.records)).toBe(true);
  });
});

describe('publication vocabularies', () => {
  it('the action vocabulary is closed and frozen', () => {
    expect([...RELEASE_PUBLICATION_ACTIONS]).toEqual(['publish', 'retract']);
    expect(Object.isFrozen(RELEASE_PUBLICATION_ACTIONS)).toBe(true);
    expect(isReleasePublicationAction('publish')).toBe(true);
    expect(isReleasePublicationAction('unpublish')).toBe(false);
  });

  it('field lists are stable and frozen', () => {
    expect(Object.isFrozen(RELEASE_PUBLICATION_FIELDS)).toBe(true);
    expect([...RELEASE_PUBLICATION_FIELDS]).toContain('releaseRecordDigest');
    expect([...RELEASE_PUBLICATION_FIELDS]).toContain('rights');
  });
});
