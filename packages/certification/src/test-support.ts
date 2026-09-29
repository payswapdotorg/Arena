/**
 * Shared test fixtures for @arena/certification (internal — only used by
 * the package's own test suite; never exported from index.ts).
 */

import { sha256Hex } from '@arena/protocol-core';
import { createCertificationSuite } from './suite.js';
import type { CreateCertificationSuiteInput } from './suite.js';
import type { CreateCertificationRecordInput } from './record.js';
import type { ComponentVerdictSummary } from './verdict.js';

export const T0 = '2026-02-01T10:00:00.000Z';
export const T1 = '2026-02-01T10:00:01.000Z';
export const T2 = '2026-02-01T10:00:02.000Z';
export const T3 = '2026-02-01T10:00:03.000Z';

export const CORR = 'corr-cert-0001';
export const IDEM = 'idem-cert-0001';

/** A deterministic 64-char sha256 hex string for test fixtures. */
export async function makeDigest(seed: string): Promise<string> {
  return sha256Hex(seed);
}

/** Build a deterministic 64-char sha256 hex string from a numeric index. */
export async function digestOf(index: number): Promise<string> {
  return sha256Hex(`arena-certification-test-${String(index)}`);
}

/** Default verdict semantics text used by every test suite. */
export function defaultVerdictSemantics(): {
  readonly pass: string;
  readonly 'conditional-pass': string;
  readonly fail: string;
  readonly unknown: string;
} {
  return {
    pass: 'every suite component produced a pass verdict and no constraint was declared',
    'conditional-pass':
      'every suite component produced a pass verdict AND at least one component declared a constraint the consumer must honor',
    fail: 'at least one suite component produced a fail verdict (the composition did not satisfy the suite)',
    unknown:
      'at least one suite component produced an unknown verdict OR the suite is misconfigured (zero components of every kind)',
  };
}

/** A two-component suite input (one evaluation ref + one verification ref). */
export async function makeSuiteInput(
  overrides: Partial<Pick<CreateCertificationSuiteInput, 'suiteId' | 'version' | 'title' | 'scopeStatement'>> = {},
): Promise<CreateCertificationSuiteInput> {
  const evaluationRef = await digestOf(1);
  const verificationRef = await digestOf(2);
  return {
    suiteId: overrides.suiteId ?? 'suite-reference-0001',
    version: overrides.version ?? '1.0.0',
    title: overrides.title ?? 'Reference Certification Suite (test fixture)',
    scopeStatement:
      overrides.scopeStatement ??
      'Agent Body B, version V, possessed by Cognitive Substrate M, under Environment E and Runtime Profile R, satisfied Certification Suite S at revision X.',
    components: [
      { kind: 'evaluation', refs: [evaluationRef] },
      { kind: 'verification', refs: [verificationRef] },
    ],
    verdictSemantics: defaultVerdictSemantics(),
    inputSchema: {
      namespace: 'certification',
      name: 'run-certification-command',
      version: '1.0.0',
    },
    outputSchema: {
      namespace: 'certification',
      name: 'certification-record',
      version: '1.0.0',
    },
    provenance: {
      authoredBy: 'arena-reference-fabric',
      submittedAt: T0,
      notes: 'A023 test fixture suite',
    },
  };
}

/** A three-component suite input (evaluation + verification + compatibility). */
export async function makeThreeComponentSuiteInput(
  overrides: Partial<Pick<CreateCertificationSuiteInput, 'suiteId'>> = {},
): Promise<CreateCertificationSuiteInput> {
  const evaluationRef = await digestOf(10);
  const verificationRef = await digestOf(11);
  const compatibilityRef = await digestOf(12);
  return {
    suiteId: overrides.suiteId ?? 'suite-three-component-0001',
    version: '1.0.0',
    title: 'Three-Component Reference Suite (test fixture)',
    scopeStatement:
      'Agent Body B, version V, possessed by Cognitive Substrate M, under Environment E and Runtime Profile R, satisfied Certification Suite S at revision X.',
    components: [
      { kind: 'evaluation', refs: [evaluationRef] },
      { kind: 'verification', refs: [verificationRef] },
      { kind: 'compatibility', refs: [compatibilityRef] },
    ],
    verdictSemantics: defaultVerdictSemantics(),
    inputSchema: {
      namespace: 'certification',
      name: 'run-certification-command',
      version: '1.0.0',
    },
    outputSchema: {
      namespace: 'certification',
      name: 'certification-record',
      version: '1.0.0',
    },
    provenance: {
      authoredBy: 'arena-reference-fabric',
      submittedAt: T0,
      notes: 'A023 three-component test fixture suite',
    },
  };
}

