/**
 * ExpertRegistry tests (Work Order A006 gates 4 and 6) — append-only
 * registration records, idempotent re-registration, identity conflicts,
 * lifecycle state records, supersession, digest/neutral-id addressability
 * and tenant scoping (cross-tenant negatives).
 */

import { describe, expect, it } from 'vitest';
import {
  EXPERT_REGISTRATION_RECORD_VERSION,
  createExpertRegistry,
  getExpert,
  getExpertByDigest,
  hasExpert,
  isExpertRegistry,
  listExperts,
  listExpertVersions,
  listRegistrationRecords,
  recordProfileState,
  recordSupersession,
  registerExpert,
} from './registry.js';
import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import {
  attachExpertEvidence,
  publishProfile,
  retireProfile,
} from './lifecycle.js';
import { createExpertProfile, expertVersionRef } from './profile.js';
import {
  AT,
  AT_EVEN_LATER,
  AT_LATER,
  DECLARER,
  DIGEST_D,
  expectThrowsCode,
  otherTenantProfileInput,
  RECORDER,
  validProfileInput,
} from './test-support.js';

const SCOPE_A = { tenant: 'tenant-a' };
const SCOPE_B = { tenant: 'tenant-b' };

async function draft() {
  return createExpertProfile(validProfileInput());
}

