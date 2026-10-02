/**
 * Evaluation detail views (Work Order B012; issue #87;
 * apps/web/src/evaluation). SYNC presentational components.
 *
 *   - EvaluationReportDetailView: scores WITH their suite identity, the
 *     run conditions, and the honest not-verified framing — an
 *     evaluation result never renders as verified;
 *   - VerificationRecordView: the verifier identity, the scope, the
 *     per-requirement verdicts, and the append-only evidence addresses —
 *     verification never renders a score;
 *   - CertificationRunView: the composition tuple PROMINENT (all five
 *     parts), the derived verdict + honestly CONDITIONAL level, the
 *     append-only validity posture with revocation grounds, and the
 *     derived scoped statement — a bare-model claim is unrenderable; an
 *     incomplete record renders as the honest incomplete variant.
 */

import {
  DemoDataBadge,
  DeniedState,
  EmptyState,
  PageHeader,
  TruthBadge,
} from '@arena/ui-platform';
import { DEMO_LABELLING } from '@arena/demo';
import { EvaluationTruthMark, Maybe } from './evaluation-home-view.js';
import type { EvaluationReportView } from './evaluation-view-model.js';
import type { VerificationDetailView } from './verification-view-model.js';
import type { CertificationDetailView } from './certification-view-model.js';

