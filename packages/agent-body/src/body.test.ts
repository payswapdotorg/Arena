/**
 * AgentBody and BodyVersion tests: all AB1.0 snapshot fields,
 * content-addressing (gate 3 dedup), registry semantics, lineage and
 * provenance validation, tamper detection, immutability (freeze) and the
 * provider/credential tripwires.
 */

import { describe, expect, it } from 'vitest';
import { AgentBodyError } from './errors.js';
import { AGENT_BODY_ERROR_CODES } from './errors.js';
import {
  AGENT_BODY_IDENTITY_PATTERN_SOURCE,
  bodyVersionRef,
  bodyVersionView,
  computeBodyVersionDigest,
  createAgentBody,
  createBodyVersion,
  findBodyVersionRef,
  formatAgentBodyIdentity,
  isAgentBody,
  isBodyVersion,
  isSameAgentBodyIdentity,
  parseAgentBodyIdentity,
  registerBodyVersion,
  toAgentBodyIdentity,
  verifyBodyVersion,
} from './body.js';
import {
  CREATOR,
  DIGEST_A,
  RIGHTS,
  TIMESTAMP,
  makeBodyVersion,
  makeBodyVersionInput,
} from './test-support.js';

describe('AgentBodyIdentity (positive)', () => {
  it('formats and parses the stable string form', () => {
    const identity = toAgentBodyIdentity({ tenant: 'tenant-a', name: 'structural-engineer' });
    const formatted = formatAgentBodyIdentity(identity);
    expect(formatted).toBe('arena:body/tenant-a/structural-engineer');
    expect(parseAgentBodyIdentity(formatted)).toEqual(identity);
    expect(new RegExp(AGENT_BODY_IDENTITY_PATTERN_SOURCE).test(formatted)).toBe(true);
    expect(isSameAgentBodyIdentity(identity, parseAgentBodyIdentity(formatted))).toBe(true);
  });
});

describe('AgentBodyIdentity (negative)', () => {
  it('rejects malformed identities', () => {
    expect(() => toAgentBodyIdentity({ tenant: 'BAD', name: 'x' })).toThrow(/namespace/);
    expect(() => toAgentBodyIdentity({ tenant: 't', name: 'BAD NAME' })).toThrow(/name/);
    expect(() => parseAgentBodyIdentity('arena:body/t/x@1.0.0')).toThrow(/identity string/);
    expect(() => parseAgentBodyIdentity('http://example.com/body')).toThrow(/identity string/);
  });
});

