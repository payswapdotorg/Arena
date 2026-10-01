/**
 * Aria-labelling helpers — deterministic id generation and
 * aria-describedby assembly shared by state and layout components.
 */

function slug(part: string): string {
  return part
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Deterministic element id: `slug(prefix)-slug(name)`. Throws when either
 * part slugifies to nothing — an empty id would silently break
 * aria-labelledby wiring.
 */
export function elementId(prefix: string, name: string): string {
  const prefixPart = slug(prefix);
  const namePart = slug(name);
  if (prefixPart.length === 0 || namePart.length === 0) {
    throw new Error(
      `elementId requires slugifiable prefix and name (got ${JSON.stringify(prefix)}, ${JSON.stringify(name)})`,
    );
  }
  return `${prefixPart}-${namePart}`;
}

/**
 * Join truthy ids into an aria-describedby value; returns undefined when
 * nothing applies so callers can omit the attribute entirely
 * (exactOptionalPropertyTypes-safe).
 */
export function describeWith(
  ...ids: ReadonlyArray<string | undefined>
): string | undefined {
  const present = ids.filter((id): id is string => id !== undefined);
  if (present.length === 0) return undefined;
  return present.join(' ');
}
