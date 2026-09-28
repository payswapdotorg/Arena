/**
 * ExpertProfile tests (Work Order A006 gate 2 — THE §8 field-group suite;
 * gates 2/3/5/7 data contracts) — positive construction carrying EVERY §8
 * field, per-group missing/invalid negatives, content addressing,
 * deep-freezing, tamper detection and the derived-data rejection.
 */

import { describe, expect, it } from 'vitest';
import {  EXPERT_PROFILE_RECORD_VERSION,
  computeExpertProfileDigest,
  createExpertProfile,
  expertProfileContentView,
  expertVersionRef,
  isExpertProfile,
  verifyExpertProfile,
} from './profile.js';
import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import { recomputeReliabilityMetrics } from './reliability.js';
import {
  AT,
  AT_LATER,
  DECLARER,
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  DIGEST_D,
  DIGEST_E,
  RECORDER,
  minimalProfileInput,
  validProfileInput,
  expectRejectsCode,
} from './test-support.js';

describe('createExpertProfile (positive — every §8 field group present)', () => {
  it('creates a deep-frozen DRAFT profile carrying all §8 fields', async () => {
    const profile = await createExpertProfile(validProfileInput());
    expect(profile.recordVersion).toBe(EXPERT_PROFILE_RECORD_VERSION);
    expect(profile.status).toBe('draft');
    expect(profile.version).toBe('1.0.0');
    expect(profile.identity.tenant).toBe('tenant-a');
    expect(profile.identity.expertId).toBe('expert-invoice-reconciliation');

    // §8 identity: neutral id + declared identity refs (PII minimization).
    expect(profile.identityRefs).toHaveLength(1);
    expect(profile.identityRefs[0]!.kind).toBe('identity-attestation');

    // §8 competencies: capability/skill refs + proficiency evidence refs.
    expect(profile.competencies).toHaveLength(2);
    expect(profile.competencies[0]!.proficiency).toBe('proficient');
    expect(profile.competencies[0]!.proficiencyEvidence).toHaveLength(1);

    // §8 qualifications: typed records (credential refs, evidence digests, status).
    expect(profile.qualifications).toHaveLength(1);
    expect(profile.qualifications[0]!.status).toBe('verified');

    // §8 evidence: digest-addressed refs.
    expect(profile.evidence).toHaveLength(1);

    // §8 task history: append-only record refs (empty for a new expert).
    expect(profile.taskHistory).toEqual([]);

    // §8 reliability: the append-only event-sourced ledger (empty; counters derived).
    expect(profile.reliability).toEqual([]);
    const metrics = recomputeReliabilityMetrics(profile.reliability);
    expect(metrics.totalEvents).toBe(0);

    // §8 availability: typed windows.
    expect(profile.availability.windows).toHaveLength(2);

    // §8 domain/jurisdiction: explicit professional-limitation metadata.
    expect(profile.domainScope.domains).toHaveLength(1);
    expect(profile.domainScope.jurisdictions).toHaveLength(2);
    expect(profile.domainScope.limitations).toHaveLength(3);

    // Privacy policy (lock rule 23) + lifecycle + declaration.
    expect(profile.privacyPolicy.visibility.competencies).toBe('public');
    expect(profile.lifecycle).toHaveLength(1);
    expect(profile.lifecycle[0]!.kind).toBe('profile-created');
    expect(profile.lifecycle[0]!.actor.principalId).toBe(DECLARER.principalId);
    expect(profile.declaredAt).toBe(AT);

    // Immutability: deep-frozen everywhere.
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.competencies)).toBe(true);
    expect(Object.isFrozen(profile.competencies[0]!)).toBe(true);
    expect(() => {
      (profile as { status: string }).status = 'published';
    }).toThrow(TypeError);
  });

  it('is content-addressed: same content ⇒ same digest; any change ⇒ different digest', async () => {
    const a = await createExpertProfile(validProfileInput());
    const b = await createExpertProfile(validProfileInput());
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);

    const changed = await createExpertProfile({
      ...validProfileInput(),
      evidence: [
        { digest: DIGEST_D, description: 'Different foundational evidence.' },
      ],
    });
    expect(changed.digest).not.toBe(a.digest);

    const digestOfView = await computeExpertProfileDigest(
      expertProfileContentView(a),
    );
    expect(digestOfView).toBe(a.digest);
  });

  it('verifyExpertProfile passes and detects tampering (fail-closed)', async () => {
    const profile = await createExpertProfile(validProfileInput());
    await expect(verifyExpertProfile(profile)).resolves.toBe(profile.digest);
    await expect(verifyExpertProfile(profile, profile.digest)).resolves.toBe(
      profile.digest,
    );
    const { digest: _d, ...view } = profile;
    const tampered = {
      ...view,
      qualifications: [],
      digest: profile.digest,
    } as typeof profile;
    await expect(verifyExpertProfile(tampered)).rejects.toThrow(
      /digest mismatch/,
    );
    await expect(
      verifyExpertProfile(profile, 'f'.repeat(64)),
    ).rejects.toThrow(EXPERT_ERROR_CODES.TAMPERED ? /digest mismatch/ : /x/);
  });

  it('isExpertProfile recognizes the canonical record and rejects foreign shapes', async () => {
    const profile = await createExpertProfile(validProfileInput());
    expect(isExpertProfile(profile)).toBe(true);
    expect(isExpertProfile(null)).toBe(false);
    expect(isExpertProfile({ recordVersion: 99 })).toBe(false);
    expect(isExpertProfile({ ...profile, evidence: [] })).toBe(false);
  });

  it('expertVersionRef is the content-addressed ref of the exact state', async () => {
    const profile = await createExpertProfile(validProfileInput());
    const ref = expertVersionRef(profile);
    expect(ref.tenant).toBe('tenant-a');
    expect(ref.expertId).toBe('expert-invoice-reconciliation');
    expect(ref.version).toBe('1.0.0');
    expect(ref.digest).toBe(profile.digest);
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('the minimal variant (no identity refs, no qualifications) is valid', async () => {
    const profile = await createExpertProfile(minimalProfileInput());
    expect(profile.identityRefs).toEqual([]);
    expect(profile.qualifications).toEqual([]);
    expect(profile.evidence).toHaveLength(1); // still >= 1 foundational evidence
  });
});

