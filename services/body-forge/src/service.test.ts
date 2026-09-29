/**
 * ForgeService tests (Work Order A021 item 7): submit → validate →
 * compose → record; the digest-addressed append-only registry;
 * deterministic replay (same key ⇒ byte-identical record); pure
 * projections.
 */

import { describe, expect, it } from 'vitest';
import { isBodyVersion } from '@arena/agent-body';
import {
  BODY_FORGE_ERROR_CODES,
  isForgeRecord,
  verifyForgeRecord,
} from '@arena/body-forge';
import { ForgeService } from './fabric.js';
import { CORR, FORGE_KEY, T5, makeManifest, makePolicy, makeRecipe, parentRefV1 } from './test-support.js';

const RECIPE = makeRecipe();

describe('submit (validate → compose → record)', () => {
  it('emits the ForgeRecord and the BodyVersion proposal, and records both', async () => {
    const service = new ForgeService();
    const manifest = await makeManifest();
    const policy = await makePolicy();
    const result = await service.submit(manifest, policy, {
      forgeKey: FORGE_KEY,
      recipe: RECIPE,
      notes: 'first forge',
    });
    expect(isBodyVersion(result.bodyVersion)).toBe(true);
    expect(isForgeRecord(result.record)).toBe(true);
    expect(result.record.provenance.notes).toBe('first forge');
    expect(service.listRecords()).toHaveLength(1);
    expect(service.getRecord(result.record.digest as string)).toBeDefined();
    expect(await verifyForgeRecord(result.record)).toBe(result.record.digest);
  });

  it('the record carries the full lineage: manifest digest, policy digest, emitted version digest + ref, correlation id', async () => {
    const service = new ForgeService();
    const manifest = await makeManifest();
    const policy = await makePolicy();
    const result = await service.submit(manifest, policy, { forgeKey: FORGE_KEY, recipe: RECIPE });
    expect(result.record.manifestDigest).toBe(manifest.digest);
    expect(result.record.policyDigest).toBe(policy.digest);
    expect(result.record.bodyVersionDigest).toBe(result.bodyVersion.digest);
    expect(result.record.bodyVersionRef.version).toBe('1.0.0');
    expect(result.record.correlationId).toBe(CORR);
    expect(result.record.provenance.forgedBy).toBe('arena-body-forge-fabric');
    expect(result.record.provenance.recordedAt).toBe(T5);
  });
});

