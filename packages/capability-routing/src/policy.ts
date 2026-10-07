/**
 * Resolution policy (Work Order C015; issue #121) — the VERSIONED mapping
 * of escalation modes to the resource classes Arena may resolve them
 * against. Derived from spec/human-escalation-work-items.md (C015 row):
 *
 *   TOOL_GAP   → tool + marketplace-artifact candidates;
 *   KNOWLEDGE  → knowledge-tier candidates;
 *   SOLVE / CORRECT / UNBLOCK / REVIEW / TEACH → experts and/or Bodies;
 *
 * EVALUATE is an approved escalation mode (AGENTS.md) with no explicit
 * C015 mapping in the work-items row — this policy maps it to
 * marketplace artifacts (evaluation suites) + experts (review), recorded
 * as an architecture question in the PR.
 *
 * THE NO-SILENT-COERCION LAW (structural): the policy is a closed table;
 * a demand's requested class that no mode of the demand allows is NEVER
 * reinterpreted into another class — the engine emits the typed
 * `class-not-allowed` outcome instead. Consumers propose; the policy
 * closes; nothing in between mutates a demand's class intent.
 */

import { CAPABILITY_ROUTING_ERROR_CODES, CapabilityRoutingError } from './errors.js';

/** The eight approved escalation modes (AGENTS.md; spec/human-escalation-work-items.md). */
export const ESCALATION_MODES = Object.freeze([
  'SOLVE',
  'CORRECT',
  'UNBLOCK',
  'REVIEW',
  'TEACH',
  'TOOL_GAP',
  'KNOWLEDGE',
  'EVALUATE',
] as const);
export type EscalationMode = (typeof ESCALATION_MODES)[number];

/** The closed resource-class vocabulary (the C015 candidate space). */
export const RESOURCE_CLASSES = Object.freeze([
  'expert',
  'body',
  'tool',
  'knowledge',
  'artifact',
] as const);
export type ResourceClass = (typeof RESOURCE_CLASSES)[number];

/** Wire version of the resolution policy. */
export const RESOLUTION_POLICY_VERSION = 1 as const;

/** The closed mode → allowed-resource-classes table (version 1). Deterministic, frozen, total over the eight modes. */
export const RESOLUTION_POLICY: Readonly<Record<EscalationMode, readonly ResourceClass[]>> =
  Object.freeze({
    SOLVE: Object.freeze<readonly ResourceClass[]>(['expert', 'body']),
    CORRECT: Object.freeze<readonly ResourceClass[]>(['expert', 'body']),
    UNBLOCK: Object.freeze<readonly ResourceClass[]>(['expert', 'body']),
    REVIEW: Object.freeze<readonly ResourceClass[]>(['expert', 'body']),
    TEACH: Object.freeze<readonly ResourceClass[]>(['expert', 'body']),
    TOOL_GAP: Object.freeze<readonly ResourceClass[]>(['tool', 'artifact']),
    KNOWLEDGE: Object.freeze<readonly ResourceClass[]>(['knowledge']),
    EVALUATE: Object.freeze<readonly ResourceClass[]>(['artifact', 'expert']),
  });

/** Structural (non-throwing) guard for the closed mode vocabulary. */
export function isEscalationMode(value: unknown): value is EscalationMode {
  return typeof value === 'string' && (ESCALATION_MODES as readonly string[]).includes(value);
}

/** Structural (non-throwing) guard for the closed resource-class vocabulary. */
export function isResourceClass(value: unknown): value is ResourceClass {
  return typeof value === 'string' && (RESOURCE_CLASSES as readonly string[]).includes(value);
}

/**
 * The classes the policy allows for a set of modes (union, deterministic
 * canonical class order). A mode outside the closed vocabulary throws a
 * typed INVALID_POLICY error — callers validate demand modes earlier.
 */
export function allowedResourceClasses(modes: readonly string[]): readonly ResourceClass[] {
  if (!Array.isArray(modes) || modes.length === 0) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_POLICY, {
      message: 'resolution policy requires a non-empty escalation-mode list',
      details: { modes: Array.isArray(modes) ? [...modes] : String(modes) },
    });
  }
  for (const mode of modes) {
    if (!isEscalationMode(mode)) {
      throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_POLICY, {
        message: `unknown escalation mode: ${JSON.stringify(mode)}`,
        details: { allowed: [...ESCALATION_MODES] },
      });
    }
  }
  const allowed = new Set<ResourceClass>();
  for (const mode of modes as readonly EscalationMode[]) {
    for (const resourceClass of RESOLUTION_POLICY[mode]) {
      allowed.add(resourceClass);
    }
  }
  return Object.freeze(
    RESOURCE_CLASSES.filter((resourceClass) => allowed.has(resourceClass)),
  );
}

/**
 * Closed check: is one resource class allowed for a set of modes? (The
 * engine's per-class gate — never a coercion path.)
 */
export function isClassAllowedForModes(
  resourceClass: ResourceClass,
  modes: readonly string[],
): boolean {
  return (allowedResourceClasses(modes) as readonly string[]).includes(resourceClass);
}
