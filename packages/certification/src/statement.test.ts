/**
 * Certification statement tests (Work Order A023; design law scope form).
 */

import { describe, expect, it } from 'vitest';
import { CertificationError } from './errors.js';
import {
  CERTIFICATION_STATEMENT_FIELDS,
  STATEMENT_TEMPLATE,
  STATEMENT_VERDICTS,
  buildCertificationStatement,
  isCertificationStatement,
  renderStatementText,
  statementVerdictFor,
} from './statement.js';
import { digestOf } from './test-support.js';

const DIGEST = '0'.repeat(64);

describe('statement template (the design-law form)', () => {
  it('the template carries EVERY design-law field — Body, Substrate, Environment, RuntimeProfile, Suite, Revision', () => {
    expect(STATEMENT_TEMPLATE).toContain('{bodyVersionRef}');
    expect(STATEMENT_TEMPLATE).toContain('{substrateRef}');
    expect(STATEMENT_TEMPLATE).toContain('{environmentRef}');
    expect(STATEMENT_TEMPLATE).toContain('{runtimeProfileRef}');
    expect(STATEMENT_TEMPLATE).toContain('{suiteRef}');
    expect(STATEMENT_TEMPLATE).toContain('{suiteRevision}');
  });
  it('the template has all six scope fields (no field can be silently dropped)', () => {
    const fields = [
      '{bodyVersionRef}',
      '{substrateRef}',
      '{environmentRef}',
      '{runtimeProfileRef}',
      '{suiteRef}',
      '{suiteRevision}',
    ];
    for (const f of fields) {
      expect(STATEMENT_TEMPLATE).toContain(f);
    }
  });
});

describe('statement verdict vocabulary', () => {
  it('STATEMENT_VERDICTS mirrors CERTIFICATION_VERDICTS exactly', () => {
    expect([...STATEMENT_VERDICTS]).toEqual([
      'pass',
      'conditional-pass',
      'fail',
      'unknown',
    ]);
  });
  it('statementVerdictFor rejects unknown members', () => {
    expect(() => statementVerdictFor('bad')).toThrowError(CertificationError);
    expect(statementVerdictFor('pass')).toBe('pass');
  });
});

describe('renderStatementText (pure deterministic)', () => {
  it('substitutes every placeholder with the supplied digest', () => {
    const text = renderStatementText({
      bodyVersionRef: DIGEST,
      substrateRef: DIGEST,
      environmentRef: DIGEST,
      runtimeProfileRef: DIGEST,
      possessionRef: DIGEST,
      suiteRef: DIGEST,
      suiteRevision: DIGEST,
      verdict: 'pass',
    });
    expect(text).toContain(DIGEST);
    expect(text).toContain('verdict: pass');
  });
  it('rejects a non-digest placeholder value (fail-closed)', () => {
    expect(() =>
      renderStatementText({
        bodyVersionRef: 'not-a-digest',
        substrateRef: DIGEST,
        environmentRef: DIGEST,
        runtimeProfileRef: DIGEST,
        possessionRef: DIGEST,
        suiteRef: DIGEST,
        suiteRevision: DIGEST,
        verdict: 'pass',
      }),
    ).toThrowError(CertificationError);
  });
});

