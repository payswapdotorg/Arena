/**
 * @arena/environment-software-engineer — the reference Software
 * Engineer environment definitions (Work Order A028).
 *
 * Declares the typed ENV1.0 environments the Software Engineer Agent
 * Body executes in (A009 protocol), plus the typed A010 consumption
 * surface: run declarations that fit inside the declared isolation
 * envelopes, the admission view, and the canonical lifecycle sequence.
 * The end-to-end provisioning walkthrough lives in
 * examples/software-engineer.
 */

export * from './shared.js';
export * from './definition.js';
export * from './runtime.js';
export * from './envelopes.js';

import { SOFTWARE_ENGINEER_ENV_SCHEMAS } from './envelopes.js';
import { SOFTWARE_ENGINEER_ENV_ERROR_CODES } from './shared.js';

/** Protocol surface version of this package's data shapes. */
export const SOFTWARE_ENGINEER_ENV_PROTOCOL_VERSION = '1.0.0' as const;

/** Supported error codes (closed list). */
export const SUPPORTED_SOFTWARE_ENGINEER_ENV_ERROR_CODES: readonly string[] = Object.freeze([
  ...Object.values(SOFTWARE_ENGINEER_ENV_ERROR_CODES),
]);

/** Frozen copy of the in-package schema registry. */
export const SOFTWARE_ENGINEER_ENV_SCHEMA_REGISTRY: Readonly<Record<string, string>> =
  Object.freeze({ ...SOFTWARE_ENGINEER_ENV_SCHEMAS });
