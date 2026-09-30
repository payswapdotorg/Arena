/**
 * The REFERENCE professional surface of the Structural Engineer Agent
 * Body: deterministic catalogs of typed protocol objects.
 *
 * Every catalog is built from fixed inputs — identical calls yield
 * byte-identical digests (content addressing over canonical JSON).
 */

import {
  createStructuralAnalysisSandbox,
} from '@arena/environment-structural-engineer';
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

/** The tool primitives a structural engineer body is licensed to use. */
export async function buildStructuralEngineerToolSurface(): Promise<
  readonly ToolDescriptor[]
> {
  return Object.freeze([
    await createToolDescriptor({
      toolId: 'tool-structural-solver',
      toolKind: 'structural-analysis',
      name: 'structural-solver',
      description:
        'Run load-case analyses over the structural model and capture demand/capacity utilization ratios per limit-state check.',
    }),
    await createToolDescriptor({
      toolId: 'tool-load-model-editor',
      toolKind: 'load-model-parameters',
      name: 'load-model-editor',
      description:
        'Apply minimal, reviewable corrections to load combinations and model parameters inside the model mount.',
    }),
    await createToolDescriptor({
      toolId: 'tool-code-reference-lookup',
      toolKind: 'code-reference-lookup',
      name: 'code-reference-lookup',
      description:
        'Resolve limit-state requirements from the pinned design-code edition and section-property tables from the reference library.',
    }),
    await createToolDescriptor({
      toolId: 'tool-drawing-spec-access',
      toolKind: 'drawing-spec-access',
      name: 'drawing-spec-access',
      description:
        'Read drawing sheets, model geometry and project specifications from the read-only task-input mount.',
    }),
    await createToolDescriptor({
      toolId: 'tool-calculation-recorder',
      toolKind: 'calculation-recording',
      name: 'calculation-recorder',
      description:
        'Record auditable calculation sheets — assumptions, parameters, references and results — into the evidence mount.',
    }),
    await createToolDescriptor({
      toolId: 'tool-compliance-reporter',
      toolKind: 'compliance-reporting',
      name: 'compliance-reporter',
      description:
        'Assemble the code-compliance report: per-check utilization ratios, code citations and unresolved advisories.',
    }),
  ]);
}

/** Skills the body possesses (learned, exercised professional practices). */
export async function buildStructuralEngineerSkills(): Promise<
  readonly PracticeDescriptor[]
> {
  return Object.freeze([
    await createPracticeDescriptor({
      artifactId: 'skill-load-path-tracing',
      kind: 'skill',
      name: 'load-path-tracing',
      description:
        'Trace gravity and lateral loads from application point to foundation, flagging discontinuities and collector demands.',
    }),
    await createPracticeDescriptor({
      artifactId: 'skill-limit-state-checking',
      kind: 'skill',
      name: 'limit-state-checking',
      description:
        'Check strength and serviceability limit states against the pinned code edition with explicit utilization ratios.',
    }),
    await createPracticeDescriptor({
      artifactId: 'skill-calculation-review-checklist',
      kind: 'skill',
      name: 'calculation-review-checklist',
      description:
        'Structured review of calculation sheets: units, load cases, boundary conditions, code citations and defensibility.',
    }),
  ]);
}

/** Knowledge the body possesses (curated, citable references). */
export async function buildStructuralEngineerKnowledge(): Promise<
  readonly PracticeDescriptor[]
> {
  return Object.freeze([
    await createPracticeDescriptor({
      artifactId: 'knowledge-design-code-basis',
      kind: 'knowledge',
      name: 'design-code-basis',
      description:
        'Load-combination factors, limit-state criteria and applicable chapters of the pinned design-code edition.',
    }),
    await createPracticeDescriptor({
      artifactId: 'knowledge-section-properties-conventions',
      kind: 'knowledge',
      name: 'section-properties-conventions',
      description:
        'Section-property library conventions: naming, orientation, effective properties and material assumptions.',
    }),
    await createPracticeDescriptor({
      artifactId: 'knowledge-drawing-annotation-conventions',
      kind: 'knowledge',
      name: 'drawing-annotation-conventions',
      description:
        'Drawing conventions: grid and level naming, member tags, tributary geometry and revision clouds.',
    }),
  ]);
}

/** Procedures the body follows (ordered, auditable workflows). */
export async function buildStructuralEngineerProcedures(): Promise<
  readonly PracticeDescriptor[]
> {
  return Object.freeze([
    await createPracticeDescriptor({
      artifactId: 'procedure-resolve-failing-check-workflow',
      kind: 'procedure',
      name: 'resolve-failing-check-workflow',
      description:
        'Reproduce the failing check, trace the load path, correct the minimal cause in the model or parameters, re-run the solver, attach evidence.',
    }),
    await createPracticeDescriptor({
      artifactId: 'procedure-code-compliance-verification-workflow',
      kind: 'procedure',
      name: 'code-compliance-verification-workflow',
      description:
        'Run the full limit-state check set after corrections and record utilization ratios, code citations and calculation sheets before proposing review.',
    }),
  ]);
}

/** Capability prerequisites the body requires (A004-shaped declarations). */
export async function buildStructuralEngineerCapabilities(): Promise<
  readonly CapabilityDeclaration[]
> {
  return Object.freeze([
    await createCapabilityDeclaration({
      kind: 'capability',
      id: 'structural-verification-delivery',
      version: '1.0.0',
      description:
        'Deliver correct, auditable structural verification decisions with pinned code editions, drawings and model parameters.',
    }),
    await createCapabilityDeclaration({
      kind: 'sub-capability',
      id: 'load-path-analysis',
      version: '1.0.0',
      description: 'Analyze load paths and diagnose the cause of failing limit-state checks.',
    }),
    await createCapabilityDeclaration({
      kind: 'sub-capability',
      id: 'code-compliance-correction',
      version: '1.0.0',
      description: 'Correct load/model parameters so every limit-state check passes without relaxing criteria.',
    }),
  ]);
}

/**
 * The body's environment requirement: the reference structural-analysis
 * sandbox declared by @arena/environment-structural-engineer. The
 * manifest cites the REAL content-addressed definition — this is the
 * parity link proven in examples/structural-engineer.
 */
export async function structuralEngineerEnvironmentRequirement(): Promise<VersionedArtifactRef> {
  const definition = await createStructuralAnalysisSandbox();
  return Object.freeze({
    namespace: definition.identity.namespace,
    name: definition.identity.name,
    version: definition.version,
    digest: definition.digest,
  }) as VersionedArtifactRef;
}
