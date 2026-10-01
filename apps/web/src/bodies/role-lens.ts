/**
 * Body Studio role lenses (Work Order B010; issue #82;
 * apps/web/src/bodies).
 *
 * UXM1.0 §Core routes binds the two studio rows:
 *   - `/bodies`:      Owner=used bodies, Builder=body library, Expert=
 *                     expertise context, Evaluator=tested bodies,
 *                     Researcher=study population, Operator=runtime
 *                     health, Marketplace=available releases,
 *                     Admin=governance;
 *   - `/bodies/:id`:  Owner=adopt/inspect, Builder=build/improve,
 *                     Expert=review, Evaluator=certify, Researcher=
 *                     compare, Operator=runtime, Marketplace=license/
 *                     offer, Admin=policy.
 *
 * A lens selects LANDING CONTENT, HERO ACTION and STUDIO EMPHASIS — never
 * permissions (RC1.0; the permission authority stays server-side/
 * policy-driven). Pure + deterministic: every lens is frozen data; role
 * names/goals come from the B003 reference registry by reference. Unknown
 * roles are typed rejections, never silent fallbacks.
 */

import {
  REFERENCE_ROLE_REGISTRY,
  ROLE_IDS,
  getRoleDefinition,
} from '../../../../packages/role-context/src/index.js';
import type { RoleId } from '../../../../packages/role-context/src/index.js';

/** One suggested next action (a real route, a calm note — never a promise). */
export interface BodyStudioNextAction {
  readonly label: string;
  readonly href: string;
  readonly note: string;
}

/**
 * The studio section a lens emphasizes first (emphasis only — every
 * section stays available on every lens; the route is a capability of the
 * shell).
 */
export type BodyStudioEmphasis =
  | 'possession-matrix'
  | 'composition'
  | 'certification'
  | 'comparison'
  | 'runtime'
  | 'license'
  | 'policy';

/** One role lens for the two Body Studio rows. */
export interface BodyStudioRoleLens {
  readonly roleId: RoleId;
  /** Display name + goal, transcribed from the B003 registry by reference. */
  readonly roleName: string;
  readonly roleGoal: string;
  /** UXM1.0 `/bodies` row landing (title + intro). */
  readonly libraryTitle: string;
  readonly libraryIntro: string;
  /** The ONE hero action (UX1.0: one meaningful primary action). */
  readonly heroAction: { readonly label: string; readonly href: string };
  /** UXM1.0 `/bodies/:id` row landing (title + intro + focus note). */
  readonly detailTitle: string;
  readonly detailIntro: string;
  /** What this lens emphasizes on the detail surface (a note, never a permission). */
  readonly detailFocus: string;
  /** The studio section this lens emphasizes first. */
  readonly emphasis: BodyStudioEmphasis;
  /** Suggested next actions into real routes. */
  readonly nextActions: readonly BodyStudioNextAction[];
}

const LENS_DATA: Readonly<
  Record<RoleId, Omit<BodyStudioRoleLens, 'roleId' | 'roleName' | 'roleGoal'>>
