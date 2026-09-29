/**
 * Shared test fixtures for @arena/body-forge (NOT part of the public
 * surface — hygiene.test.ts asserts it is not exported).
 *
 * Deterministic manifest/policy/recipe fixtures used across the unit,
 * negative, property and hygiene suites. Digests are fixed constants
 * (content-addressing is tested against recomputation, not against
 * hardcoded hash values).
 */

import type { CreateBodyManifestInput } from './manifest.js';
import { expect } from 'vitest';

export const DIGEST_A =
  '1111111111111111111111111111111111111111111111111111111111111111';
export const DIGEST_B =
  '2222222222222222222222222222222222222222222222222222222222222222';
export const DIGEST_C =
  '3333333333333333333333333333333333333333333333333333333333333333';
export const DIGEST_D =
  '4444444444444444444444444444444444444444444444444444444444444444';
export const DIGEST_E =
  '5555555555555555555555555555555555555555555555555555555555555555';
export const DIGEST_F =
  '6666666666666666666666666666666666666666666666666666666666666666';
export const DIGEST_G =
  '7777777777777777777777777777777777777777777777777777777777777777';
export const DIGEST_H =
  '8888888888888888888888888888888888888888888888888888888888888888';

export const T0 = '2026-05-01T10:00:00.000Z';
export const T1 = '2026-05-01T10:00:01.000Z';
export const T2 = '2026-05-01T10:00:02.000Z';
export const T3 = '2026-05-01T10:00:03.000Z';

export const CORR_ID = 'corr-body-forge-0001';
export const FORGE_KEY = 'forge-key-0001';

/** Manifest fixture overrides (shallow-merged over the defaults). */
export interface ManifestOverrides
  extends Partial<Omit<CreateBodyManifestInput, 'body' | 'provenance' | 'lineage' | 'escalation'>> {
  readonly body?: Partial<CreateBodyManifestInput['body']>;
  readonly provenance?: Partial<CreateBodyManifestInput['provenance']>;
  readonly lineage?: Partial<CreateBodyManifestInput['lineage']>;
  readonly escalation?: Partial<CreateBodyManifestInput['escalation']>;
  /** Shortcut: replaces provenance.citations. */
  readonly citations?: CreateBodyManifestInput['provenance']['citations'];
  /** Shortcut: replaces lineage.parents. */
  readonly parents?: CreateBodyManifestInput['lineage']['parents'];
  /** Shortcut: sets lineage.supersedes. */
  readonly supersedes?: CreateBodyManifestInput['lineage']['supersedes'];
}

