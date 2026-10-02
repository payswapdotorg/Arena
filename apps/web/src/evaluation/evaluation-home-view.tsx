/**
 * EvaluationHomeView — the presentational `/evaluation` surface (Work
 * Order B012; issue #87; apps/web/src/evaluation).
 *
 * SYNC presentational component (renderable through react-dom/server in
 * the house test style): the async composition (session probe, canonical
 * reads, protocol reads) happens in the evaluation-route helpers, and
 * this component renders the resulting view model deterministically.
 *
 * THE governing truths rendered here:
 *   - Evaluation ≠ Verification ≠ Certification — the distinction banner
 *     is ALWAYS visible, and every row carries its OWN truth-class mark;
 *   - an evaluation result NEVER renders as verified; verification
 *     renders with its verifier identity and scope; certification
 *     renders as the composition-scoped claim (the five-part tuple);
 *   - claims read through the canonical read path render their honest
 *     unknown fields — nothing is fabricated to fill the space;
 *   - demo mode renders under the B006 labelling contract.
 */

import {
  DemoDataBadge,
  EmptyState,
  PageHeader,
  TruthBadge,
} from '@arena/ui-platform';
import type { StateKind } from '@arena/ui-platform';
import { DEMO_LABELLING } from '@arena/demo';
import { isBadgeTreatment } from './state-mark.js';
import type { TruthTreatment } from './state-mark.js';
import type { EvaluationHomeViewModel } from './evaluation-route.js';
import type { CertificationClaimSummary, CertificationDetailView } from './certification-view-model.js';
import type { EvaluationReportView } from './evaluation-view-model.js';
import type { VerificationDetailView } from './verification-view-model.js';

/** Render one maybe-unknown value (unknown stays unknown — never guessed). */
export function Maybe(props: { readonly value: string | undefined }) {
  if (props.value === undefined) {
    return <span className="evaluation-unknown" data-arena-unknown="true">Unknown</span>;
  }
  return <span>{props.value}</span>;
}

/** The distinct mark for the honesty-critical kinds B001 has no badge for (pending/unknown). */
export function EvaluationTruthMark(props: {
  readonly treatment: TruthTreatment;
  readonly label: string;
  readonly meaning: string;
}) {
  const { treatment, label, meaning } = props;
  if (isBadgeTreatment(treatment)) {
    return <TruthBadge kind={treatment as StateKind} />;
  }
  return (
    <span
      className="evaluation-truth evaluation-truth--pending-unknown"
      data-arena-truth={treatment}
      title={meaning}
    >
      <span className="evaluation-truth__marker" aria-hidden="true" />
      <span className="evaluation-truth__label">{label}</span>
    </span>
  );
}

/** One evaluation report row: suite identity + aggregate + the evaluation-result mark. */
function ReportRow(props: {
  readonly view: EvaluationHomeViewModel;
  readonly report: EvaluationReportView;
}) {
  const { view, report } = props;
  const suite =
    report.suite.criteriaId !== undefined
      ? `${report.suite.criteriaId}@${String(report.suite.criteriaVersion ?? 'unknown')}`
      : 'suite unknown';
  return (
    <tr className="evaluation-report-row" data-arena-report={report.reportId}>
      <td>
        <a href={`${view.reportHrefBase}/${encodeURIComponent(report.reportId)}`}>
          {report.reportId}
        </a>
      </td>
      <td data-arena-report-suite={suite}>
        <Maybe value={report.suite.criteriaId !== undefined ? suite : undefined} />
      </td>
      <td><Maybe value={report.suite.evaluatorKind} /></td>
      <td data-arena-report-aggregate={report.aggregate !== null ? String(report.aggregate.outcome) : 'unknown'}>
        {report.aggregate !== null ? (
          <>
            <TruthBadge kind="evaluation" />
            {view.demo.isDemo ? <DemoDataBadge /> : null}{' '}
            {String(report.aggregate.score)} ({String(report.aggregate.outcome)})
          </>
        ) : (
          <>
            <TruthBadge kind="evaluation" /> <Maybe value={undefined} />
          </>
        )}
      </td>
      <td><Maybe value={report.runConditions.startedAt} /></td>
    </tr>
  );
}

