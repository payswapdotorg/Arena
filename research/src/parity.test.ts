/**
 * Contract/parity tests for @arena/research (Work Order A030): the
 * research layer must REUSE -- never reimplement -- the closed enums and
 * disciplines of the merged dependency fabrics:
 *
 *   - the aggregation policy enum is @arena/evaluation's very enum
 *     (byte-for-byte, by import);
 *   - the evaluator-kind pin vocabulary accepts exactly A012's closed
 *     enum and rejects everything else;
 *   - the content-digest pattern matches A012's constant;
 *   - the public dataset packaging namespace matches the A002 reserved
 *     public namespace;
 *   - the research schema registry shapes match @arena/protocol-core's
 *     SchemaRef discipline.
 */

import { describe, expect, it } from 'vitest';
import { AGGREGATION_POLICIES, isAggregationPolicy, isEvaluatorKind, EVALUATOR_KINDS } from '@arena/evaluation';
import { PUBLIC_NAMESPACE } from '@arena/artifact-protocol';
import { digestCanonical } from '@arena/protocol-core';
import { formatSchemaRef, isSchemaRef } from '@arena/protocol-core';
import { CONTENT_DIGEST_PATTERN_SOURCE } from './shared.js';
import { SCORE_DOMAINS, scoreDomainFor } from './methodology.js';
import { BENCHMARK_STATUSES, SEED_POLICIES } from './descriptor.js';
import { BENCHMARK_OUTCOMES } from './result.js';
import { RESEARCH_SCHEMAS, researchSchemaRef, RESEARCH_SCHEMA_REGISTRY } from './schemas.js';
import { RESEARCH_PUBLIC_NAMESPACE } from './publication.js';

describe('A012 evaluation protocol parity', () => {
  it('reuses the exact A012 aggregation-policy enum (by import)', () => {
    for (const policy of AGGREGATION_POLICIES) {
      expect(isAggregationPolicy(policy)).toBe(true);
      expect(typeof scoreDomainFor(policy)).toBe('string');
      expect(SCORE_DOMAINS).toContain(scoreDomainFor(policy));
    }
    expect(isAggregationPolicy('vibe-based')).toBe(false);
  });

  it('evaluator-kind pins accept exactly the A012 closed enum', () => {
    for (const kind of EVALUATOR_KINDS) {
      expect(isEvaluatorKind(kind)).toBe(true);
    }
    expect(isEvaluatorKind('psychic')).toBe(false);
    expect(isEvaluatorKind('deterministic-test ')).toBe(false);
  });

  it('mirrors the A012 content-digest pattern source', () => {
    expect(CONTENT_DIGEST_PATTERN_SOURCE).toBe('^[0-9a-f]{64}$');
  });
});

describe('A002 artifact protocol parity', () => {
  it('the research public namespace is the A002 reserved public namespace', () => {
    expect(RESEARCH_PUBLIC_NAMESPACE).toBe(PUBLIC_NAMESPACE);
    expect(RESEARCH_PUBLIC_NAMESPACE).toBe('public');
  });

  it('content addressing is @arena/protocol-core digestCanonical (same digest for same value)', async () => {
    const value = { a: 1, b: ['x', 'y'] };
    expect(await digestCanonical(value)).toBe(await digestCanonical({ b: ['x', 'y'], a: 1 }));
  });
});

describe('research schema registry parity (SchemaRef discipline)', () => {
  it('every registered schema resolves to a well-formed SchemaRef', () => {
    for (const name of Object.keys(RESEARCH_SCHEMAS) as (keyof typeof RESEARCH_SCHEMAS)[]) {
      const ref = researchSchemaRef(name);
      expect(isSchemaRef(ref)).toBe(true);
      expect(formatSchemaRef(ref)).toBe(`arena:schema/${ref.namespace}/${ref.name}@${ref.version}`);
    }
  });

  it('the registry is the frozen disclosed shape', () => {
    expect(Object.keys(RESEARCH_SCHEMA_REGISTRY)).toEqual(Object.keys(RESEARCH_SCHEMAS));
    expect(Object.isFrozen(RESEARCH_SCHEMA_REGISTRY)).toBe(true);
  });
});

describe('closed vocabulary parity', () => {
  it('the publication lifecycle, seed policies and outcomes are closed sets', () => {
    expect(BENCHMARK_STATUSES).toEqual(['draft', 'published', 'retired']);
    expect(SEED_POLICIES).toEqual(['fixed-seed', 'declared-per-scenario']);
    expect(BENCHMARK_OUTCOMES).toEqual(['pass', 'fail', 'indeterminate']);
  });
});
