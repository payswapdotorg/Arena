/**
 * Typed protocol objects for the Software Engineer Agent Body surface.
 *
 * The body's professional surface is declared as content-addressed
 * descriptors — NOT runtime implementations:
 *
 *   - ToolDescriptor        — repo navigation / edit / test / build
 *                             primitives the body is licensed to use;
 *   - PracticeDescriptor    — skills, knowledge and procedures;
 *   - CapabilityDeclaration — capability-graph prerequisites the body
 *                             requires (projects onto A004
 *                             CapabilityNodeRef-shaped refs).
 *
 * Every descriptor is digested (sha256 over canonical JSON of its
 * digest-free view) and projects onto a VersionedArtifactRef, so the
 * BodyManifest cites real, tamper-evident surface artifacts.
 */

import type { ContentDigest, VersionedArtifactRef } from '@arena/agent-body';
import {
  SOFTWARE_ENGINEER_BODY_ERROR_CODES,
  SOFTWARE_ENGINEER_SURFACE_NAMESPACE,
  SoftwareEngineerBodyError,
  assertDescription,
  assertNeutralId,
  assertSemver,
  deepFreeze,
  surfaceDigest,
} from './shared.js';

export const SURFACE_ARTIFACT_RECORD_VERSION = 1 as const;

/** Kinds of professional practice artifacts a body may cite. */
export const PRACTICE_KINDS = Object.freeze(['skill', 'knowledge', 'procedure'] as const);
export type PracticeKind = (typeof PRACTICE_KINDS)[number];

/** Closed vocabulary of software-engineering tool primitives. */
export const TOOL_KINDS = Object.freeze([
  'repo-navigation',
  'file-edit',
  'test-execution',
  'build-execution',
  'code-search',
  'vcs-operation',
] as const);
export type ToolKind = (typeof TOOL_KINDS)[number];

const TOOL_KIND_SET: ReadonlySet<string> = new Set(TOOL_KINDS);
const PRACTICE_KIND_SET: ReadonlySet<string> = new Set(PRACTICE_KINDS);

/** A typed tool-surface protocol object (no runtime implementation). */
export interface ToolDescriptorView {
  readonly recordVersion: typeof SURFACE_ARTIFACT_RECORD_VERSION;
  readonly toolId: string;
  readonly toolKind: ToolKind;
  readonly name: string;
  readonly description: string;
}

export interface ToolDescriptor extends ToolDescriptorView {
  readonly digest: ContentDigest;
  readonly ref: VersionedArtifactRef;
}

/** A typed skill/knowledge/procedure protocol object. */
export interface PracticeDescriptorView {
  readonly recordVersion: typeof SURFACE_ARTIFACT_RECORD_VERSION;
  readonly artifactId: string;
  readonly kind: PracticeKind;
  readonly name: string;
  readonly description: string;
}

export interface PracticeDescriptor extends PracticeDescriptorView {
  readonly digest: ContentDigest;
  readonly ref: VersionedArtifactRef;
}

/** A typed capability prerequisite declaration (A004-shaped ref). */
export interface CapabilityDeclarationView {
  readonly recordVersion: typeof SURFACE_ARTIFACT_RECORD_VERSION;
  readonly kind: 'capability' | 'sub-capability';
  readonly id: string;
  readonly version: string;
  readonly description: string;
}

export interface CapabilityDeclaration extends CapabilityDeclarationView {
  readonly digest: ContentDigest;
}

function toRef(name: string, version: string, digest: string): VersionedArtifactRef {
  return Object.freeze({
    namespace: SOFTWARE_ENGINEER_SURFACE_NAMESPACE,
    name,
    version,
    digest,
  }) as VersionedArtifactRef;
}