/** One verification record row: verifier identity + outcome + the verification's own truth class. */
function VerificationRow(props: {
  readonly view: EvaluationHomeViewModel;
  readonly verification: VerificationDetailView;
}) {
  const { view, verification } = props;
  const verifier =
    verification.verifier.verifierId !== undefined
      ? `${verification.verifier.verifierId}@${String(verification.verifier.version ?? 'unknown')}`
      : undefined;
  return (
    <tr className="evaluation-verification-row" data-arena-verification={verification.verificationId}>
      <td>
        <a href={`${view.verificationHrefBase}/${encodeURIComponent(verification.verificationId)}`}>
          {verification.verificationId}
        </a>
      </td>
      <td data-arena-verification-verifier={verifier ?? 'unknown'}>
        <Maybe value={verifier} />
      </td>
      <td><Maybe value={verification.verifier.method} /></td>
      <td data-arena-verification-outcome={verification.outcome ?? 'unknown'}>
        <EvaluationTruthMark
          treatment={verification.truthClass === 'verified-fact' ? 'verified' : 'unknown'}
          label={verification.truthClass === 'verified-fact' ? 'Verified fact' : 'Unknown'}
          meaning={
            verification.truthClass === 'verified-fact'
              ? 'A claim checked against its evidence by the named verifier.'
              : 'The verifier could not decide — rendered as unknown, never guessed.'
          }
        />
        {view.demo.isDemo ? <DemoDataBadge /> : null}{' '}
        {String(verification.outcome ?? 'unknown')}
      </td>
      <td>{String(verification.requirements.length)}</td>
    </tr>
  );
}

/** One certification run row: the composition tuple summary + posture + the certification mark. */
function CertificationRow(props: {
  readonly view: EvaluationHomeViewModel;
  readonly certification: CertificationDetailView;
}) {
  const { view, certification } = props;
  if (certification.kind !== 'certification') {
    return (
      <tr className="evaluation-certification-row evaluation-certification-row--incomplete" data-arena-certification={certification.certificationId} data-arena-certification-readable="false">
        <td>{certification.certificationId}</td>
        <td colSpan={4}>
          <EvaluationTruthMark treatment="unknown" label="Unknown" meaning={certification.note} />
          {' '}
          Incomplete record: {certification.missing.join(', ')}
        </td>
      </tr>
    );
  }
  const tuple = [
    `${certification.composition.bodyVersion.tenant}/${certification.composition.bodyVersion.name}@${certification.composition.bodyVersion.version}`,
    certification.composition.substrate.substrateId,
    certification.composition.environment.environmentId,
    certification.composition.runtime.runtimeId,
    `${certification.composition.suite.suiteId}@${certification.composition.suite.suiteVersion}`,
  ].join(' × ');
  return (
    <tr
      className="evaluation-certification-row"
      data-arena-certification={certification.certificationId}
      data-arena-certification-posture={certification.validity.posture}
      data-arena-certification-readable="true"
    >
      <td>
        <a href={`${view.certificationHrefBase}/${encodeURIComponent(certification.certificationId)}`}>
          {certification.certificationId}
        </a>
      </td>
      <td data-arena-certification-tuple={tuple}>
        <span className="evaluation-tuple-summary">{tuple}</span>
      </td>
      <td data-arena-certification-level={certification.validity.grantedLevel ?? 'none'}>
        {certification.validity.grantedLevel ?? 'no grant'}
      </td>
      <td data-arena-certification-posture={certification.validity.posture}>
        {certification.validity.posture}
      </td>
      <td>
        <TruthBadge kind="certification" />
        {view.demo.isDemo ? <DemoDataBadge /> : null}
      </td>
    </tr>
  );
}

