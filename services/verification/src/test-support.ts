/**
 * Shared test fixtures for @arena/verification-fabric (internal —
 * re-exports the package test-support helpers plus fabric-level
 * builders).
 */

import { createMaterialArtifact } from '@arena/artifact-protocol';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import { createVerifierDescriptor } from '@arena/verification';
import type { CreateVerifierDescriptorInput } from '@arena/verification';
import type { VerifyOptions } from './fabric.js';

export const T0 = '2026-02-01T10:00:00.000Z';
export const T1 = '2026-02-01T10:00:01.000Z';
export const T2 = '2026-02-01T10:00:02.000Z';
export const T3 = '2026-02-01T10:00:03.000Z';

export const CORR = 'corr-fabric-0001';
export const IDEM = 'idem-fabric-0001';

/** Constraint-check evidence content (satisfied per requirement). */
export interface ConstraintOutcome {
  readonly requirementId: string;
  readonly satisfied: boolean;
  readonly detail?: string;
}

/** Build a REAL constraint-report artifact. */
export async function makeConstraintReport(
  index: number,
  outcomes: readonly ConstraintOutcome[],
): Promise<MaterialArtifact<unknown>> {
  return createMaterialArtifact({
    identity: { namespace: 'tenant-a', name: `constraint-report-${String(index).padStart(3, '0')}`, version: '1.0.0' },
    content: {
      constraints: outcomes.map((outcome) => ({
        requirementId: outcome.requirementId,
        satisfied: outcome.satisfied,
        ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
      })),
    },
  });
}

/** Build a REAL balance-proof artifact (with lineage to a source export). */
export async function makeBalanceProof(
  index: number,
  source?: MaterialArtifact<unknown>,
  content: unknown = { netted: 1180.4, expected: 1180.4 },
): Promise<MaterialArtifact<unknown>> {
  return createMaterialArtifact({
    identity: { namespace: 'tenant-a', name: `balance-proof-${String(index).padStart(3, '0')}`, version: '1.0.0' },
    refs:
      source === undefined
        ? []
        : [
            {
              namespace: source.identity.namespace,
              name: source.identity.name,
              version: source.identity.version,
              digest: source.digest,
            },
          ],
    content,
  });
}

/** A two-requirement descriptor input (constraint_check method). */
export function makeConstraintDescriptorInput(
  overrides: Partial<Pick<CreateVerifierDescriptorInput, 'verifierId' | 'method'>> = {},
): CreateVerifierDescriptorInput {
  return {
    verifierId: overrides.verifierId ?? 'verifier-constraint-0001',
    version: '1.0.0',
    method: overrides.method ?? 'constraint_check',
    requiredEvidence: [
      {
        requirementId: 'requirement-001',
        evidenceKind: 'test-report',
        claim: 'the reconciliation test suite passes against the pinned environment',
        artifact: null,
        requiredProducer: null,
      },
      {
        requirementId: 'requirement-002',
        evidenceKind: 'balance-proof',
        claim: 'the netted total matches the ERP expected balance',
        artifact: null,
        requiredProducer: 'erp-close-sandbox',
      },
    ],
    outcomeSemantics: {
      pass: 'every declared requirement is satisfied by digest-verified, provenance-valid evidence',
      fail: 'digest-verified, provenance-valid evidence is present but contradicts a declared requirement',
      unknown: 'at least one declared requirement cannot be decided (missing, unverifiable or inconclusive)',
    },
    reproducibility: { policy: 'deterministic', seed: null, parameters: null },
    inputSchema: { namespace: 'verification', name: 'run-verification-command', version: '1.0.0' },
    outputSchema: { namespace: 'verification', name: 'verification-record', version: '1.0.0' },
    provenance: { authoredBy: 'arena-reference-fabric', submittedAt: T0, notes: 'A013 fabric fixture' },
  };
}

/** An evidence-reference input pointing at an artifact. */
export function evidenceInput(
  artifact: MaterialArtifact<unknown>,
  evidenceKind: string,
  producedBy: string = 'arena-reference-fabric',
): {
  readonly evidenceKind: string;
  readonly artifact: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly provenance: { readonly producedBy: string; readonly producedAt: string; readonly notes: string | null };
} {
  return {
    evidenceKind,
    artifact: {
      namespace: artifact.identity.namespace,
      name: artifact.identity.name,
      version: artifact.identity.version,
      digest: artifact.digest,
    },
    provenance: { producedBy, producedAt: T1, notes: null },
  };
}

/** Default run options (fixed timestamps for determinism). */
export function runOptions(overrides: Partial<VerifyOptions> = {}): VerifyOptions {
  return {
    correlationId: overrides.correlationId ?? CORR,
    idempotencyKey: overrides.idempotencyKey ?? IDEM,
    startedAt: overrides.startedAt ?? T1,
    finishedAt: overrides.finishedAt ?? T2,
    provenanceNotes: overrides.provenanceNotes ?? null,
  };
}

/** Deterministic 32-bit LCG (Numerical Recipes constants, mirrors the package test-support). */
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
}

export { createVerifierDescriptor };
