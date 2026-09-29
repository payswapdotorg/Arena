/**
 * Subject + suite + statement tests (Work Order A023).
 *
 * Positive: the composition under test carries ALL FIVE scope
 * components; suites are content-addressed, stage-composed and
 * lineage-bearing; the statement renders the exact design-law sentence.
 *
 * Negative (design law): a substrate-only / environment-less subject is
 * unrepresentable; unscoped statement rendering rejects; unknown stage
 * kinds, duplicate stages, foreign/missing pins, bad grant levels,
 * duplicate constraints and unknown fields all reject with typed
 * errors.
 */

import { describe, expect, it } from 'vitest';
import {
  CERTIFICATION_STAGE_KINDS,
  certificationSuiteIdentityKey,
  certificationSuiteView,
  isCertificationSuite,
  isCertificationSuiteView,
  recomputeCertificationSuiteDigest,
} from './suite.js';
import { DEFAULT_CERTIFICATION_LIMITATIONS } from './suite.js';
import {
  certificationSubjectKey,
  createCertificationSubject,
  isCertificationSubject,
} from './subject.js';
import {
  CERTIFICATION_STATEMENT_SCOPE_FIELDS,
  VERDICT_QUALIFIERS,
  deriveCertificationStatement,
  isCertificationStatement,
} from './statement.js';
import { CertificationError } from './errors.js';
import {
  DIGEST_B,
  DIGEST_C,
  ENVIRONMENT_REF,
  RUNTIME_PROFILE,
  SUBSTRATE_REF,
  T0,
  BODY_REF,
  compositionStage,
  compatibilityStage,
  datasetStage,
  evaluationStage,
  makeSuite,
  makeSubject,
  verificationStage,
} from './test-support.js';

describe('CertificationSubject — the composition under test', () => {
  it('creates a fully-scoped subject (B/V × M × E × R)', () => {
    const subject = makeSubject();
    expect(subject.bodyVersionRef).toEqual(BODY_REF);
    expect(subject.substrateRef.substrateId).toBe('substrate-x');
    expect(subject.environmentRef.environmentId).toBe('structural-env');
    expect(subject.runtimeProfile.runtimeId).toBe('arena-runtime');
    expect(isCertificationSubject(subject)).toBe(true);
    expect(Object.isFrozen(subject)).toBe(true);
    expect(certificationSubjectKey(subject)).toContain('body:acme/structural-engineer-body@1.4.0');
    expect(certificationSubjectKey(subject)).toContain('substrate:substrate-x@6.0.1');
  });

  it('NEGATIVE (design law): a substrate-only subject is unrepresentable', () => {
    expect(() =>
      createCertificationSubject({
        bodyVersionRef: { ...BODY_REF },
        substrateRef: { ...SUBSTRATE_REF },
        environmentRef: { environmentId: '', environmentVersion: '1.0.0', constraints: ['x'] },
        runtimeProfile: { runtimeId: RUNTIME_PROFILE.runtimeId, runtimeVersion: '1.0.0', configuration: {} },
        possessionRef: null,
        tenantId: null,
        workspaceId: null,
      } as never),
    ).toThrow(/requires valid A003 environment and runtime profile components/);
  });

  it('NEGATIVE: malformed components and unknown fields reject', () => {
    expect(() =>
      createCertificationSubject({
        bodyVersionRef: { tenant: 'acme', name: 'x', version: '1.0.0', digest: 'nope' },
        substrateRef: { ...SUBSTRATE_REF },
        environmentRef: { ...ENVIRONMENT_REF },
        runtimeProfile: { ...RUNTIME_PROFILE },
        possessionRef: null,
        tenantId: null,
        workspaceId: null,
      } as never),
    ).toThrow(CertificationError);
    expect(() =>
      createCertificationSubject({
        bodyVersionRef: { ...BODY_REF },
        substrateRef: { substrateId: 'BAD ID', substrateVersion: '1.0.0', digest: DIGEST_B },
        environmentRef: { ...ENVIRONMENT_REF },
        runtimeProfile: { ...RUNTIME_PROFILE },
        possessionRef: null,
        tenantId: null,
        workspaceId: null,
      } as never),
    ).toThrow(CertificationError);
    expect(() =>
      createCertificationSubject({
        bodyVersionRef: { ...BODY_REF },
        substrateRef: { ...SUBSTRATE_REF },
        environmentRef: { ...ENVIRONMENT_REF },
        runtimeProfile: { ...RUNTIME_PROFILE },
        possessionRef: null,
        tenantId: null,
        workspaceId: null,
        rogueField: true,
      } as never),
    ).toThrow(/unknown field/);
  });
});

