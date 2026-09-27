/**
 * Internal test-support fixtures for @arena/capability-graph (Work Order A004).
 *
 * NOT part of the public surface: this module is NOT re-exported from
 * index.ts. It exists so the test battery (unit, property, parity) shares
 * one set of deterministic fixtures. Scanned by the hygiene suite like every
 * other non-test source (no `any`, no provider vocabulary).
 */

import { createCapabilityNode } from './nodes.js';
import type { CapabilityNode } from './nodes.js';
import type { SkillNodePayload, TitledNodePayload, ObservedFailureNodePayload } from './payload.js';
import type { ArtifactRefView, ProvenanceRefView } from './shared.js';

/** A fixed, obviously-fake sha256 hex (content: nothing — it is a fixture). */
export const FIXTURE_PROVENANCE_DIGEST =
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

/** A second, distinct fixture digest. */
export const FIXTURE_PROVENANCE_DIGEST_2 =
  'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1';

export const FIXTURE_PROVENANCE: ProvenanceRefView = {
  recordDigest: FIXTURE_PROVENANCE_DIGEST,
};

export const FIXTURE_PROVENANCE_2: ProvenanceRefView = {
  recordDigest: FIXTURE_PROVENANCE_DIGEST_2,
};

export const FIXTURE_ARTIFACT_REF: ArtifactRefView = {
  namespace: 'tenant-a',
  name: 'evidence-pack',
  version: '1.0.0',
  digest: 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2',
};

export const FIXTURE_TIMESTAMP = '2026-09-26T12:00:00.000Z';

export function titledPayload(overrides?: Partial<TitledNodePayload>): TitledNodePayload {
  return {
    title: 'Fixture capability',
    ...(overrides?.description !== undefined ? { description: overrides.description } : {}),
    ...(overrides?.category !== undefined ? { category: overrides.category } : {}),
  };
}

export function skillPayload(
  overrides?: Partial<SkillNodePayload>,
): SkillNodePayload {
  return {
    title: 'Fixture skill',
    summary: 'A fixture skill for tests.',
    inputs: [{ name: 'request' }],
    outputs: [{ name: 'response' }],
    prerequisites: ['fixture-prerequisite'],
    evidence: [FIXTURE_ARTIFACT_REF],
    tests: [FIXTURE_ARTIFACT_REF],
    professionalLimitations: [],
    customerData: 'none',
    ...(overrides !== undefined ? { ...overrides } : {}),
  };
}

export function observedFailurePayload(
  overrides?: Partial<ObservedFailureNodePayload>,
): ObservedFailureNodePayload {
  return {
    title: 'Fixture failure',
    summary: 'A fixture observed failure.',
    observedAt: FIXTURE_TIMESTAMP,
    severity: 'moderate',
    ...(overrides !== undefined ? { ...overrides } : {}),
  };
}

export async function makeNode(
  kind: string,
  id: string,
  version = '1.0.0',
  extra?: {
    payload?: unknown;
    provenance?: { recordDigest: string };
    supersedes?: string;
  },
): Promise<CapabilityNode> {
  const payload = extra?.payload ?? defaultPayloadFor(kind);
  return createCapabilityNode({
    kind,
    id,
    version,
    payload,
    ...(extra?.provenance !== undefined ? { provenance: extra.provenance } : {}),
    ...(extra?.supersedes !== undefined ? { supersedes: extra.supersedes } : {}),
  });
}

function defaultPayloadFor(kind: string): unknown {
  switch (kind) {
    case 'skill':
      return skillPayload();
    case 'observed-failure':
      return observedFailurePayload();
    default:
      return titledPayload();
  }
}

/**
 * A deterministic small taxonomy used by several suites:
 *
 *   domain/software-engineering
 *     -decomposes-into-> capability/code-review
 *     -decomposes-into-> capability/refactoring
 *   capability/code-review -decomposes-into-> sub-capability/review-planning
 *   sub-capability/review-planning -decomposes-into-> skill/read-diff
 *   skill/read-diff -requires-> skill/read-source
 *   skill/read-diff -produces-> skill/write-review-notes
 */
export interface FixtureTaxonomy {
  readonly domain: CapabilityNode;
  readonly capabilityReview: CapabilityNode;
  readonly capabilityRefactoring: CapabilityNode;
  readonly subCapabilityPlanning: CapabilityNode;
  readonly skillReadDiff: CapabilityNode;
  readonly skillReadSource: CapabilityNode;
  readonly skillWriteNotes: CapabilityNode;
}

export async function makeFixtureTaxonomy(): Promise<FixtureTaxonomy> {
  const domain = await makeNode('domain', 'software-engineering', '1.0.0');
  const capabilityReview = await makeNode('capability', 'code-review', '1.0.0');
  const capabilityRefactoring = await makeNode('capability', 'refactoring', '1.0.0');
  const subCapabilityPlanning = await makeNode('sub-capability', 'review-planning', '1.0.0');
  const skillReadDiff = await makeNode('skill', 'read-diff', '1.0.0', {
    provenance: { recordDigest: FIXTURE_PROVENANCE_DIGEST },
  });
  const skillReadSource = await makeNode('skill', 'read-source', '1.0.0', {
    provenance: { recordDigest: FIXTURE_PROVENANCE_DIGEST },
  });
  const skillWriteNotes = await makeNode('skill', 'write-review-notes', '1.0.0', {
    provenance: { recordDigest: FIXTURE_PROVENANCE_DIGEST },
  });
  return {
    domain,
    capabilityReview,
    capabilityRefactoring,
    subCapabilityPlanning,
    skillReadDiff,
    skillReadSource,
    skillWriteNotes,
  };
}