describe('BodyVersion (positive — every AB1.0 field is present and validated)', () => {
  it('carries body identity/version, mission and role, domain scope, capabilities, SkillRefs, KnowledgeRefs, ToolRefs, procedures', async () => {
    const version = await makeBodyVersion();
    expect(version.body).toEqual({ tenant: 'tenant-a', name: 'structural-engineer' });
    expect(version.version).toBe('1.2.0');
    expect(version.mission).toContain('structural engineering review');
    expect(version.role).toBe('senior-structural-reviewer');
    expect(version.domainScope).toEqual(['structural-engineering', 'code-compliance']);
    expect(version.capabilities).toEqual(['load-analysis', 'code-compliance-review']);
    expect(version.skills).toHaveLength(1);
    expect(version.knowledge).toHaveLength(1);
    expect(version.tools).toHaveLength(1);
    expect(version.procedures).toHaveLength(1);
  });

  it('carries memory policy, planning policy, escalation, authority boundaries and safety policy', async () => {
    const version = await makeBodyVersion();
    expect(version.memoryPolicy.policyId).toBe('memory-policy');
    expect(version.planningPolicy.policyId).toBe('planning-policy');
    expect(version.escalation.rules).toHaveLength(1);
    expect(version.escalation.rules[0]?.target.type).toBe('expert');
    expect(version.authorityBoundaries.length).toBeGreaterThan(0);
    expect(version.safetyPolicy.policyId).toBe('safety-policy');
  });

  it('carries evaluation/verification suite refs, environment requirements, compatibility profile, provenance and lineage', async () => {
    const version = await makeBodyVersion();
    expect(version.evaluationSuites).toHaveLength(1);
    expect(version.verificationSuites).toHaveLength(1);
    expect(version.environmentRequirements).toHaveLength(1);
    expect(version.substrateCompatibility.requiredModalities).toContain('text-output');
    expect(version.provenance.creator).toEqual(CREATOR);
    expect(version.provenance.createdAt).toBe(TIMESTAMP);
    expect(version.provenance.rights.license).toBe(RIGHTS.license);
    expect(version.lineage.parents).toEqual([]);
    expect(version.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(isBodyVersion(version)).toBe(true);
  });

  it('is deeply frozen (no mutation API, gate 13)', async () => {
    const version = await makeBodyVersion();
    expect(Object.isFrozen(version)).toBe(true);
    expect(Object.isFrozen(version.body)).toBe(true);
    expect(Object.isFrozen(version.skills)).toBe(true);
    expect(Object.isFrozen(version.substrateCompatibility)).toBe(true);
    expect(Object.isFrozen(version.provenance)).toBe(true);
    expect(Object.isFrozen(version.escalation.rules)).toBe(true);
    expect(() => {
      (version as unknown as Record<string, unknown>)['mission'] = 'mutated';
    }).toThrow(TypeError);
    expect(() => {
      (version.skills as unknown as unknown[]).push({ hacked: true });
    }).toThrow(TypeError);
  });

  it('verifyBodyVersion recomputes the digest', async () => {
    const version = await makeBodyVersion();
    expect(await verifyBodyVersion(version)).toBe(version.digest);
    expect(await computeBodyVersionDigest(bodyVersionView(version))).toBe(version.digest);
  });

  it('supports parent/supersession lineage (AB1.0)', async () => {
    const parent = await makeBodyVersion({ version: '1.1.0' });
    const child = await makeBodyVersion({
      version: '1.2.0',
      lineage: {
        parents: [bodyVersionRef(parent)],
        supersedes: bodyVersionRef(parent),
      },
    });
    expect(child.lineage.parents[0]?.version).toBe('1.1.0');
    expect(child.lineage.supersedes?.digest).toBe(parent.digest);
  });
});

describe('BodyVersion content addressing (gate 3 — registry-style dedup)', () => {
  it('same content ⇒ same version digest', async () => {
    const a = await makeBodyVersion();
    const b = await makeBodyVersion(); // identical input
    expect(a.digest).toBe(b.digest);
    expect(bodyVersionRef(a)).toEqual(bodyVersionRef(b));
  });

  it('different content ⇒ different digest (mission, role, policies, refs, lineage all matter)', async () => {
    const base = await makeBodyVersion();
    const changedMission = await makeBodyVersion({ mission: 'Different mission.' });
    const changedRole = await makeBodyVersion({ role: 'junior-reviewer' });
    const changedSkill = await makeBodyVersion({
      skills: [
        { namespace: 'tenant-a', name: 'skill-load-analysis', version: '2.1.0', digest: DIGEST_A },
      ],
    });
    const changedSafety = await makeBodyVersion({
      safetyPolicy: { policyId: 'safety-policy', statements: ['stricter-still'] },
    });
    for (const variant of [changedMission, changedRole, changedSkill, changedSafety]) {
      expect(variant.digest).not.toBe(base.digest);
    }
  });

  it('ordering of embedded arrays is significant (content, not set, addressing)', async () => {
    const base = await makeBodyVersion();
    const reordered = await makeBodyVersion({
      domainScope: ['code-compliance', 'structural-engineering'],
    });
    expect(reordered.digest).not.toBe(base.digest);
  });
});

describe('BodyVersion tamper detection (fail closed)', () => {
  it('a tampered field fails verification', async () => {
    const version = await makeBodyVersion();
    const tampered = {
      ...version,
      mission: 'Silently rewritten mission',
    };
    await expect(verifyBodyVersion(tampered)).rejects.toThrow(/digest mismatch/);
    try {
      await verifyBodyVersion(tampered);
    } catch (error) {
      expect((error as AgentBodyError).code).toBe(AGENT_BODY_ERROR_CODES.TAMPERED);
    }
  });

  it('a swapped digest fails verification', async () => {
    const version = await makeBodyVersion();
    const other = await makeBodyVersion({ mission: 'Other mission.' });
    await expect(verifyBodyVersion({ ...version, digest: other.digest })).rejects.toThrow(
      /digest mismatch/,
    );
  });

  it('structurally invalid versions fail verification', async () => {
    await expect(verifyBodyVersion({} as never)).rejects.toThrow(/structurally valid/);
    expect(isBodyVersion({ recordVersion: 99 })).toBe(false);
  });
});

describe('BodyVersion construction (negative — fail closed)', () => {
  it('rejects missing rights (lock rule 23)', async () => {
    await expect(
      makeBodyVersion({ provenance: { creator: CREATOR, createdAt: TIMESTAMP, rights: undefined } as never }),
    ).rejects.toThrow(/rights metadata is required/);
  });

  it('rejects empty evaluation/verification suites and environment requirements', async () => {
    await expect(makeBodyVersion({ evaluationSuites: [] })).rejects.toThrow(
      /evaluationSuites requires at least one/,
    );
    await expect(makeBodyVersion({ verificationSuites: [] })).rejects.toThrow(
      /verificationSuites requires at least one/,
    );
    await expect(makeBodyVersion({ environmentRequirements: [] })).rejects.toThrow(
      /environmentRequirements requires at least one/,
    );
  });

  it('rejects empty domain scope, capabilities, authority boundaries, mission and role', async () => {
    await expect(makeBodyVersion({ domainScope: [] })).rejects.toThrow(/domainScope/);
    await expect(makeBodyVersion({ capabilities: [] })).rejects.toThrow(/capabilities/);
    await expect(makeBodyVersion({ authorityBoundaries: [] })).rejects.toThrow(
      /authorityBoundaries/,
    );
    await expect(makeBodyVersion({ mission: '' })).rejects.toThrow(/mission/);
    await expect(makeBodyVersion({ role: '' })).rejects.toThrow(/role/);
  });

  it('rejects invalid semver versions (no build metadata)', async () => {
    await expect(makeBodyVersion({ version: '1.2.0+build.5' })).rejects.toThrow(/agent body version/);
    await expect(makeBodyVersion({ version: 'v1.2' })).rejects.toThrow(/agent body version/);
  });

  it('rejects duplicate refs and duplicate policies', async () => {
    const duplicate = {
      namespace: 'tenant-a',
      name: 'skill-load-analysis',
      version: '2.0.0',
      digest: DIGEST_A,
    };
    await expect(makeBodyVersion({ skills: [duplicate, duplicate] })).rejects.toThrow(
      /duplicate skills entry/,
    );
    await expect(
      makeBodyVersion({
        memoryPolicy: { policyId: 'memory-policy', statements: ['a'] },
        planningPolicy: { policyId: 'memory-policy', statements: ['b'] },
      }),
    ).rejects.toThrow(/duplicate policy/);
  });

  it('rejects cross-body parents, self-parents, self-supersession and duplicate parents', async () => {
    const version = await makeBodyVersion();
    const ref = bodyVersionRef(version);
    await expect(
      makeBodyVersion({
        lineage: {
          parents: [{ ...ref, tenant: 'tenant-b' }],
        },
      }),
    ).rejects.toThrow(/different body/);
    await expect(
      makeBodyVersion({ lineage: { parents: [{ ...ref, version: '1.2.0' }] } }),
    ).rejects.toThrow(/lists itself among its parents/);
    await expect(
      makeBodyVersion({
        lineage: { parents: [ref, { ...ref, digest: '5'.repeat(64) }] },
      }),
    ).rejects.toThrow(/duplicate parent body version/);
    await expect(
      makeBodyVersion({ lineage: { parents: [], supersedes: { ...ref, version: '1.2.0' } } }),
    ).rejects.toThrow(/supersedes itself/);
  });

  it('rejects credential-shaped fields anywhere in the input (spec AB1.0)', async () => {
    const input = {
      ...makeBodyVersionInput(),
      apiKey: 'sk-1234',
    } as never;
    await expect(createBodyVersion(input)).rejects.toThrow(/credential-shaped field/);
  });

  it('rejects provider brand names in mission/role text (lock rule 10)', async () => {
    await expect(makeBodyVersion({ mission: 'Act like a gpt-4o engineer.' })).rejects.toThrow(
      /provider brand name/,
    );
    await expect(makeBodyVersion({ role: 'claude-powered reviewer' })).rejects.toThrow(
      /provider brand name/,
    );
  });

  it('rejects malformed timestamps and principals in provenance', async () => {
    await expect(
      makeBodyVersion({ provenance: { creator: CREATOR, createdAt: '2026-01-15T09:30:00Z', rights: RIGHTS } }),
    ).rejects.toThrow(/timestamp/);
    await expect(
      makeBodyVersion({
        provenance: {
          creator: { type: 'model', tenant: 'tenant-a', principalId: 'm-1' },
          createdAt: TIMESTAMP,
          rights: RIGHTS,
        },
      }),
    ).rejects.toThrow(/unknown principal type/);
  });
});

describe('AgentBody — the first-class persistent object (lock rule 1)', () => {
  it('creates a frozen body with no versions', () => {
    const body = createAgentBody({
      identity: { tenant: 'tenant-a', name: 'structural-engineer' },
      createdAt: TIMESTAMP,
      creator: CREATOR,
      rights: RIGHTS,
    });
    expect(isAgentBody(body)).toBe(true);
    expect(body.versions).toEqual([]);
    expect(Object.isFrozen(body)).toBe(true);
    expect(body.rights.license).toBe(RIGHTS.license);
  });

  it('rejects malformed bodies', () => {
    expect(() =>
      createAgentBody({
        identity: { tenant: 'BAD', name: 'structural-engineer' },
        createdAt: TIMESTAMP,
        creator: CREATOR,
        rights: RIGHTS,
      }),
    ).toThrow(/namespace/);
    expect(() =>
      createAgentBody({
        identity: { tenant: 'tenant-a', name: 'structural-engineer' },
        createdAt: 'not-a-timestamp',
        creator: CREATOR,
        rights: RIGHTS,
      }),
    ).toThrow(/timestamp/);
  });
});

describe('registerBodyVersion (registry semantics — gate 3)', () => {
  it('appends a new version purely (input body unchanged)', async () => {
    const body = createAgentBody({
      identity: { tenant: 'tenant-a', name: 'structural-engineer' },
      createdAt: TIMESTAMP,
      creator: CREATOR,
      rights: RIGHTS,
    });
    const version = await makeBodyVersion();
    const updated = await registerBodyVersion(body, version);
    expect(updated).not.toBe(body);
    expect(body.versions).toHaveLength(0); // input untouched
    expect(updated.versions).toHaveLength(1);
    expect(updated.versions[0]?.digest).toBe(version.digest);
    expect(findBodyVersionRef(updated, '1.2.0')?.digest).toBe(version.digest);
    expect(findBodyVersionRef(updated, '9.9.9')).toBeNull();
    expect(Object.isFrozen(updated)).toBe(true);
  });

  it('same content is idempotent (same version + same digest returns the same registry)', async () => {
    const body = createAgentBody({
      identity: { tenant: 'tenant-a', name: 'structural-engineer' },
      createdAt: TIMESTAMP,
      creator: CREATOR,
      rights: RIGHTS,
    });
    const a = await makeBodyVersion();
    const b = await makeBodyVersion(); // identical content ⇒ identical digest
    const once = await registerBodyVersion(body, a);
    const twice = await registerBodyVersion(once, b);
    expect(twice).toBe(once); // dedup: no second entry
    expect(twice.versions).toHaveLength(1);
  });

  it('same version with different content is a VERSION_CONFLICT (immutable history)', async () => {
    const body = createAgentBody({
      identity: { tenant: 'tenant-a', name: 'structural-engineer' },
      createdAt: TIMESTAMP,
      creator: CREATOR,
      rights: RIGHTS,
    });
    const a = await makeBodyVersion();
    const mutated = await makeBodyVersion({ mission: 'Different mission.' });
    const registered = await registerBodyVersion(body, a);
    await expect(registerBodyVersion(registered, mutated)).rejects.toThrow(
      /already registered with a different digest/,
    );
    try {
      await registerBodyVersion(registered, mutated);
    } catch (error) {
      expect((error as AgentBodyError).code).toBe(AGENT_BODY_ERROR_CODES.VERSION_CONFLICT);
    }
  });

  it('rejects versions of a different body and tampered versions', async () => {
    const body = createAgentBody({
      identity: { tenant: 'tenant-a', name: 'structural-engineer' },
      createdAt: TIMESTAMP,
      creator: CREATOR,
      rights: RIGHTS,
    });
    const foreign = await makeBodyVersion({
      body: { tenant: 'tenant-a', name: 'software-engineer' },
    });
    await expect(registerBodyVersion(body, foreign)).rejects.toThrow(/does not belong to body/);

    const tampered = { ...(await makeBodyVersion()), mission: 'rewritten' };
    await expect(registerBodyVersion(body, tampered as never)).rejects.toThrow(
      /digest mismatch/,
    );
  });

  it('accumulates multiple versions in append order', async () => {
    const body = createAgentBody({
      identity: { tenant: 'tenant-a', name: 'structural-engineer' },
      createdAt: TIMESTAMP,
      creator: CREATOR,
      rights: RIGHTS,
    });
    const v1 = await makeBodyVersion({ version: '1.1.0' });
    const v2 = await makeBodyVersion({ version: '1.2.0' });
    const withV1 = await registerBodyVersion(body, v1);
    const withV2 = await registerBodyVersion(withV1, v2);
    expect(withV2.versions.map((ref) => ref.version)).toEqual(['1.1.0', '1.2.0']);
  });
});
