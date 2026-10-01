/**
 * Demo narrative view composition (Work Order B006; issue #73;
 * apps/web/src/demo). SERVER-ONLY.
 *
 * Builds the fully-renderable demo landing view model: the role-scoped
 * narrative (variant resolved against the B003 reference role registry),
 * each step's canonical reads fetched THROUGH the B005 read-model path
 * and projected into labelled summaries, the demo kind inventory, and
 * the corpus-hash stamp (the visible determinism proof).
 *
 * Presentation maps product-truth labels onto the @arena/ui-platform
 * truth treatments here — the VOCABULARY is owned by @arena/demo, the
 * VISUAL semantics by the design system, so no two labels can render
 * with identical semantics.
 */

import type { CanonicalRead, KindInventory, ReadModelKind } from '../../../../packages/read-model/src/index.js';
import {
  DEFAULT_NARRATIVE_VARIANT_ID,
  NARRATIVE_VARIANT_IDS,
  describeDemoRecord,
  getDemoNarrativeForVariant,
} from '@arena/demo';
import type {
  DemoRecordSummary,
  NarrativeStep,
  ProductTruthLabel,
} from '@arena/demo';
import { REFERENCE_ROLE_REGISTRY } from '../../../../packages/role-context/src/index.js';
import type { StateKind, NavItem } from '@arena/ui-platform';

/** Map each product-truth label onto its distinct design-system treatment. */
export const TRUTH_LABEL_TO_STATE_KIND: Readonly<Record<ProductTruthLabel, StateKind>> =
  Object.freeze({
    'verified-fact': 'verified',
    evidence: 'evidence',
    'expert-judgment': 'expert-judgment',
    'model-output': 'model-output',
    'simulation-replay': 'simulation',
    'evaluation-result': 'evaluation',
    certification: 'certification',
    suggestion: 'suggestion',
  } as const);

/** The truth treatment a narrative step's label renders with. */
export function truthStateKind(label: ProductTruthLabel): StateKind {
  return TRUTH_LABEL_TO_STATE_KIND[label];
}

/** One narrative step resolved for rendering (reads already fetched). */
export interface NarrativeStepView {
  readonly stepId: string;
  readonly order: number;
  readonly title: string;
  readonly body: string;
  readonly truth: ProductTruthLabel;
  readonly truthState: StateKind;
  /** (kind, recordId, focus) chips the step points at. */
  readonly readRefs: readonly { readonly kind: ReadModelKind; readonly recordId: string; readonly focus?: string }[];
  /** Labelled summaries of the step's canonical reads. */
  readonly summaries: readonly DemoRecordSummary[];
}

/** One role lens link on the demo landing. */
export interface RoleLensLink {
  readonly href: string;
  readonly label: string;
  readonly active: boolean;
}

/** The complete demo landing view model (deterministic by construction). */
export interface DemoLandingView {
  readonly variantId: string;
  readonly variantTitle: string;
  readonly variantIntro: string;
  /** The B003 reference role behind the lens (name + goal). */
  readonly roleName: string;
  readonly roleGoal: string;
  readonly steps: readonly NarrativeStepView[];
  readonly roleLenses: readonly RoleLensLink[];
  readonly inventory: KindInventory;
  readonly corpusHash: string;
}

/** Resolve the requested variant (query-driven, explicit state; default owner). */
export function resolveVariantId(requested: string | undefined): string {
  if (requested === undefined) return DEFAULT_NARRATIVE_VARIANT_ID;
  return (NARRATIVE_VARIANT_IDS as readonly string[]).includes(requested)
    ? requested
    : DEFAULT_NARRATIVE_VARIANT_ID;
}

/** The reference role behind a variant (B003 registry lookup, fail-closed fallback-free). */
function referenceRole(variantId: string): { readonly name: string; readonly goal: string } {
  const role = REFERENCE_ROLE_REGISTRY.roles.find((entry) => entry.roleId === variantId);
  if (role === undefined) {
    return { name: variantId, goal: '' };
  }
  return { name: role.name, goal: role.goal };
}

/** Build the demo landing view: narrative + reads + inventory + hash stamp. */
export async function buildDemoLandingView(options: {
  readonly variantId: string;
  readonly read: (recordId: string) => Promise<CanonicalRead>;
  readonly inventory: () => Promise<KindInventory>;
  readonly corpusHash: string;
}): Promise<DemoLandingView> {
  const narrative = getDemoNarrativeForVariant(options.variantId);
  const role = referenceRole(options.variantId);
  const steps: NarrativeStepView[] = [];
  for (const step of narrative.steps as readonly NarrativeStep[]) {
    const summaries: DemoRecordSummary[] = [];
    const seen = new Set<string>();
    for (const ref of step.readRefs) {
      if (seen.has(ref.recordId)) continue;
      seen.add(ref.recordId);
      summaries.push(describeDemoRecord(await options.read(ref.recordId)));
    }
    steps.push({
      stepId: step.stepId,
      order: step.order,
      title: step.title,
      body: step.body,
      truth: step.truth,
      truthState: truthStateKind(step.truth),
      readRefs: step.readRefs,
      summaries: Object.freeze(summaries),
    });
  }
  const lenses: RoleLensLink[] = NARRATIVE_VARIANT_IDS.map((variantId) => ({
    href: `/demo?role=${variantId}`,
    label: referenceRole(variantId).name,
    active: variantId === options.variantId,
  }));
  return {
    variantId: options.variantId,
    variantTitle: narrative.variant.title,
    variantIntro: narrative.variant.intro,
    roleName: role.name,
    roleGoal: role.goal,
    steps: Object.freeze(steps),
    roleLenses: Object.freeze(lenses),
    inventory: await options.inventory(),
    corpusHash: options.corpusHash,
  };
}

/** Nav items for the demo route (explicit, query-driven state only). */
export const DEMO_ROUTE_NAV_ITEMS: readonly NavItem[] = Object.freeze([
  { href: '/demo?role=owner', label: 'Owner lens' },
  { href: '/demo?role=agent-builder', label: 'Agent-builder lens' },
  { href: '/demo?role=expert', label: 'Expert lens' },
] as const);