/** One claim read through the canonical read path (the B010 honesty pattern). */
function ClaimRow(props: { readonly claim: CertificationClaimSummary; readonly demo: boolean }) {
  const { claim, demo } = props;
  return (
    <li
      className="evaluation-claim"
      data-arena-claim={claim.recordId}
      data-arena-claim-scope={claim.subject !== undefined ? `${claim.subject.bodyId}@${claim.subject.bodyVersion}` : 'unknown'}
    >
      <div className="evaluation-claim__head">
        <strong>{claim.certificationId ?? claim.recordId}</strong>
        <TruthBadge kind="certification" />
        {demo ? <DemoDataBadge /> : null}
      </div>
      <p className="evaluation-claim__scope">
        Claim scope:{' '}
        <code>
          {claim.subject !== undefined
            ? `${claim.subject.bodyId}@${claim.subject.bodyVersion} (tested composition)`
            : 'subject unknown'}
        </code>{' '}
        — verdict <Maybe value={claim.verdict} />
      </p>
      {claim.basis !== undefined ? <p className="evaluation-claim__basis">Basis: {claim.basis}</p> : null}
      {claim.unknownFields.length > 0 ? (
        <p className="evaluation-claim__unknown" data-arena-claim-unknown="true">
          Unknown fields (rendered as unknown, never fabricated): {claim.unknownFields.join(', ')}.
        </p>
      ) : null}
      <p className="evaluation-claim__note">{claim.scopeNote}</p>
    </li>
  );
}

