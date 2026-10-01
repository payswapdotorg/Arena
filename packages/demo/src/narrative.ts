/**
 * The guided first-run narrative (Work Order B006; issue #73).
 *
 * A versioned, ordered sequence of narrative steps — the calm, friendly
 * story the demo landing tells: introduce the workspace, show an Agent
 * Body, show a Task run + trajectory, show evaluation vs verification
 * (product-truth-labelled), show the Epoch learning loop at a narrative
 * level, and invite exploring by role. Every step points at canonical
 * reads (kind + record id from the demo corpus) and carries ONE
 * product-truth label for what is being shown.
 *
 * Role-scoped variants (owner / agent-builder / expert at minimum) are
 * frozen reorderings of the SAME steps — the web layer maps variant ids
 * onto the B003 role-context registry (name/goal) so the narrative walks
 * real reference roles.
 */

import { DEMO_ERROR_CODES, DemoError } from './errors.js';
import { isProductTruthLabel, type ProductTruthLabel } from './shared.js';
import { DEMO_CORPUS_RECORD_IDS } from './corpus.js';
import type { ReadModelKind } from '@arena/read-model';

/** Version of the narrative script (a script change is a version change). */
export const DEMO_NARRATIVE_VERSION = '1.0.0' as const;

/** One canonical read a narrative step points at. */
export interface NarrativeReadRef {
  /** The B005 disclosed kind of the referenced corpus record. */
  readonly kind: ReadModelKind;
  /** The corpus record id (`demo.<kind>:<stable-slug>`). */
  readonly recordId: string;
  /** Optional deterministic pointer into the record data. */
  readonly focus?: string;
}

/** One step of the guided narrative. */
export interface NarrativeStep {
  readonly stepId: string;
  /** 1-based canonical position (frozen; ordering is part of the contract). */
  readonly order: number;
  readonly title: string;
  /** Calm, friendly body text — no hype. */
  readonly body: string;
  /** The canonical read(s) this step shows (kind + record id). */
  readonly readRefs: readonly NarrativeReadRef[];
  /** The product-truth label for what is being shown. */
  readonly truth: ProductTruthLabel;
}

/** The narrative role-variant ids (mapped onto B003 reference roles). */
export const NARRATIVE_VARIANT_IDS = Object.freeze(['owner', 'agent-builder', 'expert'] as const);

/** One role-scoped narrative variant. */
export interface NarrativeRoleVariant {
  readonly variantId: (typeof NARRATIVE_VARIANT_IDS)[number];
  readonly title: string;
  readonly intro: string;
  /** Ordered step ids — a frozen reordering of the canonical steps. */
  readonly stepIds: readonly string[];
}

