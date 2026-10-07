/**
 * The competitions surface views (Work Order C013; apps/web/src/
 * competitions). SYNC presentational components — the route resolvers
 * compose the experience server-side and render one of these. Every
 * route renders its honest state set: loading/empty/error/permission-
 * denied/demo-data/success (UX quality gates). The AE1.0 UX chain is
 * rendered in order: Problem → Solutions → Challenge → Proof →
 * Response → Community signal → Adjudication → Verified result; every
 * claim links its supporting evidence; the community signal is visibly
 * labelled a DISCOVERY signal per the shared state vocabulary (never
 * equivalent to the verified badge).
 */

import {
  DemoDataBadge,
  DeniedState,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Surface,
  TruthBadge,
} from '@arena/ui-platform';

import type {
  CompetitionDetailViewModel,
  CompetitionSummaryViewModel,
  SolutionViewModel,
} from './view-models.js';
import type { DiscoverySignalViewModel } from './view-models.js';

// ---------------------------------------------------------------------------
// Mount-level honest states
// ---------------------------------------------------------------------------

/** `/competitions/**` without an authenticated session: fail closed. */
export function CompetitionsAuthRequiredView() {
  return (
    <div
      className="competitions-surface competitions-surface--auth-required"
      data-arena-route="competitions"
      data-arena-surface-auth="required"
    >
      <PageHeader
        title="Expert Arena"
        description="Adversarial expert evaluation — qualified experts compete by solving a task and attempting to falsify one another's solutions. For authenticated workspace members."
      />
      <DeniedState
        message="The Expert Arena requires an authenticated workspace session. Sessions are validated server-side (fail closed) — there is no anonymous competition surface."
        requiredAuthority="authenticated session (B004 session boundary)"
      />
      <p className="competitions-surface__auth-hint">
        <a href="/">Go to the Arena home surface</a> to sign in. Competition results feed
        Verification as candidates — they never bypass Verifier authority.
      </p>
    </div>
  );
}

/** A competitions read that failed: the honest error state. */
export function CompetitionsErrorView(props: { readonly detail: string }) {
  return (
    <div
      className="competitions-surface competitions-surface--error"
      data-arena-route="competitions"
      data-arena-state="error"
    >
      <PageHeader title="Expert Arena" description="The competition surface could not be read." />
      <ErrorState
        title="Competition read failed"
        detail={props.detail}
        action={<a href="/competitions">Retry the Expert Arena</a>}
      />
    </div>
  );
}

