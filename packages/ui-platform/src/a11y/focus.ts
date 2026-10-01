/**
 * Focus management helpers — pure functions over an ordered list of focus
 * stop ids. The tab sequence of a trapped region (inspector sheet, dialog)
 * is computed deterministically here so the interactive wiring (B018) and
 * the tests share one definition.
 */

/** Validates and returns a focus trap sequence; empty or duplicate ids throw. */
export function focusTrapSequence(ids: readonly string[]): readonly string[] {
  if (ids.length === 0) {
    throw new Error('focus trap sequence requires at least one stop');
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (id.length === 0) {
      throw new Error('focus trap stop ids must be non-empty');
    }
    if (seen.has(id)) {
      throw new Error(`duplicate focus trap stop id: ${id}`);
    }
    seen.add(id);
  }
  return ids;
}

/**
 * Next stop in a trapped tab order. Wraps from the last stop to the first
 * (forward) and from the first to the last (backward). A `current` that is
 * not part of the order starts from the beginning (forward) or the end
 * (backward) — fail-open to a sane edge, never to a dead end.
 */
export function nextFocusStop(
  order: readonly string[],
  current: string | null,
  direction: 'forward' | 'backward',
): string {
  const validated = focusTrapSequence(order);
  if (current === null || !validated.includes(current)) {
    return direction === 'forward'
      ? (validated[0] as string)
      : (validated[validated.length - 1] as string);
  }
  const index = validated.indexOf(current);
  const delta = direction === 'forward' ? 1 : -1;
  const next = (index + delta + validated.length) % validated.length;
  return validated[next] as string;
}
