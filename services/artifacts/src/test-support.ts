/**
 * Shared test fixtures for @arena/artifact-service (NOT part of the public
 * surface — hygiene.test.ts asserts it is not exported).
 */

import { createMaterialArtifact } from '@arena/artifact-protocol';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import type { CreateProvenanceRecordInput } from '@arena/provenance';

export const T0 = '2026-03-01T12:00:00.000Z';
export const T1 = '2026-03-01T12:00:01.000Z';
export const T2 = '2026-03-01T12:00:02.000Z';
export const T3 = '2026-03-01T12:00:03.000Z';

export const TENANT_A = 'tenant-a';
export const TENANT_B = 'tenant-b';

export const CALLER_A = { type: 'user', tenant: TENANT_A, principalId: 'user-42' };
export const CALLER_B = { type: 'user', tenant: TENANT_B, principalId: 'user-7' };
export const CALLER_SERVICE = { type: 'service', tenant: TENANT_A, principalId: 'svc-1' };

export const RIGHTS = {
  license: 'CC-BY-4.0',
  commercialUse: 'allowed',
  redistribution: 'allowed',
  customerData: 'none',
};

/** Deterministic seeded LCG (the house property-test pattern — fully seeded). */
export class TestLcg {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 0x2f6e2b1;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state;
  }
  nextInt(maxExclusive: number): number {
    return Math.floor((this.next() / 0x100000000) * maxExclusive);
  }
  pick<T>(items: readonly T[]): T {
    const item = items[this.nextInt(items.length)];
    if (item === undefined) throw new Error('TestLcg.pick on empty list');
    return item;
  }
}

/** Build a REAL A002 MaterialArtifact (digest computed by A002 itself). */
export async function makeArtifact(
  index: number,
  overrides: {
    namespace?: string;
    name?: string;
    version?: string;
    content?: unknown;
    refs?: { namespace: string; name: string; version: string; digest: string }[];
  } = {},
): Promise<MaterialArtifact<unknown>> {
  return createMaterialArtifact({
    identity: {
      namespace: overrides.namespace ?? TENANT_A,
      name: overrides.name ?? `service-artifact-${String(index).padStart(3, '0')}`,
      version: overrides.version ?? '1.0.0',
    },
    refs: overrides.refs ?? [],
    content:
      overrides.content === undefined
        ? { kind: 'fixture', index, payload: `service fixture ${String(index)}` }
        : overrides.content,
  });
}

/** Ref view of an artifact (identity + digest). */
export function refOf(artifact: MaterialArtifact<unknown>): {
  namespace: string;
  name: string;
  version: string;
  digest: string;
} {
  return {
    namespace: artifact.identity.namespace,
    name: artifact.identity.name,
    version: artifact.identity.version,
    digest: artifact.digest,
  };
}

/**
 * A provenance record input for `artifact` with the given parent refs
 * (parents must already be stored for the service's closed-world
 * validation). The transformation is a synthetic-but-valid transform ref
 * with inputs = the parents (the A002 provenance invariant).
 */
export function makeRecordInput(
  artifact: MaterialArtifact<unknown>,
  parents: readonly MaterialArtifact<unknown>[],
  overrides: {
    createdAt?: string;
    verification?: CreateProvenanceRecordInput['verification'];
    relation?: string;
  } = {},
): CreateProvenanceRecordInput {
  const relation = overrides.relation ?? 'derived-from';
  const parentRefs = parents.map((parent) => refOf(parent));
  return {
    artifact: refOf(artifact),
    creator: { type: 'service', tenant: artifact.identity.namespace, principalId: 'svc-1' },
    createdAt: overrides.createdAt ?? T0,
    parents: parentRefs.map((parent) => ({ parent, relation })),
    transformation: {
      transform: {
        namespace: artifact.identity.namespace,
        name: 'reference-transform',
        version: '1.0.0',
        digest: 'a'.repeat(64),
      },
      inputs: parentRefs,
    },
    rights: RIGHTS,
    ...(overrides.verification !== undefined
      ? { verification: overrides.verification }
      : {}),
  };
}