const STEPS: readonly NarrativeStep[] = Object.freeze([
  {
    stepId: 'welcome',
    order: 1,
    title: 'Welcome to a demo workspace',
    body: 'This is Arena in demo mode: a deterministic, resettable walkthrough of one workspace. Nothing here is customer state, no credentials were needed to enter, and every datum is labelled with the kind of truth it is.',
    readRefs: [{ kind: 'capability-case', recordId: 'demo.capability-case.payments-reliability' }],
    truth: 'verified-fact',
  },
  {
    stepId: 'agent-body',
    order: 2,
    title: 'An Agent Body, as data',
    body: 'This is the software-engineer reference body: a versioned manifest of skills, knowledge, tools and procedures — not a person, and not a running process. Its possessions live on a substrate, and substrate access is composition-scoped.',
    readRefs: [
      { kind: 'agent-body', recordId: 'demo.agent-body.software-engineer', focus: 'manifestSummary' },
      { kind: 'agent-body', recordId: 'demo.agent-body.structural-engineer', focus: 'manifestSummary' },
    ],
    truth: 'verified-fact',
  },
  {
    stepId: 'task-run',
    order: 3,
    title: 'A task run, replayed',
    body: 'Here is one capability case and its task run: what the body observed, which tool it used, and what came back. The timeline distinguishes observation, action, tool and result. This is a replay of a recorded run — it is not a live mutation of anything.',
    readRefs: [
      {
        kind: 'capability-case',
        recordId: 'demo.capability-case.payments-reliability',
        focus: 'trajectory',
      },
    ],
    truth: 'simulation-replay',
  },
  {
    stepId: 'model-output',
    order: 4,
    title: 'What the model proposed',
    body: 'The body proposed a change: jittered exponential backoff instead of a fixed retry interval. A proposal from a model is a model output — a draft to review, not a verified fact about the code.',
    readRefs: [
      {
        kind: 'capability-case',
        recordId: 'demo.capability-case.payments-reliability',
        focus: 'trajectory',
      },
    ],
    truth: 'model-output',
  },
  {
    stepId: 'evaluation',
    order: 5,
    title: 'Evaluation: did the body meet its suite?',
    body: 'Evaluation checks the body against its declared evaluation suite. Here the suite passed and regression tests were added. Evaluation is its own concept — it is not verification, and it is not certification.',
    readRefs: [
      {
        kind: 'capability-case',
        recordId: 'demo.capability-case.payments-reliability',
        focus: 'evaluation',
      },
    ],
    truth: 'evaluation-result',
  },
  {
    stepId: 'verification',
    order: 6,
    title: 'Verification: independent checks',
    body: 'Verification re-ran the regression tests in a clean environment and a second reviewer inspected the diff. These are the recorded checks — evidence, carried as evidence, not as a claim.',
    readRefs: [
      {
        kind: 'capability-case',
        recordId: 'demo.capability-case.payments-reliability',
        focus: 'verification',
      },
    ],
    truth: 'evidence',
  },
  {
    stepId: 'epoch',
    order: 7,
    title: 'The Epoch learning loop, in one breath',
    body: 'When a run produces something worth keeping, the Epoch loop suggests a skill draft — and admission requires experiment evidence. The suggestion below stays a suggestion until it earns its evidence. Nothing is silently learned.',
    readRefs: [
      {
        kind: 'capability-case',
        recordId: 'demo.capability-case.payments-reliability',
        focus: 'epoch',
      },
    ],
    truth: 'suggestion',
  },
  {
    stepId: 'certification',
    order: 8,
    title: 'Certification: a distinct milestone',
    body: 'Because evaluation passed and independent verification passed, the body version was certified for release. Certification is a milestone with its own basis — never a side effect of a good evaluation alone.',
    readRefs: [
      {
        kind: 'certification',
        recordId: 'demo.certification.software-engineer-v1-1-0',
      },
    ],
    truth: 'certification',
  },
  {
    stepId: 'explore-by-role',
    order: 9,
    title: 'Explore by role',
    body: 'Arena reads differently depending on who you are: an owner asks what is happening and what it costs; an agent-builder asks how bodies are put together; an expert asks where their judgment is needed. Pick a role lens above — the same labelled truth, from your angle.',
    readRefs: [
      { kind: 'expert-qualification', recordId: 'demo.expert-qualification.structural-review' },
      { kind: 'capability-case', recordId: 'demo.capability-case.payments-reliability' },
    ],
    truth: 'expert-judgment',
  },
] as const);

const VARIANTS: readonly NarrativeRoleVariant[] = Object.freeze([
  {
    variantId: 'owner',
    title: 'Owner lens',
    intro: 'As the workspace owner you want the honest state of one case, what was verified, and what it cost — with nothing presented as more certain than it is.',
    stepIds: Object.freeze([
      'welcome',
      'task-run',
      'evaluation',
      'verification',
      'certification',
      'agent-body',
      'model-output',
      'epoch',
      'explore-by-role',
    ]),
  },
  {
    variantId: 'agent-builder',
    title: 'Agent-builder lens',
    intro: 'As the agent-builder you care how the body is assembled, what it proposed, and how the Epoch loop turns runs into skill drafts.',
    stepIds: Object.freeze([
      'welcome',
      'agent-body',
      'model-output',
      'task-run',
      'epoch',
      'evaluation',
      'verification',
      'certification',
      'explore-by-role',
    ]),
  },
  {
    variantId: 'expert',
    title: 'Expert lens',
    intro: 'As the domain expert you care where your judgment is recorded, what evidence backs each claim, and which verification checks you could repeat.',
    stepIds: Object.freeze([
      'welcome',
      'explore-by-role',
      'verification',
      'evaluation',
      'model-output',
      'task-run',
      'agent-body',
      'certification',
      'epoch',
    ]),
  },
] as const);

