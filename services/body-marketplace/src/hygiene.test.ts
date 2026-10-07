/**
 * Hygiene tests (Work Order C014): the closed vocabularies, the typed
 * error taxonomy, and the not-exported test-support discipline.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BODY_MARKETPLACE_ERROR_CODES,
  isBodyMarketplaceError,
  BodyMarketplaceError,
} from './errors.js';
import {
  LISTING_STATES,
  LISTING_TRANSITIONS,
  LISTING_GUARD_REASONS,
  CERTIFICATION_POSTURE_STATES,
  LISTING_PERMITTED_USES,
} from './fabric.js';
import {
  PRETRAINING_INPUT_KINDS,
  PRETRAINING_BLOCK_REASON_CODES,
  TRAINING_USE_RIGHTS,
} from './pretraining.js';
import { BODY_MARKETPLACE_QUERY_KINDS } from './envelopes.js';
import * as index from './index.js';

describe('hygiene: closed vocabularies', () => {
  it('listing states form the closed lifecycle vocabulary', () => {
    expect([...LISTING_STATES]).toEqual(['draft', 'published', 'suspended', 'retired']);
    expect(LISTING_TRANSITIONS.retired).toEqual([]);
    expect(LISTING_TRANSITIONS.draft).toContain('published');
    expect(LISTING_TRANSITIONS.published).not.toContain('draft');
  });

  it('guard reasons, postures, permitted uses and query kinds are closed', () => {
    expect(LISTING_GUARD_REASONS).toContain('certification-not-record-backed');
    expect(CERTIFICATION_POSTURE_STATES).toEqual(['record-backed', 'unverified']);
    expect(LISTING_PERMITTED_USES.length).toBeGreaterThan(0);
    expect(BODY_MARKETPLACE_QUERY_KINDS.length).toBeGreaterThan(0);
  });

  it('pretraining vocabularies are closed', () => {
    expect(PRETRAINING_INPUT_KINDS).toContain('validated-intervention-evidence');
    expect(PRETRAINING_BLOCK_REASON_CODES).toEqual([
      'rights-insufficient',
      'evidence-insufficient',
    ]);
    expect(TRAINING_USE_RIGHTS).toEqual(['permitted', 'forbidden', 'unspecified']);
  });
});

describe('hygiene: typed errors', () => {
  it('normalizes unknown failures fail-closed', () => {
    const error = new Error('boom');
    const normalized = new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
      message: 'wrapped',
      cause: error,
    });
    expect(isBodyMarketplaceError(normalized)).toBe(true);
    expect(isBodyMarketplaceError(error)).toBe(false);
  });

  it('exposes the closed error-code registry', () => {
    const values = Object.values(BODY_MARKETPLACE_ERROR_CODES);
    expect(values).toContain(BODY_MARKETPLACE_ERROR_CODES.PRETRAINING_BLOCKED);
    expect(values).toContain(BODY_MARKETPLACE_ERROR_CODES.CERTIFICATION_NOT_RECORD_BACKED);
    expect(values).toContain(BODY_MARKETPLACE_ERROR_CODES.TENANT_ACCESS_DENIED);
  });
});

describe('hygiene: surface discipline', () => {
  it('does NOT export the test-support module from the public surface', () => {
    expect(Object.keys(index)).not.toContain('makeAcceptedEvidence');
    expect(Object.keys(index)).not.toContain('makePretrainingRequest');
  });

  it('source tree contains no wall-clock reads (Date.now / new Date() without injection)', () => {
    const files = [
      'errors.ts',
      'shared.ts',
      'pretraining.ts',
      'ports.ts',
      'fabric.ts',
      'envelopes.ts',
      'service.ts',
    ];
    const dir = fileURLToPath(new URL('.', import.meta.url));
    for (const file of files) {
      const source = readFileSync(`${dir}${file}`, 'utf8');
      expect(source.includes('Date.now()')).toBe(false);
      // new Date(...) appears ONLY against the injected clock.
      const clockReads = source.match(/new Date\(/g) ?? [];
      const injected = source.match(/new Date\(this\.clock\.now\(\)\)/g) ?? [];
      expect(clockReads.length).toBe(injected.length);
    }
  });

  it('fabric consumes sibling protocols through package imports only', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const source = readFileSync(`${dir}fabric.ts`, 'utf8');
    expect(source).toMatch(/from '@arena\/body-forge'/);
    expect(source).toMatch(/from '@arena\/certification'/);
    expect(source).toMatch(/from '@arena\/body-registry'/);
    expect(source.includes("from '../../../../services/")).toBe(false);
    expect(source.includes("from '../../services/")).toBe(false);
  });
});
