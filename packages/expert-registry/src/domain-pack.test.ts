/**
 * Domain-pack tests (Work Order A006 gate 8; R37) — packs ADD domain
 * competency types/metadata and can NEVER alter lifecycle semantics or
 * inject authority/PII fields (all negative paths machine-tested).
 */

import { describe, expect, it } from 'vitest';
import {
  EXPERT_DOMAIN_PACK_VERSION,
  assertProfileConformsToDomainPacks,
  createExpertDomainPack,
  isExpertDomainPack,
} from './domain-pack.js';
import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import { createExpertProfile } from './profile.js';
import {
  expectThrowsCode, expectRejectsCode,
  validDomainPackInput,
  validProfileInput,
} from './test-support.js';

describe('createExpertDomainPack (positive)', () => {
  it('creates a content-addressed, deep-frozen pack descriptor', async () => {
    const pack = await createExpertDomainPack(validDomainPackInput());
    expect(pack.packVersion).toBe(EXPERT_DOMAIN_PACK_VERSION);
    expect(pack.id).toBe('structural-engineering');
    expect(pack.competencyTypes).toHaveLength(2);
    expect(pack.metadataFields).toHaveLength(2);
    expect(pack.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(isExpertDomainPack(pack)).toBe(true);
    expect(Object.isFrozen(pack)).toBe(true);
    expect(Object.isFrozen(pack.competencyTypes)).toBe(true);
  });

  it('same input ⇒ same digest; any change ⇒ different digest', async () => {
    const a = await createExpertDomainPack(validDomainPackInput());
    const b = await createExpertDomainPack(validDomainPackInput());
    expect(a.digest).toBe(b.digest);
    const changed = await createExpertDomainPack({
      ...validDomainPackInput(),
      description: 'Changed description.',
    });
    expect(changed.digest).not.toBe(a.digest);
  });

  it('metadataFields may be empty (types-only packs are valid)', async () => {
    const pack = await createExpertDomainPack({
      ...validDomainPackInput(),
      metadataFields: [],
    });
    expect(pack.metadataFields).toEqual([]);
  });
});

describe('createExpertDomainPack (negative — R37 guards)', () => {
  it('rejects pack inputs that try to ALTER LIFECYCLE SEMANTICS', async () => {
    for (const extra of [
      { lifecycle: 'DRAFT → DELETED' },
      { statuses: ['draft', 'published', 'deleted'] },
      { transitions: [{ from: 'draft', to: 'archived' }] },
      { statusSet: 'custom' },
    ]) {
      await expect(
        createExpertDomainPack({ ...validDomainPackInput(), ...extra } as never),
      ).rejects.toThrow(/cannot declare/);
    }
  });

  it('rejects packs that try to INJECT AUTHORITY FIELDS (lock rule 9)', async () => {
    // Via declared metadata field names…
    await expectRejectsCode(
      () =>
        createExpertDomainPack({
          ...validDomainPackInput(),
          metadataFields: [
            ...validDomainPackInput().metadataFields,
            { field: 'adminOf', valueType: 'string', required: false, description: 'x' },
          ],
        }),
      EXPERT_ERROR_CODES.AUTHORITY_FIELD_REJECTED,
    );
    // …via declared competency type ids…
    await expect(
      createExpertDomainPack({
        ...validDomainPackInput(),
        competencyTypes: [
          ...validDomainPackInput().competencyTypes,
          { type: 'structural.system-role', description: 'x' },
        ],
      }),
    ).rejects.toThrow(/authority-shaped/);
    // …and via raw authority-shaped input keys at any depth.
    await expectRejectsCode(
      () =>
        createExpertDomainPack({
          ...validDomainPackInput(),
          competencyTypes: [
            ...validDomainPackInput().competencyTypes,
            { type: 'structural.ok-type', description: 'x', grantedScopes: ['all'] },
          ],
        } as never),
      EXPERT_ERROR_CODES.AUTHORITY_FIELD_REJECTED,
    );
  });

  it('rejects packs that try to inject PII field names', async () => {
    await expectRejectsCode(
      () =>
        createExpertDomainPack({
          ...validDomainPackInput(),
          metadataFields: [
            { field: 'email', valueType: 'string', required: false, description: 'contact' },
          ],
        }),
      EXPERT_ERROR_CODES.PII_FIELD_REJECTED,
    );
  });

  it('rejects malformed ids, versions, descriptions and declarations', async () => {
    await expect(
      createExpertDomainPack({ ...validDomainPackInput(), id: 'Bad Id' }),
    ).rejects.toThrow(/invalid domain pack id/);
    await expect(
      createExpertDomainPack({ ...validDomainPackInput(), version: '1.0' }),
    ).rejects.toThrow(/invalid domain pack version/);
    await expect(
      createExpertDomainPack({ ...validDomainPackInput(), description: '' }),
    ).rejects.toThrow(/non-empty description/);
    await expect(
      createExpertDomainPack({ ...validDomainPackInput(), competencyTypes: [] }),
    ).rejects.toThrow(/at least one domain competency type/);
    await expect(
      createExpertDomainPack({
        ...validDomainPackInput(),
        competencyTypes: [
          { type: 'Bad Type', description: 'x' },
        ],
      }),
    ).rejects.toThrow(/invalid domain competency type/);
    await expect(
      createExpertDomainPack({
        ...validDomainPackInput(),
        competencyTypes: [
          ...validDomainPackInput().competencyTypes,
          { type: 'structural.load-analysis', description: 'duplicate' },
        ],
      }),
    ).rejects.toThrow(/duplicate domain competency type/);
    await expect(
      createExpertDomainPack({
        ...validDomainPackInput(),
        metadataFields: [
          ...validDomainPackInput().metadataFields,
          {
            field: 'stampEligibility',
            valueType: 'string',
            required: false,
            description: 'duplicate',
          },
        ],
      }),
    ).rejects.toThrow(/duplicate domain metadata field/);
    await expect(
      createExpertDomainPack({
        ...validDomainPackInput(),
        metadataFields: [
          { field: 'years', valueType: 'object', required: false, description: 'x' },
        ],
      }),
    ).rejects.toThrow(/unknown domain metadata value type/);
    await expect(
      createExpertDomainPack({ ...validDomainPackInput(), metadataFields: 'x' as never }),
    ).rejects.toThrow(ExpertRegistryError);
    await expect(
      createExpertDomainPack(null as never),
    ).rejects.toThrow(/plain object/);
  });
});

describe('assertProfileConformsToDomainPacks (R37 binding)', () => {
  it('accepts conforming domain-typed competencies', async () => {
    const pack = await createExpertDomainPack(validDomainPackInput());
    const profile = await createExpertProfile({
      ...validProfileInput(),
      competencies: [
        ...validProfileInput().competencies,
        {
          capability: {
            kind: 'capability',
            id: 'load-analysis',
            version: '1.0.0',
            digest: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
          },
          proficiency: 'advanced',
          proficiencyEvidence: [
            {
              digest: 'b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
              description: 'Load analysis review set.',
            },
          ],
          domainType: 'structural.load-analysis',
          domainMetadata: {
            stampEligibility: 'informational only',
            yearsOfPractice: 12,
          },
        },
      ],
    });
    expect(() => assertProfileConformsToDomainPacks(profile, [pack])).not.toThrow();
  });

  it('accepts profiles without domain-typed competencies (packs are additive)', async () => {
    const pack = await createExpertDomainPack(validDomainPackInput());
    const profile = await createExpertProfile(validProfileInput());
    expect(() => assertProfileConformsToDomainPacks(profile, [pack])).not.toThrow();
    expect(() => assertProfileConformsToDomainPacks(profile, [])).not.toThrow();
  });

  it('rejects undeclared domain types (negative)', async () => {
    const pack = await createExpertDomainPack(validDomainPackInput());
    const profile = await createExpertProfile({
      ...validProfileInput(),
      competencies: [
        {
          ...validProfileInput().competencies[0]!,
          domainType: 'structural.unknown-type',
        },
      ],
    });
    expectThrowsCode(
      () => assertProfileConformsToDomainPacks(profile, [pack]),
      EXPERT_ERROR_CODES.UNKNOWN_DOMAIN_COMPETENCY_TYPE,
    );
    // No packs provided at all: the type is still undeclared.
    expect(() => assertProfileConformsToDomainPacks(profile, [])).toThrow(
      /undeclared domain type/,
    );
  });

  it('rejects undeclared metadata keys, type mismatches and missing required fields', async () => {
    const pack = await createExpertDomainPack(validDomainPackInput());
    const base = {
      ...validProfileInput().competencies[0]!,
      domainType: 'structural.load-analysis',
    };
    const undeclared = await createExpertProfile({
      ...validProfileInput(),
      competencies: [{ ...base, domainMetadata: { unknownField: 'x' } }],
    });
    expect(() => assertProfileConformsToDomainPacks(undeclared, [pack])).toThrow(
      /not declared by any provided pack/,
    );
    const wrongType = await createExpertProfile({
      ...validProfileInput(),
      competencies: [{ ...base, domainMetadata: { yearsOfPractice: 'twelve' } }],
    });
    expect(() => assertProfileConformsToDomainPacks(wrongType, [pack])).toThrow(
      /must be number/,
    );
    const missingRequired = await createExpertProfile({
      ...validProfileInput(),
      competencies: [{ ...base, domainMetadata: { yearsOfPractice: 12 } }],
    });
    expect(() => assertProfileConformsToDomainPacks(missingRequired, [pack])).toThrow(
      /requires metadata field "stampEligibility"/,
    );
  });

  it('re-screens declared names during conformance (defense in depth)', async () => {
    // A rogue PACK (bypassing createExpertDomainPack) declaring an
    // authority-shaped type, PLUS a hand-crafted profile carrying that type
    // (bypassing createExpertProfile — e.g. deserialized from foreign
    // tooling), must still be rejected at the conformance boundary.
    const roguePack = {
      packVersion: EXPERT_DOMAIN_PACK_VERSION,
      id: 'rogue',
      version: '1.0.0',
      description: 'A rogue pack constructed out-of-band.',
      competencyTypes: [{ type: 'rogue.admin-of', description: 'x' }],
      metadataFields: [],
      digest: 'c'.repeat(64),
    };
    const clean = await createExpertProfile(validProfileInput());
    const handCrafted = JSON.parse(JSON.stringify(clean)) as unknown as {
      competencies: { domainType?: string; domainMetadata?: Record<string, unknown> }[];
    } & Parameters<typeof assertProfileConformsToDomainPacks>[0];
    handCrafted.competencies[0]!.domainType = 'rogue.admin-of';
    expectThrowsCode(
      () => assertProfileConformsToDomainPacks(handCrafted, [roguePack as never]),
      EXPERT_ERROR_CODES.AUTHORITY_FIELD_REJECTED,
    );
    // And a PII-shaped metadata key on the same hand-crafted profile.
    const piiPack = {
      ...roguePack,
      competencyTypes: [{ type: 'rogue.ok-type', description: 'x' }],
      metadataFields: [{ field: 'email', valueType: 'string', required: false, description: 'x' }],
    };
    const handCrafted2 = JSON.parse(JSON.stringify(clean)) as unknown as {
      competencies: { domainType?: string; domainMetadata?: Record<string, unknown> }[];
    } & Parameters<typeof assertProfileConformsToDomainPacks>[0];
    handCrafted2.competencies[0]!.domainType = 'rogue.ok-type';
    handCrafted2.competencies[0]!.domainMetadata = { email: 'x@example.com' };
    expectThrowsCode(
      () => assertProfileConformsToDomainPacks(handCrafted2, [piiPack as never]),
      EXPERT_ERROR_CODES.PII_FIELD_REJECTED,
    );
  });
});