describe('createExpertProfile (negative — missing required §8 field per group)', () => {
  const cases: readonly [string, (input: Record<string, unknown>) => void][] = [
    [
      'identity',
      (input) => {
        delete input['identity'];
      },
    ],
    [
      'identityRefs',
      (input) => {
        delete input['identityRefs'];
      },
    ],
    [
      'version',
      (input) => {
        delete input['version'];
      },
    ],
    [
      'competencies',
      (input) => {
        delete input['competencies'];
      },
    ],
    [
      'qualifications',
      (input) => {
        delete input['qualifications'];
      },
    ],
    [
      'evidence',
      (input) => {
        delete input['evidence'];
      },
    ],
    [
      'taskHistory',
      (input) => {
        delete input['taskHistory'];
      },
    ],
    [
      'reliability',
      (input) => {
        delete input['reliability'];
      },
    ],
    [
      'availability',
      (input) => {
        delete input['availability'];
      },
    ],
    [
      'domainScope',
      (input) => {
        delete input['domainScope'];
      },
    ],
    [
      'privacyPolicy',
      (input) => {
        delete input['privacyPolicy'];
      },
    ],
    [
      'declaredBy',
      (input) => {
        delete input['declaredBy'];
      },
    ],
    [
      'declaredAt',
      (input) => {
        delete input['declaredAt'];
      },
    ],
  ];

  for (const [field, mutate] of cases) {
    it(`rejects a missing ${field} field (§8 field group)`, async () => {
      const input = validProfileInput() as unknown as Record<string, unknown>;
      mutate(input);
      await expect(createExpertProfile(input as never)).rejects.toThrow(
        ExpertRegistryError,
      );
    });
  }

  it('rejects an empty competencies list (experts are capability providers)', async () => {
    await expect(
      createExpertProfile({ ...validProfileInput(), competencies: [] }),
    ).rejects.toThrow(/at least one competency/);
  });

  it('rejects an empty evidence list (evidence-free capability claims are not profiles)', async () => {
    await expect(
      createExpertProfile({ ...validProfileInput(), evidence: [] }),
    ).rejects.toThrow(/at least one digest-addressed foundational evidence/);
  });

  it('rejects an empty availability record', async () => {
    await expect(
      createExpertProfile({
        ...validProfileInput(),
        availability: { windows: [] },
      }),
    ).rejects.toThrow(/at least one typed window/);
  });

  it('rejects domain scopes without explicit limitations (lock rule 23)', async () => {
    await expect(
      createExpertProfile({
        ...validProfileInput(),
        domainScope: { ...validProfileInput().domainScope, limitations: [] },
      }),
    ).rejects.toThrow(/explicit professional limitation/);
  });
});

