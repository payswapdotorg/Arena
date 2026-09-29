/**
 * Manifest unit tests (Work Order A021): construction, freezing,
 * content-addressing, tamper detection, closed vocabularies,
 * mandatory rights, citation structure, conflict rules and the HARD
 * supersedes-requires-parent lineage rule.
 */

import { describe, expect, it } from 'vitest';
import { AGENT_BODY_ERROR_CODES } from '@arena/agent-body';
import {
  BODY_MANIFEST_FIELDS,
  BODY_MANIFEST_VERSION,
  MANIFEST_CAPABILITY_KINDS,
  MANIFEST_CITATION_KINDS,
  bodyManifestKey,
  bodyManifestView,
  computeBodyManifestDigest,
  createBodyManifest,
  isBodyManifest,
  isBodyManifestView,
  isManifestCitation,
  manifestArtifactRef,
  verifyBodyManifest,
  BODY_FORGE_ERROR_CODES,
} from './index.js';
import { DIGEST_A, DIGEST_B, DIGEST_F, DIGEST_G, T0, makeManifestInput, parentRefV1 } from './test-support.js';

describe('BodyManifest construction (positive)', () => {
  it('creates a frozen, content-addressed manifest from a valid input', async () => {
    const manifest = await createBodyManifest(makeManifestInput());
    expect(isBodyManifest(manifest)).toBe(true);
    expect(isBodyManifestView(bodyManifestView(manifest))).toBe(true);
    expect(manifest.recordVersion).toBe(BODY_MANIFEST_VERSION);
    expect(manifest.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.capabilities)).toBe(true);
    expect(Object.isFrozen(manifest.provenance)).toBe(true);
    expect(Object.isFrozen(manifest.lineage)).toBe(true);
    expect(manifest.capabilities[0]?.kind).toBe('capability');
    expect(manifest.capabilities[0]?.id).toBe('capability-reconciliation');
    expect(manifest.skills[0]?.namespace).toBe('arena-skills');
  });

  it('content-addresses: identical inputs ⇒ identical digests; different content ⇒ different digests', async () => {
    const a = await createBodyManifest(makeManifestInput());
    const b = await createBodyManifest(makeManifestInput());
    expect(a.digest).toBe(b.digest);
    const c = await createBodyManifest(makeManifestInput({ mission: 'A different mission.' }));
    expect(c.digest).not.toBe(a.digest);
    // The digest commits to exactly the digest-free view.
    expect(await computeBodyManifestDigest(bodyManifestView(a))).toBe(a.digest);
  });

  it('exposes stable keys and a content-addressed artifact ref', async () => {
    const manifest = await createBodyManifest(makeManifestInput());
    expect(bodyManifestKey(manifest)).toBe(
      `manifest-reconciliation-v1@1.0.0#${manifest.digest}`,
    );
    const ref = manifestArtifactRef(manifest);
    expect(ref).toEqual({
      namespace: 'body-forge',
      name: 'manifest-reconciliation-v1',
      version: '1.0.0',
      digest: manifest.digest,
    });
  });

  it('mirrors the stable field list', () => {
    expect(BODY_MANIFEST_FIELDS).toContain('substrateCompatibility');
    expect(BODY_MANIFEST_FIELDS).toContain('provenance');
    expect(BODY_MANIFEST_FIELDS).toContain('lineage');
    expect(BODY_MANIFEST_FIELDS).toHaveLength(25);
  });
});

describe('tamper detection', () => {
  it('verifyBodyManifest fails closed with BODY_FORGE_TAMPERED on a mutated copy', async () => {
    const manifest = await createBodyManifest(makeManifestInput());
    expect(await verifyBodyManifest(manifest)).toBe(manifest.digest);
    const tampered = { ...manifest, mission: 'A tampered mission.' } as typeof manifest;
    await expect(verifyBodyManifest(tampered)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.TAMPERED,
    });
  });

  it('rejects a non-manifest object outright', async () => {
    await expect(verifyBodyManifest({ not: 'a-manifest' } as never)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_MANIFEST,
    });
  });
});

