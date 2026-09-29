/**
 * ReleaseRecord tests (Work Order A024) — registration, supersession,
 * retirement: content addressing, determinism, closed shapes,
 * tamper detection, gate-evidence consistency.
 */

import { describe, expect, it } from 'vitest';
import { digestCanonical } from '@arena/protocol-core';
import { deepFreeze } from '@arena/agent-body';
import {
  RELEASE_ARTIFACT_REF_FIELDS,
  RELEASE_RECORD_FIELDS,
  RELEASE_RECORD_KINDS,
  RELEASE_RECORD_PROVENANCE_FIELDS,
  RELEASE_RECORD_VERSION,
  createReleaseRegistrationRecord,
  createReleaseRetirementRecord,
  createReleaseSupersessionRecord,
  isReleaseArtifactRef,
  isReleaseRecord,
  isReleaseRecordKind,
  isReleaseRecordView,
  releaseArtifactIdentityKey,
  releaseArtifactRefKey,
  verifyReleaseGateEvidence,
  verifyReleaseRecord,
} from './record.js';
import { evaluateReleaseGate } from './gate.js';
import { BODY_REGISTRY_ERROR_CODES, BodyRegistryError, isBodyRegistryError } from './errors.js';
import { CORRELATION_ID, DIGEST_A, IDEMPOTENCY_KEY, T1, T2, makeAdmittedScenario } from './test-support.js';

const RELEASE_VERSION = '2.0.0';

async function admittedEvidence() {
  const scenario = await makeAdmittedScenario();
  const verdict = await evaluateReleaseGate(scenario.candidate, scenario.stores);
  if (!verdict.admitted || verdict.evidence === null) {
    throw new Error('fixture scenario must be admitted');
  }
  return { scenario, evidence: verdict.evidence };
}

async function makeRegistration(overrides: Record<string, unknown> = {}) {
  const { evidence } = await admittedEvidence();
  return createReleaseRegistrationRecord({
    bodyVersionRef: {
      tenant: evidence.bodyVersionRef.tenant,
      name: evidence.bodyVersionRef.name,
      version: evidence.bodyVersionRef.version,
      digest: evidence.bodyVersionRef.digest,
    },
    releaseVersion: RELEASE_VERSION,
    gate: evidence,
    tags: ['production'],
    releasedAt: T1,
    correlationId: CORRELATION_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    tenantId: null,
    workspaceId: null,
    provenance: { releasedBy: 'release-bot', recordedAt: T1, notes: null },
    ...overrides,
  } as Parameters<typeof createReleaseRegistrationRecord>[0]);
}

describe('release registration record — positive', () => {
  it('creates a frozen, content-addressed registration record', async () => {
    const record = await makeRegistration();
    expect(record.kind).toBe('release-registration');
    expect(record.recordVersion).toBe(RELEASE_RECORD_VERSION);
    expect(Object.isFrozen(record)).toBe(true);
    expect(record.channel).toBe('stable');
    expect(record.tags).toEqual(['production']);
    expect(record.supersedes).toBeNull();
    expect(record.retires).toBeNull();
    expect(record.grounds).toBeNull();
  });

  it('DERIVES the citable release artifact ref (A002 discipline)', async () => {
    const record = await makeRegistration();
    expect(record.release).not.toBeNull();
    expect(record.release!.namespace).toBe('acme');
    expect(record.release!.name).toBe('structural-engineer-body');
    expect(record.release!.version).toBe(RELEASE_VERSION);
    // The release identity digest addresses the released material.
    expect(record.release!.digest).toBe(record.bodyVersionRef!.digest);
    expect(isReleaseArtifactRef(record.release)).toBe(true);
    expect(releaseArtifactRefKey(record.release!)).toBe(
      `acme/structural-engineer-body@${RELEASE_VERSION}#${record.bodyVersionRef!.digest}`,
    );
    expect(releaseArtifactIdentityKey(record.release!)).toBe(
      `acme/structural-engineer-body@${RELEASE_VERSION}`,
    );
  });

  it('carries the frozen gate evidence snapshot + its computed digest', async () => {
    const record = await makeRegistration();
    expect(record.gate).not.toBeNull();
    expect(record.gateEvidenceDigest).not.toBeNull();
    await verifyReleaseGateEvidence(record);
  });

  it('is deterministic: identical inputs ⇒ identical digest', async () => {
    const first = await makeRegistration();
    const second = await makeRegistration();
    expect(first.digest).toBe(second.digest);
  });

  it('is content-addressed: the digest covers the full view', async () => {
    const record = await makeRegistration();
    const { digest: _d, ...view } = record as unknown as Record<string, unknown>;
    expect(await digestCanonical(view)).toBe(record.digest);
  });

  it('structural guards accept the record and its view', async () => {
    const record = await makeRegistration();
    expect(isReleaseRecordView(record)).toBe(true);
    expect(isReleaseRecord(record)).toBe(true);
    expect(isReleaseRecordKind(record.kind)).toBe(true);
  });

  it('verifyReleaseRecord returns the digest on intact records', async () => {
    const record = await makeRegistration();
    await expect(verifyReleaseRecord(record)).resolves.toBe(record.digest);
  });

  it('field lists are stable and frozen', () => {
    expect(Object.isFrozen(RELEASE_RECORD_FIELDS)).toBe(true);
    expect(Object.isFrozen(RELEASE_ARTIFACT_REF_FIELDS)).toBe(true);
    expect(Object.isFrozen(RELEASE_RECORD_PROVENANCE_FIELDS)).toBe(true);
    expect([...RELEASE_RECORD_KINDS]).toEqual([
      'release-registration',
      'release-supersession',
      'release-retirement',
    ]);
  });
});

