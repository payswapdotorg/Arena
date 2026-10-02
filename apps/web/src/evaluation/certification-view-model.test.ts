/**
 * Certification view-model tests (Work Order B012; issue #87).
 *
 * The structural heart of B012: certification renders ONLY as a
 * composition-scoped claim — the five-part tuple (Body Version ×
 * Substrate × Environment × Runtime × Suite) is non-optional on the
 * positive variant, so a bare-model claim is UNREPRESENTABLE. Revoked,
 * superseded and active postures project honestly; malformed or
 * subject-less records render as the incomplete variant with the
 * missing pieces named. The canonical read payload projects into the
 * claim summary with the B010 unknown-fields honesty.
 */

import { describe, expect, it } from 'vitest';

import type { CanonicalRead } from '../../../../packages/read-model/src/index.js';
import { toCertificationClaimSummary, toCertificationDetailView } from './certification-view-model.js';
import type {
  CertificationCompleteView,
  CertificationIncompleteView,
} from './certification-view-model.js';
import {
  buildEvaluationDemoCorpus,
  EVALUATION_DEMO_IDS,
} from './fixtures.js';

type CertificationDetail = ReturnType<typeof toCertificationDetailView>;

/** Narrow to the incomplete variant (the honest failure shape) for assertions. */
function asIncomplete(view: CertificationDetail): CertificationIncompleteView {
  if (view.kind !== 'incomplete-record') {
    throw new Error(`expected the incomplete-record variant, got ${String(view.kind)}`);
  }
  return view;
}

/** Narrow to the complete variant (the composition-scoped claim) for assertions. */
function asComplete(view: CertificationDetail): CertificationCompleteView {
  if (view.kind !== 'certification') {
    throw new Error(`expected the certification variant, got ${String(view.kind)}`);
  }
  return view;
}

describe('certification detail view projection (positive)', () => {
  it('renders run B as the complete composition-scoped claim (all five tuple parts prominent)', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const view = asComplete(
      toCertificationDetailView({
        record: corpus.certificationRunB,
        suite: corpus.suite,
        supersededRunDigests: [corpus.certificationRunA.digest],
        revocations: [corpus.revocation],
        certificationId: EVALUATION_DEMO_IDS.certificationRunB,
      }),
    );

    expect(view.truthClass).toBe('certification');
    expect(view.certificationId).toBe(EVALUATION_DEMO_IDS.certificationRunB);
    expect(view.digest).toBe(corpus.certificationRunB.digest);
    expect(view.scopeNote).toContain('never to a model in isolation');

    // THE composition tuple — every part required, none optional.
    expect(view.composition.bodyVersion).toEqual({
      tenant: 'arena-reference',
      name: 'software-engineer-body',
      version: '1.1.0',
      digest: corpus.certificationRunB.subject?.bodyVersionRef.digest,
    });
    expect(view.composition.substrate.substrateId).toBe('workspace-mount');
    expect(view.composition.substrate.substrateVersion).toBe('1.0.0');
    expect(view.composition.environment.environmentId).toBe('sandboxed-workspace');
    expect(view.composition.environment.constraints).toEqual(['network-denied-by-default']);
    expect(view.composition.runtime.runtimeId).toBe('arena-runtime');
    expect(view.composition.runtime.runtimeVersion).toBe('2.1.0');
    expect(view.composition.runtime.configuration).toBe('{"timeoutMs":30000}');
    expect(view.composition.suite.suiteId).toBe('suite-payments-reliability');
    expect(view.composition.suite.suiteVersion).toBe('1.0.0');
    expect(view.composition.suite.suiteRevision).toBe(corpus.suite.digest);
    expect(view.composition.suite.levelGrant).toBe('CERTIFIED');

    // The DERIVED verdict + the honestly CONDITIONAL level.
    expect(view.verdict).toBe('satisfied');
    expect(view.validity.posture).toBe('active');
    expect(view.validity.grantedLevel).toBe('CONDITIONAL');
    expect(view.validity.supersedes).toBe(corpus.certificationRunA.digest);
    expect(view.validity.revocation).toBeUndefined();
    expect(view.validity.note).toContain('never a wall-clock expiry');

    // The DERIVED scoped statement, verbatim.
    expect(view.statement.text).toContain('software-engineer-body');
    expect(view.statement.scope.body).toBe('arena-reference/software-engineer-body@1.1.0');
    expect(view.statement.scope.suite).toBe('suite-payments-reliability@1.0.0');
    expect(view.statement.constraints).toHaveLength(1);

    // Stage results with their suite-declared kinds; the evidence-backed
    // stages carry their evidence digests (the composition stage pins the
    // composition itself — no separate evidence digest).
    expect(view.stages).toHaveLength(3);
    expect(view.stages.map((stage) => stage.kind)).toEqual([
      'evaluation',
      'verification',
      'composition',
    ]);
    for (const stage of view.stages) {
      expect(stage.outcome).toBe('satisfied');
    }
    expect(view.stages[0]?.evidenceDigest).toBeTruthy();
    expect(view.stages[1]?.evidenceDigest).toBeTruthy();
    expect(view.stages[0]?.evidenceDigest).toBe(corpus.evaluationRecord.digest);
    expect(view.stages[1]?.evidenceDigest).toBe(corpus.verificationRecord.digest);
  });

  it('renders run A with the REVOKED posture and its recorded grounds (never a silent deletion)', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const view = asComplete(
      toCertificationDetailView({
        record: corpus.certificationRunA,
        suite: corpus.suite,
        supersededRunDigests: [corpus.certificationRunA.digest],
        revocations: [corpus.revocation],
        certificationId: EVALUATION_DEMO_IDS.certificationRunA,
      }),
    );
    expect(view.validity.posture).toBe('revoked');
    expect(view.validity.revocation?.grounds).toContain('mis-declared');
    expect(view.validity.revocation?.recordedAt).toBe('2026-10-01T08:20:00.000Z');
  });

  it('projects the SUPERSEDED posture when no revocation exists', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const view = asComplete(
      toCertificationDetailView({
        record: corpus.certificationRunA,
        suite: corpus.suite,
        supersededRunDigests: [corpus.certificationRunA.digest],
        revocations: [],
      }),
    );
    expect(view.validity.posture).toBe('superseded');
  });
});

