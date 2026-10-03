/**
 * ReplayRunView — the presentational run-detail surface (Work Order
 * B011; issue #86; apps/web/src/replay).
 *
 * SYNC presentational component: renders the interactive run-inspection
 * view model — the TIMELINE (append-only steps with per-step
 * action/observation/event records, wall-clock vs logical ordering),
 * the STEP INSPECTOR (explicit selection, per-step I/O), the
 * ENVIRONMENT EVENT STREAM, and the RESULT LINKAGE (evidence
 * addresses + evaluation/verification records, each under its OWN
 * truth class).
 *
 * THE governing truths rendered here:
 *   - REPLAY IS OBSERVATIONAL — the banner is ALWAYS visible and there
 *     is no re-run affordance anywhere on this screen;
 *   - every timeline step and every event renders as SIMULATION-REPLAY
 *     — never as a result; linked artifacts render under their own
 *     classes (evidence / evaluation-result / verified-fact / unknown);
 *   - degradation is visible: unreadable rows, gap markers, the chain
 *     verification stamp and honest unknown fields all render as
 *     themselves, never silently repaired;
 *   - step selection is explicit (?step=N): out-of-range requests are
 *     reported verbatim, never clamped.
 */

import { DemoDataBadge, EmptyState, PageHeader, TruthBadge } from '@arena/ui-platform';
import type { StateKind } from '@arena/ui-platform';
import {
  Maybe,
  ReplayDemoBanner,
  ReplayObservationalBanner,
  ReplayRoleBar,
  ReplaySurfaceFactsAside,
  ReplayTruthLegend,
  ReplayTruthMark,
} from './replay-home-view.js';
import { replayTruthClassTreatment } from './state-mark.js';
import type { ReplayTruthTreatment } from './state-mark.js';
import type { ReplayRunScreenModel } from './replay-route.js';
import { replayStepHref } from './replay-route.js';
import type {
  ReplayStepModel,
  ReplayTruthClass,
} from '../../../../packages/replay-ui/src/index.js';

function shortDigest(digest: string | null): string {
  if (digest === null) return 'unknown';
  return `${digest.slice(0, 16)}…`;
}

function plainTruthMark(truthClass: ReplayTruthClass) {
  const treatment: ReplayTruthTreatment = replayTruthClassTreatment(truthClass);
  if (
    treatment === 'verified' ||
    treatment === 'evidence' ||
    treatment === 'evaluation' ||
    treatment === 'simulation'
  ) {
    return <TruthBadge kind={treatment as StateKind} />;
  }
  return <ReplayTruthMark truthClass={truthClass} />;
}

// ---------------------------------------------------------------------------
// Run facts (A010 run record + run result + chain verification)
// ---------------------------------------------------------------------------

