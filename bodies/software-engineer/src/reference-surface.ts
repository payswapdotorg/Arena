/**
 * The REFERENCE professional surface of the Software Engineer Agent
 * Body: deterministic catalogs of typed protocol objects.
 *
 * Every catalog is built from fixed inputs — identical calls yield
 * byte-identical digests (content addressing over canonical JSON).
 */

import {
  createSoftwareEngineerSandbox,
} from '@arena/environment-software-engineer';
import {
  createCapabilityDeclaration,
  createPracticeDescriptor,
  createToolDescriptor,
} from './surface.js';
import type {
  CapabilityDeclaration,
  PracticeDescriptor,
  ToolDescriptor,
} from './surface.js';
import type { VersionedArtifactRef } from '@arena/agent-body';

/** The tool primitives a software engineer body is licensed to use. */
export async function buildSoftwareEngineerToolSurface(): Promise<
  readonly ToolDescriptor[]
> {
  return Object.freeze([
    await createToolDescriptor({
      toolId: 'tool-repo-navigator',
      toolKind: 'repo-navigation',
      name: 'repo-navigator',
      description:
        'Locate files, symbols, modules and configuration across a repository checkout.',
    }),
    await createToolDescriptor({
      toolId: 'tool-file-editor',
      toolKind: 'file-edit',
      name: 'file-editor',
      description:
        'Apply minimal, reviewable edits to source files inside the workspace mount.',
    }),
    await createToolDescriptor({
      toolId: 'tool-test-runner',
      toolKind: 'test-execution',
      name: 'test-runner',
      description:
        'Execute the declared test suite and capture per-test outcomes as evidence.',
    }),
    await createToolDescriptor({
      toolId: 'tool-build-runner',
      toolKind: 'build-execution',
      name: 'build-runner',
      description:
        'Execute the declared build pipeline and capture build status and logs.',
    }),
    await createToolDescriptor({
      toolId: 'tool-code-search',
      toolKind: 'code-search',
      name: 'code-search',
      description:
        'Search definitions, references and history patterns across the checkout.',
    }),
    await createToolDescriptor({
      toolId: 'tool-vcs-client',
      toolKind: 'vcs-operation',
      name: 'vcs-client',
      description:
        'Inspect diffs, stage changes and propose commits; never mutates protected refs.',
    }),
  ]);
}

/** Skills the body possesses (learned, exercised professional practices). */
export async function buildSoftwareEngineerSkills(): Promise<
  readonly PracticeDescriptor[]
> {
  return Object.freeze([
    await createPracticeDescriptor({
      artifactId: 'skill-pr-review-checklist',
      kind: 'skill',
      name: 'pr-review-checklist',
      description:
        'Structured review of changes: correctness, tests, rollback, and blast radius.',
    }),
    await createPracticeDescriptor({
      artifactId: 'skill-test-driven-fix-loop',
      kind: 'skill',
      name: 'test-driven-fix-loop',
      description:
        'Reproduce, isolate, fix and re-verify a failure with the smallest failing test first.',
    }),
    await createPracticeDescriptor({
      artifactId: 'skill-dependency-hygiene',
      kind: 'skill',
      name: 'dependency-hygiene',
      description:
        'Evaluate dependency changes for pinning, license and supply-chain impact.',
    }),
  ]);
}

/** Knowledge the body possesses (curated, citable references). */
export async function buildSoftwareEngineerKnowledge(): Promise<
  readonly PracticeDescriptor[]
> {
  return Object.freeze([
    await createPracticeDescriptor({
      artifactId: 'knowledge-repo-layout-conventions',
      kind: 'knowledge',
      name: 'repo-layout-conventions',
      description:
        'Canonical repository layout: source roots, test roots, configuration and tooling files.',
    }),
    await createPracticeDescriptor({
      artifactId: 'knowledge-language-toolchain-notes',
      kind: 'knowledge',
      name: 'language-toolchain-notes',
      description:
        'Pinned language/toolchain behaviors: module resolution, strictness, build caches.',
    }),
    await createPracticeDescriptor({
      artifactId: 'knowledge-ci-pipeline-conventions',
      kind: 'knowledge',
      name: 'ci-pipeline-conventions',
      description:
        'Pipeline stages, artifact retention and required checks for protected branches.',
    }),
  ]);
}

/** Procedures the body follows (ordered, auditable workflows). */
export async function buildSoftwareEngineerProcedures(): Promise<
  readonly PracticeDescriptor[]
> {
  return Object.freeze([
    await createPracticeDescriptor({
      artifactId: 'procedure-fix-failing-test-workflow',
      kind: 'procedure',
      name: 'fix-failing-test-workflow',
      description:
        'Reproduce the failure, isolate the defect, apply the minimal fix, re-run the suite, attach evidence.',
    }),
    await createPracticeDescriptor({
      artifactId: 'procedure-green-build-verification-workflow',
      kind: 'procedure',
      name: 'green-build-verification-workflow',
      description:
        'Run the full build after changes and record status, logs and artifact digests before proposing review.',
    }),
  ]);
}

/** Capability prerequisites the body requires (A004-shaped declarations). */
export async function buildSoftwareEngineerCapabilities(): Promise<
  readonly CapabilityDeclaration[]
> {
  return Object.freeze([
    await createCapabilityDeclaration({
      kind: 'capability',
      id: 'software-change-delivery',
      version: '1.0.0',
      description:
        'Deliver correct, reviewable software changes from reproduction through green builds.',
    }),
    await createCapabilityDeclaration({
      kind: 'sub-capability',
      id: 'code-review',
      version: '1.0.0',
      description: 'Review proposed changes for correctness, tests and blast radius.',
    }),
    await createCapabilityDeclaration({
      kind: 'sub-capability',
      id: 'test-repair',
      version: '1.0.0',
      description: 'Repair failing tests through minimal, evidence-producing fixes.',
    }),
  ]);
}

/**
 * The body's environment requirement: the reference software-engineer
 * sandbox declared by @arena/environment-software-engineer. The
 * manifest cites the REAL content-addressed definition — this is the
 * parity link proven in examples/software-engineer.
 */
export async function softwareEngineerEnvironmentRequirement(): Promise<VersionedArtifactRef> {
  const definition = await createSoftwareEngineerSandbox();
  return Object.freeze({
    namespace: definition.identity.namespace,
    name: definition.identity.name,
    version: definition.version,
    digest: definition.digest,
  }) as VersionedArtifactRef;
}
