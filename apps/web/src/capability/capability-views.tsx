/**
 * CaseListView / CaseDetailView / TaskDetailView — the presentational
 * capability surfaces (Work Order B008; issue #80; apps/web/src/capability).
 *
 * SYNC presentational components (renderable through react-dom/server in
 * the house test style): the async composition (session probe, canonical
 * reads, flow execution) lives in the composition modules; these render
 * the resulting view models deterministically.
 *
 * Product truths rendered here:
 *   - every datum carries its canonical state classification (B007
 *     state-mark pattern; distinct pending/unknown marks; injective);
 *   - role is a LENS, never an authorization;
 *   - lifecycle status is canonical (A005) — never invented;
 *   - demo mode renders under the B006 labelling contract;
 *   - no fabricated progress: guided steps render done/current/upcoming
 *     strictly from the canonical lifecycle history.
 */

import {
  DemoDataBadge,
  DeniedState,
  EmptyState,
  PageHeader,
  PrimaryAction,
  TruthBadge,
} from '@arena/ui-platform';
import type { StateKind } from '@arena/ui-platform';
import { DEMO_LABELLING } from '@arena/demo';
import { isBadgeTreatment } from '../cockpit/state-mark.js';
import type { CockpitTruthTreatment } from '../cockpit/state-mark.js';
import type { RoleId } from '../../../../packages/role-context/src/index.js';
import type {
  CapabilityDatum,
  CaseDetailViewModel,
  CaseListViewModel,
  GuidedStepRow,
  TaskDetailViewModel,
} from './case-view.js';
import type { CaseCard } from './case-view.js';

const ROLE_LENS_NOTE =
  'Role context is a lens — it changes what this surface emphasizes for you, never what you are authorized to do.';

/** The distinct capability mark for the honesty-critical kinds B001 has no badge for. */
function CapabilityTruthMark(props: {
  readonly treatment: CockpitTruthTreatment;
  readonly label: string;
  readonly title?: string;
}) {
  const { treatment, label, title } = props;
  if (isBadgeTreatment(treatment)) {
    return <TruthBadge kind={treatment as StateKind} />;
  }
  return (
    <span
      className={`capability-truth capability-truth--${treatment}`}
      data-arena-truth={treatment}
      {...(title !== undefined ? { title } : {})}
    >
      <span className="capability-truth__marker" aria-hidden="true" />
      <span className="capability-truth__label">{label}</span>
    </span>
  );
}

function DatumRow(props: { readonly datum: CapabilityDatum }) {
  const { datum: entry } = props;
  return (
    <div className="capability-datum" data-arena-datum-label={entry.label}>
      <dt>
        {entry.label}
        <CapabilityTruthMark treatment={entry.treatment} label={entry.stateLabel} title={`Canonical classification: ${entry.stateKind}`} />
      </dt>
      <dd>{entry.text}</dd>
    </div>
  );
}

function DatumList(props: { readonly data: readonly CapabilityDatum[] }) {
  if (props.data.length === 0) {
    return <p className="capability-datum__empty">Nothing recorded here yet — nothing is fabricated to fill the space.</p>;
  }
  return (
    <dl className="capability-datadict" data-arena-datadict="true">
      {props.data.map((entry) => (
        <DatumRow key={`${entry.label}-${entry.text}`} datum={entry} />
      ))}
    </dl>
  );
}

function RoleSwitcher(props: { readonly view: { readonly roleSwitch: CaseListViewModel['roleSwitch']; readonly roleHrefBase: string } }) {
  const { roleSwitch, roleHrefBase } = props.view;
  return (
    <nav className="capability-roles" aria-label="Role lens switcher" data-arena-role-switcher="true">
      <ul>
        {roleSwitch.grantedRoleIds.map((roleId: RoleId) => {
          const active = roleId === roleSwitch.activeRoleId;
          return (
            <li key={roleId}>
              <a
                href={`${roleHrefBase}?role=${roleId}`}
                className={active ? 'capability-role capability-role--active' : 'capability-role'}
                {...(active ? { 'aria-current': 'page' as const } : {})}
              >
                {roleId}
              </a>
            </li>
          );
        })}
      </ul>
      <p className="capability-roles__note">{ROLE_LENS_NOTE}</p>
    </nav>
  );
}