function RunFactsSection(props: { readonly view: ReplayRunScreenModel }) {
  const runRecord = props.view.detail.runRecord;
  const runResult = props.view.detail.runResult;
  return (
    <section className="replay-runfacts" aria-labelledby="replay-runfacts-title" data-arena-runfacts-section="true">
      <h2 id="replay-runfacts-title">Run facts</h2>
      <dl className="replay-runfacts__facts">
        <div>
          <dt>Run record</dt>
          <dd data-arena-run-record-readable={runRecord.readable ? 'true' : 'false'}>
            {runRecord.readable ? (
              <>
                <code>{String(runRecord.runId)}</code> — environment{' '}
                <code>{String(runRecord.environmentId)}@{String(runRecord.environmentVersion)}</code>
                , job <code>{String(runRecord.jobRef)}</code>, seed{' '}
                <code>{String(runRecord.seed ?? 'none')}</code>, submitted{' '}
                {String(runRecord.submittedAt)}
              </>
            ) : (
              <>
                <ReplayTruthMark truthClass="unknown" /> {runRecord.note}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Run result (A010)</dt>
          <dd data-arena-run-result-readable={runResult.readable ? 'true' : 'false'}>
            {runResult.readable ? (
              <>
                completed at {String(runResult.finishedAt)} — binds trajectory{' '}
                <code>{shortDigest(runResult.trajectoryDigest)}</code> and{' '}
                {String(runResult.evidenceDigests.length)} evidence address(es)
              </>
            ) : (
              <>
                <ReplayTruthMark truthClass="unknown" /> {runResult.note}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Chain verification</dt>
          <dd data-arena-chain-verification={props.view.detail.chainVerification.status}>
            {props.view.detail.chainVerification.status === 'verified' ? (
              <>
                <TruthBadge kind="verified" /> full chain recomputed — the timeline&apos;s
                digest chain verifies against its declared head
              </>
            ) : props.view.detail.chainVerification.status === 'failed' ? (
              <>
                <ReplayTruthMark truthClass="unknown" /> verification failed (
                {String(props.view.detail.chainVerification.errorCode)}) — the timeline
                renders as degraded replay data: {String(props.view.detail.chainVerification.detail)}
              </>
            ) : (
              <>
                <ReplayTruthMark truthClass="unknown" /> not attempted in this composition —
                rendered as unknown, never silently assumed
              </>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

function StepRow(props: {
  readonly view: ReplayRunScreenModel;
  readonly step: ReplayStepModel;
  readonly selected: boolean;
}) {
  const { view, step, selected } = props;
  const href = replayStepHref({
    runHrefBase: view.runHrefBase,
    runKey: view.detail.runKey,
    step: step.sequence,
    activeRoleId: view.roleSwitch.activeRoleId,
  });
  return (
    <tr
      className={
        selected
          ? 'replay-step replay-step--selected'
          : 'replay-step'
      }
      data-arena-step={step.sequence}
      data-arena-step-kind={step.kind}
      data-arena-step-truth={replayTruthClassTreatment(step.truthClass)}
      {...(selected ? { 'aria-current': 'step' as const } : {})}
    >
      <td>
        <a href={href}>#{String(step.sequence)}</a>
      </td>
      <td>
        {plainTruthMark(step.truthClass)} {step.kindLabel}
        {view.demo.isDemo ? <DemoDataBadge /> : null}
      </td>
      <td>{step.summary}</td>
      <td>
        <Maybe value={step.occurredAt} />
      </td>
      <td>
        {step.wallClockDeltaMs === null
          ? '—'
          : step.sameWallClockAsPrevious
            ? 'same timestamp (logical order authoritative)'
            : `+${String(step.wallClockDeltaMs)}ms`}
      </td>
      <td>
        <code>{shortDigest(step.stepDigest)}</code>
      </td>
    </tr>
  );
}

function TimelineSection(props: { readonly view: ReplayRunScreenModel }) {
  const { timeline, inspection } = props.view.detail;
  return (
    <section
      className="replay-timeline"
      aria-labelledby="replay-timeline-title"
      data-arena-timeline-section="true"
      data-arena-timeline-state={timeline.state}
      data-arena-timeline-integrity={timeline.integrity}
      data-arena-timeline-outcome={timeline.outcome}
    >
      <h2 id="replay-timeline-title">Timeline — what the agent did</h2>
      <p className="replay-timeline__note">
        {String(timeline.stepCount)} readable step(s); wall-clock span{' '}
        {timeline.span.elapsedMs === null ? 'unknown' : `${String(timeline.span.elapsedMs)}ms`}
        {timeline.sameWallClockSteps.length > 0
          ? `; ${String(timeline.sameWallClockSteps.length)} step(s) share a wall-clock timestamp — the LOGICAL (chain sequence) order is authoritative`
          : ''}
        . Every step renders as simulation-replay — never a result.
      </p>
      {timeline.steps.length === 0 ? (
        <EmptyState
          title="No trajectory steps to replay"
          hint={
            timeline.state === 'no-data'
              ? 'No trajectory payload exists for this run (no data) — nothing is fabricated.'
              : timeline.degradation.join(' ') || 'No readable steps.'
          }
        />
      ) : (
        <div
          className="replay-timeline__scroll"
          role="region"
          aria-label="Trajectory timeline table"
          tabIndex={0}
        >
          <table className="replay-timeline__table">
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">Kind</th>
                <th scope="col">Record</th>
                <th scope="col">Wall clock</th>
                <th scope="col">Δ</th>
                <th scope="col">Step digest</th>
              </tr>
            </thead>
            <tbody>
              {timeline.steps.map((step) => (
                <StepRow
                  key={step.sequence}
                  view={props.view}
                  step={step}
                  selected={
                    inspection.state === 'selected' && inspection.step?.sequence === step.sequence
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {timeline.degradation.length > 0 ? (
        <div className="replay-timeline__degradation" data-arena-timeline-degradation="true">
          <h3>Degradation (rendered honestly, never repaired)</h3>
          <ul>
            {timeline.degradation.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {timeline.pending ? (
        <p className="replay-timeline__pending" data-arena-timeline-pending="true">
          <ReplayTruthMark truthClass="pending" /> No completion entry exists yet — the run is
          still in flight or was truncated after the fact; the final outcome stays pending,
          never guessed.
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The step inspector (explicit selection, per-step I/O)
// ---------------------------------------------------------------------------

function StepPayloadView(props: { readonly payloadView: unknown }) {
  const payloadView = props.payloadView as {
    readonly kind?: string;
    readonly actionId?: string;
    readonly input?: unknown;
    readonly observationId?: string;
    readonly channel?: string;
    readonly content?: string;
    readonly checkpointId?: string;
    readonly snapshotDigest?: string;
    readonly code?: string;
    readonly message?: string;
    readonly outcome?: string;
    readonly evidenceDigests?: readonly string[];
    readonly reason?: string;
  };
  switch (payloadView?.kind) {
    case 'action':
      return (
        <div className="replay-io" data-arena-step-io="action">
          <p>
            Action <code>{String(payloadView.actionId)}</code> — input:
          </p>
          <pre className="replay-io__json">
            <code>{JSON.stringify(payloadView.input ?? null, null, 2)}</code>
          </pre>
        </div>
      );
    case 'observation':
      return (
        <div className="replay-io" data-arena-step-io="observation">
          <p>
            Observation <code>{String(payloadView.observationId)}</code> on channel{' '}
            <code>{String(payloadView.channel)}</code>:
          </p>
          <pre className="replay-io__content">
            <code>{String(payloadView.content)}</code>
          </pre>
        </div>
      );
    case 'checkpoint':
      return (
        <div className="replay-io" data-arena-step-io="checkpoint">
          <p>
            Checkpoint <code>{String(payloadView.checkpointId)}</code> — snapshot digest:
          </p>
          <p>
            <code>{String(payloadView.snapshotDigest)}</code>
          </p>
        </div>
      );
    case 'error':
      return (
        <div className="replay-io" data-arena-step-io="error">
          <p>
            Error <code>{String(payloadView.code)}</code>:
          </p>
          <pre className="replay-io__content">
            <code>{String(payloadView.message)}</code>
          </pre>
        </div>
      );
    case 'completion':
      return (
        <div className="replay-io" data-arena-step-io="completion">
          <p>
            Completion — outcome <strong>{String(payloadView.outcome)}</strong>;{' '}
            {String(payloadView.evidenceDigests?.length ?? 0)} evidence address(s):
          </p>
          <ul className="replay-io__evidence">
            {(payloadView.evidenceDigests ?? []).map((digest) => (
              <li key={digest}>
                <code>{digest}</code>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'no-data':
      return (
        <div className="replay-io" data-arena-step-io="no-data">
          <p>No data for this step — the sequence is missing from the payload; nothing is fabricated.</p>
        </div>
      );
    case 'unreadable':
      return (
        <div className="replay-io" data-arena-step-io="unreadable">
          <p>
            <ReplayTruthMark truthClass="unknown" /> Unreadable entry —{' '}
            {String(payloadView.reason)}.
          </p>
        </div>
      );
    default:
      return (
        <div className="replay-io" data-arena-step-io="unknown">
          <p>
            <ReplayTruthMark truthClass="unknown" /> Unknown payload shape.
          </p>
        </div>
      );
  }
}

function StepInspectorSection(props: { readonly view: ReplayRunScreenModel }) {
  const { inspection, timeline } = props.view.detail;
  const stepHref = (step: number) =>
    replayStepHref({
      runHrefBase: props.view.runHrefBase,
      runKey: props.view.detail.runKey,
      step,
      activeRoleId: props.view.roleSwitch.activeRoleId,
    });
  return (
    <section
      className="replay-inspector-section"
      aria-labelledby="replay-inspector-title"
      data-arena-step-inspector="true"
      data-arena-selection-state={inspection.state}
    >
      <h2 id="replay-inspector-title">Step inspector</h2>
      {inspection.step === null ? (
        <EmptyState
          title={
            inspection.state === 'out-of-range'
              ? `Step ${String(inspection.requestedSequence)} does not exist`
              : 'No step selected'
          }
          hint={inspection.note}
        />
      ) : (
        <div className="replay-inspector-section__body">
          <p className="replay-inspector-section__note">{inspection.note}</p>
          <div
            className="replay-step-detail"
            data-arena-selected-step={inspection.step.sequence}
            data-arena-selected-kind={inspection.step.kind}
          >
            <div className="replay-step-detail__head">
              <strong>
                Step #{String(inspection.step.sequence)} — {inspection.step.kindLabel}
              </strong>
              <ReplayTruthMark
                truthClass={
                  (inspection.step.truthClass as ReplayTruthClass) ?? 'unknown'
                }
              />
              {props.view.demo.isDemo ? <DemoDataBadge /> : null}
            </div>
            <p className="replay-step-detail__summary">{inspection.step.summary}</p>
            <p className="replay-step-detail__clock">
              Wall clock: <Maybe value={inspection.step.occurredAt} />
              {inspection.step.wallClockDeltaMs !== null
                ? ` (+${String(inspection.step.wallClockDeltaMs)}ms since the previous readable step)`
                : ''}
            </p>
            <p className="replay-step-detail__chain">
              Step digest <code>{shortDigest(inspection.step.stepDigest)}</code>, anchored to{' '}
              <code>{shortDigest(inspection.step.prevDigest)}</code>
            </p>
            <StepPayloadView payloadView={inspection.step.payloadView} />
          </div>
          <p className="replay-inspector-section__nav" data-arena-step-nav="true">
            {inspection.previousSequence !== null ? (
              <a href={stepHref(inspection.previousSequence)}>
                ← Previous step (#{String(inspection.previousSequence)})
              </a>
            ) : (
              <span>← No previous step</span>
            )}
            {inspection.nextSequence !== null ? (
              <a href={stepHref(inspection.nextSequence)}>
                Next step (#{String(inspection.nextSequence)}) →
              </a>
            ) : (
              <span>No next step →</span>
            )}
          </p>
          <p className="replay-inspector-section__hint">
            Select any timeline step (including gap markers) to inspect its I/O — selection is
            explicit query state; the timeline has {String(timeline.steps.length)} row(s).
          </p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The environment event stream
// ---------------------------------------------------------------------------

function EventStreamSection(props: { readonly view: ReplayRunScreenModel }) {
  const { eventStream } = props.view.detail;
  return (
    <section
      className="replay-events"
      aria-labelledby="replay-events-title"
      data-arena-event-stream-section="true"
      data-arena-event-stream-state={eventStream.state}
    >
      <h2 id="replay-events-title">Environment event stream</h2>
      <p className="replay-events__note">{eventStream.note}</p>
      {eventStream.events.length === 0 ? (
        <EmptyState
          title={
            eventStream.state === 'no-data'
              ? 'No environment event stream (no data)'
              : 'Empty environment event stream'
          }
          hint={
            eventStream.state === 'no-data'
              ? 'No event stream was provided for this run — distinct from an existing-but-empty stream.'
              : 'A stream exists but records zero events.'
          }
        />
      ) : (
        <div
          className="replay-events__scroll"
          role="region"
          aria-label="Environment event stream table"
          tabIndex={0}
        >
          <table className="replay-events__table">
            <thead>
              <tr>
                <th scope="col">Seq</th>
                <th scope="col">Event</th>
                <th scope="col">Summary</th>
                <th scope="col">Wall clock</th>
                <th scope="col">Linked step</th>
              </tr>
            </thead>
            <tbody>
              {eventStream.events.map((row, index) => (
                <tr
                  key={`${String(row.sequence ?? 'x')}-${String(index)}`}
                  data-arena-event={row.kind}
                  data-arena-event-truth={replayTruthClassTreatment(row.truthClass)}
                >
                  <td>{row.sequence === null ? `#${String(index + 1)}` : `#${String(row.sequence)}`}</td>
                  <td>
                    {plainTruthMark(row.truthClass)} {row.kindLabel}
                    {props.view.demo.isDemo ? <DemoDataBadge /> : null}
                  </td>
                  <td>{row.summary}</td>
                  <td>
                    <Maybe value={row.occurredAt} />
                  </td>
                  <td>
                    {row.linkedStep === null ? (
                      '—'
                    ) : (
                      <a
                        href={replayStepHref({
                          runHrefBase: props.view.runHrefBase,
                          runKey: props.view.detail.runKey,
                          step: row.linkedStep,
                          activeRoleId: props.view.roleSwitch.activeRoleId,
                        })}
                      >
                        step #{String(row.linkedStep)}
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The result linkage (evidence / evaluation / verification)
// ---------------------------------------------------------------------------

function LinkageSection(props: { readonly view: ReplayRunScreenModel }) {
  const { linkage } = props.view.detail;
  return (
    <section
      className="replay-linkage"
      aria-labelledby="replay-linkage-title"
      data-arena-linkage-section="true"
    >
      <h2 id="replay-linkage-title">Linked artifacts (result linkage)</h2>
      <p className="replay-linkage__note">
        Evidence addresses are append-only content digests; evaluation records render as
        evaluation results (never verified); verification records render as their own class —
        none of them collapses into a generic &quot;AI result&quot;.
      </p>

      <h3>Evidence addresses</h3>
      {linkage.evidence.length === 0 ? (
        <EmptyState
          title="No evidence addresses"
          hint="This run declared no evidence digests — nothing is fabricated."
        />
      ) : (
        <ul className="replay-linkage__evidence" data-arena-linkage-evidence="true">
          {linkage.evidence.map((link) => (
            <li key={`${link.source}-${link.digest}`} data-arena-evidence-digest={link.digest}>
              <TruthBadge kind="evidence" /> <code>{link.digest}</code>{' '}
              <span className="replay-linkage__source">({link.source})</span>
              {props.view.demo.isDemo ? <DemoDataBadge /> : null}
            </li>
          ))}
        </ul>
      )}

      <h3>Evaluation results</h3>
      {linkage.evaluations.length === 0 ? (
        <EmptyState
          title="No evaluation records linked to this run"
          hint="Evaluation records bind to runs by trajectory digest; none address this run's trajectory."
        />
      ) : (
        <ul className="replay-linkage__evaluations" data-arena-linkage-evaluations="true">
          {linkage.evaluations.map((link) => (
            <li
              key={link.recordId}
              data-arena-evaluation-readable={link.readable ? 'true' : 'false'}
            >
              <div className="replay-linkage__head">
                <TruthBadge kind="evaluation" />
                {props.view.demo.isDemo ? <DemoDataBadge /> : null}
                <code>{shortDigest(link.digest)}</code>
              </div>
              {link.readable ? (
                <p>
                  Aggregate score <strong>{String(link.aggregateScore)}</strong> (
                  {String(link.aggregateOutcome)}) over {String(link.verdictCount)} verdict(s);
                  judged trajectory <code>{shortDigest(link.trajectoryRef)}</code> against
                  criteria <code>{shortDigest(link.criteriaRef)}</code>. {link.note}
                </p>
              ) : (
                <p>
                  <ReplayTruthMark truthClass="unknown" /> {link.note}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Verification records</h3>
      {linkage.verifications.length === 0 ? (
        <EmptyState
          title="No verification records linked to this run"
          hint="Verification records establish which required evidence exists and supports which claims; none are linked here."
        />
      ) : (
        <ul className="replay-linkage__verifications" data-arena-linkage-verifications="true">
          {linkage.verifications.map((link) => (
            <li
              key={link.recordId}
              data-arena-verification-readable={link.readable ? 'true' : 'false'}
              data-arena-verification-outcome={String(link.outcome)}
            >
              <div className="replay-linkage__head">
                {link.truthClass === 'verified-fact' ? (
                  <TruthBadge kind="verified" />
                ) : (
                  <ReplayTruthMark truthClass="unknown" />
                )}
                {props.view.demo.isDemo ? <DemoDataBadge /> : null}
                <code>{shortDigest(link.digest)}</code>
              </div>
              {link.readable ? (
                <p>
                  Outcome <strong>{String(link.outcome)}</strong> over{' '}
                  {String(link.requirementsCount)} requirement(s) (
                  {String(link.supportedCount)} supported); verifier{' '}
                  <code>{shortDigest(link.verifierRef)}</code>. {link.note}
                </p>
              ) : (
                <p>
                  <ReplayTruthMark truthClass="unknown" /> {link.note}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {linkage.degradation.length > 0 ? (
        <div className="replay-linkage__degradation" data-arena-linkage-degradation="true">
          <h3>Linkage degradation</h3>
          <ul>
            {linkage.degradation.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function ReplayRunView({ view }: { readonly view: ReplayRunScreenModel }) {
  const { detail } = view;
  return (
    <div
      className="replay-surface replay-surface--run"
      data-arena-route="replay-run"
      data-arena-surface-mode={view.mode}
      data-arena-run={detail.runId}
      data-arena-run-outcome={detail.timeline.outcome}
    >
      <PageHeader
        title={`Run replay — ${detail.runKey}`}
        description={`The append-only record of run ${detail.runId}. Observational inspection only — the timeline, the environment event stream and every linked artifact render as themselves.`}
      />

      <ReplayObservationalBanner note={detail.observationalNote} />

      {view.demo.isDemo ? (
        <ReplayDemoBanner {...(view.demo.corpusHash !== undefined ? { corpusHash: view.demo.corpusHash } : {})} />
      ) : null}

      <ReplayRoleBar
        roleSwitch={view.roleSwitch}
        {...(detail.inspection.requestedSequence !== null
          ? { preserveQuery: `step=${String(detail.inspection.requestedSequence)}` }
          : {})}
      />

      <RunFactsSection view={view} />
      <TimelineSection view={view} />
      <StepInspectorSection view={view} />
      <EventStreamSection view={view} />
      <LinkageSection view={view} />

      <ReplayTruthLegend />

      <ReplaySurfaceFactsAside facts={view} rows={detail.timeline.steps} totalKnown={detail.timeline.steps.length} />

      <p className="replay-surface__back">
        <a href={view.runHrefBase}>Back to the replay run list</a>
      </p>
    </div>
  );
}
