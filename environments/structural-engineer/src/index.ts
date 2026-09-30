/**
 * @arena/environment-structural-engineer — the reference Structural
 * Engineer environment definitions (Work Order A029).
 *
 * Declares the typed ENV1.0 environments the Structural Engineer Agent
 * Body executes in (A009 protocol): a seeded structural-analysis
 * sandbox with reference-data egress, and a sealed hermetic review
 * world; plus the typed A010 consumption surface: run declarations
 * that fit inside the declared isolation envelopes, the admission
 * view, and the canonical lifecycle sequence. The end-to-end
 * provisioning walkthrough lives in examples/structural-engineer.
 */

export * from './shared.js';
export * from './definition.js';
export * from './runtime.js';
export * from './envelopes.js';

import { STRUCTURAL_ENGINEER_ENV_SCHEMAS } from './envelopes.js';
import { STRUCTURAL_ENGINEER_ENV_ERROR_CODES } from './shared.js';

/** Protocol surface version of this package's data shapes. */
export const STRUCTURAL_ENGINEER_ENV_PROTOCOL_VERSION = '1.0.0' as const;

/** Supported error codes (closed list). */
export const SUPPORTED_STRUCTURAL_ENGINEER_ENV_ERROR_CODES: readonly string[] = Object.freeze([
  ...Object.values(STRUCTURAL_ENGINEER_ENV_ERROR_CODES),
]);

/** Frozen copy of the in-package schema registry. */
export const STRUCTURAL_ENGINEER_ENV_SCHEMA_REGISTRY: Readonly<Record<string, string>> =
  Object.freeze({ ...STRUCTURAL_ENGINEER_ENV_SCHEMAS });
