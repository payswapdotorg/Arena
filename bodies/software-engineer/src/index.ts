/**
 * @arena/body-software-engineer — the reference Software Engineer
 * Agent Body (Work Order A028).
 *
 * The FIRST COMPLETE REFERENCE VERTICAL SLICE body of Arena: a fully
 * specified body definition that exercises the entire protocol stack —
 * BodyManifest (A021) → BodyVersion/AgentBody lineage (A003) →
 * environment requirements (A009/A010) → task compilation (A008) →
 * trajectory → evaluation (A012) → verification (A013) →
 * compatibility (A022) → certification (A023) → registration/release
 * (A024) → SDK consumption (A025). The end-to-end walkthrough lives in
 * examples/software-engineer.
 *
 * This package declares the body as typed, content-addressed protocol
 * DATA. It ships no runtime tool implementations: the professional
 * surface (repo navigation, edit, test, build primitives) is expressed
 * as typed descriptor objects that project onto VersionedArtifactRef
 * entries cited by the BodyManifest.
 */

export * from './shared.js';
export * from './surface.js';
export * from './reference-surface.js';
export * from './manifest.js';
export * from './body.js';
export * from './envelopes.js';

import { SOFTWARE_ENGINEER_BODY_SCHEMAS } from './envelopes.js';
import { SOFTWARE_ENGINEER_BODY_ERROR_CODES } from './shared.js';

/** Protocol surface version of this package's data shapes. */
export const SOFTWARE_ENGINEER_BODY_PROTOCOL_VERSION = '1.0.0' as const;

/** Supported error codes (closed list). */
export const SUPPORTED_SOFTWARE_ENGINEER_BODY_ERROR_CODES: readonly string[] = Object.freeze([
  ...Object.values(SOFTWARE_ENGINEER_BODY_ERROR_CODES),
]);

/** Frozen copy of the in-package schema registry. */
export const SOFTWARE_ENGINEER_BODY_SCHEMA_REGISTRY: Readonly<Record<string, string>> =
  Object.freeze({ ...SOFTWARE_ENGINEER_BODY_SCHEMAS });