/** Validate + digest a tool-surface descriptor. */
export async function createToolDescriptor(input: {
  readonly toolId: string;
  readonly toolKind: ToolKind;
  readonly name: string;
  readonly version?: string;
  readonly description: string;
}): Promise<ToolDescriptor> {
  assertNeutralId(input.toolId, 'toolId');
  assertNeutralId(input.name, 'name');
  assertDescription(input.description, 'description');
  const version = input.version ?? '1.0.0';
  assertSemver(version, 'version');
  if (!TOOL_KIND_SET.has(input.toolKind)) {
    throw new SoftwareEngineerBodyError(
      SOFTWARE_ENGINEER_BODY_ERROR_CODES.INVALID_SURFACE_ARTIFACT,
      `toolKind must be one of ${TOOL_KINDS.join(' | ')} (got: ${String(input.toolKind)})`,
      { toolKind: input.toolKind },
    );
  }
  const view: ToolDescriptorView = Object.freeze({
    recordVersion: SURFACE_ARTIFACT_RECORD_VERSION,
    toolId: input.toolId,
    toolKind: input.toolKind,
    name: input.name,
    description: input.description,
  });
  const digest = await surfaceDigest(view);
  return deepFreeze({
    ...view,
    digest,
    ref: toRef(input.name, version, digest),
  }) as ToolDescriptor;
}

/** Validate + digest a practice (skill/knowledge/procedure) descriptor. */
export async function createPracticeDescriptor(input: {
  readonly artifactId: string;
  readonly kind: PracticeKind;
  readonly name: string;
  readonly version?: string;
  readonly description: string;
}): Promise<PracticeDescriptor> {
  assertNeutralId(input.artifactId, 'artifactId');
  assertNeutralId(input.name, 'name');
  assertDescription(input.description, 'description');
  const version = input.version ?? '1.0.0';
  assertSemver(version, 'version');
  if (!PRACTICE_KIND_SET.has(input.kind)) {
    throw new SoftwareEngineerBodyError(
      SOFTWARE_ENGINEER_BODY_ERROR_CODES.INVALID_SURFACE_ARTIFACT,
      `kind must be one of ${PRACTICE_KINDS.join(' | ')} (got: ${String(input.kind)})`,
      { kind: input.kind },
    );
  }
  const view: PracticeDescriptorView = Object.freeze({
    recordVersion: SURFACE_ARTIFACT_RECORD_VERSION,
    artifactId: input.artifactId,
    kind: input.kind,
    name: input.name,
    description: input.description,
  });
  const digest = await surfaceDigest(view);
  return deepFreeze({
    ...view,
    digest,
    ref: toRef(input.name, version, digest),
  }) as PracticeDescriptor;
}

/** Validate + digest a capability prerequisite declaration. */
export async function createCapabilityDeclaration(input: {
  readonly kind: 'capability' | 'sub-capability';
  readonly id: string;
  readonly version: string;
  readonly description: string;
}): Promise<CapabilityDeclaration> {
  assertNeutralId(input.id, 'id');
  assertSemver(input.version, 'version');
  assertDescription(input.description, 'description');
  if (input.kind !== 'capability' && input.kind !== 'sub-capability') {
    throw new SoftwareEngineerBodyError(
      SOFTWARE_ENGINEER_BODY_ERROR_CODES.INVALID_CAPABILITY_DECLARATION,
      `capability kind must be 'capability' | 'sub-capability' (got: ${String(input.kind)})`,
      { kind: input.kind },
    );
  }
  const view: CapabilityDeclarationView = Object.freeze({
    recordVersion: SURFACE_ARTIFACT_RECORD_VERSION,
    kind: input.kind,
    id: input.id,
    version: input.version,
    description: input.description,
  });
  const digest = await surfaceDigest(view);
  return deepFreeze({ ...view, digest }) as CapabilityDeclaration;
}

/** Project a capability declaration onto the A004 CapabilityNodeRef shape. */
export function capabilityNodeRef(declaration: CapabilityDeclaration): {
  readonly kind: 'capability' | 'sub-capability';
  readonly id: string;
  readonly version: string;
  readonly digest: string;
} {
  return Object.freeze({
    kind: declaration.kind,
    id: declaration.id,
    version: declaration.version,
    digest: declaration.digest,
  });
}

export function isToolDescriptor(value: unknown): value is ToolDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ToolDescriptor).recordVersion === SURFACE_ARTIFACT_RECORD_VERSION &&
    TOOL_KIND_SET.has(String((value as ToolDescriptor).toolKind))
  );
}

export function isPracticeDescriptor(value: unknown): value is PracticeDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PracticeDescriptor).recordVersion === SURFACE_ARTIFACT_RECORD_VERSION &&
    PRACTICE_KIND_SET.has(String((value as PracticeDescriptor).kind))
  );
}
