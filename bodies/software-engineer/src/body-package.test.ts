/**
 * Positive + negative tests for the reference body surface, manifest
 * and forge pipeline.
 */

import { describe, expect, it } from 'vitest';
import { AGENT_BODY_ERROR_CODES, toSubstrateCompatibilityProfile } from '@arena/agent-body';
import { BODY_FORGE_ERROR_CODES } from '@arena/body-forge';
import {
  createCapabilityDeclaration,
  createPracticeDescriptor,
  createToolDescriptor,
} from './surface.js';
import {
  buildSoftwareEngineerCapabilities,
  buildSoftwareEngineerKnowledge,
  buildSoftwareEngineerProcedures,
  buildSoftwareEngineerSkills,
  buildSoftwareEngineerToolSurface,
  softwareEngineerEnvironmentRequirement,
} from './reference-surface.js';
import {
  SOFTWARE_ENGINEER_BODY_EVOLVED_VERSION,
  SOFTWARE_ENGINEER_BODY_INITIAL_VERSION,
  createSuiteRequirement,
  softwareEngineerEvolutionManifestInput,
  softwareEngineerManifestInput,
} from './manifest.js';
import {
  buildSoftwareEngineerBody,
  forgeSoftwareEngineerBody,
  softwareEngineerForgePolicy,
} from './body.js';

const HEX64 = /^[0-9a-f]{64}$/;

describe('reference surface (positive)', () => {
  it('builds the six tool primitives as content-addressed descriptors', async () => {
    const tools = await buildSoftwareEngineerToolSurface();
    expect(tools).toHaveLength(6);
    const kinds = new Set(tools.map((tool) => tool.toolKind));
    expect(kinds).toEqual(
      new Set([
        'repo-navigation',
        'file-edit',
        'test-execution',
        'build-execution',
        'code-search',
        'vcs-operation',
      ]),
    );
    for (const tool of tools) {
      expect(tool.digest).toMatch(HEX64);
      expect(tool.ref.namespace).toBe('software-engineer-body');
      expect(tool.ref.digest).toBe(tool.digest);
    }
  });

  it('builds skills, knowledge and procedures with distinct refs', async () => {
    const [skills, knowledge, procedures] = await Promise.all([
      buildSoftwareEngineerSkills(),
      buildSoftwareEngineerKnowledge(),
      buildSoftwareEngineerProcedures(),
    ]);
    expect(skills).toHaveLength(3);
    expect(knowledge).toHaveLength(3);
    expect(procedures).toHaveLength(2);
    const names = [
      ...skills.map((s) => s.ref.name),
      ...knowledge.map((k) => k.ref.name),
      ...procedures.map((p) => p.ref.name),
    ];
    expect(new Set(names).size).toBe(names.length);
  });

  it('declares capability prerequisites with A004-shaped refs', async () => {
    const capabilities = await buildSoftwareEngineerCapabilities();
    expect(capabilities).toHaveLength(3);
    expect(capabilities[0]!.kind).toBe('capability');
    expect(capabilities.slice(1).every((c) => c.kind === 'sub-capability')).toBe(true);
    for (const capability of capabilities) {
      expect(capability.digest).toMatch(HEX64);
    }
  });

  it('cites the REAL sandbox definition as its environment requirement', async () => {
    const requirement = await softwareEngineerEnvironmentRequirement();
    expect(requirement).toEqual({
      namespace: 'arena-reference',
      name: 'software-engineer-sandbox',
      version: '1.0.0',
      digest: expect.stringMatching(HEX64),
    });
  });

  it('is deterministic: identical inputs give identical digests', async () => {
    const [a, b] = await Promise.all([
      buildSoftwareEngineerToolSurface(),
      buildSoftwareEngineerToolSurface(),
    ]);
    expect(a.map((t) => t.digest)).toEqual(b.map((t) => t.digest));
  });
});