function DemoBanner(props: { readonly view: { readonly demo: { readonly isDemo: boolean; readonly corpusHash?: string } } }) {
  const { demo } = props.view;
  if (!demo.isDemo) return null;
  return (
    <section className="capability-demo-banner" aria-label="Demo mode notice" data-arena-demo-banner="true">
      <DemoDataBadge note="deterministic seed" />
      <p>
        <strong>{DEMO_LABELLING.bannerTitle}.</strong> {DEMO_LABELLING.bannerText}
      </p>
      {demo.corpusHash !== undefined ? (
        <p className="capability-demo-banner__hash" data-arena-corpus-hash="true">
          Demo corpus hash: <code>{demo.corpusHash.slice(0, 72)}…</code>
        </p>
      ) : null}
    </section>
  );
}

function DeniedRoleNotice(props: { readonly view: { readonly roleSwitch: CaseListViewModel['roleSwitch'] } }) {
  const { roleSwitch } = props.view;
  if (!roleSwitch.denied) return null;
  return (
    <section aria-label="Role request outcome" data-arena-role-denied="true">
      <DeniedState
        message={`The requested role context (${String(roleSwitch.deniedRequested)}) is not granted to you in this workspace — showing your granted ${String(roleSwitch.activeRoleId)} lens instead.`}
        requiredAuthority={`granted role: ${String(roleSwitch.deniedRequested)}`}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Case list
// ---------------------------------------------------------------------------

function CaseListCard(props: { readonly card: CaseCard; readonly base: string }) {
  const { card, base } = props;
  const href = `${base}/${encodeURIComponent(card.recordId)}`;
  return (
    <li className="capability-card" data-arena-case={card.recordId} data-arena-case-shape={card.shape}>
      <div className="capability-card__head">
        <a href={href} className="capability-card__title">
          {card.title}
        </a>
        {card.demo ? <DemoDataBadge /> : null}
      </div>
      <p className="capability-card__summary">{card.summary}</p>
      <div className="capability-card__facts">
        {card.facts.map((entry) => (
          <span key={`${card.recordId}-${entry.label}`} className="capability-chip">
            <span className="capability-chip__label">{entry.label}:</span> {entry.text}{' '}
            <CapabilityTruthMark treatment={entry.treatment} label={entry.stateLabel} title={`Canonical classification: ${entry.stateKind}`} />
          </span>
        ))}
      </div>
      {card.nextStep !== undefined ? (
        <p className="capability-card__next" data-arena-next-step={card.nextStep.stepId}>
          Next guided step: <strong>{card.nextStep.title}</strong> — {card.nextStep.guidance}
        </p>
      ) : null}
      {card.shape === 'narrative' ? (
        <p className="capability-card__note" data-arena-narrative-note="true">
          Narrative demo record — the guided flow starts a NEW canonical case rather than transitioning this one.
        </p>
      ) : null}
    </li>
  );
}

export function CaseListView(props: { readonly view: CaseListViewModel }) {
  const { view } = props;
  const startHref = view.mode === 'demo' ? '/demo/cases/start' : '/cases/start';
  return (
    <div className="capability" data-arena-route="cases" data-arena-mode={view.mode} data-arena-active-role={view.roleSwitch.activeRoleId}>
      <PageHeader
        title={view.lens.heading}
        description={view.lens.intro}
        actions={<PrimaryAction href={startHref} testId="cases-start">Start a capability case</PrimaryAction>}
      />
      <DemoBanner view={view} />
      <RoleSwitcher view={view} />
      <DeniedRoleNotice view={view} />
      {view.lens.notPrimarySurface ? (
        <p className="capability-lens-note" data-arena-not-primary="true">
          Cases are not this role’s primary surface — you are seeing the shared case list through a neutral reading.
        </p>
      ) : null}
      {view.empty ? (
        <EmptyState
          title="No capability cases yet"
          hint="Starting a case walks the whole capability-development path with you: start it from the action above."
        />
      ) : (
        <ul className="capability-cards" data-arena-case-cards="true">
          {view.cards.map((card) => (
            <CaseListCard key={card.recordId} card={card} base={view.roleHrefBase} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case detail
// ---------------------------------------------------------------------------

function GuidedStepRowView(props: { readonly row: GuidedStepRow; readonly detail: CaseDetailViewModel; readonly caseId: string }) {
  const { row, detail, caseId } = props;
  const { step, phase } = row;
  const actionHref =
    detail.mode === 'demo'
      ? `/demo/cases/${encodeURIComponent(detail.recordId)}/continue`
      : `/cases/${encodeURIComponent(detail.recordId)}/continue`;
  return (
    <li
      className={`capability-step capability-step--${phase}`}
      data-arena-guided-step={step.stepId}
      data-arena-guided-phase={phase}
    >
      <span className="capability-step__order" aria-hidden="true">{String(step.order)}</span>
      <div className="capability-step__body">
        <strong>{step.title}</strong>
        <p>{step.guidance}</p>
        {phase === 'current' && detail.shape === 'canonical' ? (
          <form method="post" action={actionHref} className="capability-step__form" data-arena-flow-form={step.stepId}>
            <input type="hidden" name="stepId" value={step.stepId} />
            <input type="hidden" name="caseId" value={caseId} />
            {step.transition === 'triage' ? (
              <label>
                Triage rationale (required — stays inspectable)
                <textarea name="note" required rows={2} placeholder="Why this case is selected for capability development" />
              </label>
            ) : null}
            {step.transition === 'resolve' ? (
              <label>
                Resolution statement (required — the outcome, terminal)
                <textarea name="resolution" required rows={2} placeholder="The outcome this case is resolved with" />
              </label>
            ) : null}
            {step.transition === 'attach-evidence' ? (
              <>
                <label>
                  Evidence digest (sha256, NEW — append-only)
                  <input name="evidenceDigest" required pattern="[0-9a-f]{64}" placeholder="64 hex characters" />
                </label>
                <label>
                  Evidence description
                  <input name="evidenceDescription" required placeholder={`What this ${step.stepId} evidence shows`} />
                </label>
              </>
            ) : null}
            {step.transition === 'submit' || step.transition === 'activate' ? (
              <label>
                Note (optional, recorded on the event)
                <input name="note" placeholder="Optional note" />
              </label>
            ) : null}
            <button type="submit">{step.title}</button>
            <p className="capability-step__inputnote">{step.inputNote}</p>
          </form>
        ) : null}
      </div>
    </li>
  );
}

export function CaseDetailView(props: { readonly view: CaseDetailViewModel }) {
  const { view } = props;
  const startHref = view.mode === 'demo' ? '/demo/cases/start' : '/cases/start';
  return (
    <div className="capability" data-arena-route="case-detail" data-arena-mode={view.mode} data-arena-case-shape={view.shape} data-arena-active-role={view.roleSwitch.activeRoleId}>
      <PageHeader title={view.lens.lensName} description={view.lens.question} />
      <DemoBanner view={view} />
      <RoleSwitcher view={view} />
      <DeniedRoleNotice view={view} />
      <section className="capability-case-head" aria-labelledby="capability-case-title">
        <h2 id="capability-case-title">{view.title}</h2>
        <p>{view.summary}</p>
        <DatumList data={view.facts} />
        {view.lens.notPrimarySurface ? (
          <p className="capability-lens-note" data-arena-not-primary="true">
            Cases are not this role’s primary surface — a neutral reading of the shared case object.
          </p>
        ) : null}
      </section>

      {view.shape === 'canonical' ? (
        <>
          <section className="capability-guided" aria-labelledby="capability-guided-title" data-arena-guided="true">
            <h2 id="capability-guided-title">The guided capability-development path</h2>
            <p>
              Where this case stands — read strictly from the canonical lifecycle. No step is marked done before its lifecycle event exists.
            </p>
            <ol className="capability-steps">
              {view.guided.map((row) => (
                <GuidedStepRowView key={row.step.stepId} row={row} detail={view} caseId={view.caseId} />
              ))}
            </ol>
            {view.terminal ? (
              <div className="capability-deadend" data-arena-dead-end="true">
                <EmptyState
                  title="This case is terminal"
                  hint={`${view.supplement.terminalNote} ${view.supplement.followUp} ${view.supplement.supersede}`}
                />
                <PrimaryAction href={startHref} testId="case-followup-start">Start a follow-up case</PrimaryAction>
              </div>
            ) : null}
          </section>

          {view.requirements.map((group) => (
            <section key={group.group} className="capability-reqgroup" aria-labelledby={`req-${group.group}`}>
              <h2 id={`req-${group.group}`}>{group.group}</h2>
              <DatumList data={group.entries} />
            </section>
          ))}

          <section className="capability-history" aria-labelledby="capability-history-title">
            <h2 id="capability-history-title">Lifecycle history (append-only)</h2>
            {view.history.length === 0 ? (
              <EmptyState title="No lifecycle events" hint="The canonical event log is empty for this record." />
            ) : (
              <ol className="capability-events" data-arena-lifecycle-events="true">
                {view.history.map((event) => (
                  <li key={String(event.sequence)} data-arena-event={event.kind}>
                    <span className="capability-events__seq" aria-hidden="true">{String(event.sequence)}</span>{' '}
                    <code>{event.kind}</code> · {event.fromStatus} → {event.toStatus} · by{' '}
                    <code>{event.actor}</code> at <code>{event.occurredAt}</code>
                    {event.note !== undefined ? <p className="capability-events__note">{event.note}</p> : null}
                  </li>
                ))}
              </ol>
            )}
            <p className="capability-history__note">
              Record-integrity note: every render of this case re-verifies its content digest. That is record
              integrity — it is NOT capability verification (A013); evaluation and verification results carry their
              own distinct classifications when they exist.
            </p>
          </section>
        </>
      ) : (
        <section className="capability-narrative" data-arena-narrative-case="true">
          <p>
            This demo record is narrative-shaped: it is not a canonical A005 case protocol object, so the guided
            lifecycle (submit → triage → activate → evidence → resolve) does not apply to it. Start a NEW canonical
            case to walk the guided workflow.
          </p>
          <PrimaryAction href={startHref} testId="narrative-start">Start a canonical case</PrimaryAction>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task detail
// ---------------------------------------------------------------------------

export function TaskDetailView(props: { readonly view: TaskDetailViewModel }) {
  const { view } = props;
  const caseHref =
    view.caseRecordId !== undefined
      ? `${view.mode === 'demo' ? '/demo/cases' : '/cases'}/${encodeURIComponent(view.caseRecordId)}`
      : undefined;
  return (
    <div className="capability" data-arena-route="task" data-arena-mode={view.mode} data-arena-task-shape={view.shape} data-arena-active-role={view.roleSwitch.activeRoleId}>
      <PageHeader title={view.lens.lensName} description={view.lens.question} />
      <DemoBanner view={view} />
      <RoleSwitcher view={view} />
      <DeniedRoleNotice view={view} />
      <section className="capability-task-head" aria-labelledby="capability-task-title">
        <h2 id="capability-task-title">{view.title}</h2>
        <p>{view.summary}</p>
        <DatumList data={view.facts} />
        {view.shape === 'task-spec' ? (
          <p className="capability-task__proposal" data-arena-task-proposal="true">
            A TaskSpec is a PROPOSAL until pinned. A proposal is not an execution, a result, or a verification claim.
          </p>
        ) : null}
        {view.narrative !== undefined && caseHref !== undefined ? (
          <p className="capability-task__case">
            Embedded in case <a href={caseHref}>{view.narrative.caseRecordId}</a> — narrative demo state, visibly labelled.
          </p>
        ) : null}
        {view.shape === 'narrative' && view.narrative === undefined ? (
          <EmptyState title="Task not found" hint={view.summary} />
        ) : null}
      </section>
      <section className="capability-task-objectives" aria-labelledby="task-objectives">
        <h2 id="task-objectives">Objectives</h2>
        <DatumList data={view.objectives} />
      </section>
      <section className="capability-task-constraints" aria-labelledby="task-constraints">
        <h2 id="task-constraints">Constraints</h2>
        <DatumList data={view.constraints} />
      </section>
      <section className="capability-task-tools" aria-labelledby="task-tools">
        <h2 id="task-tools">Permitted tools</h2>
        <DatumList data={view.tools} />
      </section>
      <section className="capability-task-outputs" aria-labelledby="task-outputs">
        <h2 id="task-outputs">Expected outputs</h2>
        <DatumList data={view.outputs} />
      </section>
    </div>
  );
}
