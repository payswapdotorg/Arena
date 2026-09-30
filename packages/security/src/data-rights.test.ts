/**
 * Data-rights tests (Work Order A034): the six mandatory fields, closed
 * vocabularies, publication transitions, retention/publication
 * violations.
 */

import { describe, expect, it } from 'vitest';
import type { DataRightsRecord } from './data-rights.js';
import {
  assertDataRightsForAction,
  assertPublicationTransition,
  checkDataRightsForAction,
  isDataRightsRecord,
  PERMITTED_USES,
  PUBLICATION_STATUSES,
  PUBLICATION_TRANSITIONS,
  retentionExpiry,
  SECURITY_ERROR_CODES,
  SecurityError,
  toDataRightsRecord,
  toRetentionPolicy,
} from './index.js';
import {
  captureSecurityError,
  makeDataRightsInput,
  T0,
  T1,
  T5,
  TENANT_A,
} from './test-support.js';

describe('retention policy validation', () => {
  it('fixed-days requires retentionDays; until-date requires expiresAt', () => {
    expect(() =>
      toRetentionPolicy({ recordVersion: 1, mode: 'fixed-days', retentionDays: null, expiresAt: null }),
    ).toThrowError(/requires retentionDays/);
    expect(() =>
      toRetentionPolicy({ recordVersion: 1, mode: 'until-date', retentionDays: null, expiresAt: null }),
    ).toThrowError(/requires expiresAt/);
  });

  it('mode none must carry no silent defaults', () => {
    expect(() =>
      toRetentionPolicy({ recordVersion: 1, mode: 'none', retentionDays: 10, expiresAt: null }),
    ).toThrowError(/no silent defaults/);
  });

  it('retentionDays must be a sane integer', () => {
    expect(() =>
      toRetentionPolicy({ recordVersion: 1, mode: 'fixed-days', retentionDays: -1, expiresAt: null }),
    ).toThrowError(/0\.\.36500/);
  });

  it('retentionExpiry computes the absolute instant', () => {
    const policy = toRetentionPolicy({
      recordVersion: 1,
      mode: 'fixed-days',
      retentionDays: 30,
      expiresAt: null,
    });
    expect(retentionExpiry(policy, T0)).toBe('2026-10-30T00:00:00.000Z');
  });
});

describe('data-rights records carry ALL SIX mandatory S1.0 fields', () => {
  it('a well-formed record validates and freezes', () => {
    const rights = toDataRightsRecord(makeDataRightsInput());
    expect(rights.owner).toBe(TENANT_A);
    expect(rights.permittedUse).toBe('cross-tenant-learning');
    expect(rights.publicationStatus).toBe('tenant-internal');
    expect(Object.isFrozen(rights)).toBe(true);
    expect(isDataRightsRecord(rights)).toBe(true);
  });

  it('dropping ANY of the six fields is a validation error', () => {
    for (const field of [
      'owner',
      'source',
      'permittedUse',
      'contractRef',
      'retention',
      'publicationStatus',
    ]) {
      const input = makeDataRightsInput();
      delete input[field];
      expect(() => toDataRightsRecord(input), `missing ${field}`).toThrowError(
        /missing required field/,
      );
    }
  });

  it('unknown permitted uses and statuses are rejected (closed vocabularies)', () => {
    expect(() => toDataRightsRecord(makeDataRightsInput({ permittedUse: 'anything-goes' })))
      .toThrowError(/must be one of/);
    expect(() => toDataRightsRecord(makeDataRightsInput({ publicationStatus: 'semi-public' })))
      .toThrowError(/must be one of/);
  });
});

describe('publication transitions (closed graph)', () => {
  it('private → tenant-internal → public is legal; withdrawn is terminal', () => {
    expect(() => assertPublicationTransition('private', 'tenant-internal')).not.toThrow();
    expect(() => assertPublicationTransition('tenant-internal', 'public')).not.toThrow();
    expect(() => assertPublicationTransition('public', 'withdrawn')).not.toThrow();
    expect(captureSecurityError(() => assertPublicationTransition('withdrawn', 'public')).code)
      .toBe(SECURITY_ERROR_CODES.PUBLICATION_FORBIDDEN);
  });

  it('skipping public → withdrawn backwards is illegal', () => {
    expect(() => assertPublicationTransition('public', 'tenant-internal')).toThrowError(
      SecurityError,
    );
    expect(() => assertPublicationTransition('private', 'withdrawn')).toThrowError(SecurityError);
  });

  it('the transition graph has no cycles (DFS with recursion stack)', () => {
    const graph = PUBLICATION_TRANSITIONS as unknown as Record<string, readonly string[]>;
    const visiting = new Set<string>();
    const done = new Set<string>();
    const walk = (node: string): void => {
      if (done.has(node)) return;
      if (visiting.has(node)) throw new Error('cycle detected in publication graph');
      visiting.add(node);
      for (const next of graph[node]!) walk(next);
      visiting.delete(node);
      done.add(node);
    };
    for (const status of PUBLICATION_STATUSES) walk(status);
    expect(done.size).toBe(PUBLICATION_STATUSES.length);
  });
});

describe('retention and publication enforcement', () => {
  it('an expired record denies every data action (retention violation)', () => {
    const rights = toDataRightsRecord(
      makeDataRightsInput({
        recordedAt: T0,
        retention: { recordVersion: 1, mode: 'until-date', retentionDays: null, expiresAt: T1 },
      }),
    );
    for (const action of ['read', 'export', 'publish', 'use-for-learning'] as const) {
      const decision = checkDataRightsForAction(rights, action, T5);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('retention-expired');
    }
    expect(captureSecurityError(() => assertDataRightsForAction(rights, 'read', T5)).code).toBe(
      SECURITY_ERROR_CODES.DATA_RIGHTS_FORBIDDEN,
    );
  });

  it('a withdrawn record denies every data action (publication violation)', () => {
    const rights = toDataRightsRecord(
      makeDataRightsInput({ publicationStatus: 'withdrawn' }),
    );
    const decision = checkDataRightsForAction(rights, 'read', T1);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('publication-forbidden');
  });

  it('cross-tenant reads of non-public records are denied', () => {
    const rights = toDataRightsRecord(makeDataRightsInput());
    const decision = checkDataRightsForAction(rights, 'read', T1, { crossTenant: true });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('publication-forbidden');
  });

  it('a missing rights record is NEVER an allow (fail closed)', () => {
    for (const rights of [null, undefined, { junk: true }]) {
      const decision = checkDataRightsForAction(
        rights as DataRightsRecord | null,
        'read',
        T1,
      );
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('rights-missing');
    }
  });

  it('cross-tenant learning consumption requires permittedUse cross-tenant-learning', () => {
    const internal = toDataRightsRecord(
      makeDataRightsInput({ permittedUse: 'tenant-internal' }),
    );
    const decision = checkDataRightsForAction(internal, 'use-for-learning', T1, {
      crossTenant: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('use-not-permitted');
  });

  it('the permitted-use vocabulary keeps cross-tenant-learning explicit', () => {
    expect(Object.isFrozen(PERMITTED_USES)).toBe(true);
    expect(PERMITTED_USES).toContain('cross-tenant-learning');
    expect(PERMITTED_USES).not.toContain('any');
  });
});
