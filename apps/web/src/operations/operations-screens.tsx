/**
 * The operations screen views (Work Order B014; apps/web/src/operations):
 * the jobs list, the job detail, the audit stream and the capacity panel.
 * SYNC presentational components — the async composition lives in the
 * operations-route helpers, these render the view models deterministically.
 *
 * The B014 truths render identically on every screen: job states are
 * recorded facts (never optimistic), SLO verdicts are measurements with
 * windows, audit rows are append-only evidence with actor identity, and
 * capacity postures are fail-closed with visible ceilings. Demo mode
 * renders under the B006 labelling contract.
 */

import { DemoDataBadge, EmptyState, PageHeader, TruthBadge } from '@arena/ui-platform';
import { DEMO_LABELLING } from '@arena/demo';
import { Maybe, OperationsTruthMark } from './operations-home-view.js';
import type {
  AuditScreenViewModel,
  CapacityScreenViewModel,
  JobDetailScreenViewModel,
  JobsListViewModel,
} from './operations-route.js';
import type { CapacityDimensionView } from './capacity-view-model.js';

function DemoBanner() {
  return (
    <section className="operations-demo-banner" aria-label="Demo mode notice" data-arena-demo-banner="true">
      <DemoDataBadge note="deterministic seed" />
      <p>
        <strong>{DEMO_LABELLING.bannerTitle}.</strong> {DEMO_LABELLING.bannerText}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Jobs list
// ---------------------------------------------------------------------------

export function JobsListView({ view }: { readonly view: JobsListViewModel }) {
  return (
    <div className="operations-surface operations-surface--jobs" data-arena-route="operations-jobs" data-arena-surface-mode={view.mode}>
      <PageHeader
        title="Jobs"
        description="The job lifecycle as recorded by the control plane: queued, running, succeeded, failed or cancelled — append-only histories, attempts and timestamps, never an optimistic completion."
      />
      {view.demo.isDemo ? <DemoBanner /> : null}
      <section className="operations-jobs-note" aria-label="Jobs posture note">
        <p>{view.jobsNote}</p>
        <p className="operations-jobs-note__law">{view.honestyNote}</p>
      </section>
      {view.jobs.length === 0 ? (
        <EmptyState title="No job records" hint={view.jobsNote} />
      ) : (
        <div className="operations-jobs__scroll" role="region" aria-label="Jobs table" tabIndex={0}>
          <table className="operations-jobs__table">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Kind</th>
                <th scope="col">State</th>
                <th scope="col">Attempts</th>
                <th scope="col">Submitted</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {view.jobs.map((job) => (
                <tr
                  key={job.jobId ?? 'unknown'}
                  className="operations-job-row"
                  data-arena-job={job.jobId ?? 'unknown'}
                  data-arena-job-state={job.state}
                >
                  <td>
                    {job.jobId !== undefined ? (
                      <a href={`${view.jobDetailHrefBase}/${encodeURIComponent(job.jobId)}`}>{job.jobId}</a>
                    ) : (
                      <Maybe value={job.jobId} />
                    )}
                  </td>
                  <td>
                    <Maybe value={job.kindKey} /> {view.demo.isDemo ? <DemoDataBadge /> : null}
                  </td>
                  <td data-arena-job-state={job.state}>
                    {job.truthClass === 'verified-fact' ? (
                      <TruthBadge kind="verified" />
                    ) : (
                      <OperationsTruthMark
                        treatment="unknown"
                        label="Unknown"
                        meaning="The record state cannot be read — rendered as unknown, never guessed."
                      />
                    )}{' '}
                    <span className={`operations-job-state operations-job-state--${job.state}`}>{job.state}</span>
                  </td>
                  <td>{job.attempts !== undefined ? String(job.attempts) : '—'}</td>
                  <td>
                    <Maybe value={job.submittedAt} />
                  </td>
                  <td>
                    <Maybe value={job.updatedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="operations-jobs__back">
        <a href={view.mode === 'demo' ? '/demo/operations' : '/operations'}>Back to the operations overview</a>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job detail
// ---------------------------------------------------------------------------

export function JobDetailView({ view }: { readonly view: JobDetailScreenViewModel }) {
  const job = view.view;
  return (
    <div className="operations-surface operations-surface--job-detail" data-arena-route="operations-job" data-arena-surface-mode={view.mode}>
      <PageHeader
        title={`Job ${job.jobId ?? 'unknown'}`}
        description="One job's append-only lifecycle: attempts, events, policy and outcome, exactly as the control-plane record carries them."
      />
      {view.demo.isDemo ? <DemoBanner /> : null}
      <section className="operations-job-summary" aria-label="Job summary" data-arena-job-state={job.state}>
        <dl className="operations-job-summary__facts">
          <div><dt>Job id</dt><dd><code><Maybe value={job.jobId} /></code></dd></div>
          <div><dt>Kind</dt><dd><code><Maybe value={job.kindKey} /></code></dd></div>
          <div><dt>Correlation id</dt><dd><code><Maybe value={job.correlationId} /></code></dd></div>
          <div>
            <dt>State</dt>
            <dd>
              {job.truthClass === 'verified-fact' ? <TruthBadge kind="verified" /> : <OperationsTruthMark treatment="unknown" label="Unknown" meaning="The record state cannot be read." />}{' '}
              <span className={`operations-job-state operations-job-state--${job.state}`}>{job.state}</span>
              {job.outcomeNote !== undefined ? ` — ${job.outcomeNote}` : ''}
            </dd>
          </div>
          <div><dt>Attempts</dt><dd>{job.attempts !== undefined ? String(job.attempts) : '—'}</dd></div>
          <div><dt>Submitted</dt><dd><Maybe value={job.submittedAt} /></dd></div>
          <div><dt>Updated</dt><dd><Maybe value={job.updatedAt} /></dd></div>
          <div><dt>Definition digest</dt><dd><code><Maybe value={job.definitionDigest} /></code></dd></div>
          <div><dt>Retry policy</dt><dd>max {job.policy.maxAttempts !== undefined ? String(job.policy.maxAttempts) : '—'} attempts{job.policy.retryableErrorClasses.length > 0 ? `, retryable: ${job.policy.retryableErrorClasses.join(', ')}` : ''}</dd></div>
          {job.nextRetryAt !== undefined ? <div><dt>Next retry at</dt><dd><code>{job.nextRetryAt}</code></dd></div> : null}
          {job.timeoutAt !== undefined ? <div><dt>Attempt deadline</dt><dd><code>{job.timeoutAt}</code></dd></div> : null}
        </dl>
        {job.unknownFields.length > 0 ? (
          <p className="operations-job-summary__unknown" data-arena-job-unknown="true">
            Unknown fields (rendered as unknown, never fabricated): {job.unknownFields.join(', ')}.
          </p>
        ) : null}
      </section>

      {job.failure !== undefined ? (
        <section className="operations-job-failure" aria-label="Recorded failure" data-arena-job-failure="true">
          <h2>Failure (terminal)</h2>
          <p>
            kind <code>{job.failure.kind}</code> · class <code>{job.failure.errorClass}</code> — {job.failure.message}
          </p>
        </section>
      ) : null}
      {job.cancellation !== undefined ? (
        <section className="operations-job-cancellation" aria-label="Recorded cancellation" data-arena-job-cancellation="true">
          <h2>Cancellation (terminal)</h2>
          <p>
            {job.cancellation.reason} at <code>{job.cancellation.cancelledAt}</code>
          </p>
        </section>
      ) : null}
      {job.progress !== undefined ? (
        <section className="operations-job-progress" aria-label="Last progress" data-arena-job-progress="true">
          <h2>Last progress</h2>
          <p>
            attempt {String(job.progress.attempt)}
            {job.progress.percent !== undefined ? ` · ${String(job.progress.percent)}%` : ''}
            {job.progress.note !== undefined ? ` · ${job.progress.note}` : ''} · at <code>{job.progress.at}</code>
          </p>
        </section>
      ) : null}
      {job.resultNote !== undefined ? (
        <section className="operations-job-result" aria-label="Recorded result" data-arena-job-result="true">
          <h2>Result</h2>
          <p><code>{job.resultNote}</code></p>
        </section>
      ) : null}

      <section className="operations-job-attempts" aria-labelledby="operations-job-attempts-title">
        <h2 id="operations-job-attempts-title">Attempt history (append-only)</h2>
        {job.attemptHistory.length === 0 ? (
          <EmptyState title="No attempts yet" hint="The job has not been claimed — attempts appear when a worker starts them." />
        ) : (
          <div className="operations-job-attempts__scroll" role="region" aria-label="Attempt history" tabIndex={0}>
            <table className="operations-job-attempts__table">
              <thead>
                <tr>
                  <th scope="col">Attempt</th>
                  <th scope="col">Started</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Ended</th>
                  <th scope="col">Error class</th>
                </tr>
              </thead>
              <tbody>
                {job.attemptHistory.map((attempt) => (
                  <tr key={attempt.attempt ?? 'unknown'} data-arena-attempt={attempt.attempt ?? 'unknown'} data-arena-attempt-outcome={attempt.outcome ?? 'unknown'}>
                    <td>{attempt.attempt !== undefined ? String(attempt.attempt) : '—'}</td>
                    <td><Maybe value={attempt.startedAt} /></td>
                    <td>{attempt.outcome ?? 'unknown'}</td>
                    <td><Maybe value={attempt.endedAt} /></td>
                    <td><Maybe value={attempt.errorClass} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="operations-job-events" aria-labelledby="operations-job-events-title">
        <h2 id="operations-job-events-title">Event history (append-only)</h2>
        <div className="operations-job-events__scroll" role="region" aria-label="Event history" tabIndex={0}>
          <table className="operations-job-events__table">
            <thead>
              <tr>
                <th scope="col">Sequence</th>
                <th scope="col">Event</th>
                <th scope="col">Occurred at</th>
              </tr>
            </thead>
            <tbody>
              {job.events.map((event) => (
                <tr key={`${String(event.sequence ?? 'unknown')}-${event.kind ?? 'unknown'}`} data-arena-event={event.kind ?? 'unknown'}>
                  <td>{event.sequence !== undefined ? String(event.sequence) : '—'}</td>
                  <td><code>{event.kind ?? 'unknown'}</code></td>
                  <td><Maybe value={event.occurredAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="operations-job__back">
        <a href={view.jobsHrefBase}>Back to the jobs list</a>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit stream
// ---------------------------------------------------------------------------

export function AuditStreamScreenView({ view }: { readonly view: AuditScreenViewModel }) {
  const stream = view.stream;
  return (
    <div className="operations-surface operations-surface--audit" data-arena-route="operations-audit" data-arena-surface-mode={view.mode}>
      <PageHeader
        title="Audit stream"
        description="Append-only security audit evidence: sequenced, digest-chained and tamper-evident, attributed to actor and correlation id. History is never edited, removed or re-sorted here."
      />
      {view.demo.isDemo ? <DemoBanner /> : null}
      <section className="operations-audit-posture" aria-label="Chain posture">
        <p className="operations-audit-posture__note">{stream.appendOnlyNote}</p>
        <p className="operations-audit-posture__chain" data-arena-audit-chain-verified={stream.chainVerified ?? 'unknown'}>
          Chain verification:{' '}
          {stream.chainVerified === true ? (
            <>
              <TruthBadge kind="verified" /> verified (head digest recomputed)
            </>
          ) : stream.chainVerified === false ? (
            <>
              <TruthBadge kind="evidence" /> broken — tamper evidence, not noise
            </>
          ) : (
            'unknown (not verified in this posture)'
          )}
          {stream.headDigest !== undefined ? (
            <>
              {' '}· head <code>{stream.headDigest.slice(0, 24)}…</code>
            </>
          ) : null}
        </p>
      </section>
      {stream.count === 0 ? (
        <EmptyState title="No audit events" hint={stream.emptyNote} />
      ) : (
        <ul className="operations-audit__list operations-audit__list--full">
          {stream.events.map((event) => (
            <li
              key={event.eventId ?? event.sequence ?? 'unknown'}
              className="operations-audit-event"
              data-arena-audit-sequence={event.sequence ?? 'unknown'}
              data-arena-audit-kind={event.kind ?? 'unknown'}
              data-arena-audit-effect={event.effect ?? 'unknown'}
            >
              <div className="operations-audit-event__head">
                <strong>#{event.sequence !== undefined ? String(event.sequence) : 'unknown'}</strong>{' '}
                <code>{event.kind ?? 'unknown kind'}</code>
                {event.truthClass === 'evidence' ? <TruthBadge kind="evidence" /> : <OperationsTruthMark treatment="unknown" label="Unknown" meaning="The audit record cannot be read — rendered as unknown." />}
                {view.demo.isDemo ? <DemoDataBadge /> : null}
              </div>
              <p className="operations-audit-event__actor">
                Actor: tenant <code><Maybe value={event.actorTenantId} /></code> · principal{' '}
                <code><Maybe value={event.actorPrincipalId} /></code>
              </p>
              <p className="operations-audit-event__action">
                <Maybe value={event.action} /> @ boundary <Maybe value={event.boundaryClass} /> →{' '}
                <span className={`operations-audit-effect operations-audit-effect--${event.effect ?? 'unknown'}`}>
                  {event.effect ?? 'unknown'}
                </span>
                {event.reason !== undefined ? ` (${event.reason})` : ''}
              </p>
              <p className="operations-audit-event__address">
                correlation <code>{event.correlationId ?? 'unknown'}</code>
                {event.causationId !== undefined ? (
                  <>
                    {' '}· caused by <code>{event.causationId}</code>
                  </>
                ) : null}{' '}
                · {event.occurredAt ?? 'unknown time'}
              </p>
              <p className="operations-audit-event__chain">
                digest <code>{event.digest !== undefined ? `${event.digest.slice(0, 24)}…` : 'unknown'}</code> ← previous{' '}
                <code>{event.previousDigest !== undefined ? `${event.previousDigest.slice(0, 24)}…` : 'unknown'}</code>
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="operations-audit__back">
        <a href={view.mode === 'demo' ? '/demo/operations' : '/operations'}>Back to the operations overview</a>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capacity panel
// ---------------------------------------------------------------------------

function DimensionRow(props: { readonly dimension: CapacityDimensionView }) {
  const { dimension } = props;
  return (
    <tr data-arena-dimension={dimension.dimension ?? 'unknown'} data-arena-dimension-ceiling-unknown={dimension.ceilingUnknown ? 'true' : 'false'}>
      <td><code>{dimension.dimension ?? 'unknown'}</code></td>
      <td>{dimension.used !== undefined ? String(dimension.used) : 'unreported'}</td>
      <td>
        {dimension.ceilingUnknown ? (
          <span className="operations-dimension__ceiling-unknown" title="The provider reports no ceiling — rendered as unknown, never unlimited">
            ceiling unknown
          </span>
        ) : (
          (dimension.limit !== undefined ? String(dimension.limit) : 'unreported')
        )}
      </td>
      <td>{dimension.remaining !== undefined ? String(dimension.remaining) : 'unreported'}</td>
      <td>{dimension.windowMs !== undefined ? String(dimension.windowMs) : '—'}</td>
    </tr>
  );
}

export function CapacityPanelView({ view }: { readonly view: CapacityScreenViewModel }) {
  const board = view.board;
  return (
    <div className="operations-surface operations-surface--capacity" data-arena-route="operations-capacity" data-arena-surface-mode={view.mode}>
      <PageHeader
        title="Provider capacity (free tier)"
        description="Every hosted provider's quota posture, ceilings and consumption — fail closed on exhaustion and disability, with no billable fallback anywhere."
      />
      {view.demo.isDemo ? <DemoBanner /> : null}
      <section className="operations-capacity-guarantee" aria-label="The fail-closed guarantee">
        <p data-arena-capacity-guarantee="true">{board.guaranteeNote}</p>
        <p className="operations-capacity-guarantee__policy" data-arena-exhaustion-policy={board.exhaustionPolicy} data-arena-no-billable-fallback="true">
          Exhaustion policy: <strong>{board.exhaustionPolicy}</strong> (the type's single inhabitant). Billable
          fallback: <strong>none</strong> — it is not offered, not hidden and not representable.
        </p>
        <p className="operations-capacity-guarantee__overall" data-arena-capacity-overall={board.overall}>
          Overall posture: <strong>{board.overall}</strong>
          {board.boardNote !== undefined ? ` — ${board.boardNote}` : ''}
        </p>
      </section>
      {board.providers.map((provider) => (
        <section
          key={provider.providerId ?? 'unknown'}
          className="operations-provider"
          aria-labelledby={`provider-${provider.providerId ?? 'unknown'}-title`}
          data-arena-provider={provider.providerId ?? 'unknown'}
          data-arena-provider-status={provider.status}
        >
          <h2 id={`provider-${provider.providerId ?? 'unknown'}-title`}>
            <code>{provider.providerId ?? 'unknown provider'}</code> —{' '}
            <span className={`operations-capacity-status operations-capacity-status--${provider.status}`}>
              {provider.status}
            </span>{' '}
            ({provider.failClosed ? 'fail closed' : 'usable'})
            {view.demo.isDemo ? <DemoDataBadge /> : null}
          </h2>
          <p className="operations-provider__role">{provider.role}</p>
          {provider.note !== undefined ? <p className="operations-provider__note">{provider.note}</p> : null}
          {provider.reasons.length > 0 ? (
            <ul className="operations-provider__reasons" data-arena-provider-reasons={provider.reasons.map((reason) => reason.code).join(',')}>
              {provider.reasons.map((reason, index) => (
                <li key={`${reason.code}-${String(index)}`}>
                  <code>{reason.code}</code>
                  {reason.dimension !== undefined ? (
                    <span> (dimension: {reason.dimension})</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {provider.dimensions.length > 0 ? (
            <div className="operations-provider__scroll" role="region" aria-label="Dimensions table" tabIndex={0}>
              <table className="operations-provider__table">
                <thead>
                  <tr>
                    <th scope="col">Dimension</th>
                    <th scope="col">Used</th>
                    <th scope="col">Limit</th>
                    <th scope="col">Remaining</th>
                    <th scope="col">Window (ms)</th>
                  </tr>
                </thead>
                <tbody>
                  {provider.dimensions.map((dimension) => (
                    <DimensionRow key={dimension.dimension ?? 'unknown'} dimension={dimension} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="operations-provider__no-dimensions">
              No dimension readings reported for this posture{provider.status === 'DISABLED' ? ' (an unwired provider reports none — fail closed, never unlimited)' : ''}.
            </p>
          )}
        </section>
      ))}
      <p className="operations-capacity__back">
        <a href={view.mode === 'demo' ? '/demo/operations' : '/operations'}>Back to the operations overview</a>
      </p>
    </div>
  );
}
