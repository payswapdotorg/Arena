/**
 * The composition-scoped substrate comparison model (Work Order B010;
 * issue #82; packages/body-ui).
 *
 * THE governing rule (B010 brief §6; architecture-lock rule 4): substrate
 * comparisons are COMPOSITION-SCOPED or TYPED-REJECTED. A bare
 * model-vs-model / substrate-vs-substrate ranking is FORBIDDEN —
 * certification claims apply to the tested composition, never the base
 * model. The model below makes that rule structural:
 *
 *   - every comparison arm is a FULL composition selector (body version ×
 *     substrate × runtime × environment) — never a bare substrate;
 *   - a substrate comparison PINS one body version: the substrate is the
 *     only varying component (arms disagreeing on the body version are a
 *     typed MIXED_BODY_VERSIONS rejection — that is a different study);
 *   - arms must share identical environment semantics (the comparison
 *     basis); the shared suite is declared on the basis and rendered as
 *     unknown when not carried (never fabricated);
 *   - the output is a per-composition table of rows carrying each arm's
 *     full composition identity and its evidence VERBATIM — never a
 *     ranking, never a winner, never a numeric score.
 *
 * Rejections are TYPED frozen results (the closed vocabulary below), so
 * the UI renders the rejection honestly instead of silently producing a
 * bare ranking.
 */

import { deepFreezeView } from './shared.js';

/** Wire version of the comparison view models. */
export const COMPARISON_VIEW_VERSION = 1 as const;

/** The closed rejection vocabulary for invalid comparison requests. */
export const SUBSTRATE_COMPARISON_REJECTION_CODES = Object.freeze([
  'BODY_UI_INSUFFICIENT_ARMS',
  'BODY_UI_BARE_SUBSTRATE_COMPARISON',
  'BODY_UI_MIXED_BODY_VERSIONS',
  'BODY_UI_INCOMPLETE_ARM',
  'BODY_UI_ENVIRONMENT_BASIS_MISMATCH',
] as const);

/** One typed rejection code (closed vocabulary). */
export type SubstrateComparisonRejectionCode =
  (typeof SUBSTRATE_COMPARISON_REJECTION_CODES)[number];

/**
 * The comparison scope contract, carried as frozen data so every compare
 * surface renders the rule and its rejection vocabulary verbatim.
 */
export const COMPARISON_SCOPE_CONTRACT = Object.freeze({
  scope: 'composition-scoped',
  rule:
    'Substrate comparisons compare full compositions (Body Version × Substrate × Runtime × Environment) under identical suite/environment semantics — a bare substrate or model ranking is a typed rejection, never a rendered comparison.',
  rejectionVocabulary: SUBSTRATE_COMPARISON_REJECTION_CODES,
} as const);

/** The body half of a comparison arm — REQUIRED (the composition is scoped to it). */
export interface CompositionBodySelector {
  readonly bodyId: string;
  readonly version: string;
}

/** One comparison arm: a full composition selector (all components required for a valid comparison). */
export interface SubstrateComparisonArm {
  readonly armId: string;
  /** REQUIRED: the body version this arm's composition is scoped to. */
  readonly bodyVersion: CompositionBodySelector | undefined;
  /** The substrate under test in this arm (REQUIRED — a missing substrate is an incomplete arm). */
  readonly substrate: string | undefined;
  /** The runtime component of this arm's composition, when carried. */
  readonly runtime: string | undefined;
  /** The environment component of this arm's composition (must match the basis). */
  readonly environment: string | undefined;
  /** The possession id this arm derives from, when carried (the binding's own id). */
  readonly possessionId: string | undefined;
  /** Evidence carried VERBATIM (never ranked, never scored by this model). */
  readonly evidence: {
    readonly verdict: string | undefined;
    readonly reasons: readonly string[];
  };
}

/** The comparison basis: the shared semantics every arm is compared under. */
export interface SubstrateComparisonBasis {
  /** The shared suite identity — unknown when not carried (rendered as unknown, never fabricated). */
  readonly suite: string | undefined;
  /** The shared environment semantics; arms must match it when declared. */
  readonly environment: string | undefined;
}

/** The comparison request (composition-scoped by construction or typed-rejected). */
export interface SubstrateComparisonRequest {
  readonly basis: SubstrateComparisonBasis;
  readonly arms: readonly SubstrateComparisonArm[];
}