/** The pending state while the composition resolves server-side. */
export function CompetitionsLoadingView() {
  return (
    <div
      className="competitions-surface competitions-surface--loading"
      data-arena-route="competitions"
      data-arena-state="loading"
    >
      <PageHeader title="Expert Arena" description="Loading the competition surface…" />
      <LoadingState label="Resolving competitions, judgments and adjudication state…" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The arena home (competition list)
// ---------------------------------------------------------------------------

export function CompetitionsHomeView(props: {
  readonly tenantLabel: string;
  readonly demo: boolean;
  readonly competitions: readonly CompetitionSummaryViewModel[];
}) {
  return (
    <div
      className="competitions-surface competitions-surface--home"
      data-arena-route="competitions-home"
      data-arena-demo={props.demo ? 'true' : 'false'}
    >
      <PageHeader
        title="Expert Arena"
        description={`Adversarial expert evaluation — independent solutions, evidence-carrying challenges, qualification-aware voting, evidence-weighted adjudication. Workspace: ${props.tenantLabel}.`}
      />
      {props.demo ? (
        <p className="competitions-surface__truth">
          <DemoDataBadge note="deterministic demo competition corpus — demo state is never customer state" />
        </p>
      ) : null}
      <Surface>
        <h2>The competition model (AE1.0)</h2>
        <ol className="competitions-surface__chain" data-arena-list="competition-chain">
          <li>Problem</li>
          <li>Solutions</li>
          <li>Challenge</li>
          <li>Proof</li>
          <li>Response</li>
          <li>Community signal</li>
          <li>Adjudication</li>
          <li>Verified result</li>
        </ol>
        <p className="competitions-surface__law">
          This is an evaluation method, not a replacement for Verification: the raw upvote/downvote
          ratio is surfaced only as a labelled discovery signal and is structurally excluded from
          adjudication inputs. Competition results feed Evaluation/Verification/Certification as
          candidate inputs — they never bypass Verifier authority.
        </p>
        {props.competitions.length === 0 ? (
          <EmptyState
            title="No competitions yet"
            hint="Open a competition over a task to solicit independent qualified solutions — the arena renders honest empty states until then."
          />
        ) : (
          <ul className="competitions-surface__competitions" data-arena-list="competitions">
            {props.competitions.map((competition) => (
              <li key={competition.competitionId} data-arena-competition={competition.competitionId}>
                <a href={`/competitions/${competition.competitionId}`}>{competition.title}</a>
                <span className="competitions-surface__state">{competition.stateLabel}</span>
                <span className="competitions-surface__facts">
                  {competition.judgmentCount} judgments
                  {competition.outcome === null ? '' : ` · result: ${competition.outcome}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Surface>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The competition detail (the full AE1.0 UX chain)
// ---------------------------------------------------------------------------

function SignalSection(props: { readonly signal: DiscoverySignalViewModel }) {
  return (
    <section className="competitions-detail__signal" data-arena-section="community-signal">
      <h3>Community signal</h3>
      <p className="competitions-detail__signal-label">
        <TruthBadge kind="suggestion" />
        <span className="competitions-detail__signal-kind">
          discovery signal — not a verified badge
        </span>
      </p>
      <p data-arena-fact="signal-ratio">
        Upvotes <strong>{props.signal.upvotes}</strong> · Downvotes{' '}
        <strong>{props.signal.downvotes}</strong> · Raw ratio{' '}
        <strong>{props.signal.ratio === null ? 'unknown (no votes)' : props.signal.ratio.toFixed(2)}</strong>
        {props.signal.smallSample ? ' · small sample' : ''}
      </p>
      <p className="competitions-detail__disclosure">{props.signal.disclosure}</p>
    </section>
  );
}

function SolutionSection(props: { readonly solution: SolutionViewModel }) {
  return (
    <section className="competitions-detail__solution" data-arena-solution={props.solution.submissionId}>
      <h3>Solution {props.solution.submissionId.slice(4, 12)} — by {props.solution.authorExpertRef}</h3>
      <ul className="competitions-detail__judgments" data-arena-list="judgments">
        {props.solution.judgments.map((judgment) => (
          <li key={judgment.judgmentId} data-arena-judgment={judgment.type}>
            <span className="competitions-detail__judgment-type">{judgment.type}</span>
            <span className="competitions-detail__judgment-expert"> by {judgment.expertRef}</span>
            <p className="competitions-detail__claim">Claim: {judgment.claim}</p>
            <ul className="competitions-detail__evidence" data-arena-list="evidence">
              {judgment.evidence.map((item) => (
                <li key={item.evidenceRef} data-arena-evidence={item.evidenceRef}>
                  <a href={`#evidence/${item.evidenceRef}`}>{item.evidenceRef}</a>
                  <span className="competitions-detail__evidence-claim"> — {item.supportsClaim}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <SignalSection signal={props.solution.signal} />
    </section>
  );
}

export function CompetitionDetailView(props: {
  readonly tenantLabel: string;
  readonly demo: boolean;
  readonly model: CompetitionDetailViewModel;
}) {
  const { model } = props;
  return (
    <div
      className="competitions-surface competitions-surface--detail"
      data-arena-route="competition-detail"
      data-arena-demo={props.demo ? 'true' : 'false'}
      data-arena-competition-state={model.state}
    >
      <PageHeader
        title="Expert Arena"
        description={`Adversarial expert evaluation. Workspace: ${props.tenantLabel}.`}
      />
      {props.demo ? (
        <p className="competitions-surface__truth">
          <DemoDataBadge note="deterministic demo competition — demo state is never customer state" />
        </p>
      ) : null}
      <nav className="competitions-detail__nav" aria-label="Expert Arena">
        <a href="/competitions">All competitions</a>
      </nav>
      <Surface>
        <section className="competitions-detail__problem" data-arena-section="problem">
          <h2>Problem</h2>
          <p data-arena-fact="task-title">{model.title}</p>
          <p>{model.statement}</p>
          <p className="competitions-detail__skills">
            Required skills: {model.requiredSkills.join(', ')} (qualification-aware visibility and
            aggregation).
          </p>
        </section>
        <section className="competitions-detail__solutions" data-arena-section="solutions">
          <h2>Solutions, challenges, proof and responses</h2>
          {model.solutions.map((solution) => (
            <SolutionSection key={solution.submissionId} solution={solution} />
          ))}
        </section>
        <section className="competitions-detail__adjudication" data-arena-section="adjudication">
          <h2>Adjudication</h2>
          {model.result === null ? (
            <p>Adjudication has not run yet.</p>
          ) : (
            <>
              <p data-arena-fact="formula">Evidence-weighted aggregation, formula v{model.result.formulaVersion} — qualified votes, challenge validity, evidence quality, verifier outcome, task-specific evaluator, historical calibration, agreement patterns.</p>
              <ul className="competitions-detail__reasons" data-arena-list="reasons">
                {model.result.reasons.map((reason) => (
                  <li key={reason.code + reason.detail.slice(0, 24)}>
                    <code>{reason.code}</code> — {reason.detail}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="competitions-detail__result" data-arena-section="verified-result">
          <h2>Verified result</h2>
          {model.result !== null && model.result.outcome === 'verified_result' ? (
            <p data-arena-truth="verified">
              Verified result: winner{' '}
              <strong>{model.result.winnerSubmissionId ?? 'none'}</strong> — derived through
              evidence-weighted adjudication with the Verifier outcome applied (candidate input to
              Certification; never a certification itself).
            </p>
          ) : (
            <p data-arena-truth="pending">
              No verified result yet — {model.result?.outcome ?? model.state}. Ties, small samples
              and unknown verification surface explicit states, never a coin-flip winner.
            </p>
          )}
          {model.result !== null ? (
            <ul className="competitions-detail__limitations" data-arena-list="limitations">
              {model.result.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          ) : null}
        </section>
      </Surface>
    </div>
  );
}