describe('release registration record — negative', () => {
  it('rejects a gate evidence snapshot scoped to a DIFFERENT body version', async () => {
    const { evidence } = await admittedEvidence();
    await expect(
      createReleaseRegistrationRecord({
        bodyVersionRef: {
          tenant: evidence.bodyVersionRef.tenant,
          name: evidence.bodyVersionRef.name,
          version: '9.9.9',
          digest: evidence.bodyVersionRef.digest,
        },
        releaseVersion: RELEASE_VERSION,
        gate: evidence,
        releasedAt: T1,
        correlationId: CORRELATION_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        provenance: { releasedBy: 'release-bot', recordedAt: T1, notes: null },
      }),
    ).rejects.toSatisfy((error: unknown) => isBodyRegistryError(error));
  });

  it('rejects a malformed gate evidence snapshot', async () => {
    await expect(
      makeRegistration({ gate: { channel: 'nightly' } }),
    ).rejects.toSatisfy((error: unknown) => isBodyRegistryError(error));
  });

  it('rejects a non-semver release version', async () => {
    await expect(makeRegistration({ releaseVersion: 'not-semver!' })).rejects.toSatisfy(
      (error: unknown) => isBodyRegistryError(error),
    );
  });

  it('rejects duplicate tags', async () => {
    await expect(makeRegistration({ tags: ['production', 'production'] })).rejects.toSatisfy(
      (error: unknown) => isBodyRegistryError(error),
    );
  });

  it('rejects malformed tags (charset + limit)', async () => {
    await expect(makeRegistration({ tags: ['NOT-LOWERCASE'] })).rejects.toSatisfy(
      (error: unknown) => isBodyRegistryError(error),
    );
    const tooMany = Array.from({ length: 17 }, (_, index) => `tag-${index}`);
    await expect(makeRegistration({ tags: tooMany })).rejects.toSatisfy(
      (error: unknown) => isBodyRegistryError(error),
    );
  });

  it('rejects invalid correlation/idempotency keys', async () => {
    await expect(makeRegistration({ correlationId: '' })).rejects.toSatisfy(
      (error: unknown) => isBodyRegistryError(error),
    );
    await expect(makeRegistration({ idempotencyKey: '' })).rejects.toSatisfy(
      (error: unknown) => isBodyRegistryError(error),
    );
  });

  it('rejects malformed provenance (closed shape)', async () => {
    await expect(
      makeRegistration({ provenance: { releasedBy: 'release-bot', recordedAt: T1 } }),
    ).rejects.toSatisfy((error: unknown) => isBodyRegistryError(error));
  });

  it('detects TAMPERED records (digest mismatch fails closed)', async () => {
    const record = await makeRegistration();
    const tampered = deepFreeze({
      ...record,
      channel: 'development',
    }) as typeof record;
    await expect(verifyReleaseRecord(tampered)).rejects.toSatisfy((error: unknown) => {
      return isBodyRegistryError(error) && (error as BodyRegistryError).code === BODY_REGISTRY_ERROR_CODES.TAMPERED;
    });
  });

  it('structural guards REJECT views that mix registration and lineage fields', async () => {
    const record = await makeRegistration();
    const mixed = { ...record, supersedes: DIGEST_A };
    expect(isReleaseRecordView(mixed)).toBe(false);
    expect(isReleaseRecord(mixed)).toBe(false);
  });
});