/** The shared demo banner (the view's own layer on top of the /demo layout banner). */
function DemoBanner() {
  return (
    <section className="evaluation-demo-banner" aria-label="Demo mode notice" data-arena-demo-banner="true">
      <DemoDataBadge note="deterministic seed" />
      <p>
        <strong>{DEMO_LABELLING.bannerTitle}.</strong> {DEMO_LABELLING.bannerText}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Evaluation report detail
// ---------------------------------------------------------------------------

export function EvaluationReportDetailView(props: {
  readonly view: EvaluationReportView;
  readonly demo: boolean;
}) {
  const { view, demo } = props;
  return (
    <div className="evaluation-surface evaluation-surface--report" data-arena-route="evaluation-report" data-arena-surface-mode={demo ? 'demo' : 'session'} data-arena-report={view.reportId}>
      <PageHeader
        title="Evaluation report"
        description={`An append-once A012 record: ${view.reportId}.`}
      />
      {demo ? <DemoBanner /> : null}

      <section className="evaluation-report-truth" aria-label="Truth class" data-arena-report-truth="evaluation-result">
        <TruthBadge kind="evaluation" />
        {demo ? <DemoDataBadge /> : null}
        <p className="evaluation-report-truth__note">{view.notVerifiedNote}</p>
      </section>

      <section className="evaluation-report-suite" aria-labelledby="evaluation-report-suite-title" data-arena-report-suite-section="true">
        <h2 id="evaluation-report-suite-title">Suite identity</h2>
        <dl className="evaluation-report-suite__facts">
          <div><dt>Criteria set</dt><dd data-arena-suite-criteria={view.suite.criteriaId ?? 'unknown'}><Maybe value={view.suite.criteriaId !== undefined ? `${view.suite.criteriaId}@${String(view.suite.criteriaVersion ?? 'unknown')}` : undefined} /></dd></div>
          <div><dt>Aggregation policy</dt><dd><Maybe value={view.suite.aggregation} /></dd></div>
          <div><dt>Pass bar</dt><dd>{view.suite.passAt !== undefined ? String(view.suite.passAt) : <Maybe value={undefined} />}</dd></div>
          <div><dt>Evaluator</dt><dd data-arena-suite-evaluator={view.suite.evaluatorId ?? 'unknown'}><Maybe value={view.suite.evaluatorId !== undefined ? `${view.suite.evaluatorId}@${String(view.suite.evaluatorVersion ?? 'unknown')}` : undefined} /></dd></div>
          <div><dt>Evaluator kind</dt><dd><Maybe value={view.suite.evaluatorKind} /></dd></div>
          <div><dt>Criteria digest</dt><dd><code><Maybe value={view.suite.criteriaRef} /></code></dd></div>
          <div><dt>Evaluator digest</dt><dd><code><Maybe value={view.suite.evaluatorRef} /></code></dd></div>
        </dl>
      </section>

      <section className="evaluation-report-metrics" aria-labelledby="evaluation-report-metrics-title" data-arena-report-metrics="true">
        <h2 id="evaluation-report-metrics-title">Scores</h2>
        <div className="evaluation-report-metrics__scroll" role="region" aria-label="Metric rows table" tabIndex={0}>
          <table className="evaluation-report-metrics__table">
            <thead>
              <tr>
                <th scope="col">Criterion</th>
                <th scope="col">Weight</th>
                <th scope="col">Score</th>
                <th scope="col">Judgment</th>
                <th scope="col">Meets bar</th>
              </tr>
            </thead>
            <tbody>
              {view.metrics.map((metric) => (
                <tr key={String(metric.criterionId)} data-arena-metric={String(metric.criterionId)} data-arena-metric-score={metric.score !== undefined ? String(metric.score) : 'unknown'}>
                  <td>
                    <code>{String(metric.criterionId)}</code>
                    {metric.description !== undefined ? (
                      <p className="evaluation-metric__description">{metric.description}</p>
                    ) : null}
                  </td>
                  <td>{metric.weight !== undefined ? String(metric.weight) : <Maybe value={undefined} />}</td>
                  <td>{metric.score !== undefined ? String(metric.score) : <Maybe value={undefined} />}</td>
                  <td><Maybe value={metric.judgment} /></td>
                  <td data-arena-metric-pass={metric.meetsThreshold === null ? 'unknown' : String(metric.meetsThreshold)}>
                    {metric.meetsThreshold === null ? <Maybe value={undefined} /> : String(metric.meetsThreshold)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="evaluation-report-metrics__aggregate" data-arena-report-aggregate={view.aggregate !== null ? String(view.aggregate.outcome) : 'unknown'}>
          Aggregate:{' '}
          {view.aggregate !== null
            ? `${String(view.aggregate.score)} — ${String(view.aggregate.outcome)} (per ${String(view.suite.aggregation ?? 'unknown policy')})`
            : 'Unknown'}
          {view.confidence !== undefined ? ` · confidence ${String(view.confidence)}` : ''}
        </p>
        {view.limitations !== undefined ? (
          <p className="evaluation-report-metrics__limitations" data-arena-report-limitations="true">
            Limitations: {view.limitations}
          </p>
        ) : null}
      </section>

      <section className="evaluation-report-conditions" aria-labelledby="evaluation-report-conditions-title" data-arena-report-conditions="true">
        <h2 id="evaluation-report-conditions-title">Run conditions</h2>
        <dl className="evaluation-report-conditions__facts">
          <div><dt>Seed</dt><dd><code><Maybe value={view.runConditions.seed} /></code></dd></div>
          <div><dt>Deterministic</dt><dd>{view.runConditions.deterministic !== undefined ? String(view.runConditions.deterministic) : <Maybe value={undefined} />}</dd></div>
          <div><dt>Seeded</dt><dd>{view.runConditions.seeded !== undefined ? String(view.runConditions.seeded) : <Maybe value={undefined} />}</dd></div>
          <div><dt>Requires human</dt><dd>{view.runConditions.requiresHuman !== undefined ? String(view.runConditions.requiresHuman) : <Maybe value={undefined} />}</dd></div>
          <div><dt>Started</dt><dd><Maybe value={view.runConditions.startedAt} /></dd></div>
          <div><dt>Finished</dt><dd><Maybe value={view.runConditions.finishedAt} /></dd></div>
          <div><dt>Executed by</dt><dd><Maybe value={view.runConditions.executedBy} /></dd></div>
          <div><dt>Recorded at</dt><dd><Maybe value={view.runConditions.recordedAt} /></dd></div>
          <div><dt>Case digest</dt><dd><code><Maybe value={view.subjects.caseRef} /></code></dd></div>
          <div><dt>Trajectory digest</dt><dd><code><Maybe value={view.subjects.trajectoryRef} /></code></dd></div>
          <div><dt>Body digest</dt><dd><code><Maybe value={view.subjects.bodyRef} /></code></dd></div>
          <div><dt>Substrate digest</dt><dd><code><Maybe value={view.subjects.substrateRef} /></code></dd></div>
          <div><dt>Record digest</dt><dd><code>{view.digest ?? 'unreadable'}</code></dd></div>
        </dl>
        {view.unknownFields.length > 0 ? (
          <p className="evaluation-report-conditions__unknown" data-arena-report-unknown="true">
            Unknown fields (rendered as unknown, never fabricated): {view.unknownFields.join(', ')}.
          </p>
        ) : null}
      </section>

      <p className="evaluation-detail__back">
        <a href={demo ? '/demo/evaluation' : '/evaluation'}>Back to the evaluation surface</a>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verification detail
// ---------------------------------------------------------------------------

export function VerificationRecordView(props: {
  readonly view: VerificationDetailView;
  readonly demo: boolean;
}) {
  const { view, demo } = props;
  return (
    <div className="evaluation-surface evaluation-surface--verification" data-arena-route="evaluation-verification" data-arena-surface-mode={demo ? 'demo' : 'session'} data-arena-verification={view.verificationId}>
      <PageHeader
        title="Verification record"
        description={`An append-once A013 record: ${view.verificationId}.`}
      />
      {demo ? <DemoBanner /> : null}

      <section className="evaluation-verification-truth" aria-label="Truth class" data-arena-verification-truth={view.truthClass}>
        <EvaluationTruthMark
          treatment={view.truthClass === 'verified-fact' ? 'verified' : 'unknown'}
          label={view.truthClass === 'verified-fact' ? 'Verified fact' : 'Unknown'}
          meaning={
            view.truthClass === 'verified-fact'
              ? 'A claim checked against its evidence by the named verifier.'
              : 'The verifier could not decide — rendered as unknown, never guessed.'
          }
        />
        {demo ? <DemoDataBadge /> : null}
        <p className="evaluation-verification-truth__note">{view.notEvaluationNote}</p>
        <p className="evaluation-verification-truth__outcome" data-arena-verification-outcome={view.outcome ?? 'unknown'}>
          Derived outcome: <strong>{String(view.outcome ?? 'unknown')}</strong>
          {view.unknownCause !== undefined
            ? ` — ${view.unknownCause.reason}: ${view.unknownCause.detail}`
            : ''}
        </p>
      </section>

      <section className="evaluation-verification-verifier" aria-labelledby="evaluation-verification-verifier-title" data-arena-verification-verifier-section="true">
        <h2 id="evaluation-verification-verifier-title">Verifier identity</h2>
        <dl className="evaluation-verification-verifier__facts">
          <div><dt>Verifier</dt><dd data-arena-verifier-id={view.verifier.verifierId ?? 'unknown'}><Maybe value={view.verifier.verifierId !== undefined ? `${view.verifier.verifierId}@${String(view.verifier.version ?? 'unknown')}` : undefined} /></dd></div>
          <div><dt>Method</dt><dd><Maybe value={view.verifier.method} /></dd></div>
          <div><dt>Reproducibility</dt><dd><Maybe value={view.verifier.reproducibility} /></dd></div>
          <div><dt>Verifier digest</dt><dd><code><Maybe value={view.verifier.verifierRef} /></code></dd></div>
        </dl>
        {view.verifier.semantics !== undefined ? (
          <details className="evaluation-verification-verifier__semantics" data-arena-verifier-semantics="true">
            <summary>Declared outcome semantics</summary>
            <dl>
              <div><dt>pass</dt><dd>{view.verifier.semantics.pass}</dd></div>
              <div><dt>fail</dt><dd>{view.verifier.semantics.fail}</dd></div>
              <div><dt>unknown</dt><dd>{view.verifier.semantics.unknown}</dd></div>
            </dl>
          </details>
        ) : null}
      </section>

      <section className="evaluation-verification-scope" aria-labelledby="evaluation-verification-scope-title" data-arena-verification-scope="true">
        <h2 id="evaluation-verification-scope-title">Scope — declared requirements</h2>
        <div className="evaluation-verification-scope__scroll" role="region" aria-label="Requirement support table" tabIndex={0}>
          <table className="evaluation-verification-scope__table">
            <thead>
              <tr>
                <th scope="col">Requirement</th>
                <th scope="col">Claim</th>
                <th scope="col">Evidence kind</th>
                <th scope="col">Support</th>
                <th scope="col">Evidence digest</th>
              </tr>
            </thead>
            <tbody>
              {view.requirements.map((requirement) => (
                <tr key={String(requirement.requirementId)} data-arena-requirement={String(requirement.requirementId)} data-arena-requirement-status={requirement.status ?? 'unknown'}>
                  <td><code>{String(requirement.requirementId)}</code></td>
                  <td><Maybe value={requirement.claim} /></td>
                  <td><Maybe value={requirement.evidenceKind} /></td>
                  <td><Maybe value={requirement.status} /></td>
                  <td><code><Maybe value={requirement.evidenceDigest} /></code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="evaluation-verification-evidence" aria-labelledby="evaluation-verification-evidence-title" data-arena-verification-evidence="true">
        <h2 id="evaluation-verification-evidence-title">Evidence addresses (append-only)</h2>
        <ol className="evaluation-verification-evidence__list">
          {view.evidence.map((address) => (
            <li key={address.key} className="evaluation-evidence-address" data-arena-evidence-address={address.key}>
              <code>{address.key}</code>
              <p className="evaluation-evidence-address__provenance">
                produced by <Maybe value={address.producedBy} /> at <Maybe value={address.producedAt} />
                {address.notes !== undefined ? ` — ${address.notes}` : ''}
              </p>
            </li>
          ))}
        </ol>
        {view.evidence.length === 0 ? (
          <EmptyState
            title="No evidence bundle on this record"
            hint="The append-only evidence bundle is empty or unreadable — rendered as-is, never fabricated."
          />
        ) : null}
      </section>

      <section className="evaluation-verification-run" aria-labelledby="evaluation-verification-run-title" data-arena-verification-run="true">
        <h2 id="evaluation-verification-run-title">Run facts</h2>
        <dl className="evaluation-verification-run__facts">
          <div><dt>Correlation id</dt><dd><code><Maybe value={view.correlationId} /></code></dd></div>
          <div><dt>Idempotency key</dt><dd><code><Maybe value={view.idempotencyKey} /></code></dd></div>
          <div><dt>Input digest</dt><dd><code><Maybe value={view.inputDigest} /></code></dd></div>
          <div><dt>Started</dt><dd><Maybe value={view.startedAt} /></dd></div>
          <div><dt>Finished</dt><dd><Maybe value={view.finishedAt} /></dd></div>
          <div><dt>Executed by</dt><dd><Maybe value={view.executedBy} /></dd></div>
          <div><dt>Recorded at</dt><dd><Maybe value={view.recordedAt} /></dd></div>
          <div><dt>Record digest</dt><dd><code>{view.digest ?? 'unreadable'}</code></dd></div>
        </dl>
        {view.unknownFields.length > 0 ? (
          <p className="evaluation-verification-run__unknown" data-arena-verification-unknown="true">
            Unknown fields (rendered as unknown, never fabricated): {view.unknownFields.join(', ')}.
          </p>
        ) : null}
      </section>

      <p className="evaluation-detail__back">
        <a href={demo ? '/demo/evaluation' : '/evaluation'}>Back to the evaluation surface</a>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Certification detail
// ---------------------------------------------------------------------------

export function CertificationRunView(props: {
  readonly view: CertificationDetailView;
  readonly demo: boolean;
}) {
  const { view, demo } = props;

  if (view.kind !== 'certification') {
    return (
      <div className="evaluation-surface evaluation-surface--certification-incomplete" data-arena-route="evaluation-certification" data-arena-surface-mode={demo ? 'demo' : 'session'} data-arena-certification={view.certificationId} data-arena-certification-readable="false">
        <PageHeader
          title="Certification record incomplete"
          description={`Record ${view.certificationId} cannot render as a certification.`}
        />
        {demo ? <DemoBanner /> : null}
        <DeniedState
          message={view.note}
          requiredAuthority="the full tested composition (Body Version × Substrate × Environment × Runtime × Suite)"
        />
        <p className="evaluation-certification__missing" data-arena-certification-missing="true">
          Missing pieces: {view.missing.join(', ')}.
        </p>
        <p className="evaluation-certification__scope-note">{view.scopeNote}</p>
        <p className="evaluation-detail__back">
          <a href={demo ? '/demo/evaluation' : '/evaluation'}>Back to the evaluation surface</a>
        </p>
      </div>
    );
  }

  const tuple = view.composition;
  return (
    <div className="evaluation-surface evaluation-surface--certification" data-arena-route="evaluation-certification" data-arena-surface-mode={demo ? 'demo' : 'session'} data-arena-certification={view.certificationId} data-arena-certification-readable="true" data-arena-certification-posture={view.validity.posture}>
      <PageHeader
        title="Certification claim"
        description={`An append-once A023 record: ${view.certificationId}.`}
      />
      {demo ? <DemoBanner /> : null}

      <section className="evaluation-certification-truth" aria-label="Truth class" data-arena-certification-truth="certification">
        <TruthBadge kind="certification" />
        {demo ? <DemoDataBadge /> : null}
        <p className="evaluation-certification-truth__note">{view.scopeNote}</p>
      </section>

      <section className="evaluation-certification-tuple" aria-labelledby="evaluation-certification-tuple-title" data-arena-certification-tuple="true">
        <h2 id="evaluation-certification-tuple-title">The tested composition — all five parts</h2>
        <dl className="evaluation-certification-tuple__facts">
          <div data-arena-tuple-part="body-version">
            <dt>Body Version</dt>
            <dd><code>{tuple.bodyVersion.tenant}/{tuple.bodyVersion.name}@{tuple.bodyVersion.version}</code></dd>
          </div>
          <div data-arena-tuple-part="substrate">
            <dt>Substrate</dt>
            <dd><code>{tuple.substrate.substrateId}@{tuple.substrate.substrateVersion}</code></dd>
          </div>
          <div data-arena-tuple-part="environment">
            <dt>Environment</dt>
            <dd><code>{tuple.environment.environmentId}@{tuple.environment.environmentVersion}</code>
              {tuple.environment.constraints.length > 0 ? (
                <p className="evaluation-tuple__constraints">constraints: {tuple.environment.constraints.join(', ')}</p>
              ) : null}
            </dd>
          </div>
          <div data-arena-tuple-part="runtime">
            <dt>Runtime</dt>
            <dd><code>{tuple.runtime.runtimeId}@{tuple.runtime.runtimeVersion}</code>
              <p className="evaluation-tuple__configuration">configuration: {tuple.runtime.configuration}</p>
            </dd>
          </div>
          <div data-arena-tuple-part="suite">
            <dt>Certification Suite</dt>
            <dd><code>{tuple.suite.suiteId}@{tuple.suite.suiteVersion}</code>
              <p className="evaluation-tuple__revision">suite revision: <code>{tuple.suite.suiteRevision}</code></p>
            </dd>
          </div>
        </dl>
      </section>

      <section className="evaluation-certification-validity" aria-labelledby="evaluation-certification-validity-title" data-arena-certification-validity="true">
        <h2 id="evaluation-certification-validity-title">Verdict, level and validity posture</h2>
        <dl className="evaluation-certification-validity__facts">
          <div><dt>Verdict</dt><dd data-arena-certification-verdict={view.verdict}>{view.verdict}</dd></div>
          <div><dt>Granted level</dt><dd data-arena-certification-level={view.validity.grantedLevel ?? 'none'}>{view.validity.grantedLevel ?? 'no grant (nothing is granted on a failed or unknown run)'}</dd></div>
          <div><dt>Posture</dt><dd data-arena-certification-posture={view.validity.posture}>{view.validity.posture}</dd></div>
          {view.validity.supersedes !== undefined ? (
            <div><dt>Supersedes</dt><dd><code>{view.validity.supersedes}</code></dd></div>
          ) : null}
          {view.validity.revocation !== undefined ? (
            <div data-arena-certification-revocation="true"><dt>Revocation</dt><dd>{view.validity.revocation.grounds} (recorded {view.validity.revocation.recordedAt})</dd></div>
          ) : null}
        </dl>
        <p className="evaluation-certification-validity__note">{view.validity.note}</p>
      </section>

      <section className="evaluation-certification-statement" aria-labelledby="evaluation-certification-statement-title" data-arena-certification-statement="true">
        <h2 id="evaluation-certification-statement-title">The derived scoped statement</h2>
        <blockquote className="evaluation-certification-statement__text">
          <p>{view.statement.text}</p>
        </blockquote>
        <dl className="evaluation-certification-statement__scope">
          <div><dt>Body</dt><dd>{view.statement.scope.body}</dd></div>
          <div><dt>Substrate</dt><dd>{view.statement.scope.substrate}</dd></div>
          <div><dt>Environment</dt><dd>{view.statement.scope.environment}</dd></div>
          <div><dt>Runtime</dt><dd>{view.statement.scope.runtime}</dd></div>
          <div><dt>Suite</dt><dd>{view.statement.scope.suite}</dd></div>
          {view.statement.constraints.length > 0 ? (
            <div><dt>Constraints</dt><dd>{view.statement.constraints.join('; ')}</dd></div>
          ) : null}
          {view.statement.limitations !== undefined ? (
            <div><dt>Limitations</dt><dd>{view.statement.limitations}</dd></div>
          ) : null}
        </dl>
      </section>

      <section className="evaluation-certification-stages" aria-labelledby="evaluation-certification-stages-title" data-arena-certification-stages="true">
        <h2 id="evaluation-certification-stages-title">Stage results</h2>
        <div className="evaluation-certification-stages__scroll" role="region" aria-label="Stage results table" tabIndex={0}>
          <table className="evaluation-certification-stages__table">
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col">Kind</th>
                <th scope="col">Outcome</th>
                <th scope="col">Reason</th>
                <th scope="col">Evidence digest</th>
              </tr>
            </thead>
            <tbody>
              {view.stages.map((stage) => (
                <tr key={stage.stageId} data-arena-stage={stage.stageId} data-arena-stage-outcome={stage.outcome}>
                  <td><code>{stage.stageId}</code></td>
                  <td>{stage.kind}</td>
                  <td>{stage.outcome}</td>
                  <td><code>{stage.reason}</code></td>
                  <td><code><Maybe value={stage.evidenceDigest} /></code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="evaluation-certification-run" aria-labelledby="evaluation-certification-run-title" data-arena-certification-run="true">
        <h2 id="evaluation-certification-run-title">Run facts</h2>
        <dl className="evaluation-certification-run__facts">
          <div><dt>Correlation id</dt><dd><code><Maybe value={view.correlationId} /></code></dd></div>
          <div><dt>Idempotency key</dt><dd><code><Maybe value={view.idempotencyKey} /></code></dd></div>
          <div><dt>Tenant</dt><dd><Maybe value={view.tenantId} /></dd></div>
          <div><dt>Workspace</dt><dd><Maybe value={view.workspaceId} /></dd></div>
          <div><dt>Started</dt><dd><Maybe value={view.startedAt} /></dd></div>
          <div><dt>Finished</dt><dd><Maybe value={view.finishedAt} /></dd></div>
          <div><dt>Executed by</dt><dd><Maybe value={view.executedBy} /></dd></div>
          <div><dt>Record digest</dt><dd><code>{view.digest}</code></dd></div>
        </dl>
      </section>

      <p className="evaluation-detail__back">
        <a href={demo ? '/demo/evaluation' : '/evaluation'}>Back to the evaluation surface</a>
      </p>
    </div>
  );
}
