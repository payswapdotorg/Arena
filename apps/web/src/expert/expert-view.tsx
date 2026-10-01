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
  ErrorState,
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
import type {
  CaseWorkModel,
  CaseNotFoundViewModel,
  CaseTaskRow,
  EvaluationBlock,
  RunContext,
  SuggestionBlock,
  TaskNotFoundViewModel,
  TaskPosture,
  TaskWorkModel,
  TrajectoryStep,
  VerificationBlock,
} from './workbench.js';
import type { ExpertEvidenceCard } from './evidence.js';
import {
  BODY_NOT_MODEL_NOTE,
  EVIDENCE_APPEND_ONLY_NOTE,
  RUN_STATE_HONESTY_NOTE,
} from './workbench.js';
import { EXPERT_EVIDENCE_VERDICTS } from './evidence.js';

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

// ---------------------------------------------------------------------------
// Workbench shared panels (case work lens + task execute/review)
// ---------------------------------------------------------------------------

/** One qualification scope chip (judgment domain — never authorization). */
function QualificationScope(props: { readonly card: ExpertQualificationCard }) {
  const { card } = props;
  return (
    <li
      className="expert-scope"
      data-arena-qualification-scope={card.domain}
    >
      <strong>{card.domain}</strong>
      {card.scope.length > 0 ? <span> — {card.scope.join(', ')}</span> : null}
      <TruthMark truth={card.truth} />
      {card.demo ? <DemoDataBadge /> : null}
    </li>
  );
}

/** The run context panel: run state + trajectory outcome, honestly carried. */
function RunContextPanel(props: { readonly run: RunContext }) {
  const { run } = props;
  return (
    <section
      className="expert-run"
      aria-labelledby="expert-run-title"
      data-arena-run-context="true"
    >
      <h2 id="expert-run-title">Run state</h2>
      <p className="expert-run__note">{RUN_STATE_HONESTY_NOTE}</p>
      <div className="expert-run__states">
        <StateChip label="run" state={run.state} kind="run" />
        <StateChip label="trajectory outcome" state={run.outcome} kind="outcome" />
      </div>
      {!run.carriedState ? (
        <p className="expert-run__absent" data-arena-run-absent="true">
          The canonical record carries no run state — rendered as unknown, never guessed from the
          timeline.
        </p>
      ) : null}
    </section>
  );
}

/**
 * The trajectory timeline: an OBSERVATIONAL REPLAY of the recorded run.
 * Every step renders its carried kind distinctly — observation, action,
 * tool, result, model-output (plus the A011 checkpoint/error/completion
 * kinds); unknown kinds render as carried-with-unknown-class. A
 * model-output step is raw model output (badged as such); every other
 * recorded step is run data classified as the replay itself.
 */