describe('reference surface (negative/adversarial)', () => {
  it('rejects an unknown tool kind', async () => {
    await expect(
      createToolDescriptor({
        toolId: 'tool-bad',
        // @ts-expect-error adversarial input: unknown tool kind
        toolKind: 'mind-control',
        name: 'bad-tool',
        description: 'invalid kind',
      }),
    ).rejects.toMatchObject({ code: 'SOFTWARE_ENGINEER_BODY_INVALID_SURFACE_ARTIFACT' });
  });

  it('rejects empty descriptions and invalid ids', async () => {
    await expect(
      createToolDescriptor({
        toolId: 'tool-x',
        toolKind: 'code-search',
        name: 'x',
        description: '   ',
      }),
    ).rejects.toMatchObject({ code: 'SOFTWARE_ENGINEER_BODY_INVALID_SURFACE_ARTIFACT' });
    await expect(
      createPracticeDescriptor({
        artifactId: 'BAD_ID',
        kind: 'skill',
        name: 'x',
        description: 'valid description',
      }),
    ).rejects.toMatchObject({ code: 'SOFTWARE_ENGINEER_BODY_INVALID_SURFACE_ARTIFACT' });
    await expect(
      createCapabilityDeclaration({
        // @ts-expect-error adversarial input: invalid capability kind
        kind: 'domain',
        id: 'x',
        version: '1.0.0',
        description: 'invalid capability kind',
      }),
    ).rejects.toMatchObject({ code: 'SOFTWARE_ENGINEER_BODY_INVALID_CAPABILITY_DECLARATION' });
  });
});

describe('manifest (positive)', () => {
  it('produces a valid v1.0.0 manifest input satisfying every A003 floor', async () => {
    const input = await softwareEngineerManifestInput();
    expect(input.body).toEqual({ tenant: 'arena-reference', name: 'software-engineer' });
    expect(input.targetVersion).toBe(SOFTWARE_ENGINEER_BODY_INITIAL_VERSION);
    expect(input.capabilities.length).toBeGreaterThanOrEqual(1);
    expect(input.tools).toHaveLength(6);
    expect(input.skills).toHaveLength(3);
    expect(input.knowledge).toHaveLength(3);
    expect(input.procedures).toHaveLength(2);
    expect(input.evaluationSuites.length).toBeGreaterThanOrEqual(1);
    expect(input.verificationSuites.length).toBeGreaterThanOrEqual(1);
    expect(input.environmentRequirements.length).toBeGreaterThanOrEqual(1);
    expect(input.lineage.parents).toEqual([]);
  });

  it('builds content-addressed suite requirements', async () => {
    const evaluation = await createSuiteRequirement({
      suiteId: 'suite-x',
      role: 'evaluation',
      version: '1.0.0',
      description: 'x',
    });
    expect(evaluation.digest).toMatch(HEX64);
    expect(evaluation.ref.name).toBe('suite-x');
    await expect(
      createSuiteRequirement({
        suiteId: 'suite-y',
        // @ts-expect-error adversarial input: unknown role
        role: 'licensure',
        version: '1.0.0',
        description: 'y',
      }),
    ).rejects.toMatchObject({ code: 'SOFTWARE_ENGINEER_BODY_INVALID_MANIFEST_INPUT' });
  });
});