describe('registry basics (positive)', () => {
  it('creates an empty frozen registry', () => {
    const registry = createExpertRegistry();
    expect(registry.registrations).toEqual([]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(isExpertRegistry(registry)).toBe(true);
  });

  it('registerExpert appends exactly one registration record', async () => {
    const registry = registerExpert(createExpertRegistry(), await draft(), {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    expect(registry.registrations).toHaveLength(1);
    const record = registry.registrations[0]!;
    expect(record.recordVersion).toBe(EXPERT_REGISTRATION_RECORD_VERSION);
    expect(record.sequence).toBe(1);
    expect(record.profile.status).toBe('draft');
    expect(record.registeredBy.principalId).toBe(DECLARER.principalId);
    expect(Object.isFrozen(registry.registrations)).toBe(true);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it('getExpert / getExpertByDigest / hasExpert / listExperts work (neutral id + digest)', async () => {
    const draftProfile = await draft();
    const registry = registerExpert(createExpertRegistry(), draftProfile, {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    expect(
      getExpert(
        registry,
        { tenant: 'tenant-a', expertId: 'expert-invoice-reconciliation' },
        SCOPE_A,
      ).digest,
    ).toBe(draftProfile.digest);
    expect(getExpertByDigest(registry, draftProfile.digest, SCOPE_A).version).toBe(
      '1.0.0',
    );
    expect(
      hasExpert(
        registry,
        { tenant: 'tenant-a', expertId: 'expert-invoice-reconciliation' },
        SCOPE_A,
      ),
    ).toBe(true);
    expect(
      hasExpert(registry, { tenant: 'tenant-a', expertId: 'expert-nobody' }, SCOPE_A),
    ).toBe(false);
    expect(listExperts(registry, SCOPE_A)).toHaveLength(1);
    expect(listRegistrationRecords(registry, SCOPE_A)).toHaveLength(1);
  });
});

describe('gate 4 — idempotent re-registration and identity conflict (negative)', () => {
  it('re-registering the SAME digest is idempotent (no duplicate record)', async () => {
    const draftProfile = await draft();
    const once = registerExpert(createExpertRegistry(), draftProfile, {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    const twice = registerExpert(once, draftProfile, {
      registeredBy: DECLARER,
      registeredAt: AT_LATER,
    });
    expect(twice).toBe(once);
    expect(twice.registrations).toHaveLength(1);
  });

  it('a DIFFERENT profile under the same neutral id is rejected (conflict)', async () => {
    const first = await draft();
    const registry = registerExpert(createExpertRegistry(), first, {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    const different = await createExpertProfile({
      ...validProfileInput(),
      evidence: [
        { digest: DIGEST_D, description: 'A different evidence set entirely.' },
      ],
    });
    expectThrowsCode(
      () => registerExpert(registry, different, { registeredBy: DECLARER, registeredAt: AT_LATER }),
      EXPERT_ERROR_CODES.IDENTITY_CONFLICT,
    );
    try {
      registerExpert(registry, different, { registeredBy: DECLARER, registeredAt: AT_LATER });
    } catch (error) {
      expect((error as ExpertRegistryError).message).toMatch(/first registration wins/);
    }
  });

  it('initial registration requires a fresh draft (one profile-created event)', async () => {
    const published = await publishProfile(await draft(), { at: AT_LATER, actor: DECLARER });
    expect(() =>
      registerExpert(createExpertRegistry(), published, {
        registeredBy: DECLARER,
        registeredAt: AT_LATER,
      }),
    ).toThrow(/fresh draft profile/);
  });

  it('a fresh profile cannot carry a supersededBy ref', async () => {
    // Hand-craft a single-event draft carrying a supersededBy ref (the pure
    // constructor never produces this shape) to hit the admission guard.
    const draftProfile = await draft();
    type ProfileParam = Parameters<typeof registerExpert>[1];
    const crafted = JSON.parse(
      JSON.stringify({
        ...draftProfile,
        supersededBy: {
          tenant: 'tenant-a',
          expertId: 'expert-invoice-reconciliation',
          version: '2.0.0',
          digest: 'e'.repeat(64),
        },
      }),
    ) as unknown as ProfileParam;
    expectThrowsCode(
      () =>
        registerExpert(createExpertRegistry(), crafted, {
          registeredBy: DECLARER,
          registeredAt: AT_LATER,
        }),
      EXPERT_ERROR_CODES.INVALID_LIFECYCLE,
    );
  });

  it('cross-tenant registration is denied (lock rule 11)', async () => {
    const draftProfile = await draft();
    expectThrowsCode(
      () =>
        registerExpert(createExpertRegistry(), draftProfile, {
          registeredBy: { type: 'user', tenant: 'tenant-b', principalId: 'rogue' },
          registeredAt: AT,
        }),
      EXPERT_ERROR_CODES.CROSS_TENANT_ACCESS,
    );
  });
});

describe('recordProfileState (append-only within a version)', () => {
  it('admits lifecycle states and keeps every historical state addressable', async () => {
    let registry = registerExpert(createExpertRegistry(), await draft(), {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    const draftState = registry.registrations[0]!.profile;
    const published = await publishProfile(draftState, { at: AT_LATER, actor: DECLARER });
    registry = recordProfileState(registry, published, {
      registeredBy: DECLARER,
      registeredAt: AT_LATER,
    });
    expect(registry.registrations).toHaveLength(2);
    // The DRAFT state is still addressable by its digest (append-only).
    expect(getExpertByDigest(registry, draftState.digest, SCOPE_A).status).toBe('draft');
    expect(getExpert(registry, draftState.identity, SCOPE_A).status).toBe('published');
    // Idempotent re-assertion of an admitted state.
    const again = recordProfileState(registry, published, {
      registeredBy: DECLARER,
      registeredAt: AT_EVEN_LATER,
    });
    expect(again).toBe(registry);
  });

  it('rejects states for unregistered versions', async () => {
    const foreign = await createExpertProfile({
      ...validProfileInput(),
      identity: { tenant: 'tenant-a', expertId: 'expert-unregistered' },
    });
    const published = await publishProfile(foreign, { at: AT_LATER, actor: DECLARER });
    expectThrowsCode(
      () =>
        recordProfileState(createExpertRegistry(), published, {
          registeredBy: DECLARER,
          registeredAt: AT_LATER,
        }),
      EXPERT_ERROR_CODES.EXPERT_NOT_FOUND,
    );
  });

  it('rejects terminal-advancing admissions and history rewrites', async () => {
    let registry = registerExpert(createExpertRegistry(), await draft(), {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    const draftState = registry.registrations[0]!.profile;
    const published = await publishProfile(draftState, { at: AT_LATER, actor: DECLARER });
    registry = recordProfileState(registry, published, {
      registeredBy: DECLARER,
      registeredAt: AT_LATER,
    });
    const retired = await retireProfile(published, {
      at: AT_EVEN_LATER,
      actor: DECLARER,
      note: 'Done.',
    });
    registry = recordProfileState(registry, retired, {
      registeredBy: DECLARER,
      registeredAt: AT_EVEN_LATER,
    });
    // A ninth-life mutation of the retired state is rejected.
    const zombie = await attachExpertEvidence(retired, {
      at: AT_EVEN_LATER,
      actor: DECLARER,
      evidence: [{ digest: DIGEST_D, description: 'Should not be admissible.' }],
    }).catch(() => null);
    expect(zombie).toBeNull(); // terminal guard fires first in the pure function
    expect(registry.registrations).toHaveLength(3);
  });
});

describe('recordSupersession (gate 5 — new versions admitted, old kept)', () => {
  it('admits a superseding version and records the superseded ref', async () => {
    let registry = registerExpert(createExpertRegistry(), await draft(), {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    const v1 = registry.registrations[0]!.profile;
    const v1Published = await publishProfile(v1, { at: AT_LATER, actor: DECLARER });
    registry = recordProfileState(registry, v1Published, {
      registeredBy: DECLARER,
      registeredAt: AT_LATER,
    });
    const v2 = await createExpertProfile({
      ...validProfileInput(),
      version: '2.0.0',
      supersedes: expertVersionRef(v1Published),
      declaredAt: AT_EVEN_LATER,
    });
    registry = recordSupersession(registry, v2, {
      registeredBy: DECLARER,
      registeredAt: AT_EVEN_LATER,
    });
    expect(registry.registrations).toHaveLength(3);
    const lastRecord = registry.registrations[2]!;
    expect(lastRecord.supersedes?.version).toBe('1.0.0');
    // Both versions addressable; v1 still retrievable by digest AND version.
    expect(getExpertByDigest(registry, v1.digest, SCOPE_A).version).toBe('1.0.0');
    expect(getExpert(registry, v1.identity, SCOPE_A, '2.0.0').version).toBe('2.0.0');
    expect(getExpert(registry, v1.identity, SCOPE_A).version).toBe('2.0.0');
    const versions = listExpertVersions(registry, v1.identity, SCOPE_A);
    expect(versions.map((p) => p.version)).toEqual(['1.0.0', '2.0.0']);
  });

  it('rejects supersession without a supersedes ref or addressing a stale state', async () => {
    let registry = registerExpert(createExpertRegistry(), await draft(), {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    const v1 = registry.registrations[0]!.profile;
    const noRef = await createExpertProfile({
      ...validProfileInput(),
      version: '2.0.0',
      declaredAt: AT_LATER,
    });
    expectThrowsCode(
      () =>
        recordSupersession(registry, noRef, {
          registeredBy: DECLARER,
          registeredAt: AT_LATER,
        }),
      EXPERT_ERROR_CODES.INVALID_SUPERSESSION,
    );
    const v2 = await createExpertProfile({
      ...validProfileInput(),
      version: '2.0.0',
      supersedes: expertVersionRef(v1),
      declaredAt: AT_LATER,
    });
    // While v1's DRAFT state is the latest admitted state, the supersession
    // addressing it is admissible…
    registry = recordSupersession(registry, v2, {
      registeredBy: DECLARER,
      registeredAt: AT_LATER,
    });
    expect(registry.registrations).toHaveLength(2);
    // …but a supersedes ref addressing a state that is NOT the current
    // admitted state (the superseded draft, after v2 became current) is stale.
    const v3 = await createExpertProfile({
      ...validProfileInput(),
      version: '3.0.0',
      supersedes: expertVersionRef(v1),
      declaredAt: AT_EVEN_LATER,
    });
    expectThrowsCode(
      () =>
        recordSupersession(registry, v3, {
          registeredBy: DECLARER,
          registeredAt: AT_EVEN_LATER,
        }),
      EXPERT_ERROR_CODES.INVALID_SUPERSESSION,
    );
  });

  it('rejects superseding versions that drop or rewrite append-only history', async () => {
    const registry = registerExpert(createExpertRegistry(), await draft(), {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    const v1 = registry.registrations[0]!.profile;
    const grownV1 = await attachExpertEvidence(v1, {
      at: AT_LATER,
      actor: DECLARER,
      evidence: [{ digest: DIGEST_D, description: 'Added before superseding.' }],
    });
    const recorded = recordProfileState(registry, grownV1, {
      registeredBy: DECLARER,
      registeredAt: AT_LATER,
    });
    const dropping = await createExpertProfile({
      ...validProfileInput(),
      version: '2.0.0',
      supersedes: expertVersionRef(grownV1),
      declaredAt: AT_EVEN_LATER,
    });
    expectThrowsCode(
      () =>
        recordSupersession(recorded, dropping, {
          registeredBy: DECLARER,
          registeredAt: AT_EVEN_LATER,
        }),
      EXPERT_ERROR_CODES.EVIDENCE_REMOVAL,
    );
  });

  it('rejects retraction of declared identity refs across versions', async () => {
    const registry = registerExpert(createExpertRegistry(), await draft(), {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    const v1 = registry.registrations[0]!.profile;
    const retracting = await createExpertProfile({
      ...validProfileInput(),
      version: '2.0.0',
      identityRefs: [],
      supersedes: expertVersionRef(v1),
      declaredAt: AT_LATER,
    });
    expectThrowsCode(
      () =>
        recordSupersession(registry, retracting, {
          registeredBy: DECLARER,
          registeredAt: AT_LATER,
        }),
      EXPERT_ERROR_CODES.INVALID_IDENTITY_REF,
    );
  });

  it('rejects supersession for unknown experts', async () => {
    const stranger = await createExpertProfile({
      ...validProfileInput(),
      identity: { tenant: 'tenant-a', expertId: 'expert-stranger' },
      version: '2.0.0',
      supersedes: {
        tenant: 'tenant-a',
        expertId: 'expert-stranger',
        version: '1.0.0',
        digest: 'a'.repeat(64),
      },
      declaredAt: AT_LATER,
    });
    expectThrowsCode(
      () =>
        recordSupersession(createExpertRegistry(), stranger, {
          registeredBy: DECLARER,
          registeredAt: AT_LATER,
        }),
      EXPERT_ERROR_CODES.EXPERT_NOT_FOUND,
    );
  });
});

describe('gate 6 — tenant scoping (cross-tenant negatives)', () => {
  it('cross-tenant reads fail closed on every query surface', async () => {
    const registry = registerExpert(createExpertRegistry(), await draft(), {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    const profile = registry.registrations[0]!.profile;
    const identity = { tenant: 'tenant-a', expertId: profile.identity.expertId };
    expectThrowsCode(() => getExpert(registry, identity, SCOPE_B), EXPERT_ERROR_CODES.CROSS_TENANT_ACCESS);
    expectThrowsCode(
      () => getExpertByDigest(registry, profile.digest, SCOPE_B),
      EXPERT_ERROR_CODES.CROSS_TENANT_ACCESS,
    );
    expectThrowsCode(
      () => listExpertVersions(registry, identity, SCOPE_B),
      EXPERT_ERROR_CODES.CROSS_TENANT_ACCESS,
    );
    expect(listExperts(registry, SCOPE_B)).toEqual([]);
    expect(listRegistrationRecords(registry, SCOPE_B)).toEqual([]);
    expect(hasExpert(registry, identity, SCOPE_B)).toBe(false);
  });

  it('the reserved public namespace is readable by every tenant', async () => {
    const publicInput = {
      ...validProfileInput(),
      identity: { tenant: 'public', expertId: 'expert-open-knowledge' },
      declaredBy: { type: 'user', tenant: 'public', principalId: 'expert-intake' },
    };
    const registry = registerExpert(
      createExpertRegistry(),
      await createExpertProfile(publicInput),
      { registeredBy: { type: 'user', tenant: 'public', principalId: 'expert-intake' }, registeredAt: AT },
    );
    expect(
      getExpert(registry, { tenant: 'public', expertId: 'expert-open-knowledge' }, SCOPE_B).identity
        .tenant,
    ).toBe('public');
    expect(listExperts(registry, SCOPE_B)).toHaveLength(1);
  });

  it('multi-tenant isolation: each tenant sees only its own experts', async () => {
    const a = await draft();
    const b = await createExpertProfile(otherTenantProfileInput());
    let registry = registerExpert(createExpertRegistry(), a, {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    registry = registerExpert(registry, b, {
      registeredBy: { type: 'user', tenant: 'tenant-b', principalId: 'expert-intake' },
      registeredAt: AT,
    });
    expect(listExperts(registry, SCOPE_A)).toHaveLength(1);
    expect(listExperts(registry, SCOPE_B)).toHaveLength(1);
    expect(listExperts(registry, SCOPE_A)[0]!.identity.tenant).toBe('tenant-a');
    expect(listRegistrationRecords(registry, SCOPE_A)).toHaveLength(1);
    expect(registry.registrations).toHaveLength(2); // but the full log has both
  });

  it('invalid reader tenants are rejected', async () => {
    const registry = registerExpert(createExpertRegistry(), await draft(), {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    expect(() => listExperts(registry, { tenant: 'BAD' })).toThrow(
      /invalid reader tenant scope/,
    );
  });
});

describe('registration records as audit surface', () => {
  it('the admission log is append-only and sequenced (R28-style evidence)', async () => {
    let registry = registerExpert(createExpertRegistry(), await draft(), {
      registeredBy: DECLARER,
      registeredAt: AT,
    });
    const draftState = registry.registrations[0]!.profile;
    const published = await publishProfile(draftState, { at: AT_LATER, actor: DECLARER });
    registry = recordProfileState(registry, published, {
      registeredBy: RECORDER,
      registeredAt: AT_LATER,
    });
    const sequences = registry.registrations.map((r) => r.sequence);
    expect(sequences).toEqual([1, 2]);
    // The first record is untouched by the second admission.
    expect(registry.registrations[0]!.registeredAt).toBe(AT);
    expect(registry.registrations[0]!.profile.digest).toBe(draftState.digest);
    expect(() => {
      (registry.registrations as unknown[]).pop();
    }).toThrow(TypeError);
  });
});