/** One compared row: a full composition with its evidence verbatim — never ranked. */
export interface SubstrateComparisonRow {
  readonly viewVersion: typeof COMPARISON_VIEW_VERSION;
  readonly armId: string;
  /** The PINNED body version every arm shares (the comparison's scope). */
  readonly bodyVersion: CompositionBodySelector;
  readonly substrate: string;
  readonly runtime: string | undefined;
  readonly environment: string | undefined;
  readonly possessionId: string | undefined;
  readonly evidence: {
    readonly verdict: string | undefined;
    readonly reasons: readonly string[];
  };
  /** The claim scope note: what any evidence on this row actually asserts. */
  readonly claimScopeNote: string;
}

/** The successful comparison: a per-composition table, never a ranking. */
export interface SubstrateComparisonTable {
  readonly viewVersion: typeof COMPARISON_VIEW_VERSION;
  readonly kind: 'substrate-within-composition';
  readonly basis: SubstrateComparisonBasis;
  /** True when the shared suite identity is unknown (rendered as unknown — never fabricated). */
  readonly suiteUnknown: boolean;
  readonly rows: readonly SubstrateComparisonRow[];
}

/** The typed rejection of an invalid comparison request. */
export interface SubstrateComparisonRejection {
  readonly viewVersion: typeof COMPARISON_VIEW_VERSION;
  readonly kind: 'rejected';
  readonly code: SubstrateComparisonRejectionCode;
  readonly message: string;
  readonly guidance: string;
}

/** The outcome of building a substrate comparison: compared, or typed-rejected. */
export type SubstrateComparisonOutcome =
  | SubstrateComparisonTable
  | SubstrateComparisonRejection;

/**
 * Build the composition-scoped substrate comparison. Deterministic and
 * pure: rows preserve request order; no scores, no ranking, no winner.
 * Invalid requests are TYPED rejections — most importantly a request
 * whose arms carry no body version (a BARE substrate/model ranking)
 * is rejected with `BODY_UI_BARE_SUBSTRATE_COMPARISON`.
 */
