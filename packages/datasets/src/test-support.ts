/**
 * Shared test fixtures for @arena/datasets (NOT part of the public
 * surface — hygiene.test.ts asserts it is not exported).
 */

import { createMaterialArtifact } from '@arena/artifact-protocol';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import type { CreateDatasetManifestInput } from './manifest.js';

export const T0 = '2026-02-01T08:00:00.000Z';
export const T1 = '2026-02-01T08:00:01.000Z';
export const T2 = '2026-02-01T08:00:02.000Z';
export const T3 = '2026-02-01T08:00:03.000Z';

export const TENANT_A = 'tenant-a';
export const TENANT_B = 'tenant-b';

export const RIGHTS = {
  license: 'CC-BY-4.0',
  commercialUse: 'allowed',
  redistribution: 'allowed',
  customerData: 'none',
};

export const CREATOR_A = { type: 'user', tenant: TENANT_A, principalId: 'user-42' };
export const CREATOR_B = { type: 'service', tenant: TENANT_B, principalId: 'svc-7' };

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
      name: overrides.name ?? `dataset-artifact-${String(index).padStart(3, '0')}`,
      version: overrides.version ?? '1.0.0',
    },
    refs: overrides.refs ?? [],
    content:
      overrides.content === undefined
        ? { kind: 'fixture', index, payload: `dataset fixture ${String(index)}` }
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

/** A manifest input with sensible defaults for the given entry refs. */
export function makeManifestInput(
  entries: readonly { role: string; artifact: { namespace: string; name: string; version: string; digest: string } }[],
  overrides: {
    namespace?: string;
    name?: string;
    version?: string;
    parents?: CreateDatasetManifestInput['provenance']['parents'];
    rights?: unknown;
    createdAt?: string;
    verification?: CreateDatasetManifestInput['provenance']['verification'];
  } = {},
): CreateDatasetManifestInput {
  return {
    identity: {
      namespace: overrides.namespace ?? TENANT_A,
      name: overrides.name ?? 'quarterly-reports',
      version: overrides.version ?? '1.0.0',
    },
    entries: [...entries],
    provenance: {
      creator: CREATOR_A,
      createdAt: overrides.createdAt ?? T0,
      parents: overrides.parents ?? [],
      rights: overrides.rights ?? RIGHTS,
      ...(overrides.verification !== undefined
        ? { verification: overrides.verification }
        : {}),
    },
  };
}
