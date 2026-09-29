/**
 * Shared test fixtures for @arena/verification (NOT part of the public
 * surface — hygiene.test.ts asserts it is not exported).
 */

import { createMaterialArtifact } from '@arena/artifact-protocol';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import type { CreateVerifierDescriptorInput } from './descriptor.js';
import type { RequirementSupportInput } from './evidence.js';
import type { CreateVerificationRecordInput } from './record.js';

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

export const T0 = '2026-01-15T09:30:00.000Z';
export const T1 = '2026-01-15T09:30:01.000Z';
export const T2 = '2026-01-15T09:30:02.000Z';
export const T3 = '2026-01-15T09:30:03.000Z';
export const T4 = '2026-01-15T09:30:04.000Z';
export const T5 = '2026-01-15T09:30:05.000Z';
export const T6 = '2026-01-15T09:30:06.000Z';
export const T7 = '2026-01-15T09:30:07.000Z';

export const CORR_A = 'corr-verification-0001';
export const IDEM_A = 'idem-verification-0001';

// ---------------------------------------------------------------------------
// Evidence artifacts (REAL A002 MaterialArtifacts)
// ---------------------------------------------------------------------------

export interface ArtifactOverrides {
  readonly namespace?: string;
  readonly name?: string;
  readonly version?: string;
  readonly content?: unknown;
  readonly refs?: { namespace: string; name: string; version: string; digest: string }[];
}

/** Build a REAL A002 MaterialArtifact (digest computed by A002 itself). */
export async function makeArtifact(
  index: number,
  overrides: ArtifactOverrides = {},
): Promise<MaterialArtifact<unknown>> {
  return createMaterialArtifact({
    identity: {
      namespace: overrides.namespace ?? 'tenant-a',
      name: overrides.name ?? `evidence-artifact-${String(index).padStart(3, '0')}`,
      version: overrides.version ?? '1.0.0',
    },
    refs: overrides.refs ?? [],
    content:
      overrides.content === undefined
        ? { kind: 'fixture', index, payload: `evidence fixture ${String(index)}` }
        : overrides.content,
  });
}

/** Content shape understood by the reference constraint-check verifier. */
export interface ConstraintEvidenceContent {
  readonly constraints: readonly {
    readonly requirementId: string;
    readonly satisfied: boolean;
    readonly detail?: string;
  }[];
}

/** Build constraint-check evidence content for the given requirement outcomes. */
export function constraintContent(
  outcomes: readonly { readonly requirementId: string; readonly satisfied: boolean }[],
): ConstraintEvidenceContent {
  return {
    constraints: outcomes.map((outcome) => ({
      requirementId: outcome.requirementId,
      satisfied: outcome.satisfied,
    })),
  };
}

// ---------------------------------------------------------------------------
// Descriptor fixtures
// ---------------------------------------------------------------------------

export interface RequirementFixture {
  readonly requirementId: string;
  readonly evidenceKind: string;
  readonly claim: string;
  readonly artifact?: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  } | null;
  readonly requiredProducer?: string | null;
}

export interface DescriptorOverrides {
  readonly verifierId?: string;
  readonly version?: string;
  readonly method?: string;
  readonly requirements?: readonly RequirementFixture[];
  readonly policy?: string;
  readonly seed?: string | null;
  readonly parameters?: string | null;
}

/** Two default requirements (test-report + balance-proof kinds). */
export function defaultRequirements(): readonly RequirementFixture[] {
  return [
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
  ];
}

export function makeDescriptorInput(
  overrides: DescriptorOverrides = {},
): CreateVerifierDescriptorInput {
  const requirements = overrides.requirements ?? defaultRequirements();
  const policy = overrides.policy ?? 'deterministic';
  const seed = overrides.seed === undefined ? null : overrides.seed;
  return {
    verifierId: overrides.verifierId ?? 'verifier-000042',
    version: overrides.version ?? '1.0.0',
    method: overrides.method ?? 'constraint_check',
    requiredEvidence: requirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      evidenceKind: requirement.evidenceKind,
      claim: requirement.claim,
      artifact: requirement.artifact === undefined ? null : requirement.artifact,
      requiredProducer: requirement.requiredProducer === undefined ? null : requirement.requiredProducer,
    })),
    outcomeSemantics: {
      pass: 'every declared requirement is satisfied by digest-verified, provenance-valid evidence',
      fail: 'digest-verified, provenance-valid evidence is present but contradicts a declared requirement',
      unknown: 'at least one declared requirement cannot be decided (missing, unverifiable or inconclusive)',
    },
    reproducibility: {
      policy,
      seed,
      parameters: overrides.parameters === undefined ? null : overrides.parameters,
    },
    inputSchema: { namespace: 'verification', name: 'run-verification-command', version: '1.0.0' },
    outputSchema: { namespace: 'verification', name: 'verification-record', version: '1.0.0' },
    provenance: {
      authoredBy: 'arena-reference-fabric',
      submittedAt: T0,
      notes: 'authored by the A013 reference fabric',
    },
  };
}

// ---------------------------------------------------------------------------
// Evidence bundle + support fixtures
// ---------------------------------------------------------------------------

export interface EvidenceFixture {
  readonly evidenceKind: string;
  readonly artifact: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly provenance: {
    readonly producedBy: string;
    readonly producedAt: string;
    readonly notes: string | null;
  };
}

/** An evidence-reference fixture pointing at a built artifact. */
export function evidenceFor(
  artifact: MaterialArtifact<unknown>,
  evidenceKind: string,
  producedBy: string = 'arena-reference-fabric',
): EvidenceFixture {
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

/** A support entry fixture. */
export function support(
  requirementId: string,
  status: string,
  evidenceDigest: string | null = null,
  notes: string | null = null,
): RequirementSupportInput {
  return { requirementId, status, evidenceDigest, notes };
}

export interface RecordOverrides {
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly executedBy?: string;
  readonly notes?: string | null;
}

/** A record-input fixture bound to a descriptor, bundle and support summary. */
export function makeRecordInput(
  verifierDigest: string,
  evidence: readonly EvidenceFixture[],
  evidenceSupport: readonly RequirementSupportInput[],
  overrides: RecordOverrides = {},
): CreateVerificationRecordInput {
  return {
    verifierRef: verifierDigest,
    evidence: evidence.map((entry) => ({
      evidenceKind: entry.evidenceKind,
      artifact: { ...entry.artifact },
      provenance: { ...entry.provenance },
    })),
    evidenceSupport,
    correlationId: overrides.correlationId ?? CORR_A,
    idempotencyKey: overrides.idempotencyKey ?? IDEM_A,
    startedAt: overrides.startedAt ?? T1,
    finishedAt: overrides.finishedAt ?? T2,
    provenance: {
      executedBy: overrides.executedBy ?? 'verifier-instance-01',
      recordedAt: overrides.finishedAt ?? T2,
      notes: overrides.notes === undefined ? null : overrides.notes,
    },
  };
}

/**
 * Deterministic 32-bit LCG for property tests (Numerical Recipes
 * constants — mirrors @arena/trajectory's TestLcg; kept in test-support
 * because the determinism primitive is A010's owned surface, not this
 * package's).
 */
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