export function EvaluationHomeView({ view }: { readonly view: EvaluationHomeViewModel }) {
  return (
    <div className="evaluation-surface" data-arena-route="evaluation" data-arena-surface-mode={view.mode}>
      <PageHeader
        title="Evaluation, verification & certification"
        description="Evaluation scores a run against explicit criteria; verification establishes evidence support; certification claims a tested composition. Three truth classes, never one 'AI result'."
      />

      {view.demo.isDemo ? (
        <section className="evaluation-demo-banner" aria-label="Demo mode notice" data-arena-demo-banner="true">
          <DemoDataBadge note="deterministic seed" />
          <p>
            <strong>{DEMO_LABELLING.bannerTitle}.</strong> {DEMO_LABELLING.bannerText}
          </p>
        </section>
      ) : null}

      <section
        className="evaluation-distinction"
        aria-label="Evaluation, verification and certification distinction"
        data-arena-evaluation-distinction="true"
      >
        <p>{view.distinctionNote}</p>
      </section>

      <section className="evaluation-reports" aria-labelledby="evaluation-reports-title" data-arena-reports-section="true">
        <h2 id="evaluation-reports-title">Evaluation reports</h2>
        {view.reports.length === 0 ? (
          <EmptyState
            title="No evaluation runs recorded yet"
            hint="Evaluation reports are append-only A012 records scored against explicit, versioned criteria. In this workspace posture none are recorded yet — nothing is fabricated to fill the space."
          />
        ) : (
          <div className="evaluation-reports__scroll" role="region" aria-label="Evaluation reports table" tabIndex={0}>
            <table className="evaluation-reports__table">
              <thead>
                <tr>
                  <th scope="col">Report</th>
                  <th scope="col">Criteria set</th>
                  <th scope="col">Evaluator kind</th>
                  <th scope="col">Aggregate</th>
                  <th scope="col">Started</th>
                </tr>
              </thead>
              <tbody>
                {view.reports.map((report) => (
                  <ReportRow key={report.reportId} view={view} report={report} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="evaluation-verifications" aria-labelledby="evaluation-verifications-title" data-arena-verifications-section="true">
        <h2 id="evaluation-verifications-title">Verification records</h2>
        {view.verifications.length === 0 ? (
          <EmptyState
            title="No verification runs recorded yet"
            hint="Verification records establish which required evidence exists and supports which claims (pass | fail | unknown — never a score). None are recorded in this posture."
          />
        ) : (
          <div className="evaluation-verifications__scroll" role="region" aria-label="Verification records table" tabIndex={0}>
            <table className="evaluation-verifications__table">
              <thead>
                <tr>
                  <th scope="col">Record</th>
                  <th scope="col">Verifier</th>
                  <th scope="col">Method</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Requirements</th>
                </tr>
              </thead>
              <tbody>
                {view.verifications.map((verification) => (
                  <VerificationRow key={verification.verificationId} view={view} verification={verification} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="evaluation-certifications" aria-labelledby="evaluation-certifications-title" data-arena-certifications-section="true">
        <h2 id="evaluation-certifications-title">Certification runs</h2>
        {view.certifications.length === 0 ? (
          <EmptyState
            title="No certification runs recorded yet"
            hint="A certification run evaluates one Body Version × Substrate × Environment × Runtime × Suite composition. None are recorded in this posture."
          />
        ) : (
          <div className="evaluation-certifications__scroll" role="region" aria-label="Certification runs table" tabIndex={0}>
            <table className="evaluation-certifications__table">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Tested composition</th>
                  <th scope="col">Granted level</th>
                  <th scope="col">Posture</th>
                  <th scope="col">Truth class</th>
                </tr>
              </thead>
              <tbody>
                {view.certifications.map((certification) => (
                  <CertificationRow key={certification.certificationId} view={view} certification={certification} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="evaluation-claims" aria-labelledby="evaluation-claims-title" data-arena-claims-section="true">
        <h2 id="evaluation-claims-title">Certification claims (canonical read path)</h2>
        {view.claims.length === 0 ? (
          <EmptyState
            title="No certification claims in the record store"
            hint="Claims read through the B005 read path render whatever the record store actually holds — nothing is fabricated."
          />
        ) : (
          <ul className="evaluation-claims__list">
            {view.claims.map((claim) => (
              <ClaimRow key={claim.recordId} claim={claim} demo={view.demo.isDemo} />
            ))}
          </ul>
        )}
      </section>

      <section className="evaluation-legend" aria-labelledby="evaluation-legend-title" data-arena-truth-legend="true">
        <h2 id="evaluation-legend-title">Truth classes on this surface</h2>
        <p className="evaluation-legend__note">
          Every datum carries one of these classes — no generic "AI result" badge exists.
        </p>
        <ul className="evaluation-legend__list">
          {view.legend.map((mark) => (
            <li key={mark.truthClass} className="evaluation-legend__row" data-arena-truth-class={mark.truthClass}>
              <EvaluationTruthMark treatment={mark.treatment} label={mark.label} meaning={mark.meaning} />
              <span className="evaluation-legend__meaning">{mark.meaning}</span>
            </li>
          ))}
        </ul>
      </section>

      <aside className="evaluation-inspector" aria-label="Surface facts" data-arena-surface-inspector="true">
        <h2>Surface facts</h2>
        <dl className="evaluation-inspector__facts">
          <div><dt>Tenant</dt><dd><code>{view.tenantId}</code></dd></div>
          <div><dt>Workspace</dt><dd><code>{view.workspaceId}</code></dd></div>
          <div><dt>Reports</dt><dd>{String(view.reports.length)}</dd></div>
          <div><dt>Verifications</dt><dd>{String(view.verifications.length)}</dd></div>
          <div><dt>Certification runs</dt><dd>{String(view.certifications.length)}</dd></div>
          <div><dt>Claims (read path)</dt><dd>{String(view.claims.length)}</dd></div>
          <div><dt>Read at</dt><dd>{view.readAt > 0 ? new Date(view.readAt).toISOString() : 'Unknown'}</dd></div>
        </dl>
        {view.demo.isDemo && view.demo.corpusHash !== undefined ? (
          <p className="evaluation-inspector__hash" data-arena-corpus-hash="true">
            Demo corpus hash: <code>{view.demo.corpusHash.slice(0, 72)}…</code>
          </p>
        ) : null}
      </aside>
    </div>
  );
}