export function buildSubstrateComparison(
  request: SubstrateComparisonRequest,
): SubstrateComparisonOutcome {
  const arms = request.arms;

  if (arms.length < 2) {
    return rejection(
      'BODY_UI_INSUFFICIENT_ARMS',
      'a comparison needs at least two arms',
      'Assemble at least two compositions (possessions) before comparing; one composition is a fact, not a comparison.',
    );
  }

  // The composition scope: every arm must carry its body version. An arm
  // without one is a bare substrate — the forbidden model-ranking shape.
  for (const arm of arms) {
    if (arm.bodyVersion === undefined) {
      return rejection(
        'BODY_UI_BARE_SUBSTRATE_COMPARISON',
        `arm ${JSON.stringify(arm.armId)} carries no body version — a bare substrate comparison is not a valid Arena comparison`,
        'Compose each arm as a full composition (Body Version × Substrate × Runtime × Environment). Certification claims apply to the tested composition, never the bare model.',
      );
    }
  }

  // The substrate-within-composition scope pins ONE body version.
  const pinned = arms[0]?.bodyVersion;
  if (pinned === undefined) {
    // Unreachable (validated above); kept for exhaustive strictness.
    return rejection(
      'BODY_UI_BARE_SUBSTRATE_COMPARISON',
      'no arm carries a body version',
      'Compose each arm as a full composition.',
    );
  }
  for (const arm of arms) {
    const bodyVersion = arm.bodyVersion;
    if (
      bodyVersion === undefined ||
      bodyVersion.bodyId !== pinned.bodyId ||
      bodyVersion.version !== pinned.version
    ) {
      return rejection(
        'BODY_UI_MIXED_BODY_VERSIONS',
        `arm ${JSON.stringify(arm.armId)} binds ${bodyVersion === undefined ? 'no body version' : `${bodyVersion.bodyId}@${bodyVersion.version}`} while the comparison pins ${pinned.bodyId}@${pinned.version}`,
        'A substrate comparison pins one body version so the substrate is the only varying component. Comparing different bodies or versions is a different study (composition comparison), not a substrate comparison.',
      );
    }
  }

  // Every arm must name its substrate — otherwise the comparison has
  // nothing to compare and the row would render a guessed blank.
  for (const arm of arms) {
    if (arm.substrate === undefined || arm.substrate.length === 0) {
      return rejection(
        'BODY_UI_INCOMPLETE_ARM',
        `arm ${JSON.stringify(arm.armId)} carries no substrate`,
        'Every comparison arm must name the cognitive substrate bound into its composition; an unknown substrate renders as unknown, never as a fabricated comparison.',
      );
    }
  }

  // Identical environment semantics: when the basis declares an
  // environment, every arm must match it; arms must also agree with each
  // other when the basis is undeclared (unknown basis, known arms).
  const declaredEnvironment = request.basis.environment;
  for (const arm of arms) {
    if (
      declaredEnvironment !== undefined &&
      arm.environment !== undefined &&
      arm.environment !== declaredEnvironment
    ) {
      return rejection(
        'BODY_UI_ENVIRONMENT_BASIS_MISMATCH',
        `arm ${JSON.stringify(arm.armId)} carries environment ${JSON.stringify(arm.environment)} while the comparison basis declares ${JSON.stringify(declaredEnvironment)}`,
        'Compare compositions under identical environment semantics: align the arms’ environments with the declared basis before comparing.',
      );
    }
    if (declaredEnvironment === undefined && arm.environment !== undefined) {
      const first = arms[0]?.environment;
      if (first !== undefined && first !== arm.environment) {
        return rejection(
          'BODY_UI_ENVIRONMENT_BASIS_MISMATCH',
          `arms carry differing environments (${JSON.stringify(first)} vs ${JSON.stringify(arm.environment)}) with no declared basis`,
          'Declare the shared environment semantics on the comparison basis so the arms are compared under identical conditions.',
        );
      }
    }
  }

  const rows: SubstrateComparisonRow[] = arms.map((arm) => {
    // Validated above: bodyVersion and substrate are present.
    const bodyVersion = arm.bodyVersion as CompositionBodySelector;
    const substrate = arm.substrate as string;
    return deepFreezeView({
      viewVersion: COMPARISON_VIEW_VERSION,
      armId: arm.armId,
      bodyVersion: Object.freeze({ bodyId: bodyVersion.bodyId, version: bodyVersion.version }),
      substrate,
      runtime: arm.runtime,
      environment: arm.environment,
      possessionId: arm.possessionId,
      evidence: Object.freeze({
        verdict: arm.evidence.verdict,
        reasons: Object.freeze([...arm.evidence.reasons]),
      }),
      claimScopeNote:
        'Evidence on this row asserts a claim about THIS composition (Body Version × Substrate × Runtime × Environment × Suite) — never about the substrate in isolation.',
    } satisfies SubstrateComparisonRow);
  });

  return deepFreezeView({
    viewVersion: COMPARISON_VIEW_VERSION,
    kind: 'substrate-within-composition',
    basis: Object.freeze({
      suite: request.basis.suite,
      environment: request.basis.environment,
    }),
    suiteUnknown: request.basis.suite === undefined,
    rows: Object.freeze(rows),
  } satisfies SubstrateComparisonTable);
}

/** Build one typed rejection (frozen; message + guidance rendered verbatim). */
function rejection(
  code: SubstrateComparisonRejectionCode,
  message: string,
  guidance: string,
): SubstrateComparisonRejection {
  return Object.freeze({
    viewVersion: COMPARISON_VIEW_VERSION,
    kind: 'rejected' as const,
    code,
    message,
    guidance,
  } satisfies SubstrateComparisonRejection);
}

/**
 * Project possession matrix rows into comparison arms (the studio's bridge
 * from the possession matrix to the comparison model). Rows whose body
 * half is unreadable become arms WITHOUT a body version — feeding them
 * into `buildSubstrateComparison` then yields the honest typed
 * BARE_SUBSTRATE_COMPARISON rejection rather than a guessed comparison.
 */
export function possessionRowsToComparisonArms(
  rows: readonly {
    readonly possessionId: string | undefined;
    readonly bodyVersion: { readonly bodyId: string; readonly version: string } | undefined;
    readonly substrate: string | undefined;
    readonly runtime: string | undefined;
    readonly environment: string | undefined;
  }[],
): readonly SubstrateComparisonArm[] {
  return Object.freeze(
    rows.map((row, index) => ({
      armId: row.possessionId ?? `possession-row-${String(index)}`,
      bodyVersion: row.bodyVersion,
      substrate: row.substrate,
      runtime: row.runtime,
      environment: row.environment,
      possessionId: row.possessionId,
      evidence: Object.freeze({ verdict: undefined, reasons: Object.freeze([]) }),
    })),
  );
}
