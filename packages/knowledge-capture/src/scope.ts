/**
 * Typed knowledge scope declarations (Work Order C008; EES1.0
 * "Knowledge capture" — task-specific advice must not silently become
 * universal knowledge).
 *
 * Every lattice record declares a STRUCTURED scope, not a free string:
 *
 *   task        — one task instance (task-specific guidance lives here);
 *   case        — one case/engagement the task belongs to;
 *   domain      — a named domain of practice;
 *   jurisdiction — a legal/regulatory jurisdiction.
 *
 * Scope kinds are ORDERED (rank): task < case < domain < jurisdiction.
 * The no-silent-promotion wall (lattice.ts) permits AT MOST ONE rank of
 * scope widening per explicit promotion — a task-scoped record can never
 * jump straight to domain/jurisdiction scope (that is overgeneralization
 * and fails closed).
 */

export const KNOWLEDGE_SCOPE_KINDS = Object.freeze([
  'task',
  'case',
  'domain',
  'jurisdiction',
] as const);
export type KnowledgeScopeKind = (typeof KNOWLEDGE_SCOPE_KINDS)[number];

export function isKnowledgeScopeKind(value: unknown): value is KnowledgeScopeKind {
  return typeof value === 'string' && (KNOWLEDGE_SCOPE_KINDS as readonly string[]).includes(value);
}

/** The typed scope declaration every lattice record must carry. */
export interface KnowledgeScopeDeclaration {
  readonly kind: KnowledgeScopeKind;
  /** The scoped subject (task id, case id, domain name, jurisdiction code). */
  readonly ref: string;
}

/** Scope rank (ordered lattice: task < case < domain < jurisdiction). */
export const KNOWLEDGE_SCOPE_RANK: Readonly<Record<KnowledgeScopeKind, number>> = Object.freeze({
  task: 0,
  case: 1,
  domain: 2,
  jurisdiction: 3,
});

/** How many scope ranks a promotion may widen in a single step (the wall). */
export const MAX_SCOPE_WIDENING_PER_PROMOTION = 1;

export function scopeRank(kind: KnowledgeScopeKind): number {
  return KNOWLEDGE_SCOPE_RANK[kind];
}

/**
 * Parse a scope declaration from the C006 artifact's scope string using
 * the "<kind>:<ref>" convention (e.g. "task:task-42", "domain:eu-vat").
 * Returns null when the string is not a convention-shaped declaration —
 * callers fail closed on that (a free-text scope is NOT a typed scope).
 */
export function parseScopeDeclaration(scope: string): KnowledgeScopeDeclaration | null {
  if (typeof scope !== 'string') return null;
  const separator = scope.indexOf(':');
  if (separator <= 0) return null;
  const kind = scope.slice(0, separator);
  const ref = scope.slice(separator + 1);
  if (!isKnowledgeScopeKind(kind)) return null;
  if (ref.length === 0 || ref.length > 512) return null;
  return Object.freeze({ kind, ref });
}

/** Validate an arbitrary value as a scope declaration (fail-closed helper). */
export function isKnowledgeScopeDeclaration(value: unknown): value is KnowledgeScopeDeclaration {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isKnowledgeScopeKind(candidate['kind']) &&
    typeof candidate['ref'] === 'string' &&
    candidate['ref'].length > 0 &&
    candidate['ref'].length <= 512
  );
}