describe('CertificationSuite — the stage-composed declaration', () => {
  it('creates a content-addressed suite composing all five stage kinds', async () => {
    const suite = await makeSuite([
      verificationStage('verify-constraints', DIGEST_C),
      evaluationStage('judge-design', DIGEST_B, DIGEST_C),
      compatibilityStage('body-substrate'),
      datasetStage('benchmark', { namespace: 'arena', name: 'structural-benchmark', version: '1.2.0', digest: DIGEST_C }),
      compositionStage('composition'),
    ]);
    expect(suite.suiteId).toBe('structural-certification');
    expect(suite.levelGrant).toBe('CERTIFIED');
    expect(suite.stages).toHaveLength(5);
    expect(suite.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(isCertificationSuite(suite)).toBe(true);
    expect(isCertificationSuiteView(certificationSuiteView(suite))).toBe(true);
    expect(certificationSuiteIdentityKey(suite)).toBe('structural-certification@2.1.0');
    await expect(recomputeCertificationSuiteDigest(suite)).resolves.toBe(suite.digest);
    expect(Object.isFrozen(suite)).toBe(true);
    expect([...CERTIFICATION_STAGE_KINDS]).toEqual([
      'evaluation',
      'verification',
      'compatibility',
      'dataset',
      'composition',
    ]);
  });

  it('content addressing: ANY field change changes the digest (new revision)', async () => {
    const base = await makeSuite([verificationStage('v', DIGEST_C)]);
    const bumped = await makeSuite([verificationStage('v', DIGEST_B)]);
    const relabeled = await makeSuite([verificationStage('v', DIGEST_C)], { levelGrant: 'CANDIDATE' });
    expect(base.digest).not.toBe(bumped.digest);
    expect(base.digest).not.toBe(relabeled.digest);
  });

  it('carries the supersedes lineage and a null default', async () => {
    const first = await makeSuite([verificationStage('v', DIGEST_C)]);
    const second = await makeSuite([verificationStage('v', DIGEST_C)], {
      version: '2.2.0',
      supersedes: first.digest,
    });
    expect(second.supersedes).toBe(first.digest);
    expect(first.supersedes).toBeNull();
  });

  it('NEGATIVE: empty suites, unknown kinds, duplicate stages, foreign pins reject', async () => {
    await expect(makeSuite([])).rejects.toThrow(/at least one stage/);
    await expect(
      makeSuite([{ ...verificationStage('v', DIGEST_C), kind: 'vibes' } as never]),
    ).rejects.toThrow(/unknown stage kind/);
    await expect(
      makeSuite([verificationStage('v', DIGEST_C), verificationStage('v', DIGEST_B)]),
    ).rejects.toThrow(/duplicate stage id/);
    // foreign pins: a verification stage carrying an evaluator pin
    await expect(
      makeSuite([
        {
          ...verificationStage('v', DIGEST_C),
          evaluatorRef: DIGEST_B,
          criteriaRef: DIGEST_C,
        } as never],
      ),
    ).rejects.toThrow(/only evaluation stages carry evaluatorRef/);
    // missing own pins: a verification stage without a verifierRef
    await expect(
      makeSuite([{ ...verificationStage('v', ''), verifierRef: null } as never]),
    ).rejects.toThrow(/requires a verifierRef pin/);
    // evaluation stage missing the criteria pin
    await expect(
      makeSuite([{ ...evaluationStage('e', DIGEST_B, ''), criteriaRef: null } as never]),
    ).rejects.toThrow(/requires BOTH evaluatorRef and criteriaRef/);
    // composition stage with no requirements
    await expect(
      makeSuite([
        { ...compositionStage('c'), environmentRequirement: null, runtimeRequirement: null } as never,
      ]),
    ).rejects.toThrow(/at least one of environmentRequirement/);
    // dataset pin on a compatibility stage
    await expect(
      makeSuite([
        {
          ...compatibilityStage('k'),
          datasetRef: { namespace: 'arena', name: 'benchmark-d', version: '1.0.0', digest: DIGEST_C },
        } as never,
      ]),
    ).rejects.toThrow(/only dataset stages carry a datasetRef/);
  });

  it('NEGATIVE: bad grant levels, duplicate constraints, unknown fields, bad provenance reject', async () => {
    await expect(
      makeSuite([verificationStage('v', DIGEST_C)], { levelGrant: 'GURU' } as never),
    ).rejects.toThrow(/levelGrant/);
    await expect(
      makeSuite([verificationStage('v', DIGEST_C)], { constraints: ['a', 'a'] } as never),
    ).rejects.toThrow(/duplicate constraint/);
    await expect(
      makeSuite([verificationStage('v', DIGEST_C)], { rogue: true } as never),
    ).rejects.toThrow(/unknown field/);
    await expect(
      makeSuite([verificationStage('v', DIGEST_C)], {
        provenance: { authoredBy: '', submittedAt: T0, notes: null },
      } as never),
    ).rejects.toThrow(CertificationError);
  });

  it('NEGATIVE: digest recomputation trips on tampering', async () => {
    const suite = await makeSuite([verificationStage('v', DIGEST_C)]);
    const tampered = { ...suite, suiteId: 'hijacked-suite' };
    await expect(recomputeCertificationSuiteDigest(tampered as never)).rejects.toThrow(
      /digest mismatch/,
    );
  });
});

describe('CertificationStatement — the design law', () => {
  it('renders the exact scoped sentence with all five components + revision', async () => {
    const subject = makeSubject();
    const suite = await makeSuite([verificationStage('v', DIGEST_C)]);
    const statement = deriveCertificationStatement(subject, suite, 'satisfied', 'CERTIFIED');
    expect(statement.scope.body).toBe('acme/structural-engineer-body');
    expect(statement.scope.bodyVersion).toBe('1.4.0');
    expect(statement.scope.substrate).toBe('substrate-x');
    expect(statement.scope.environment).toBe('structural-env');
    expect(statement.scope.runtime).toBe('arena-runtime');
    expect(statement.scope.suite).toBe('structural-certification');
    expect(statement.suiteRevision).toBe(suite.digest);
    expect(statement.text).toBe(
      `Agent Body acme/structural-engineer-body, version 1.4.0, possessed by Cognitive ` +
        `Substrate substrate-x, under Environment structural-env and Runtime Profile ` +
        `arena-runtime, satisfied Certification Suite structural-certification at ` +
        `revision ${suite.digest}. Level granted: CERTIFIED. ` +
        `${DEFAULT_CERTIFICATION_LIMITATIONS}`,
    );
    expect(statement.limitations).toBe(DEFAULT_CERTIFICATION_LIMITATIONS);
    expect(isCertificationStatement(statement)).toBe(true);
    expect(CERTIFICATION_STATEMENT_SCOPE_FIELDS).toHaveLength(10);
    expect(Object.isFrozen(statement)).toBe(true);
  });

  it('renders every verdict qualifier honestly', async () => {
    const subject = makeSubject();
    const suite = await makeSuite([verificationStage('v', DIGEST_C)]);
    expect(deriveCertificationStatement(subject, suite, 'not-satisfied', null).text).toContain(
      'did not satisfy',
    );
    expect(deriveCertificationStatement(subject, suite, 'unknown', null).text).toContain(
      'could not be determined against',
    );
    expect(VERDICT_QUALIFIERS.satisfied).toBe('satisfied');
  });

  it('carries declared constraints and the suite-declared limitations notice', async () => {
    const subject = makeSubject();
    const suite = await makeSuite([verificationStage('v', DIGEST_C)], {
      constraints: ['offline use only'],
      limitations: 'Custom notice: no sign-off authority.',
    });
    const statement = deriveCertificationStatement(subject, suite, 'satisfied', 'CONDITIONAL');
    expect(statement.text).toContain('conditional: offline use only');
    expect(statement.text).toContain('Custom notice: no sign-off authority.');
    expect(statement.grantedLevel).toBe('CONDITIONAL');
  });

  it('NEGATIVE (design law): unscoped rendering and unknown verdicts reject', async () => {
    const subject = makeSubject();
    const suite = await makeSuite([verificationStage('v', DIGEST_C)]);
    expect(() => deriveCertificationStatement(null as never, suite, 'satisfied', null)).toThrow(
      CertificationError,
    );
    expect(() =>
      deriveCertificationStatement(subject, null as never, 'satisfied', null),
    ).toThrow(CertificationError);
    expect(() =>
      deriveCertificationStatement(subject, suite, 'maybe' as never, null),
    ).toThrow(/closed vocabulary/);
    // a scope with an empty component is unrepresentable (tripwire)
    const broken = { ...subject, environmentRef: { ...ENVIRONMENT_REF, environmentId: '' } };
    expect(() => deriveCertificationStatement(broken as never, suite, 'satisfied', null)).toThrow(
      /scope component 'environment' is empty/,
    );
  });
});