> = Object.freeze({
  owner: {
    libraryTitle: 'Used bodies',
    libraryIntro:
      'The Agent Bodies your workspace runs: what each is composed of, which compositions are certified, and what you can adopt with confidence.',
    heroAction: { label: 'Inspect your body library', href: '/bodies' },
    detailTitle: 'Adopt / inspect',
    detailIntro:
      'Inspect what this body is composed of and which of its possessions are certified before you adopt it.',
    detailFocus:
      'Adoption reads the certified compositions — a certification claim covers the tested composition, never the model in isolation.',
    emphasis: 'certification',
    nextActions: [
      { label: 'Open a capability case', href: '/cases', note: 'Follow one gap from case to certified release.' },
      { label: 'Browse the marketplace', href: '/marketplace', note: 'Purchase never implies certification.' },
    ],
  },
  'agent-builder': {
    libraryTitle: 'Body library',
    libraryIntro:
      'Assemble and improve Agent Bodies: skills, knowledge, tools and policies composed around a mission — a body is never just a model.',
    heroAction: { label: 'Improve an Agent Body', href: '/bodies' },
    detailTitle: 'Build / improve',
    detailIntro:
      'Improve this body: compose new skills, knowledge or tools. Improvement creates a NEW immutable Body Version — a version is never edited in place.',
    detailFocus:
      'Every change lands as a new content-addressed version; the possession matrix shows which substrate bindings exist for it.',
    emphasis: 'composition',
    nextActions: [
      { label: 'Review capability gaps', href: '/cases', note: 'Which cases say a capability is missing?' },
      { label: 'Compare substrates in research', href: '/research', note: 'Substrate comparisons are composition-scoped.' },
    ],
  },
  expert: {
    libraryTitle: 'Expertise context',
    libraryIntro:
      'The bodies whose work you are asked to review: their composition, their possessions and what evidence exists around them.',
    heroAction: { label: 'Review assigned work', href: '/cases' },
    detailTitle: 'Review',
    detailIntro:
      'Review this body as expertise context: what it is composed of and how its compositions are bound to substrates.',
    detailFocus:
      'Expert judgment is its own canonical kind — distinct from model output and from verification.',
    emphasis: 'composition',
    nextActions: [
      { label: 'Open assigned cases', href: '/cases', note: 'Enter the workbench from the case that assigned the work.' },
    ],
  },
  evaluator: {
    libraryTitle: 'Tested bodies',
    libraryIntro:
      'The bodies awaiting measurement and the certifications their tested compositions have earned.',
    heroAction: { label: 'Open the evaluation queue', href: '/research' },
    detailTitle: 'Certify',
    detailIntro:
      'Certify this body: a certification claim asserts that a TESTED COMPOSITION — Body Version × Substrate × Environment × Runtime × Suite — satisfied its suite.',
    detailFocus:
      'Certification is distinct from evaluation and from verification; the claim never covers the bare model.',
    emphasis: 'certification',
    nextActions: [
      { label: 'Open evaluation suites', href: '/research', note: 'Suites, criteria and verifier bindings live in the research lab.' },
    ],
  },
  researcher: {
    libraryTitle: 'Study population',
    libraryIntro:
      'The bodies under study: their compositions, their possession populations and the comparisons that measure capability.',
    heroAction: { label: 'Run a capability experiment', href: '/research' },
    detailTitle: 'Compare',
    detailIntro:
      'Compare substrates for this body. Substrate comparisons are COMPOSITION-SCOPED: every arm is a full composition under identical suite/environment semantics — a bare model ranking is a typed rejection.',
    detailFocus:
      'Compare possessions, not models: the substrate is one component of a versioned composition binding.',
    emphasis: 'comparison',
    nextActions: [
      { label: 'Open the benchmark lab', href: '/research', note: 'Body × substrate comparisons and capability lift.' },
    ],
  },
  operator: {
    libraryTitle: 'Runtime health',
    libraryIntro:
      'The bodies in flight and the runtimes and environments their possessions bind — business meaning unchanged.',
    heroAction: { label: 'Investigate a failure', href: '/operations' },
    detailTitle: 'Runtime',
    detailIntro:
      'The runtime posture of this body: which runtimes and environments its possessions bind, and what remains unknown.',
    detailFocus:
      'A possession binds the runtime and environment into the composition — unknown components render as unknown.',
    emphasis: 'runtime',
    nextActions: [
      { label: 'Open operations', href: '/operations', note: 'Jobs, SLOs, quotas and audit as they land (B014).' },
    ],
  },
  'marketplace-participant': {
    libraryTitle: 'Available releases',
    libraryIntro:
      'Bodies available as releases: what each is, how it was created, and which compositions carry certification — purchase never implies certification.',
    heroAction: { label: 'Discover capability artifacts', href: '/marketplace' },
    detailTitle: 'License / offer',
    detailIntro:
      'The license/offer posture of this body: what is released, what is certified, and what rights attach.',
    detailFocus:
      'A licensed artifact is not automatically a certified composition — provenance and rights stay explicit.',
    emphasis: 'license',
    nextActions: [
      { label: 'Browse the catalog', href: '/marketplace', note: 'What it is, how it was created, verification, rights, price.' },
    ],
  },
  administrator: {
    libraryTitle: 'Governance',
    libraryIntro:
      'The tenant\u2019s bodies as a governance surface: tenancy, policy posture and the canonical inventory.',
    heroAction: { label: 'Review tenant policy and audit', href: '/settings' },
    detailTitle: 'Policy',
    detailIntro:
      'The policy posture of this body: authority boundaries, safety policy and tenant scoping as the canonical record carries them.',
    detailFocus:
      'Administration is policy work — roles here are lenses, never grants.',
    emphasis: 'policy',
    nextActions: [
      { label: 'Open members and policy', href: '/settings', note: 'Members, roles, policies, entitlements, audit.' },
    ],
  },
} as const);

/** All 8 studio lenses, deterministically ordered by ROLE_IDS (B003 canonical order). */
export const BODY_STUDIO_ROLE_LENSES: Readonly<Record<RoleId, BodyStudioRoleLens>> =
  Object.freeze(
    Object.fromEntries(
      ROLE_IDS.map((roleId) => {
        const definition = getRoleDefinition(REFERENCE_ROLE_REGISTRY, roleId);
        const data = LENS_DATA[roleId];
        return [
          roleId,
          Object.freeze({
            roleId,
            roleName: definition.name,
            roleGoal: definition.goal,
            libraryTitle: data.libraryTitle,
            libraryIntro: data.libraryIntro,
            heroAction: Object.freeze(data.heroAction),
            detailTitle: data.detailTitle,
            detailIntro: data.detailIntro,
            detailFocus: data.detailFocus,
            emphasis: data.emphasis,
            nextActions: Object.freeze(data.nextActions),
          } satisfies BodyStudioRoleLens),
        ];
      }),
    ) as Readonly<Record<RoleId, BodyStudioRoleLens>>,
  );

/** The lens for a role id (typed rejection for unknown ids — never a silent default). */
export function bodyStudioRoleLens(roleId: string): BodyStudioRoleLens {
  const lens = (BODY_STUDIO_ROLE_LENSES as Record<string, BodyStudioRoleLens | undefined>)[
    roleId
  ];
  if (lens === undefined) {
    throw new Error(
      `unknown body studio role lens: ${JSON.stringify(roleId)} (known: ${ROLE_IDS.join(', ')})`,
    );
  }
  return lens;
}

/** The honest label of a studio emphasis (used for the "role focus" marks). */
export const BODY_STUDIO_EMPHASIS_LABELS: Readonly<Record<BodyStudioEmphasis, string>> =
  Object.freeze({
    'possession-matrix': 'Possession matrix',
    composition: 'Composition',
    certification: 'Certification claims',
    comparison: 'Composition-scoped comparison',
    runtime: 'Runtime posture',
    license: 'License / offer',
    policy: 'Policy posture',
  } as const);
