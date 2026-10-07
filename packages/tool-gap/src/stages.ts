/**
 * The tool-gap signal stage machine (Work Order C008; spec
 * expert-environment-session.md EES1.0 "Tool-gap discovery" feed chain).
 *
 * A signal travels a typed CLOSED stage sequence — never a free string:
 *
 *   CAPTURED
 *     -> TRIAGED
 *        -> TOOL_SPECIFICATION_PROPOSED
 *           -> ADAPTER_REQUEST | BODY_IMPROVEMENT_CANDIDATE
 *              | BENCHMARK_CANDIDATE | MARKETPLACE_ARTIFACT_CANDIDATE
 *        -> (feed disjunction directly from TRIAGED)
 *   terminal stages are FINAL — the machine is closed.
 *
 * Every transition is guarded with a machine-readable reason and NOTHING
 * AUTO-PROMOTES: a stage only ever advances through an EXPLICIT command
 * carrying a recorded decision (see signal.ts). Denied transitions are
 * typed fail-closed rejections, never silent no-ops.
 *
 * Derived-from note: EES1.0 lists the feed chain "Tool specification ->
 * Adapter request -> Body improvement -> capability benchmark ->
 * marketplace artifact"; the work order stages the disjunction after
 * TOOL_SPECIFICATION_PROPOSED. This module ALSO permits the four feed
 * terminals directly from TRIAGED (a triaged signal may be disposed to a
 * benchmark/marketplace candidate without first proposing a tool
 * specification) — recorded as an architecture question for the TL.
 */

/** The closed stage vocabulary (typed, ordered, exhaustive). */
export const TOOL_GAP_STAGES = Object.freeze([
  'captured',
  'triaged',
  'tool-specification-proposed',
  'adapter-request',
  'body-improvement-candidate',
  'benchmark-candidate',
  'marketplace-artifact-candidate',
] as const);
export type ToolGapStage = (typeof TOOL_GAP_STAGES)[number];

/** The terminal (feed) stages of the machine — final once entered. */
export const TOOL_GAP_TERMINAL_STAGES = Object.freeze([
  'adapter-request',
  'body-improvement-candidate',
  'benchmark-candidate',
  'marketplace-artifact-candidate',
] as const);
export type ToolGapFeedStage = (typeof TOOL_GAP_TERMINAL_STAGES)[number];

export function isToolGapStage(value: unknown): value is ToolGapStage {
  return typeof value === 'string' && (TOOL_GAP_STAGES as readonly string[]).includes(value);
}

export function isToolGapFeedStage(value: unknown): value is ToolGapFeedStage {
  return typeof value === 'string' && (TOOL_GAP_TERMINAL_STAGES as readonly string[]).includes(value);
}

export function isTerminalToolGapStage(stage: ToolGapStage): boolean {
  return (TOOL_GAP_TERMINAL_STAGES as readonly string[]).includes(stage);
}

/**
 * The closed transition table. Keys are the FROM stage; values are the
 * ONLY stages reachable from it. Terminal stages map to nothing.
 */
export const TOOL_GAP_TRANSITIONS: Readonly<Record<ToolGapStage, readonly ToolGapStage[]>> =
  Object.freeze({
    captured: Object.freeze(['triaged'] as const),
    triaged: Object.freeze([
      'tool-specification-proposed',
      'adapter-request',
      'body-improvement-candidate',
      'benchmark-candidate',
      'marketplace-artifact-candidate',
    ] as const),
    'tool-specification-proposed': Object.freeze([
      'adapter-request',
      'body-improvement-candidate',
      'benchmark-candidate',
      'marketplace-artifact-candidate',
    ] as const),
    'adapter-request': Object.freeze([] as const),
    'body-improvement-candidate': Object.freeze([] as const),
    'benchmark-candidate': Object.freeze([] as const),
    'marketplace-artifact-candidate': Object.freeze([] as const),
  } as const satisfies Record<ToolGapStage, readonly ToolGapStage[]>);

/** Machine-readable transition verdict reasons (never bare booleans). */
export const STAGE_TRANSITION_REASONS = Object.freeze([
  'transition_ok',
  'transition_same_stage',
  'transition_no_edge',
  'transition_terminal_final',
  'transition_unknown_stage',
  'transition_requires_decision',
] as const);
export type StageTransitionReason = (typeof STAGE_TRANSITION_REASONS)[number];

/** Machine-readable transition verdict (pure — no mutation). */
export interface StageTransitionCheck {
  readonly allowed: boolean;
  readonly reason: StageTransitionReason;
  readonly from: ToolGapStage;
  readonly to: ToolGapStage;
}

/** Verdict for a proposed stage transition (pure, total). */
export function checkStageTransition(from: string, to: string): StageTransitionCheck {
  const fromStage = isToolGapStage(from) ? from : null;
  const toStage = isToolGapStage(to) ? to : null;
  if (fromStage === null || toStage === null) {
    return {
      allowed: false,
      reason: 'transition_unknown_stage',
      from: (fromStage ?? from) as ToolGapStage,
      to: (toStage ?? to) as ToolGapStage,
    };
  }
  if (toStage === fromStage) {
    return { allowed: false, reason: 'transition_same_stage', from: fromStage, to: toStage };
  }
  if (isTerminalToolGapStage(fromStage)) {
    return { allowed: false, reason: 'transition_terminal_final', from: fromStage, to: toStage };
  }
  const edges = TOOL_GAP_TRANSITIONS[fromStage];
  if (!(edges as readonly string[]).includes(toStage)) {
    return { allowed: false, reason: 'transition_no_edge', from: fromStage, to: toStage };
  }
  return { allowed: true, reason: 'transition_ok', from: fromStage, to: toStage };
}

/** The machine-readable decision codes recorded on stage history entries. */
export const STAGE_DECISION_CODES = Object.freeze([
  'capture',
  'triage_disposition',
  'tool_specification_proposed',
  'feed_disposition',
] as const);
export type StageDecisionCode = (typeof STAGE_DECISION_CODES)[number];

export function isStageDecisionCode(value: unknown): value is StageDecisionCode {
  return typeof value === 'string' && (STAGE_DECISION_CODES as readonly string[]).includes(value);
}

/** The decision code that produces a given transition (from -> to). */
export function decisionCodeForTransition(to: ToolGapStage): StageDecisionCode {
  if (to === 'captured') return 'capture';
  if (to === 'triaged') return 'triage_disposition';
  if (to === 'tool-specification-proposed') return 'tool_specification_proposed';
  return 'feed_disposition';
}