/** The full canonical narrative (frozen, versioned). */
export interface DemoNarrative {
  readonly version: typeof DEMO_NARRATIVE_VERSION;
  readonly steps: readonly NarrativeStep[];
}

/** The narrative scoped to one role variant (same steps, role order + intro). */
export interface DemoNarrativeForRole {
  readonly version: typeof DEMO_NARRATIVE_VERSION;
  readonly variant: NarrativeRoleVariant;
  readonly steps: readonly NarrativeStep[];
}

/** The frozen canonical narrative script. */
export const DEMO_NARRATIVE: DemoNarrative = Object.freeze({
  version: DEMO_NARRATIVE_VERSION,
  steps: STEPS,
});

/** All frozen role variants, in NARRATIVE_VARIANT_IDS order. */
export const NARRATIVE_VARIANTS: readonly NarrativeRoleVariant[] = VARIANTS;

/** The default variant used when a visitor opens the demo landing. */
export const DEFAULT_NARRATIVE_VARIANT_ID = 'owner' as const;

/** Read the canonical narrative (frozen copy of the script). */
export function getDemoNarrative(): DemoNarrative {
  return DEMO_NARRATIVE;
}

/** Resolve a narrative variant by id (typed DEMO_INVALID_INPUT on miss). */
export function getNarrativeVariant(variantId: string): NarrativeRoleVariant {
  const variant = VARIANTS.find((entry) => entry.variantId === variantId);
  if (variant === undefined) {
    throw new DemoError(DEMO_ERROR_CODES.INVALID_INPUT, {
      message: `unknown narrative variant ${JSON.stringify(variantId)} (allowed: ${NARRATIVE_VARIANT_IDS.join(', ')})`,
      details: { variantId },
    });
  }
  return variant;
}

/** Read the narrative scoped to one role variant (steps in variant order). */
export function getDemoNarrativeForVariant(variantId: string): DemoNarrativeForRole {
  const variant = getNarrativeVariant(variantId);
  const byId = new Map(STEPS.map((step) => [step.stepId, step] as const));
  const steps = variant.stepIds.map((stepId) => {
    const step = byId.get(stepId);
    if (step === undefined) {
      throw new DemoError(DEMO_ERROR_CODES.UNKNOWN_RECORD, {
        message: `narrative variant ${JSON.stringify(variantId)} references unknown step ${JSON.stringify(stepId)}`,
        details: { variantId, stepId },
      });
    }
    return step;
  });
  return Object.freeze({ version: DEMO_NARRATIVE_VERSION, variant, steps });
}

/**
 * Validate that every narrative read reference resolves to a record of
 * the demo corpus and carries a valid product-truth label. Used by tests
 * and by the web layer's view builder (fail closed on drift).
 */
export function assertNarrativeReferencesCorpus(): void {
  const known = new Set<string>(DEMO_CORPUS_RECORD_IDS);
  for (const step of STEPS) {
    if (!isProductTruthLabel(step.truth)) {
      throw new DemoError(DEMO_ERROR_CODES.INVALID_INPUT, {
        message: `narrative step ${JSON.stringify(step.stepId)} carries an invalid product-truth label`,
        details: { stepId: step.stepId, truth: step.truth },
      });
    }
    if (step.readRefs.length === 0) {
      throw new DemoError(DEMO_ERROR_CODES.UNKNOWN_RECORD, {
        message: `narrative step ${JSON.stringify(step.stepId)} points at no canonical read`,
        details: { stepId: step.stepId },
      });
    }
    for (const ref of step.readRefs) {
      if (!known.has(ref.recordId)) {
        throw new DemoError(DEMO_ERROR_CODES.UNKNOWN_RECORD, {
          message: `narrative step ${JSON.stringify(step.stepId)} references record ${JSON.stringify(ref.recordId)} which is not in the demo corpus`,
          details: { stepId: step.stepId, recordId: ref.recordId },
        });
      }
    }
  }
}