function TrajectoryTimeline(props: { readonly steps: readonly TrajectoryStep[] }) {
  const { steps } = props;
  return (
    <section
      className="expert-trajectory"
      aria-labelledby="expert-trajectory-title"
      data-arena-trajectory="true"
    >
      <h2 id="expert-trajectory-title">Recorded run — trajectory replay</h2>
      <p className="expert-trajectory__note">{REPLAY_NOTE}</p>
      <span className="expert-trajectory__umbrella">
        <TruthMark
          truth={{ kind: 'simulation-replay', treatment: 'simulation', label: 'Simulation replay' }}
        />
      </span>
      {steps.length === 0 ? (
        <EmptyState
          title="The case record carries no trajectory"
          hint="There is nothing to replay — the timeline renders only what the canonical record carries."
        />
      ) : (
        <ol className="expert-trajectory__steps" data-arena-trajectory-steps="true">
          {steps.map((step, index) => (
            <li
              key={`${String(step.step)}:${String(index)}`}
              className="expert-trajectory__step"
              data-arena-step-kind={step.kind.value}
              data-arena-step-recognized={step.kind.recognized ? 'true' : 'false'}
            >
              <span className="expert-trajectory__step-number">
                {step.step > 0 ? String(step.step) : '—'}
              </span>
              <span className="expert-trajectory__step-kind">
                <StateChip label="step" state={step.kind} kind="trajectory" />
              </span>
              {step.truthAsserting ? (
                <span className="expert-trajectory__step-truth">
                  <TruthMark
                    truth={{
                      kind: 'model-output',
                      treatment: 'model-output',
                      label: 'Model output',
                    }}
                  />
                </span>
              ) : null}
              <span className="expert-trajectory__step-summary">{step.summary}</span>
              {step.tool !== undefined ? (
                <code className="expert-trajectory__step-tool">{step.tool}</code>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The evaluation panel — an EVALUATION (distinct from verification and judgment). */
function EvaluationPanel(props: { readonly evaluation: EvaluationBlock }) {
  const { evaluation } = props;
  return (
    <section
      className="expert-evaluation"
      aria-labelledby="expert-evaluation-title"
      data-arena-evaluation="true"
    >
      <h2 id="expert-evaluation-title">Evaluation</h2>
      {!evaluation.carried ? (
        <EmptyState
          title="No evaluation carried"
          hint="The canonical record carries no evaluation for this work — an evaluation verdict is never guessed from anything else."
        />
      ) : (
        <>
          <TruthMark
            truth={{ kind: 'evaluation-result', treatment: 'evaluation', label: 'Evaluation result' }}
          />
          <dl className="expert-evaluation__facts">
            {evaluation.suiteId !== undefined ? (
              <div>
                <dt>Suite</dt>
                <dd>
                  <code>{evaluation.suiteId}</code>
                </dd>
              </div>
            ) : null}
            {evaluation.verdict !== undefined ? (
              <div>
                <dt>Verdict</dt>
                <dd data-arena-evaluation-verdict={evaluation.verdict}>{evaluation.verdict}</dd>
              </div>
            ) : null}
            {evaluation.evaluatedAt !== undefined ? (
              <div>
                <dt>Evaluated at</dt>
                <dd>{evaluation.evaluatedAt}</dd>
              </div>
            ) : null}
          </dl>
          {evaluation.summary !== undefined ? <p>{evaluation.summary}</p> : null}
        </>
      )}
    </section>
  );
}

/** The verification panel — a VERIFICATION (distinct from evaluation and judgment). */
function VerificationPanel(props: { readonly verification: VerificationBlock }) {
  const { verification } = props;
  return (
    <section
      className="expert-verification"
      aria-labelledby="expert-verification-title"
      data-arena-verification="true"
    >
      <h2 id="expert-verification-title">Verification</h2>
      {!verification.carried ? (
        <EmptyState
          title="No verification carried"
          hint="The canonical record carries no verification for this work — nothing here was independently verified."
        />
      ) : (
        <>
          <TruthMark
            truth={{ kind: 'verified-fact', treatment: 'verified', label: 'Verified' }}
          />
          <dl className="expert-verification__facts">
            {verification.verifierKind !== undefined ? (
              <div>
                <dt>Verifier</dt>
                <dd>
                  <code>{verification.verifierKind}</code>
                </dd>
              </div>
            ) : null}
            {verification.verdict !== undefined ? (
              <div>
                <dt>Verdict</dt>
                <dd data-arena-verification-verdict={verification.verdict}>
                  {verification.verdict}
                </dd>
              </div>
            ) : null}
            {verification.verifiedAt !== undefined ? (
              <div>
                <dt>Verified at</dt>
                <dd>{verification.verifiedAt}</dd>
              </div>
            ) : null}
          </dl>
          {verification.checks.length > 0 ? (
            <ul className="expert-verification__checks">
              {verification.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}

/** The suggestion panel — a SUGGESTION/HYPOTHESIS, never a learned fact. */
function SuggestionPanel(props: { readonly suggestion: SuggestionBlock }) {
  const { suggestion } = props;
  if (!suggestion.carried) return null;
  return (
    <section
      className="expert-suggestion"
      aria-labelledby="expert-suggestion-title"
      data-arena-suggestion="true"
    >
      <h2 id="expert-suggestion-title">Suggested (not admitted)</h2>
      <TruthMark
        truth={{ kind: 'suggestion-hypothesis', treatment: 'suggestion', label: 'Suggestion' }}
      />
      <p className="expert-suggestion__text">{suggestion.text}</p>
      <p className="expert-suggestion__meta">
        {suggestion.suggestionId !== undefined ? <code>{suggestion.suggestionId}</code> : null}
        {suggestion.kind !== undefined ? <> · {suggestion.kind}</> : null}
        {suggestion.status !== undefined ? <> · {suggestion.status}</> : null}
      </p>
    </section>
  );
}

/** The evidence ledger — the expert judgment the workbench has appended. */
function EvidenceLedger(props: {
  readonly cards: readonly ExpertEvidenceCard[];
  readonly compact?: boolean;
}) {
  const { cards, compact } = props;
  return (
    <section
      className="expert-evidence"
      aria-labelledby="expert-evidence-title"
      data-arena-evidence-ledger="true"
    >
      <h2 id="expert-evidence-title">Evidence submitted for this work</h2>
      {cards.length === 0 ? (
        <EmptyState
          title="No evidence submitted yet"
          hint="The ledger is empty — the read path found no appended expert-judgment records for this task."
        />
      ) : (
        <ol className="expert-evidence__records" data-arena-evidence-count={String(cards.length)}>
          {cards.map((card) => (
            <li
              key={card.recordId}
              className="expert-evidence__record"
              data-arena-evidence={card.recordId}
              data-arena-evidence-verdict={card.verdict ?? 'unknown'}
            >
              <div className="expert-evidence__head">
                <span className="expert-evidence__seq">#{String(card.sequence)}</span>
                <span className="expert-evidence__verdict">
                  {card.verdict ?? 'unknown verdict'}
                </span>
                <TruthMark
                  truth={{
                    kind: 'expert-judgment',
                    treatment: 'expert-judgment',
                    label: 'Expert judgment',
                  }}
                />
                {card.demo ? <DemoDataBadge /> : null}
              </div>
              <p className="expert-evidence__summary">{card.summary}</p>
              {compact !== true && card.basis.length > 0 ? (
                <p className="expert-evidence__basis">Basis: {card.basis}</p>
              ) : null}
              <CanonicalRef
                kind="expert-evidence"
                recordId={card.recordId}
                sourceVersion={card.sourceVersion}
                sourceRevision={card.sourceRevision}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * The evidence submission form: a plain HTML form POSTing to the evidence
 * route of this posture (`/expert/tasks/:id/evidence` or the demo
 * equivalent). The route handler appends through the B002 repository port
 * and redirects back; submitting NEVER moves task/run/evaluation/
 * verification state (see EVIDENCE_APPEND_ONLY_NOTE).
 */
function EvidenceForm(props: {
  readonly mode: 'session' | 'demo';
  readonly taskId: string;
  readonly caseRecordId: string;
  readonly posture: TaskPosture;
}) {
  const { mode, taskId, caseRecordId, posture } = props;
  const action =
    mode === 'demo'
      ? `/demo/expert/tasks/${encodeURIComponent(taskId)}/evidence`
      : `/expert/tasks/${encodeURIComponent(taskId)}/evidence`;
  const label =
    posture === 'review'
      ? 'Submit review judgment as evidence'
      : posture === 'execute'
        ? 'Submit work evidence'
        : 'Append evidence to the closed task\u2019s ledger';
  return (
    <form
      className="expert-evidence-form"
      method="post"
      action={action}
      data-arena-evidence-form="true"
      data-arena-evidence-posture={posture}
    >
      <h3>{label}</h3>
      <p className="expert-evidence-form__note">{EVIDENCE_APPEND_ONLY_NOTE}</p>
      <input type="hidden" name="case" value={caseRecordId} />
      <label className="expert-evidence-form__field">
        <span>Verdict</span>
        <select name="verdict" defaultValue="observation" data-arena-evidence-verdict-select="true">
          {EXPERT_EVIDENCE_VERDICTS.map((verdict) => (
            <option key={verdict} value={verdict}>
              {verdict}
            </option>
          ))}
        </select>
      </label>
      <label className="expert-evidence-form__field">
        <span>Your judgment (what you observed or reviewed)</span>
        <textarea
          name="summary"
          rows={4}
          required
          minLength={1}
          data-arena-evidence-summary="true"
        />
      </label>
      <label className="expert-evidence-form__field">
        <span>Basis (what the judgment is grounded in)</span>
        <input type="text" name="basis" required minLength={1} data-arena-evidence-basis="true" />
      </label>
      <button type="submit" data-arena-evidence-submit="true">
        Append evidence
      </button>
    </form>
  );
}

/** One task row inside the case work lens. */
function CaseTaskRowView(props: { readonly row: CaseTaskRow }) {
  const { row } = props;
  return (
    <li
      className="expert-casetask"
      data-arena-casetask={row.taskId}
      data-arena-casetask-class={row.stateClass}
    >
      <div className="expert-casetask__head">
        <a className="expert-casetask__link" href={row.href}>
          {row.title}
        </a>
        <StateChip label="task" state={row.state} kind="task" cls={row.stateClass} />
        {row.assignedExpertId !== undefined ? (
          <span className="expert-casetask__assignee">
            assigned to <code>{row.assignedExpertId}</code>
          </span>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The case work lens (UXM1.0 `/cases/:id` expert row)
// ---------------------------------------------------------------------------

/** The case work lens: what work this case carries and what it produced. */
export function CaseWorkView({ view }: { readonly view: CaseWorkModel }) {
  if (view.status === 'not-found') {
    return <CaseNotFoundView view={view} />;
  }
  return (
    <div
      className="expert"
      data-arena-route="expert-case"
      data-arena-expert-surface="case-work"
      data-arena-expert-mode={view.mode}
      data-arena-active-role="expert"
    >
      <PageHeader
        title={view.caseTitle}
        description={`Case work lens — ${view.caseId}`}
        actions={
          <PrimaryAction href={view.hrefBase} testId="expert-case-hero">
            Back to assigned work
          </PrimaryAction>
        }
      />

      {view.demo.isDemo ? <ExpertDemoBanner /> : null}

      <section className="expert-case-summary" aria-labelledby="expert-case-summary-title">
        <h2 id="expert-case-summary-title">The case</h2>
        <div className="expert-case-summary__marks">
          <StateChip label="case" state={view.lifecycle} kind="case" />
          <TruthMark truth={view.truth} />
        </div>
        {view.summary !== undefined ? <p>{view.summary}</p> : null}
        {view.assignedBody.carried ? (
          <p className="expert-case-summary__body" data-arena-assigned-body="true">
            Assigned body: <code>{view.assignedBody.bodyId}</code>
            {view.assignedBody.bodyVersion !== undefined
              ? ` @ ${view.assignedBody.bodyVersion}`
              : ''}
            . {BODY_NOT_MODEL_NOTE}
          </p>
        ) : null}
        <CanonicalRef
          kind="capability-case"
          recordId={view.caseRecordId}
          sourceVersion={view.sourceVersion}
          sourceRevision={view.sourceRevision}
        />
      </section>

      <section className="expert-case-tasks" aria-labelledby="expert-case-tasks-title">
        <h2 id="expert-case-tasks-title">Tasks this case carries</h2>
        {view.tasks.length === 0 ? (
          <EmptyState
            title="The case record carries no task list"
            hint="There is no work to enter — nothing is fabricated to fill the case."
          />
        ) : (
          <ul className="expert-case-tasks__rows" data-arena-case-tasks="true">
            {view.tasks.map((row) => (
              <CaseTaskRowView key={row.taskId} row={row} />
            ))}
          </ul>
        )}
        {view.unrecognizedTaskEntries > 0 ? (
          <p className="expert-case-tasks__unrecognized" data-arena-unrecognized-tasks={String(view.unrecognizedTaskEntries)}>
            {String(view.unrecognizedTaskEntries)} task entr
            {view.unrecognizedTaskEntries === 1 ? 'y' : 'ies'} could not be read as tasks —
            counted, never guessed into rows.
          </p>
        ) : null}
      </section>

      <RunContextPanel run={view.run} />
      <TrajectoryTimeline steps={view.trajectory} />
      <EvaluationPanel evaluation={view.evaluation} />
      <VerificationPanel verification={view.verification} />
      <SuggestionPanel suggestion={view.suggestion} />

      <section className="expert-case-evidence" aria-labelledby="expert-case-evidence-title">
        <h2 id="expert-case-evidence-title">
          Evidence this work produced ({String(view.evidenceTotal)})
        </h2>
        {view.evidenceTotal === 0 ? (
          <EmptyState
            title="No evidence appended for this case yet"
            hint="Enter a task to submit expert judgment as evidence — the ledger is append-only and always visible here."
          />
        ) : (
          view.tasks.map((row) => {
            const ledger = view.evidence[row.taskId] ?? [];
            return ledger.length > 0 ? (
              <div key={row.taskId} className="expert-case-evidence__task">
                <h3>{row.title}</h3>
                <EvidenceLedger cards={ledger} compact />
              </div>
            ) : null;
          })
        )}
      </section>

      <section className="expert-case-qualifications" aria-labelledby="expert-case-quals-title">
        <h2 id="expert-case-quals-title">Your qualifications in scope</h2>
        <p className="expert-case-qualifications__note">{view.qualificationNote}</p>
        {view.qualifications.length === 0 ? (
          <EmptyState
            title="No expert qualifications in this workspace yet"
            hint="Qualification scopes judgment domains — nothing here grants or implies authorization."
          />
        ) : (
          <ul className="expert-case-qualifications__list">
            {view.qualifications.map((card) => (
              <QualificationScope key={card.recordId} card={card} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The honest not-found state of the case work lens (fail closed). */
export function CaseNotFoundView({ view }: { readonly view: CaseNotFoundViewModel }) {
  return (
    <div
      className="expert expert--notfound"
      data-arena-route="expert-case"
      data-arena-expert-surface="case-not-found"
      data-arena-expert-mode={view.mode}
    >
      <PageHeader
        title="Case not found"
        description="The canonical read path returned no case record for this address."
      />
      <EmptyState
        title="No canonical case record at this address"
        hint={`read-canonical failed closed with READ_MODEL_RECORD_NOT_FOUND for ${view.caseRecordId} — the workbench never renders a guessed case.`}
      />
      <p className="expert-notfound__actions">
        <a href={view.hrefBase}>Back to assigned work</a>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The task execute/review surface (UXM1.0 `/tasks/:id` expert row)
// ---------------------------------------------------------------------------

const POSTURE_INSTRUCTIONS: Readonly<Record<TaskPosture, string>> = Object.freeze({
  execute:
    'Open work: perform the task, then submit evidence of what you did and observed. The canonical task state stays as the record carries it.',
  review:
    'Review work: examine the recorded trajectory and the evaluation below, then submit your review judgment as evidence. Your judgment is an expert judgment — it is not a verification and it flips nothing.',
  closed:
    'This task is completed in the canonical record. The ledger below is history — append-only, never hidden; you may still append judgment evidence to it.',
});

/** The task execute/review surface. */
export function TaskWorkView(props: {
  readonly view: TaskWorkModel;
  /** Honest post-submission outcome note (from the evidence route's redirect). */
  readonly evidenceOutcome?: { readonly kind: 'appended' | 'error'; readonly detail: string };
}) {
  const { view, evidenceOutcome } = props;
  if (view.status !== 'found') {
    return <TaskNotFoundView view={view} />;
  }
  return (
    <div
      className="expert"
      data-arena-route="expert-task"
      data-arena-expert-surface="task-work"
      data-arena-expert-posture={view.posture}
      data-arena-expert-mode={view.mode}
      data-arena-active-role="expert"
    >
      <PageHeader
        title={view.taskTitle}
        description={`Task execute/review — ${view.caseTitle}`}
        actions={
          <PrimaryAction href={view.caseHref} testId="expert-task-hero">
            Open the case work lens
          </PrimaryAction>
        }
      />

      {view.demo.isDemo ? <ExpertDemoBanner /> : null}

      {evidenceOutcome !== undefined ? (
        <section
          className={
            evidenceOutcome.kind === 'appended'
              ? 'expert-evidence-outcome expert-evidence-outcome--appended'
              : 'expert-evidence-outcome expert-evidence-outcome--error'
          }
          aria-live="polite"
          data-arena-evidence-outcome={evidenceOutcome.kind}
          data-arena-evidence-outcome-detail={evidenceOutcome.detail}
        >
          {evidenceOutcome.kind === 'appended' ? (
            <p>
              Evidence appended to the task’s ledger ({evidenceOutcome.detail}). The judgment is
              recorded — the task state, run state, evaluation verdict and verification verdict are
              all unchanged, because expert judgment is not verification.
            </p>
          ) : (
            <ErrorState
              title="The evidence submission failed closed"
              detail={`${evidenceOutcome.detail} — nothing was appended; the ledger is exactly as it was.`}
            />
          )}
        </section>
      ) : null}

      <section className="expert-task-brief" aria-labelledby="expert-task-brief-title">
        <h2 id="expert-task-brief-title">What you are asked to do</h2>
        <div className="expert-task-brief__marks">
          <StateChip label="task" state={view.taskState} kind="task" cls={view.taskStateClass} />
          <StateChip label="case" state={view.caseLifecycle} kind="case" />
          <span className="expert-task-brief__posture" data-arena-task-posture={view.posture}>
            {view.posture}
          </span>
        </div>
        <p className="expert-task-brief__instruction" data-arena-posture-instruction="true">
          {POSTURE_INSTRUCTIONS[view.posture]}
        </p>
        <p className="expert-task-brief__case">
          Case: <a href={view.caseHref}>{view.caseTitle}</a>
          {view.assignedExpertId !== undefined ? (
            <>
              {' '}· assigned by record to <code>{view.assignedExpertId}</code>
            </>
          ) : null}
        </p>
        <CanonicalRef
          kind="capability-case"
          recordId={view.caseRecordId}
          sourceVersion={view.sourceVersion}
          sourceRevision={view.sourceRevision}
        />
      </section>

      <RunContextPanel run={view.run} />
      <TrajectoryTimeline steps={view.trajectory} />
      <EvaluationPanel evaluation={view.evaluation} />
      <VerificationPanel verification={view.verification} />
      <SuggestionPanel suggestion={view.suggestion} />

      <EvidenceLedger cards={view.evidence} />

      <section className="expert-task-submit" aria-labelledby="expert-task-submit-title">
        <h2 id="expert-task-submit-title">Submit evidence</h2>
        <EvidenceForm
          mode={view.mode}
          taskId={view.taskId}
          caseRecordId={view.caseRecordId}
          posture={view.posture}
        />
      </section>

      <section className="expert-task-qualifications" aria-labelledby="expert-task-quals-title">
        <h2 id="expert-task-quals-title">Your qualifications in scope</h2>
        <p className="expert-task-qualifications__note">{view.qualificationNote}</p>
        {view.qualifications.length === 0 ? (
          <EmptyState
            title="No expert qualifications in this workspace yet"
            hint="A qualification scopes the judgment domains an expert may speak to — it is an input to matching and audit, never an authorization."
          />
        ) : (
          <ul className="expert-task-qualifications__list">
            {view.qualifications.map((card) => (
              <QualificationScope key={card.recordId} card={card} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The honest not-found/unassigned states of the task surface (fail closed). */
export function TaskNotFoundView({ view }: { readonly view: TaskNotFoundViewModel }) {
  const hint =
    view.status === 'case-not-found'
      ? `read-canonical failed closed with READ_MODEL_RECORD_NOT_FOUND for ${view.caseRecordId} — the task surface never renders a guessed task.`
      : view.status === 'task-not-found'
        ? `The canonical case record ${view.caseRecordId} carries no task ${view.taskId} — nothing is fabricated to fill the workbench.`
        : `Task ${view.taskId} is assigned by the record to ${view.assignedExpertId ?? 'another expert'}, not to this principal. Assignment identity is carried by the record — this is not an authorization decision.`;
  return (
    <div
      className="expert expert--notfound"
      data-arena-route="expert-task"
      data-arena-expert-surface={view.status}
      data-arena-expert-mode={view.mode}
    >
      <PageHeader
        title="Task not available"
        description="The canonical record does not carry this task for this principal."
      />
      <EmptyState
        title={
          view.status === 'not-assigned'
            ? 'This task is assigned to another expert'
            : 'No task at this address'
        }
        hint={hint}
      />
      <p className="expert-notfound__actions">
        <a href={view.hrefBase}>Back to assigned work</a>
        {view.status !== 'case-not-found' ? (
          <>
            {' · '}
            <a href={`${view.hrefBase}/cases/${encodeURIComponent(view.caseRecordId)}`}>
              Open the case work lens
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}