describe('certification detail view projection (adversarial — bare-model claims are unrenderable)', () => {
  it('degrades a structurally unreadable record to the incomplete variant', async () => {
    for (const malformed of [null, 3, 'record', {}, { recordVersion: 42 }]) {
      const view = asIncomplete(toCertificationDetailView({ record: malformed }));
      expect(view.truthClass).toBe('unknown');
      expect(view.digest).toBeNull();
      expect(view.missing).toContain('certification record (structurally unreadable)');
      expect(view.note).toContain('never fabricated');
    }
  });

  it('renders a revocation RECORD as incomplete (it is not a certification claim)', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const view = asIncomplete(
      toCertificationDetailView({ record: corpus.revocation, suite: corpus.suite }),
    );
    expect(view.missing).toContain('certification run (record is a revocation)');
  });

  it('renders a run record WITHOUT its suite as incomplete — the tuple cannot be completed', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const view = asIncomplete(toCertificationDetailView({ record: corpus.certificationRunB }));
    expect(view.missing).toEqual(['suite (the certification suite)']);
  });

  it('renders a subject-LESS run record as incomplete — a bare-model claim is unrepresentable', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    // A run record with the subject stripped: the A023 public API cannot
    // produce this, and the package's OWN structural guard rejects it —
    // so the projection receives an unreadable record and renders the
    // incomplete variant. The view layer double-guards the same law.
    const subjectless = {
      ...(corpus.certificationRunB as unknown as Record<string, unknown>),
      subject: null,
    };
    const view = asIncomplete(
      toCertificationDetailView({ record: subjectless, suite: corpus.suite }),
    );
    expect(view.truthClass).toBe('unknown');
    expect(
      view.missing.includes('certification record (structurally unreadable)') ||
        view.missing.includes('subject (the tested composition)'),
    ).toBe(true);
  });
});

describe('certification claim summary (the canonical read payload, B010 honesty pattern)', () => {
  /** Build one canonical certification read for the tests. */
  function certificationRead(data: unknown, recordId = 'demo.certification.x'): CanonicalRead {
    return {
      recordVersion: 1,
      recordId,
      tenantId: 'arena-demo',
      kind: 'certification',
      sourceVersion: 1,
      sourceRevision: 1,
      data,
      provenance: { createdAt: 1790841600000, updatedAt: 1790841600000 },
      readAt: 1790841600000,
    } as CanonicalRead;
  }

  it('projects the demo-shaped payload with the certification truth class', () => {
    const view = toCertificationClaimSummary(
      certificationRead({
        demoTime: '2026-10-01T08:00:00.000Z',
        certificationId: 'cert-software-engineer-1-1-0',
        subject: { bodyId: 'body-software-engineer', bodyVersion: '1.1.0' },
        certificationKind: 'body-release',
        verdict: 'certified',
        basis: 'evaluation pass + independent verification pass',
        certifiedAt: '2026-10-01T08:00:00.000Z',
      }),
    );
    expect(view.certificationId).toBe('cert-software-engineer-1-1-0');
    expect(view.subject).toEqual({ bodyId: 'body-software-engineer', bodyVersion: '1.1.0' });
    expect(view.certificationKind).toBe('body-release');
    expect(view.verdict).toBe('certified');
    expect(view.truthClass).toBe('certification');
    expect(view.unknownFields).toEqual([]);
    expect(view.scopeNote).toContain('never to a model in isolation');
  });

  it('lists missing payload fields as unknown — nothing is fabricated', () => {
    const view = toCertificationClaimSummary(certificationRead({ verdict: 'certified' }));
    expect(view.certificationId).toBeUndefined();
    expect(view.subject).toBeUndefined();
    expect(view.verdict).toBe('certified');
    expect(view.unknownFields).toContain('certificationId');
    expect(view.unknownFields).toContain('subject (bodyId@bodyVersion)');
    expect(view.unknownFields).toContain('basis');
  });

  it('rejects a non-certification read with the typed projection failure', () => {
    expect(() =>
      toCertificationClaimSummary({
        ...certificationRead({}),
        kind: 'agent-body',
      }),
    ).toThrow('certification');
  });
});
