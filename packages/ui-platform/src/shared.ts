/**
 * Presentation-only utilities shared by @arena/ui-platform components.
 * Nothing here knows anything about Arena domain concepts.
 */

/** Class-name joiner: filters out false/null/undefined parts. */
export function cx(
  ...parts: ReadonlyArray<string | false | null | undefined>
): string {
  return parts.filter((part): part is string => typeof part === 'string').join(' ');
}

/** Props shared by most presentational components. */
export interface CommonProps {
  /** Extra class names appended to the component's own classes. */
  readonly className?: string;
  /** Optional test id (rendered as data-testid). */
  readonly testId?: string;
}

/** Renders data-testid only when provided (exactOptionalPropertyTypes-safe). */
export function testIdProps(testId: string | undefined): {
  readonly 'data-testid'?: string;
} {
  return testId === undefined ? {} : { 'data-testid': testId };
}