describe('mandatory fields and A003 floors (negative)', () => {
  it('rejects an empty domainScope', async () => {
    await expect(createBodyManifest(makeManifestInput({ domainScope: [] }))).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_MANIFEST,
    });
  });

  it('rejects missing evaluation suites (a forged body version is evaluated; lock rule 7)', async () => {
    await expect(
      createBodyManifest({ ...makeManifestInput(), evaluationSuites: [] }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_MANIFEST });
  });

  it('rejects missing verification suites', async () => {
    await expect(
      createBodyManifest({ ...makeManifestInput(), verificationSuites: [] }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_MANIFEST });
  });

  it('rejects missing environment requirements', async () => {
    await expect(
      createBodyManifest({ ...makeManifestInput(), environmentRequirements: [] }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_MANIFEST });
  });

  it('rejects missing rights metadata (lock rule 23)', async () => {
    await expect(
      createBodyManifest({ ...makeManifestInput(), rights: undefined }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE });
    await expect(
      createBodyManifest({ ...makeManifestInput(), rights: { license: '???' } }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE });
  });

  it('rejects malformed capability refs and non-admissible kinds', async () => {
    await expect(
      createBodyManifest({
        ...makeManifestInput(),
        capabilities: [{ kind: 'capability', id: 'BAD ID', version: '1.0.0', digest: DIGEST_F }],
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_MANIFEST });
    // kind 'skill' is a REAL A004 kind but not admissible as a manifest capability
    await expect(
      createBodyManifest({
        ...makeManifestInput(),
        capabilities: [{ kind: 'skill', id: 'some-skill', version: '1.0.0', digest: DIGEST_F }],
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_MANIFEST });
    expect(MANIFEST_CAPABILITY_KINDS).toEqual(['capability', 'sub-capability']);
  });

  it('rejects a malformed substrate compatibility profile with a forge-typed error', async () => {
    await expect(
      createBodyManifest({
        ...makeManifestInput(),
        substrateCompatibility: {
          requiredModalities: ['not-a-modality'],
          requiredToolCalling: 'json-schema',
          contextRequirements: { minContextUnits: 32768 },
        },
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_MANIFEST });
  });

  it('rejects credential-shaped fields (A003 tripwire propagates)', async () => {
    await expect(
      createBodyManifest({
        ...makeManifestInput(),
        mission: 'benign',
        // credential-shaped FIELD anywhere in the input
        rights: {
          license: 'Proprietary',
          commercialUse: 'requires-license',
          redistribution: 'tenant-only',
          customerData: 'derived',
          apiKey: 'nope',
        },
      }),
    ).rejects.toMatchObject({ code: AGENT_BODY_ERROR_CODES.SUBSTRATE_CREDENTIAL_REJECTED });
  });

  it('rejects provider brand names in free text (A003 tripwire propagates)', async () => {
    await expect(
      createBodyManifest(makeManifestInput({ mission: 'Powered by OpenAI models.' })),
    ).rejects.toMatchObject({ code: AGENT_BODY_ERROR_CODES.PROVIDER_NAME_REJECTED });
  });
});

describe('conflict rules (adversarial)', () => {
  it('rejects duplicate skill refs', async () => {
    await expect(
      createBodyManifest({
        ...makeManifestInput(),
        skills: [
          { namespace: 'arena-skills', name: 'dup-skill', version: '1.0.0', digest: DIGEST_A },
          { namespace: 'arena-skills', name: 'dup-skill', version: '1.0.0', digest: DIGEST_A },
        ],
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.CONFLICT });
  });

  it('rejects duplicate capability ids', async () => {
    await expect(
      createBodyManifest({
        ...makeManifestInput(),
        capabilities: [
          { kind: 'capability', id: 'capability-reconciliation', version: '1.2.0', digest: DIGEST_F },
          { kind: 'sub-capability', id: 'capability-reconciliation', version: '1.3.0', digest: DIGEST_G },
        ],
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.CONFLICT });
  });

  it('rejects contradictory escalation rules (same condition twice)', async () => {
    await expect(
      createBodyManifest({
        ...makeManifestInput(),
        escalation: {
          rules: [
            {
              condition: 'discrepancy-above-threshold',
              target: { type: 'user', tenant: 'tenant-a', principalId: 'controller-01' },
            },
            {
              condition: 'discrepancy-above-threshold',
              target: { type: 'user', tenant: 'tenant-a', principalId: 'controller-02' },
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.CONFLICT });
  });

  it('rejects duplicate policy ids (contradictory policies)', async () => {
    await expect(
      createBodyManifest({
        ...makeManifestInput(),
        safetyPolicy: { policyId: 'memory-append-only', statements: ['clash'] },
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.CONFLICT });
  });

  it('rejects duplicate domainScope entries', async () => {
    await expect(
      createBodyManifest(makeManifestInput({ domainScope: ['finance', 'finance'] })),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.CONFLICT });
  });
});

describe('learning citations (the anti-silent-embedding shape)', () => {
  const SKILL = { namespace: 'arena-skills', name: 'ledger-reconciliation-checklist', version: '1.0.0', digest: DIGEST_A };

  it('accepts experiment-record and skill-draft citations that bind embedded skills', async () => {
    const manifest = await createBodyManifest(
      makeManifestInput({
        citations: [
          { kind: 'experiment-record', digest: DIGEST_B },
          { kind: 'skill-draft', digest: DIGEST_G, skills: [SKILL] },
        ],
      }),
    );
    expect(manifest.provenance.citations).toHaveLength(2);
    expect(MANIFEST_CITATION_KINDS).toEqual(['experiment-record', 'skill-draft']);
    for (const citation of manifest.provenance.citations) {
      expect(isManifestCitation(citation)).toBe(true);
    }
  });

  it('rejects unknown citation kinds (closed vocabulary)', async () => {
    await expect(
      createBodyManifest(
        makeManifestInput({
          citations: [{ kind: 'gut-feeling', digest: DIGEST_B } as never],
        }),
      ),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE });
  });

  it('rejects a skill-draft citation binding a skill NOT in the manifest (dangling citation)', async () => {
    await expect(
      createBodyManifest(
        makeManifestInput({
          skills: [],
          citations: [{ kind: 'skill-draft', digest: DIGEST_G, skills: [SKILL] }],
        }),
      ),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE });
  });

  it('rejects a skill claimed by two skill-draft citations', async () => {
    await expect(
      createBodyManifest(
        makeManifestInput({
          citations: [
            { kind: 'skill-draft', digest: DIGEST_G, skills: [SKILL] },
            { kind: 'skill-draft', digest: DIGEST_B, skills: [SKILL] },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.CONFLICT });
  });

  it('rejects duplicate citation digests and malformed citation digests', async () => {
    await expect(
      createBodyManifest(
        makeManifestInput({
          citations: [
            { kind: 'experiment-record', digest: DIGEST_B },
            { kind: 'experiment-record', digest: DIGEST_B },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.CONFLICT });
    await expect(
      createBodyManifest(
        makeManifestInput({ citations: [{ kind: 'experiment-record', digest: 'not-a-digest' }] }),
      ),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_DIGEST });
  });

  it('rejects a skill-draft citation with no bound skills', async () => {
    await expect(
      createBodyManifest(
        makeManifestInput({ citations: [{ kind: 'skill-draft', digest: DIGEST_G, skills: [] }] }),
      ),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE });
  });
});

describe('lineage (the HARD supersedes-requires-parent rule)', () => {
  it('rejects supersedes without the parent ref', async () => {
    await expect(
      createBodyManifest(
        makeManifestInput({
          targetVersion: '1.1.0',
          parents: [],
          supersedes: parentRefV1(),
        }),
      ),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.LINEAGE_VIOLATION });
  });

  it('accepts supersedes WITH the parent ref (append-only supersession)', async () => {
    const manifest = await createBodyManifest(
      makeManifestInput({
        targetVersion: '1.1.0',
        parents: [parentRefV1()],
        supersedes: parentRefV1(),
      }),
    );
    expect(manifest.lineage.supersedes?.version).toBe('1.0.0');
    expect(manifest.lineage.parents[0]?.version).toBe('1.0.0');
  });

  it('rejects cross-body parents', async () => {
    await expect(
      createBodyManifest(
        makeManifestInput({
          targetVersion: '1.1.0',
          parents: [{ tenant: 'tenant-b', name: 'other-body', version: '1.0.0', digest: DIGEST_G }],
        }),
      ),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.LINEAGE_VIOLATION });
  });

  it('rejects self-reference and duplicate parents', async () => {
    await expect(
      createBodyManifest(
        makeManifestInput({
          targetVersion: '1.0.0',
          parents: [{ tenant: 'tenant-a', name: 'ledger-reconciler', version: '1.0.0', digest: DIGEST_G }],
        }),
      ),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.LINEAGE_VIOLATION });
    await expect(
      createBodyManifest(
        makeManifestInput({
          targetVersion: '1.1.0',
          parents: [parentRefV1(), parentRefV1()],
        }),
      ),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.CONFLICT });
  });

  it('rejects malformed timestamps and authoredAt', async () => {
    await expect(
      createBodyManifest(
        makeManifestInput({
          provenance: {
            author: { type: 'user', tenant: 'tenant-a', principalId: 'author-01' },
            authoredAt: 'yesterday',
            citations: [],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_TIMESTAMP });
    expect(T0).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
