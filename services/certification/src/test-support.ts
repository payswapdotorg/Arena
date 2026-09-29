/**
 * Shared test fixtures for @arena/certification-fabric (internal).
 */

import {
  createCertificationSuite,
} from '@arena/certification';
import type { CertificationSuiteDescriptor } from '@arena/certification';
import type { ComponentVerdictSummary } from '@arena/certification';
import type { CertifyOptions } from './fabric.js';

export const T0 = '2026-02-01T10:00:00.000Z';
export const T1 = '2026-02-01T10:00:01.000Z';
export const T2 = '2026-02-01T10:00:02.000Z';
export const T3 = '2026-02-01T10:00:03.000Z';

export const CORR = 'corr-fabric-0001';
export const IDEM = 'idem-fabric-0001';

import { sha256Hex } from '@arena/protocol-core';

/** Deterministic digest from a numeric index. */
export async function digestOf(index: number): Promise<string> {
  return sha256Hex(`arena-certification-fabric-${String(index)}`);
}

/** Build a two-component suite descriptor (evaluation + verification). */
export async function makeSuite(
  suiteId = 'suite-fabric-0001',
): Promise<CertificationSuiteDescriptor> {
  return createCertificationSuite({
    suiteId,
    version: '1.0.0',
    title: 'Reference Fabric Suite (test fixture)',
    scopeStatement:
      'Agent Body B, version V, possessed by Cognitive Substrate M, under Environment E and Runtime Profile R, satisfied Certification Suite S at revision X.',
    components: [
      { kind: 'evaluation', refs: [await digestOf(1)] },
      { kind: 'verification', refs: [await digestOf(2)] },
    ],
    verdictSemantics: {
      pass: 'every component produced a pass verdict and no constraint was declared',
      'conditional-pass':
        'every component produced a pass verdict AND at least one component declared a constraint',
      fail: 'at least one component produced a fail verdict',
      unknown: 'at least one component produced an unknown verdict OR the suite is misconfigured',
    },
    inputSchema: { namespace: 'certification', name: 'run-certification-command', version: '1.0.0' },
    outputSchema: { namespace: 'certification', name: 'certification-record', version: '1.0.0' },
    provenance: { authoredBy: 'arena-reference-fabric', submittedAt: T0, notes: 'A023 fabric fixture' },
  });
}

/** Build a ComponentVerdictSummary matching a given suite descriptor (every ref passes). */
export async function allPassSummary(
  suite: CertificationSuiteDescriptor,
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
  suite: CertificationSuiteDescriptor,
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
  suite: CertificationSuiteDescriptor,
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

/** Build a summary where every pass component declares a constraint. */
export async function conditionalPassSummary(
  suite: CertificationSuiteDescriptor,
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
        constraints: ['must be deployed with the pinned environment profile'],
        notes: null,
      });
    }
  }
  return out as unknown as ComponentVerdictSummary;
}

/** Build the scope refs tuple (the design-law B×M×E×R fields). */
export async function makeScopeRefs(): Promise<{
  readonly bodyVersionRef: string;
  readonly substrateRef: string;
  readonly environmentRef: string;
  readonly runtimeProfileRef: string;
  readonly possessionRef: string;
}> {
  return {
    bodyVersionRef: await digestOf(100),
    substrateRef: await digestOf(101),
    environmentRef: await digestOf(102),
    runtimeProfileRef: await digestOf(103),
    possessionRef: await digestOf(104),
  };
}

/** Default run options (fixed timestamps for determinism). */
export function runOptions(overrides: Partial<CertifyOptions> = {}): CertifyOptions {
  const base: {
    correlationId: string;
    idempotencyKey: string;
    startedAt: string;
    finishedAt: string;
    provenanceNotes: string | null;
    executedBy?: string;
  } = {
    correlationId: overrides.correlationId ?? CORR,
    idempotencyKey: overrides.idempotencyKey ?? IDEM,
    startedAt: overrides.startedAt ?? T1,
    finishedAt: overrides.finishedAt ?? T2,
    provenanceNotes: overrides.provenanceNotes ?? null,
  };
  if (overrides.executedBy !== undefined) {
    base.executedBy = overrides.executedBy;
  }
  return base as CertifyOptions;
}

/** Deterministic 32-bit LCG (mirrors sibling test-supports). */
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