/** Build a ComponentVerdictSummary matching a given suite descriptor (every ref passes). */
export async function allPassSummary(
  suite: Awaited<ReturnType<typeof createCertificationSuite>>,
): Promise<ComponentVerdictSummary> {
  const out: Array<{
    readonly refKind: 'evaluation' | 'verification' | 'compatibility';
    readonly refDigest: string;
    readonly verdict: 'pass';
    readonly constraints: readonly string[];
    readonly notes: string | null;
  }> = [];
  for (const list of suite.components) {
    for (const ref of list.refs) {
      out.push({
        refKind: list.kind,
        refDigest: ref,
        verdict: 'pass',
        constraints: [],
        notes: null,
      });
    }
  }
  return out as unknown as ComponentVerdictSummary;
}

/** Build a summary where every component is `fail`. */
export async function allFailSummary(
  suite: Awaited<ReturnType<typeof createCertificationSuite>>,
): Promise<ComponentVerdictSummary> {
  const out: Array<{
    readonly refKind: 'evaluation' | 'verification' | 'compatibility';
    readonly refDigest: string;
    readonly verdict: 'fail';
    readonly constraints: null;
    readonly notes: string | null;
  }> = [];
  for (const list of suite.components) {
    for (const ref of list.refs) {
      out.push({
        refKind: list.kind,
        refDigest: ref,
        verdict: 'fail',
        constraints: null,
        notes: null,
      });
    }
  }
  return out as unknown as ComponentVerdictSummary;
}

/** Build a summary where every component is `unknown`. */
export async function allUnknownSummary(
  suite: Awaited<ReturnType<typeof createCertificationSuite>>,
): Promise<ComponentVerdictSummary> {
  const out: Array<{
    readonly refKind: 'evaluation' | 'verification' | 'compatibility';
    readonly refDigest: string;
    readonly verdict: 'unknown';
    readonly constraints: null;
    readonly notes: string | null;
  }> = [];
  for (const list of suite.components) {
    for (const ref of list.refs) {
      out.push({
        refKind: list.kind,
        refDigest: ref,
        verdict: 'unknown',
        constraints: null,
        notes: null,
      });
    }
  }
  return out as unknown as ComponentVerdictSummary;
}

/** Build a summary where every pass component declares one constraint. */
export async function conditionalPassSummary(
  suite: Awaited<ReturnType<typeof createCertificationSuite>>,
): Promise<ComponentVerdictSummary> {
  const out: Array<{
    readonly refKind: 'evaluation' | 'verification' | 'compatibility';
    readonly refDigest: string;
    readonly verdict: 'pass';
    readonly constraints: readonly string[];
    readonly notes: string | null;
  }> = [];
  for (const list of suite.components) {
    for (const ref of list.refs) {
      out.push({
        refKind: list.kind,
        refDigest: ref,
        verdict: 'pass',
        constraints: ['the certified composition MUST be deployed with the pinned environment profile'],
        notes: null,
      });
    }
  }
  return out as unknown as ComponentVerdictSummary;
}

/** Build a record input matching a given suite descriptor. */
export async function makeRecordInput(
  suite: Awaited<ReturnType<typeof createCertificationSuite>>,
  componentVerdicts: ComponentVerdictSummary,
  overrides: Partial<CreateCertificationRecordInput> = {},
): Promise<CreateCertificationRecordInput> {
  const bodyVersionRef = await digestOf(100);
  const substrateRef = await digestOf(101);
  const environmentRef = await digestOf(102);
  const runtimeProfileRef = await digestOf(103);
  const possessionRef = await digestOf(104);
  return {
    suiteRef: suite.digest,
    possessionRef,
    bodyVersionRef,
    substrateRef,
    environmentRef,
    runtimeProfileRef,
    componentVerdicts,
    correlationId: overrides.correlationId ?? CORR,
    idempotencyKey: overrides.idempotencyKey ?? IDEM,
    startedAt: overrides.startedAt ?? T1,
    finishedAt: overrides.finishedAt ?? T2,
    provenance: overrides.provenance ?? {
      executedBy: 'arena-reference-fabric',
      recordedAt: T2,
      notes: 'A023 test fixture record',
    },
  };
}

/** Deterministic 32-bit LCG (Numerical Recipes constants, mirrors sibling test-supports). */
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

export { createCertificationSuite };