describe('deterministic replay (lock rule 17)', () => {
  it('the same key + same tuple returns the STORED result byte-identically (never duplicated)', async () => {
    const service = new ForgeService();
    const manifest = await makeManifest();
    const policy = await makePolicy();
    const first = await service.submit(manifest, policy, { forgeKey: FORGE_KEY, recipe: RECIPE });
    const replay = await service.submit(manifest, policy, { forgeKey: FORGE_KEY, recipe: RECIPE });
    expect(replay).toBe(first);
    expect(service.listRecords()).toHaveLength(1);
    // Even a different recipe under the same key is a conflict-free NO-OP
    // replay: the key is bound to the (manifest, policy) command tuple.
    const replayWithOtherRecipe = await service.submit(manifest, policy, {
      forgeKey: FORGE_KEY,
      recipe: { ...RECIPE, forgedAt: '2026-06-01T12:00:09.000Z' },
    });
    expect(replayWithOtherRecipe).toBe(first);
  });

  it('the same key + a different tuple is an IDEMPOTENCY_CONFLICT', async () => {
    const service = new ForgeService();
    const manifest = await makeManifest();
    const otherManifest = await makeManifest({ mission: 'A different mission.' });
    const policy = await makePolicy();
    await service.submit(manifest, policy, { forgeKey: FORGE_KEY, recipe: RECIPE });
    await expect(
      service.submit(otherManifest, policy, { forgeKey: FORGE_KEY, recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.IDEMPOTENCY_CONFLICT });
    expect(service.listRecords()).toHaveLength(1);
  });

  it('a different key + the same tuple records a second execution of the same content', async () => {
    const service = new ForgeService();
    const manifest = await makeManifest();
    const policy = await makePolicy();
    const first = await service.submit(manifest, policy, { forgeKey: 'forge-key-a', recipe: RECIPE });
    const second = await service.submit(manifest, policy, { forgeKey: 'forge-key-b', recipe: RECIPE });
    expect(second.record.digest).not.toBe(first.record.digest); // different key ⇒ different record
    expect(second.bodyVersion.digest).toBe(first.bodyVersion.digest); // same content ⇒ same version
    expect(service.listRecords()).toHaveLength(2);
  });
});

describe('the version-consistency mirror (A003 registry semantics, lock rule 5)', () => {
  it('refuses to record a DIFFERENT digest for an already-forged (body, version)', async () => {
    const service = new ForgeService();
    const policy = await makePolicy();
    const first = await service.submit(await makeManifest(), policy, {
      forgeKey: 'forge-key-v1-a',
      recipe: RECIPE,
    });
    // Same version number, different content (different mission ⇒ different digest).
    const conflicting = await makeManifest({ mission: 'A conflicting mission for the same version.' });
    await expect(
      service.submit(conflicting, policy, { forgeKey: 'forge-key-v1-b', recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.VERSION_CONFLICT });
    expect(service.listRecords()).toHaveLength(1);
    expect(first.record.bodyVersionRef.version).toBe('1.0.0');
  });

  it('a NEW version number records normally (append-only growth)', async () => {
    const service = new ForgeService();
    const policy = await makePolicy();
    await service.submit(await makeManifest(), policy, { forgeKey: 'forge-key-v1', recipe: RECIPE });
    const second = await service.submit(
      await makeManifest({
        targetVersion: '1.1.0',
        parents: [parentRefV1()],
        supersedes: parentRefV1(),
      }),
      policy,
      { forgeKey: 'forge-key-v2', recipe: RECIPE },
    );
    expect(second.record.bodyVersionRef.version).toBe('1.1.0');
    expect(service.listRecords()).toHaveLength(2);
    expect(service.listRecordsByBody('tenant-a', 'ledger-reconciler')).toHaveLength(2);
    expect(service.listRecordsByBody('tenant-a', 'other-body')).toHaveLength(0);
    expect(service.listRecordsByManifest(second.record.manifestDigest)).toHaveLength(1);
  });
});

describe('input contracts (negative)', () => {
  it('requires a valid forge key', async () => {
    const service = new ForgeService();
    const manifest = await makeManifest();
    const policy = await makePolicy();
    await expect(
      service.submit(manifest, policy, { forgeKey: 'not valid!', recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_RECORD });
  });

  it('requires a structurally valid manifest and policy', async () => {
    const service = new ForgeService();
    const policy = await makePolicy();
    await expect(
      service.submit({ nope: true } as never, policy, { forgeKey: FORGE_KEY, recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_MANIFEST });
    const manifest = await makeManifest();
    await expect(
      service.submit(manifest, { nope: true } as never, { forgeKey: FORGE_KEY, recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_POLICY });
  });

  it('rejects tampered manifests and policies BEFORE composing (fail closed)', async () => {
    const service = new ForgeService();
    const policy = await makePolicy();
    const tampered = { ...(await makeManifest()), mission: 'A tampered mission.' };
    await expect(
      service.submit(tampered as never, policy, { forgeKey: FORGE_KEY, recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.TAMPERED });
    const manifest = await makeManifest();
    const tamperedPolicy = { ...policy, policyId: 'policy-tampered' };
    await expect(
      service.submit(manifest, tamperedPolicy as never, { forgeKey: FORGE_KEY, recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.TAMPERED });
    expect(service.listRecords()).toHaveLength(0);
  });

  it('the fabric enforces the package policy rules through the service', async () => {
    const service = new ForgeService();
    // A skill-free manifest under the default policy composes fine
    // (minSkills floor is 0).
    const manifest = await makeManifest({ skills: [] });
    const policy = await makePolicy();
    const result = await service.submit(manifest, policy, { forgeKey: FORGE_KEY, recipe: RECIPE });
    expect(result.bodyVersion.skills).toHaveLength(0);
    expect(service.listRecords()).toHaveLength(1);
  });
});