describe('createExpertProfile (negative — invalid values per group)', () => {
  it('rejects malformed identity and version', async () => {
    await expect(
      createExpertProfile({
        ...validProfileInput(),
        identity: { tenant: 'tenant-a', expertId: 'john-smith' },
      }),
    ).rejects.toThrow(/invalid expert id/);
    await expect(
      createExpertProfile({ ...validProfileInput(), version: '1.0.0+build' }),
    ).rejects.toThrow(/semver version/);
  });

  it('rejects non-array identityRefs', async () => {
    await expect(
      createExpertProfile({
        ...validProfileInput(),
        identityRefs: 'nope' as unknown as never,
      }),
    ).rejects.toThrow(ExpertRegistryError);
  });

  it('rejects cross-tenant task history (lock rule 11)', async () => {
    await expect(
      createExpertProfile({
        ...validProfileInput(),
        taskHistory: [
          {
            kind: 'task-outcome',
            tenant: 'tenant-b',
            taskId: 'task-x',
            version: '1.0.0',
            digest: DIGEST_E,
            occurredAt: AT_LATER,
          },
        ],
      }),
    ).rejects.toThrow(/tenant-scoped/);
  });

  it('rejects cross-tenant reliability entries and recorders (lock rule 11)', async () => {
    await expect(
      createExpertProfile({
        ...validProfileInput(),
        reliability: [
          {
            sequence: 1,
            kind: 'task-completed',
            occurredAt: AT_LATER,
            recordedBy: { type: 'service', tenant: 'tenant-b', principalId: 'rogue' },
          },
        ],
      }),
    ).rejects.toThrow(/tenant-scoped/);
    await expect(
      createExpertProfile({
        ...validProfileInput(),
        reliability: [
          {
            sequence: 1,
            kind: 'task-completed',
            occurredAt: AT_LATER,
            recordedBy: RECORDER,
            taskRecord: {
              kind: 'task-outcome',
              tenant: 'tenant-b',
              taskId: 'task-x',
              version: '1.0.0',
              digest: DIGEST_E,
              occurredAt: AT_LATER,
            },
          },
        ],
      }),
    ).rejects.toThrow(/tenant/);
  });

  it('rejects a cross-tenant declarer (lock rule 11)', async () => {
    await expect(
      createExpertProfile({
        ...validProfileInput(),
        declaredBy: { type: 'user', tenant: 'tenant-b', principalId: 'rogue' },
      }),
    ).rejects.toThrow(/declaring principal belongs to tenant/);
  });

  it('rejects malformed timestamps', async () => {
    await expect(
      createExpertProfile({ ...validProfileInput(), declaredAt: '2026-09-28' }),
    ).rejects.toThrow(ExpertRegistryError);
  });

  it('rejects invalid supersedes refs (cross-expert and non-ascending)', async () => {
    await expect(
      createExpertProfile({
        ...validProfileInput(),
        supersedes: {
          tenant: 'tenant-a',
          expertId: 'expert-someone-else',
          version: '0.9.0',
          digest: DIGEST_B,
        },
      }),
    ).rejects.toThrow(/same logical expert/);
    await expect(
      createExpertProfile({
        ...validProfileInput(),
        supersedes: {
          tenant: 'tenant-a',
          expertId: 'expert-invoice-reconciliation',
          version: '1.0.0',
          digest: DIGEST_B,
        },
      }),
    ).rejects.toThrow(/STRICTLY higher semver/);
  });
});

