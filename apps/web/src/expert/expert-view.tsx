/**
 * Expert Workbench presentational views (Work Order B009; issue #81;
 * apps/web/src/expert).
 *
 * SYNC presentational components (renderable through react-dom/server in
 * the house test style): the async composition (session probe, canonical
 * reads, evidence appends) happens in the apps/web/src/expert composition
 * modules, and these components render the resulting view models
 * deterministically — no Date.now(), no randomness, no implicit time.
 *
 * THE governing truths rendered here:
 *   - the expert workbench is the EXPERT LENS of the product (RC1.0:
 *     role context is a lens — permission enforcement stays server-side
 *     and policy-driven; the cockpit owns the global role switcher);
 *   - qualification is rendered as qualification — scoped judgment
 *     domains, never authorization, never verification;
 *   - every surfaced datum carries its canonical state classification
 *     (distinct treatments; unknown/pending render as unknown/pending);
 *   - structural lifecycle states render VERBATIM from the canonical
 *     record; unrecognized states render as carried-with-unknown-class,
 *     never guessed;
 *   - demo mode renders under the B006 labelling contract — demo state is
 *     always visibly labelled and never mistaken for customer state.
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
import { isBadgeTreatment } from './state-mark.js';
import type { ExpertTruthTreatment, StructuralState } from './state-mark.js';
import type {
  AssignedCasesViewModel,
  AssignedWorkViewModel,
  ExpertAssignmentRow,
  ExpertQualificationCard,
  AssignedCaseRow,
  TruthClassification,
} from './assignment.js';

/** The persistent "role is a lens, not authorization" note for this surface. */
const EXPERT_LENS_NOTE =
  'This is the Expert lens of the product shell. Switching lenses (on the home cockpit) changes what the product emphasizes — never what you are authorized to do. Permissions stay server-side and policy-driven.';

/** The persistent replay note for trajectory surfaces. */
export const REPLAY_NOTE =
  'This timeline is an observational replay of a recorded run — it is not a live-world mutation of anything.';

// ---------------------------------------------------------------------------
// Shared marks
// ---------------------------------------------------------------------------

/** The distinct expert mark for the two honesty-critical kinds B001 has no badge for. */
export function ExpertTruthMark(props: {
  readonly treatment: ExpertTruthTreatment;
  readonly label: string;
  readonly meaning: string;
}) {
  const { treatment, label, meaning } = props;
  if (isBadgeTreatment(treatment)) {
    return <TruthBadge kind={treatment as StateKind} />;
  }
  return (
    <span
      className={`expert-truth expert-truth--${treatment}`}
      data-arena-truth={treatment}
      title={meaning}
    >
      <span className="expert-truth__marker" aria-hidden="true" />
      <span className="expert-truth__label">{label}</span>
    </span>
  );
}

/** Render one classified truth (badge or distinct pending/unknown mark). */
function TruthMark(props: { readonly truth: TruthClassification }) {
  const { truth } = props;
  return (
    <ExpertTruthMark
      treatment={truth.treatment}
      label={truth.label}
      meaning={`Canonical classification: ${truth.kind}`}
    />
  );
}

/**
 * One STRUCTURAL lifecycle state chip: the value renders VERBATIM as the
 * canonical record carries it; unrecognized values keep their carried text
 * but are marked unknown-class — never guessed into a neighbor state.
 */
export function StateChip(props: {
  readonly label: string;
  readonly state: StructuralState;
  readonly kind: 'task' | 'case' | 'run' | 'trajectory' | 'outcome';
  readonly cls?: string;
}) {
  const { label, state, kind, cls } = props;
  const value = state.value.length > 0 ? state.value : 'unknown';
  return (
    <span
      className={`expert-state expert-state--${kind}`}
      data-arena-state-chip={kind}
      data-arena-state-value={state.value}
      data-arena-state-recognized={state.recognized ? 'true' : 'false'}
      {...(cls !== undefined ? { 'data-arena-state-class': cls } : {})}
      title={
        state.recognized
          ? `${label}: ${value} (canonical vocabulary)`
          : `${label}: carried as \u201C${value}\u201D — outside the closed vocabulary, rendered as carried, never guessed`
      }
    >
      <span className="expert-state__label">{label}</span>
      <span className="expert-state__value">{value}</span>
      {state.recognized ? null : (
        <span className="expert-state__flag" data-arena-state-unknown="true">
          unrecognized
        </span>
      )}
    </span>
  );
}