describe('buildCertificationStatement (the design-law statement form)', () => {
  it('builds a frozen, scoped statement object', async () => {
    const bodyVersionRef = await digestOf(100);
    const substrateRef = await digestOf(101);
    const environmentRef = await digestOf(102);
    const runtimeProfileRef = await digestOf(103);
    const possessionRef = await digestOf(104);
    const suiteRef = await digestOf(1);
    const suiteRevision = suiteRef;
    const statement = buildCertificationStatement({
      bodyVersionRef,
      substrateRef,
      environmentRef,
      runtimeProfileRef,
      possessionRef,
      suiteRef,
      suiteRevision,
      verdict: 'pass',
      constraints: [],
    });
    expect(Object.isFrozen(statement)).toBe(true);
    expect(statement.bodyVersionRef).toBe(bodyVersionRef);
    expect(statement.verdict).toBe('pass');
    expect(statement.constraints).toEqual([]);
    expect(statement.statementText).toContain(bodyVersionRef);
    expect(statement.statementText).toContain(substrateRef);
    expect(statement.statementText).toContain(environmentRef);
    expect(statement.statementText).toContain(runtimeProfileRef);
    expect(statement.statementText).toContain(suiteRef);
    expect(statement.statementText).toContain(suiteRevision);
  });

  it('identical inputs produce identical statement objects (determinism)', async () => {
    const refs = {
      bodyVersionRef: await digestOf(100),
      substrateRef: await digestOf(101),
      environmentRef: await digestOf(102),
      runtimeProfileRef: await digestOf(103),
      possessionRef: await digestOf(104),
      suiteRef: await digestOf(1),
      suiteRevision: await digestOf(1),
    };
    const a = buildCertificationStatement({ ...refs, verdict: 'pass', constraints: [] });
    const b = buildCertificationStatement({ ...refs, verdict: 'pass', constraints: [] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different verdicts produce different statement text', async () => {
    const refs = {
      bodyVersionRef: await digestOf(100),
      substrateRef: await digestOf(101),
      environmentRef: await digestOf(102),
      runtimeProfileRef: await digestOf(103),
      possessionRef: await digestOf(104),
      suiteRef: await digestOf(1),
      suiteRevision: await digestOf(1),
    };
    const passStmt = buildCertificationStatement({ ...refs, verdict: 'pass', constraints: [] });
    const failStmt = buildCertificationStatement({ ...refs, verdict: 'fail', constraints: [] });
    expect(passStmt.statementText).not.toBe(failStmt.statementText);
  });

  it('carries the constraints list (conditional-pass)', async () => {
    const refs = {
      bodyVersionRef: await digestOf(100),
      substrateRef: await digestOf(101),
      environmentRef: await digestOf(102),
      runtimeProfileRef: await digestOf(103),
      possessionRef: await digestOf(104),
      suiteRef: await digestOf(1),
      suiteRevision: await digestOf(1),
    };
    const stmt = buildCertificationStatement({
      ...refs,
      verdict: 'conditional-pass',
      constraints: ['must be deployed in pinned environment'],
    });
    expect(stmt.constraints).toEqual(['must be deployed in pinned environment']);
  });

  it('the field list mirrors the contract', () => {
    expect([...CERTIFICATION_STATEMENT_FIELDS]).toEqual([
      'bodyVersionRef',
      'substrateRef',
      'environmentRef',
      'runtimeProfileRef',
      'possessionRef',
      'suiteRef',
      'suiteRevision',
      'verdict',
      'statementText',
      'constraints',
    ]);
  });

  it('isCertificationStatement rejects malformed shapes', async () => {
    expect(isCertificationStatement(null)).toBe(false);
    expect(isCertificationStatement({})).toBe(false);
    const stmt = buildCertificationStatement({
      bodyVersionRef: await digestOf(100),
      substrateRef: await digestOf(101),
      environmentRef: await digestOf(102),
      runtimeProfileRef: await digestOf(103),
      possessionRef: await digestOf(104),
      suiteRef: await digestOf(1),
      suiteRevision: await digestOf(1),
      verdict: 'pass',
      constraints: [],
    });
    expect(isCertificationStatement(stmt)).toBe(true);
  });
});

describe('design-law negative — the statement NEVER carries an unscoped professional claim', () => {
  it('the rendered text ALWAYS references the body, the substrate, the environment, the runtime profile, the suite and the revision', async () => {
    const stmt = buildCertificationStatement({
      bodyVersionRef: await digestOf(100),
      substrateRef: await digestOf(101),
      environmentRef: await digestOf(102),
      runtimeProfileRef: await digestOf(103),
      possessionRef: await digestOf(104),
      suiteRef: await digestOf(1),
      suiteRevision: await digestOf(1),
      verdict: 'pass',
      constraints: [],
    });
    // Every design-law field MUST appear in the rendered text.
    for (const ref of [
      stmt.bodyVersionRef,
      stmt.substrateRef,
      stmt.environmentRef,
      stmt.runtimeProfileRef,
      stmt.suiteRef,
      stmt.suiteRevision,
    ]) {
      expect(stmt.statementText).toContain(ref);
    }
    // No "is a professional" phrasing is structurally possible here — the
    // template has no slot for an unscoped claim.
    expect(stmt.statementText.toLowerCase()).not.toContain('is a professional');
    expect(stmt.statementText.toLowerCase()).not.toContain('is a software engineer');
    expect(stmt.statementText.toLowerCase()).not.toContain('is a structural engineer');
  });
});