describe('createExpertProfile (negative — separation of concerns, gate 3)', () => {
  it('rejects authority-shaped fields at ANY depth of the input', async () => {
    for (const mutate of [
      (input: Record<string, unknown>) => {
        input['systemRole'] = 'admin';
      },
      (input: Record<string, unknown>) => {
        input['authority'] = 'root';
      },
      (input: Record<string, unknown>) => {
        input['adminOf'] = 'tenant-a';
      },
      (input: Record<string, unknown>) => {
        const competencies = input['competencies'] as Record<string, unknown>[];
        competencies[0]!['grantedScopes'] = ['read:all'];
      },
      (input: Record<string, unknown>) => {
        const qualifications = input['qualifications'] as Record<string, unknown>[];
        (qualifications[0]!['credential'] as Record<string, unknown>)['roles'] = ['auditor'];
      },
    ]) {
      const input = validProfileInput() as unknown as Record<string, unknown>;
      mutate(input);
      await expectRejectsCode(
        () => createExpertProfile(input as never),
        EXPERT_ERROR_CODES.AUTHORITY_FIELD_REJECTED,
      );
    }
  });

  it('rejects PII-shaped fields at ANY depth of the input', async () => {
    for (const mutate of [
      (input: Record<string, unknown>) => {
        input['email'] = 'john@example.com';
      },
      (input: Record<string, unknown>) => {
        input['legalName'] = 'John Doe';
      },
      (input: Record<string, unknown>) => {
        const refs = input['identityRefs'] as Record<string, unknown>[];
        refs[0]!['phoneNumber'] = '+491701234567';
      },
    ]) {
      const input = validProfileInput() as unknown as Record<string, unknown>;
      mutate(input);
      await expectRejectsCode(
        () => createExpertProfile(input as never),
        EXPERT_ERROR_CODES.PII_FIELD_REJECTED,
      );
    }
  });

  it('rejects unknown top-level fields (incl. declared derived metrics)', async () => {
    await expect(
      createExpertProfile({
        ...validProfileInput(),
        reliabilityMetrics: { tasksCompleted: 41 },
      } as never),
    ).rejects.toThrow(/unknown expert profile input field/);
    await expect(
      createExpertProfile({ ...validProfileInput(), extraField: 'x' } as never),
    ).rejects.toThrow(/unknown expert profile input field/);
  });
});

describe('createExpertProfile (negative — non-object inputs)', () => {
  it('rejects null and non-object inputs', async () => {
    await expect(createExpertProfile(null as never)).rejects.toThrow(
      /plain object/,
    );
    await expect(createExpertProfile('nope' as never)).rejects.toThrow(
      /plain object/,
    );
  });
});

describe('profile content addressing discipline', () => {
  it('the digest covers the reliability ledger (event-sourced content)', async () => {
    const base = await createExpertProfile(validProfileInput());
    const withEvidence = await createExpertProfile({
      ...validProfileInput(),
      reliability: [
        {
          sequence: 1,
          kind: 'task-completed',
          occurredAt: AT_LATER,
          recordedBy: RECORDER,
        },
      ],
    });
    expect(withEvidence.digest).not.toBe(base.digest);
    const metrics = recomputeReliabilityMetrics(withEvidence.reliability);
    expect(metrics.tasksCompleted).toBe(1);
    expect(metrics.totalEvents).toBe(1);
  });

  it('the digest covers identity refs and qualifications (all §8 groups)', async () => {
    const base = await createExpertProfile(validProfileInput());
    const noRefs = await createExpertProfile(minimalProfileInput());
    expect(noRefs.digest).not.toBe(base.digest);
    const differentCompetency = await createExpertProfile({
      ...validProfileInput(),
      competencies: [
        {
          ...validProfileInput().competencies[0]!,
          proficiency: 'advanced',
        },
      ],
    });
    expect(differentCompetency.digest).not.toBe(base.digest);
  });

  it('unused fixture digests stay distinct (fixture sanity)', () => {
    expect(DIGEST_A).not.toBe(DIGEST_B);
    expect(DIGEST_C).not.toBe(DIGEST_D);
  });
});