describe('release supersession / retirement records', () => {
  it('creates an append-only supersession record (supersedes + grounds)', async () => {
    const record = await createReleaseSupersessionRecord({
      target: DIGEST_A,
      grounds: 'superseded by release 2.1.0 (security refresh)',
      correlationId: CORRELATION_ID,
      idempotencyKey: 'idem-supersede-1',
      tenantId: null,
      workspaceId: null,
      provenance: { releasedBy: 'release-bot', recordedAt: T2, notes: null },
    });
    expect(record.kind).toBe('release-supersession');
    expect(record.supersedes).toBe(DIGEST_A);
    expect(record.grounds).toBe('superseded by release 2.1.0 (security refresh)');
    expect(record.release).toBeNull();
    expect(record.retires).toBeNull();
    expect(Object.isFrozen(record)).toBe(true);
    expect(isReleaseRecord(record)).toBe(true);
    await expect(verifyReleaseRecord(record)).resolves.toBe(record.digest);
    // determinism
    const second = await createReleaseSupersessionRecord({
      target: DIGEST_A,
      grounds: 'superseded by release 2.1.0 (security refresh)',
      correlationId: CORRELATION_ID,
      idempotencyKey: 'idem-supersede-1',
      tenantId: null,
      workspaceId: null,
      provenance: { releasedBy: 'release-bot', recordedAt: T2, notes: null },
    });
    expect(second.digest).toBe(record.digest);
  });

  it('creates an append-only retirement record (retires + grounds)', async () => {
    const record = await createReleaseRetirementRecord({
      target: DIGEST_A,
      grounds: 'end-of-life: substrate family retired',
      correlationId: CORRELATION_ID,
      idempotencyKey: 'idem-retire-1',
      tenantId: null,
      workspaceId: null,
      provenance: { releasedBy: 'release-bot', recordedAt: T2, notes: null },
    });
    expect(record.kind).toBe('release-retirement');
    expect(record.retires).toBe(DIGEST_A);
    expect(record.supersedes).toBeNull();
    expect(record.grounds).toBe('end-of-life: substrate family retired');
    expect(isReleaseRecord(record)).toBe(true);
    expect(record.digest).not.toBe(
      (await createReleaseSupersessionRecord({
        target: DIGEST_A,
        grounds: 'end-of-life: substrate family retired',
        correlationId: CORRELATION_ID,
        idempotencyKey: 'idem-retire-1',
        tenantId: null,
        workspaceId: null,
        provenance: { releasedBy: 'release-bot', recordedAt: T2, notes: null },
      })).digest,
    );
  });

  it('rejects empty or non-text grounds', async () => {
    await expect(
      createReleaseRetirementRecord({
        target: DIGEST_A,
        grounds: '',
        correlationId: CORRELATION_ID,
        idempotencyKey: 'idem-retire-2',
        tenantId: null,
        workspaceId: null,
        provenance: { releasedBy: 'release-bot', recordedAt: T2, notes: null },
      }),
    ).rejects.toSatisfy((error: unknown) => isBodyRegistryError(error));
  });

  it('rejects an invalid target digest', async () => {
    await expect(
      createReleaseSupersessionRecord({
        target: 'nope',
        grounds: 'x',
        correlationId: CORRELATION_ID,
        idempotencyKey: 'idem-supersede-2',
        tenantId: null,
        workspaceId: null,
        provenance: { releasedBy: 'release-bot', recordedAt: T2, notes: null },
      }),
    ).rejects.toSatisfy((error: unknown) => isBodyRegistryError(error));
  });
});