/** The demo banner for expert surfaces rendered under the demo posture. */
function ExpertDemoBanner() {
  return (
    <section
      className="expert-demo-banner"
      aria-label="Demo mode notice"
      data-arena-demo-banner="true"
    >
      <DemoDataBadge note="deterministic seed" />
      <p>
        <strong>{DEMO_LABELLING.bannerTitle}.</strong> {DEMO_LABELLING.bannerText}
      </p>
    </section>
  );
}

/** The canonical-read reference line (kind · record id · schema version · revision). */
function CanonicalRef(props: {
  readonly kind: string;
  readonly recordId: string;
  readonly sourceVersion: number;
  readonly sourceRevision: number;
}) {
  return (
    <p className="expert-ref">
      canonical read: <code>{props.kind}</code> · <code>{props.recordId}</code> · schema v
      {String(props.sourceVersion)} · rev {String(props.sourceRevision)}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Assigned work (the expert landing — UXM1.0 `/` expert lens)
// ---------------------------------------------------------------------------

function QualificationCard(props: { readonly card: ExpertQualificationCard }) {
  const { card } = props;
  return (
    <li
      className="expert-qualification"
      data-arena-qualification={card.recordId}
      data-arena-qualification-domain={card.domain}
    >
      <div className="expert-qualification__head">
        <strong>{card.title}</strong>
        <TruthMark truth={card.truth} />
        {card.demo ? <DemoDataBadge /> : null}
      </div>
      <p className="expert-qualification__judgment">{card.judgmentSummary}</p>
      <p className="expert-qualification__meta">
        {card.basis.length > 0 ? <>Basis: {card.basis}. </> : null}
        {card.scope.length > 0 ? <>Scoped to: {card.scope.join(', ')}.</> : null}
      </p>
      <CanonicalRef
        kind={card.kind}
        recordId={card.recordId}
        sourceVersion={card.sourceVersion}
        sourceRevision={card.sourceRevision}
      />
    </li>
  );
}

function AssignmentRow(props: { readonly row: ExpertAssignmentRow }) {
  const { row } = props;
  return (
    <li
      className="expert-assignment"
      data-arena-assignment={row.taskId}
      data-arena-assignment-class={row.taskStateClass}
    >
      <div className="expert-assignment__head">
        <a className="expert-assignment__link" href={row.href}>
          {row.taskTitle}
        </a>
        <StateChip label="task" state={row.taskState} kind="task" cls={row.taskStateClass} />
        <StateChip label="case" state={row.lifecycle} kind="case" />
        <TruthMark truth={row.truth} />
        {row.demo ? <DemoDataBadge /> : null}
      </div>
      <p className="expert-assignment__case">
        Case: {row.caseTitle}
        {row.assignedExpertId !== undefined ? (
          <>
            {' '}· assigned by record to <code>{row.assignedExpertId}</code>
          </>
        ) : null}
      </p>
      <CanonicalRef
        kind="capability-case"
        recordId={row.caseRecordId}
        sourceVersion={row.sourceVersion}
        sourceRevision={row.sourceRevision}
      />
    </li>
  );
}

function ExpertInspector(props: {
  readonly view: AssignedWorkViewModel | AssignedCasesViewModel;
  readonly principalId: string | undefined;
}) {
  const { view, principalId } = props;
  const recordCount = view.inventory.kinds.reduce((total, entry) => total + entry.count, 0);
  return (
    <aside
      className="expert-inspector"
      aria-label="Expert context inspector"
      data-arena-expert-inspector="true"
    >
      <h2>Expert context</h2>
      <dl className="expert-inspector__facts">
        <div>
          <dt>Active lens</dt>
          <dd data-arena-inspector-role="expert">Expert — {EXPERT_LENS_NOTE}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>
            <code>{view.tenantId}</code> · <code>{view.workspaceId}</code>
          </dd>
        </div>
        {principalId !== undefined ? (
          <div>
            <dt>Principal</dt>
            <dd data-arena-inspector-principal={principalId}>
              {view.principalLabel} (<code>{principalId}</code>)
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Read model</dt>
          <dd>
            {view.inventory.kinds
              .map((entry) => `${entry.kind} (${String(entry.count)})`)
              .join(', ')}
          </dd>
        </div>
        <div>
          <dt>Records read</dt>
          <dd>
            {String(recordCount)} record{recordCount === 1 ? '' : 's'}
            {view.readAt > 0 ? ` · read at ${new Date(view.readAt).toISOString()}` : ''}
          </dd>
        </div>
      </dl>
      {view.demo.isDemo && view.demo.corpusHash !== undefined ? (
        <p className="expert-inspector__hash" data-arena-corpus-hash="true">
          Demo corpus hash: <code>{view.demo.corpusHash.slice(0, 72)}…</code>
        </p>
      ) : null}
    </aside>
  );
}

/** The assigned-work landing (session + demo postures). */
export function AssignedWorkView({ view }: { readonly view: AssignedWorkViewModel }) {
  const open = view.openAssignments;
  const done = view.doneAssignments;
  const firstOpen = open[0];
  return (
    <div
      className="expert"
      data-arena-route="expert"
      data-arena-expert-surface="assigned-work"
      data-arena-expert-mode={view.mode}
      data-arena-active-role="expert"
    >
      <PageHeader
        title="Assigned work"
        description={`${view.roleName} — ${view.roleGoal}`}
        actions={
          <PrimaryAction
            href={firstOpen !== undefined ? firstOpen.href : view.casesHref}
            testId="expert-hero"
          >
            {firstOpen !== undefined ? 'Enter the workbench' : 'Open assigned cases'}
          </PrimaryAction>
        }
      />

      {view.demo.isDemo ? <ExpertDemoBanner /> : null}

      <section className="expert-qualifications" aria-labelledby="expert-qualifications-title">
        <h2 id="expert-qualifications-title">Your qualifications</h2>
        <p className="expert-qualifications__note" data-arena-qualification-note="true">
          {view.qualificationNote}
        </p>
        {view.qualifications.length === 0 ? (
          <EmptyState
            title="No expert qualifications in this workspace yet"
            hint="The canonical read path returned no expert-qualification records. Qualification scopes judgment — nothing here grants or implies authorization."
          />
        ) : (
          <ul className="expert-qualifications__cards" data-arena-qualifications="true">
            {view.qualifications.map((card) => (
              <QualificationCard key={card.recordId} card={card} />
            ))}
          </ul>
        )}
      </section>

      <section className="expert-assignments" aria-labelledby="expert-assignments-title">
        <h2 id="expert-assignments-title">What work am I assigned?</h2>
        <p className="expert-assignments__note" data-arena-assignment-note="true">
          {view.assignmentNote}
        </p>
        {view.assignments.length === 0 ? (
          <EmptyState
            title="No assigned work yet"
            hint="The canonical read path returned no capability-case records carrying a task list for this workspace. Nothing is fabricated to fill the queue."
          />
        ) : (
          <>
            <h3 className="expert-assignments__subhead">Open work ({String(open.length)})</h3>
            {open.length === 0 ? (
              <EmptyState
                title="No open work"
                hint="Every task the case records carry is completed. Completed rows stay visible below — history is append-only, never hidden."
              />
            ) : (
              <ul className="expert-assignments__rows" data-arena-assignments-open="true">
                {open.map((row) => (
                  <AssignmentRow key={`${row.caseRecordId}:${row.taskId}`} row={row} />
                ))}
              </ul>
            )}
            {done.length > 0 ? (
              <>
                <h3 className="expert-assignments__subhead">Completed ({String(done.length)})</h3>
                <ul className="expert-assignments__rows" data-arena-assignments-done="true">
                  {done.map((row) => (
                    <AssignmentRow key={`${row.caseRecordId}:${row.taskId}`} row={row} />
                  ))}
                </ul>
              </>
            ) : null}
            {view.unknownAssignments.length > 0 ? (
              <>
                <h3 className="expert-assignments__subhead">
                  Unrecognized task states ({String(view.unknownAssignments.length)})
                </h3>
                <ul className="expert-assignments__rows" data-arena-assignments-unknown="true">
                  {view.unknownAssignments.map((row) => (
                    <AssignmentRow key={`${row.caseRecordId}:${row.taskId}`} row={row} />
                  ))}
                </ul>
                <p className="expert-assignments__unknown-note">
                  These rows carry task states outside the closed vocabulary — they render as carried,
                  never guessed into open or completed.
                </p>
              </>
            ) : null}
          </>
        )}
        {view.unrecognizedTaskEntries > 0 ? (
          <p
            className="expert-assignments__unrecognized"
            data-arena-unrecognized-tasks={String(view.unrecognizedTaskEntries)}
          >
            {String(view.unrecognizedTaskEntries)} task entr
            {view.unrecognizedTaskEntries === 1 ? 'y' : 'ies'} in canonical records could not be
            read as tasks — they are counted here and never guessed into rows.
          </p>
        ) : null}
      </section>

      <ExpertInspector view={view} principalId={view.principalId} />
    </div>
  );
}

/** The assigned-cases list (`/cases` expert lens). */
export function AssignedCasesView({ view }: { readonly view: AssignedCasesViewModel }) {
  return (
    <div
      className="expert"
      data-arena-route="expert-cases"
      data-arena-expert-surface="assigned-cases"
      data-arena-expert-mode={view.mode}
      data-arena-active-role="expert"
    >
      <PageHeader
        title="Assigned cases"
        description="The capability cases whose work this lens serves — enter the workbench from the case that assigned the work."
        actions={
          <PrimaryAction href={view.hrefBase} testId="expert-cases-hero">
            Back to assigned work
          </PrimaryAction>
        }
      />

      {view.demo.isDemo ? <ExpertDemoBanner /> : null}

      <section className="expert-cases" aria-labelledby="expert-cases-title">
        <h2 id="expert-cases-title">Cases</h2>
        {view.cases.length === 0 ? (
          <EmptyState
            title="No capability cases yet"
            hint="The canonical read path returned an empty page for capability-case in this workspace."
          />
        ) : (
          <ul className="expert-cases__rows" data-arena-cases="true">
            {view.cases.map((row: AssignedCaseRow) => (
              <li
                key={row.caseRecordId}
                className="expert-case"
                data-arena-case={row.caseRecordId}
              >
                <div className="expert-case__head">
                  <a className="expert-case__link" href={row.href}>
                    {row.caseTitle}
                  </a>
                  <StateChip label="case" state={row.lifecycle} kind="case" />
                  <TruthMark truth={row.truth} />
                  {row.demo ? <DemoDataBadge /> : null}
                </div>
                <p className="expert-case__tasks">
                  {String(row.taskTotal)} task{row.taskTotal === 1 ? '' : 's'} ·{' '}
                  {String(row.taskOpen)} open
                  {row.taskUnknown > 0 ? ` · ${String(row.taskUnknown)} unknown state` : ''}
                </p>
                <CanonicalRef
                  kind="capability-case"
                  recordId={row.caseRecordId}
                  sourceVersion={row.sourceVersion}
                  sourceRevision={row.sourceRevision}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <ExpertInspector view={view} principalId={undefined} />
    </div>
  );
}

/** The fail-closed unauthenticated outcome for expert routes (never an anonymous workbench). */
export function ExpertDeniedView(props: { readonly code: string; readonly mode: 'session' | 'demo' }) {
  return (
    <div
      className="expert expert--denied"
      data-arena-route="expert"
      data-arena-expert-surface="denied"
      data-arena-expert-mode={props.mode}
    >
      <PageHeader
        title="Assigned work"
        description="The expert workbench needs an authenticated session — it never renders an anonymous workbench."
      />
      <DeniedState
        message={`The browser session did not validate (fail closed: ${props.code}). Open the product home to sign in, or explore the labelled demo workbench.`}
        requiredAuthority="authenticated session (B004 boundary)"
      />
      <p className="expert-denied__actions">
        <a href="/">Product home</a>
        {' · '}
        <a href="/demo/expert">Demo expert workbench</a>
      </p>
    </div>
  );
}
