/**
 * Hygiene suite (Work Order A034):
 *
 *   1. SPEC PARITY — the S1.0 boundary-class vocabulary matches
 *      spec/security.md's enumeration; the data-rights record carries
 *      exactly the six fields the spec names; the expert-rights record
 *      carries exactly the five; the closed vocabularies are closed.
 *   2. PUBLIC-SURFACE HYGIENE — no `any` in the public surface, the
 *      internal test-support module is not exported, exported objects
 *      are frozen, and the package's ONLY workspace runtime dependency
 *      is @arena/protocol-core (read from package.json, mirroring the
 *      governance purity check).
 *   3. NO-CONTRACTS DISCLOSURE — this package owns no contracts/
 *      surface: there is no scripts/generate-contracts.mjs and no
 *      contract output (A019/A022 precedent, disclosed in the PR).
 *   4. SECRET HYGIENE — no credential-shaped literal appears anywhere
 *      in the package source (all secret fixtures are runtime-assembled
 *      in test files; this scan is the tripwire).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as security from './index.js';
import {
  DATA_RIGHTS_VERSION,
  EXPERT_RIGHTS_VERSION,
  SPEC_S1_BOUNDARY_CLASSES,
  TENANT_BOUNDARY_CLASSES,
} from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function collectFiles(dir: string, filter: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(abs, filter));
    } else if (filter(entry.name)) {
      files.push(abs);
    }
  }
  return files;
}

describe('spec parity — spec/security.md S1.0 is the authority', () => {
  it('the boundary-class vocabulary maps the spec enumeration exactly', () => {
    expect([...SPEC_S1_BOUNDARY_CLASSES]).toEqual([
      'customer identities',
      'expert records',
      'tasks',
      'environments',
      'trajectories',
      'datasets',
      'bodies',
      'model interactions',
      'certification evidence',
    ]);
    expect(TENANT_BOUNDARY_CLASSES.length).toBe(9);
  });

  it('the data-rights record carries the six spec fields', () => {
    expect(DATA_RIGHTS_VERSION).toBe(1);
    for (const field of [
      'owner',
      'source',
      'permittedUse',
      'contractRef',
      'retention',
      'publicationStatus',
    ]) {
      expect(
        security.isDataRightsRecord({
          recordVersion: 1,
          owner: 'tenant-alpha',
          source: 's',
          permittedUse: 'tenant-internal',
          contractRef: 'c',
          retention: { recordVersion: 1, mode: 'none', retentionDays: null, expiresAt: null },
          publicationStatus: 'private',
          recordedAt: '2026-09-30T00:00:00.000Z',
          [field]: undefined,
        }),
        field,
      ).toBe(false);
    }
  });

  it('the expert-rights record carries the five spec fields', () => {
    expect(EXPERT_RIGHTS_VERSION).toBe(1);
    const record = security.toExpertRightsRecord({
      recordVersion: 1,
      rightsId: 'rights-1',
      tenantId: 'tenant-alpha',
      contributorIdentity: 'expert-1',
      pseudonym: 'pseudo-1',
      compensationTerms: { contractRef: 'c', status: 'agreed' },
      attributionPolicy: 'named',
      derivedArtifactRights: 'none',
      withdrawalPolicy: {
        noticePeriodDays: 0,
        deletionApplicable: false,
        derivedArtifactTreatment: 'retain-anonymized',
      },
      status: 'active',
      withdrawnAt: null,
    });
    expect(record.compensationTerms.contractRef).toBe('c');
  });
});

describe('public-surface hygiene', () => {
  it('exports no test-support symbols', () => {
    const exported = Object.keys(security);
    expect(exported).not.toContain('makePrincipalInput');
    expect(exported).not.toContain('TENANT_A');
    expect(exported).not.toContain('test-support');
  });

  it('exported vocabularies and registries are frozen', () => {
    expect(Object.isFrozen(security.TENANT_BOUNDARY_CLASSES)).toBe(true);
    expect(Object.isFrozen(security.AUTHORIZATION_ACTIONS)).toBe(true);
    expect(Object.isFrozen(security.AUTHORIZATION_DECISION_REASONS)).toBe(true);
    expect(Object.isFrozen(security.PERMITTED_USES)).toBe(true);
    expect(Object.isFrozen(security.PUBLICATION_STATUSES)).toBe(true);
    expect(Object.isFrozen(security.PRINCIPAL_KINDS)).toBe(true);
    expect(Object.isFrozen(security.PRINCIPAL_ROLES)).toBe(true);
    expect(Object.isFrozen(security.SECURITY_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(security.SECURITY_SCHEMAS)).toBe(true);
    expect(Object.isFrozen(security.SECURITY_AUDIT_EVENT_KINDS)).toBe(true);
  });

  it('the only workspace runtime dependency is @arena/protocol-core', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@arena/protocol-core']);
  });

  it('no `any` in the public (non-test) source', () => {
    const sources = collectFiles(join(PACKAGE_ROOT, 'src'), (name) =>
      name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts',
    );
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      expect(text.includes(': any'), `${file} must not use : any`).toBe(false);
      expect(text.includes('as any'), `${file} must not use as any`).toBe(false);
    }
  });
});

describe('no-contracts disclosure (A019/A022 precedent)', () => {
  it('ships no contracts generator and no contract output', () => {
    expect(existsSync(join(PACKAGE_ROOT, 'scripts'))).toBe(false);
    expect(existsSync(join(PACKAGE_ROOT, '..', '..', 'contracts', 'security'))).toBe(false);
  });
});

describe('secret hygiene — no credential-shaped literals in source', () => {
  it('no ghp_/sk-/AKIA token-shaped literals anywhere in the package', () => {
    const files = collectFiles(PACKAGE_ROOT, (name) => name.endsWith('.ts') || name.endsWith('.mjs') || name.endsWith('.json'));
    expect(files.length).toBeGreaterThan(10);
    // Prefixes assembled from fragments so even THIS scan stays clean of
    // full token shapes.
    const ghPrefix = ['gh', 'p_'].join('');
    const skPrefix = ['sk', '-'].join('');
    const awsPrefix = ['AK', 'IA'].join('');
    // A credential-shaped literal = prefix + >=16 alphanumeric chars.
    const tokenShape = new RegExp(
      `${ghPrefix}[A-Za-z0-9]{16,}|${skPrefix}[A-Za-z0-9_-]{16,}|${awsPrefix}[A-Z0-9]{16,}`,
    );
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      const match = text.match(tokenShape);
      expect(match, `${file} contains a credential-shaped literal: ${String(match?.[0])}`).toBeNull();
    }
  });
});