/** The default manifest input (deterministic). */
export function baseManifestInput(): CreateBodyManifestInput {
  return {
    manifestId: 'manifest-reconciliation-v1',
    version: '1.0.0',
    body: { tenant: 'tenant-a', name: 'ledger-reconciler' },
    targetVersion: '1.0.0',
    mission: 'Reconcile financial ledgers accurately and auditably.',
    role: 'senior-reconciliation-specialist',
    domainScope: ['finance', 'reconciliation'],
    capabilities: [
      { kind: 'capability', id: 'capability-reconciliation', version: '1.2.0', digest: DIGEST_F },
    ],
    skills: [
      { namespace: 'arena-skills', name: 'ledger-reconciliation-checklist', version: '1.0.0', digest: DIGEST_A },
    ],
    knowledge: [{ namespace: 'arena-knowledge', name: 'gaap-basics', version: '2.0.0', digest: DIGEST_B }],
    tools: [{ namespace: 'arena-tools', name: 'ledger-query-api', version: '1.1.0', digest: DIGEST_C }],
    procedures: [
      { namespace: 'arena-procedures', name: 'month-end-close-flow', version: '1.0.0', digest: DIGEST_D },
    ],
    memoryPolicy: { policyId: 'memory-append-only', statements: ['append-only recall, no rewrites'] },
    planningPolicy: { policyId: 'planning-checklist-first', statements: ['follow the checklist order'] },
    safetyPolicy: {
      policyId: 'safety-four-eyes',
      statements: ['require human sign-off before posting adjustments'],
    },
    escalation: {
      rules: [
        {
          condition: 'discrepancy-above-threshold',
          target: { type: 'user', tenant: 'tenant-a', principalId: 'controller-01' },
        },
      ],
    },
    authorityBoundaries: ['may propose adjustments; may not post them without sign-off'],
    evaluationSuites: [
      { namespace: 'arena-evaluation', name: 'reconciliation-accuracy-suite', version: '1.0.0', digest: DIGEST_E },
    ],
    verificationSuites: [
      { namespace: 'arena-verification', name: 'evidence-provenance-suite', version: '1.0.0', digest: DIGEST_F },
    ],
    environmentRequirements: [
      { namespace: 'arena-environments', name: 'erp-close-sandbox', version: '1.1.0', digest: DIGEST_B },
    ],
    substrateCompatibility: {
      requiredModalities: ['text-input', 'text-output'],
      requiredToolCalling: 'json-schema',
      contextRequirements: { minContextUnits: 32768 },
    },
    rights: {
      license: 'Proprietary',
      commercialUse: 'requires-license',
      redistribution: 'tenant-only',
      customerData: 'derived',
      professionalLimitations: ['not a licensed accounting system'],
    },
    provenance: {
      author: { type: 'user', tenant: 'tenant-a', principalId: 'author-01' },
      authoredAt: T0,
      citations: [],
    },
    lineage: { parents: [] },
  };
}

/** Build a valid manifest input with overrides shallow-merged over the defaults. */
export function makeManifestInput(overrides: ManifestOverrides = {}): CreateBodyManifestInput {
  const base = baseManifestInput();
  const {
    body,
    provenance,
    lineage,
    escalation,
    citations,
    parents,
    supersedes,
    ...rest
  } = overrides;
  const mergedProvenance = { ...base.provenance, ...(provenance ?? {}) };
  if (citations !== undefined) {
    (mergedProvenance as { citations: unknown }).citations = citations;
  }
  const mergedLineage = { ...base.lineage, ...(lineage ?? {}) };
  if (parents !== undefined) {
    (mergedLineage as { parents: unknown }).parents = parents;
  }
  if (supersedes !== undefined) {
    (mergedLineage as { supersedes: unknown }).supersedes = supersedes;
  }
  const merged = {
    ...base,
    ...rest,
    body: { ...base.body, ...(body ?? {}) },
    provenance: mergedProvenance,
    lineage: mergedLineage,
    escalation: { ...base.escalation, ...(escalation ?? {}) },
  };
  return merged as CreateBodyManifestInput;
}

/** A supersession parent ref pointing at the fixture body's 1.0.0. */
export function parentRefV1(): {
  readonly tenant: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
} {
  return { tenant: 'tenant-a', name: 'ledger-reconciler', version: '1.0.0', digest: DIGEST_G };
}

/** The default forge recipe fixture (deterministic; no clock reads). */
export function makeRecipe() {
  return {
    forgePrincipal: { type: 'service', tenant: 'tenant-a', principalId: 'arena-body-forge-fabric' },
    forgedAt: T1,
    correlationId: CORR_ID,
  } as const;
}

/** Assert a synchronous function throws an error carrying exactly `code`. */
export function expectSyncCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect((error as { readonly code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`expected the function to throw ${code}, but it resolved`);
}

/** Deterministic 32-bit LCG (mirrors the sibling test-supports). */
export class TestLcg {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x2f6e2b1;
  }

  nextUint32(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state;
  }

  next(): number {
    return this.nextUint32() / 2 ** 32;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  bool(): boolean {
    return this.nextUint32() % 2 === 0;
  }

  /** A pseudo-random 64-hex digest (structurally valid, not hash-derived). */
  digest(): string {
    let hex = '';
    for (let i = 0; i < 8; i += 1) {
      hex += (this.nextUint32() >>> 0).toString(16).padStart(8, '0');
    }
    return hex;
  }
}