describe('manifest (negative/adversarial)', () => {
  it('rejects evolution manifests without parents', async () => {
    await expect(softwareEngineerEvolutionManifestInput([])).rejects.toMatchObject({
      code: 'SOFTWARE_ENGINEER_BODY_INVALID_LINEAGE',
    });
  });

  it('rejects evolution manifests citing a foreign body', async () => {
    await expect(
      softwareEngineerEvolutionManifestInput([
        { tenant: 'other-tenant', name: 'other-body', version: '1.0.0', digest: 'a'.repeat(64) },
      ]),
    ).rejects.toMatchObject({ code: 'SOFTWARE_ENGINEER_BODY_INVALID_LINEAGE' });
  });

  it('rejects an invalid substrate declaration inside the manifest input (A003 tripwires)', async () => {
    const input = await softwareEngineerManifestInput();
    // unknown field in the closed compatibility profile shape
    const alienated = {
      ...input,
      substrateCompatibility: {
        ...input.substrateCompatibility,
        equivalentmodels: ['some-model'],
      },
    } as unknown as Parameters<typeof forgeSoftwareEngineerBody>[0];
    await expect(forgeSoftwareEngineerBody(alienated)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_MANIFEST,
    });
    // alias-shaped field names are forbidden outright
    const aliased = {
      ...input,
      substrateCompatibility: {
        ...input.substrateCompatibility,
        modelaliases: [],
      },
    } as unknown as Parameters<typeof forgeSoftwareEngineerBody>[0];
    await expect(forgeSoftwareEngineerBody(aliased)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_MANIFEST,
    });
    // the A003 tripwire itself rejects alias-shaped profiles at the source (synchronous throw)
    try {
      toSubstrateCompatibilityProfile({
        requiredModalities: ['text-input', 'text-output'],
        requiredToolCalling: 'json-schema',
        contextRequirements: { minContextUnits: 1 },
        equivalentmodels: ['some-model'],
      } as never);
      expect.unreachable('alias-shaped compatibility profile must throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(
        AGENT_BODY_ERROR_CODES.SUBSTRATE_ALIAS_FORBIDDEN,
      );
    }
  });

  it('rejects unmet capability prerequisites via the strengthened forge policy', async () => {
    const input = await softwareEngineerManifestInput();
    // strip the tool surface: the reference policy requires minTools >= 6
    const gutted = { ...input, tools: [] } as Parameters<typeof forgeSoftwareEngineerBody>[0];
    await expect(forgeSoftwareEngineerBody(gutted)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.REQUIREMENT_VIOLATION,
    });
    // strip capabilities: minCapabilities >= 3
    const incapable = {
      ...input,
      capabilities: [input.capabilities[0]!],
    } as Parameters<typeof forgeSoftwareEngineerBody>[0];
    await expect(forgeSoftwareEngineerBody(incapable)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.REQUIREMENT_VIOLATION,
    });
  });
});

describe('body build (positive)', () => {
  it('forges and registers the v1.0.0 → v1.1.0 append-only lineage', async () => {
    const build = await buildSoftwareEngineerBody();
    expect(build.body.identity).toEqual({ tenant: 'arena-reference', name: 'software-engineer' });
    expect(build.body.versions).toHaveLength(2);
    expect(build.body.versions[0]!.version).toBe(SOFTWARE_ENGINEER_BODY_INITIAL_VERSION);
    expect(build.body.versions[1]!.version).toBe(SOFTWARE_ENGINEER_BODY_EVOLVED_VERSION);
    // the evolved body's lineage cites v1.0.0 as parent AND superseded ref
    expect(build.evolved.bodyVersion.lineage.parents).toHaveLength(1);
    expect(build.evolved.bodyVersion.lineage.parents[0]!.version).toBe(
      SOFTWARE_ENGINEER_BODY_INITIAL_VERSION,
    );
    expect(build.evolved.bodyVersion.lineage.supersedes?.version).toBe(
      SOFTWARE_ENGINEER_BODY_INITIAL_VERSION,
    );
    // provenance carries exactly the manifest + policy records (A021 projection)
    expect(build.initial.bodyVersion.provenance.records).toHaveLength(2);
    expect(build.initial.bodyVersion.provenance.creator.principalId).toBe(
      'arena-body-forge-fabric',
    );
  });

  it('is deterministic: two builds yield identical digests', async () => {
    const [a, b] = await Promise.all([buildSoftwareEngineerBody(), buildSoftwareEngineerBody()]);
    expect(a.initial.bodyVersion.digest).toBe(b.initial.bodyVersion.digest);
    expect(a.evolved.bodyVersion.digest).toBe(b.evolved.bodyVersion.digest);
    expect(a.initial.forgeRecord.digest).toBe(b.initial.forgeRecord.digest);
  });

  it('strengthens the A003 input floors without weakening them', async () => {
    const policy = await softwareEngineerForgePolicy();
    expect(policy.requirements.minTools).toBeGreaterThanOrEqual(6);
    expect(policy.requirements.minCapabilities).toBeGreaterThanOrEqual(1);
    expect(policy.requirements.minEvaluationSuites).toBeGreaterThanOrEqual(1);
  });
});
