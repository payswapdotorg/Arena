/**
 * StartCaseFormView — the guided START form (Work Order B008; issue #80;
 * apps/web/src/capability). SYNC presentational component.
 *
 * The form a NEW user follows to start a Capability Case: it collects the
 * canonical case framing fields a first-run user can actually write (the
 * narrative framing), pre-filled with the DISCLOSED reference framing —
 * every pre-fill is visible and editable, never silently fabricated. The
 * structural requirement refs (capability, domain, competency,
 * environment, tools, evaluators, verifiers) are the disclosed reference
 * framing and are stated as such on the form.
 *
 * Plain HTML form POST (the house JavaScript-free posture) to the
 * start/submit route handler; the flow-actions grammar parses exactly
 * these fields. Demo mode renders under the B006 labelling contract.
 */

import { PageHeader, PrimaryAction } from '@arena/ui-platform';
import { DEMO_LABELLING } from '@arena/demo';
import type { StartCaseInput } from '../../../../packages/product-flows/src/index.js';
import { FlowErrorNotice } from './gate.js';

export interface StartCaseFormViewProps {
  readonly mode: 'session' | 'demo';
  /** The disclosed reference framing the form pre-fills (editable). */
  readonly framing: StartCaseInput;
  /** A typed rejection code from a previous submit attempt (?flowError=). */
  readonly flowError?: string;
}

const CASE_PRIORITIES: readonly string[] = ['low', 'normal', 'high', 'critical'];
const CASE_RISK_LEVELS: readonly string[] = ['low', 'moderate', 'high', 'severe'];

/** One labelled form field row (the house plain-language posture). */
function Field(props: {
  readonly label: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  const { label, hint, children } = props;
  return (
    <label className="capability-field">
      <span className="capability-field__label">{label}</span>
      {children}
      {hint !== undefined ? <span className="capability-field__hint">{hint}</span> : null}
    </label>
  );
}

export function StartCaseFormView(props: StartCaseFormViewProps) {
  const { mode, framing, flowError } = props;
  const isDemo = mode === 'demo';
  const action = isDemo ? '/demo/cases/start/submit' : '/cases/start/submit';
  const listHref = isDemo ? '/demo/cases' : '/cases';
  const evidence = framing.evidence[0];
  return (
    <div
      className="capability capability-start"
      data-arena-route="cases-start"
      data-arena-mode={mode}
    >
      <PageHeader
        title="Start a capability case"
        description="A Capability Case is the bridge from an observed failure to capability development. Fill in what you saw and what you need — every field stays inspectable for the whole life of the case."
        actions={
          <PrimaryAction href={listHref} testId="start-back-to-cases">
            Back to your cases
          </PrimaryAction>
        }
      />
      {isDemo ? (
        <section
          className="capability-demo-banner"
          aria-label="Demo mode notice"
          data-arena-demo-banner="true"
        >
          <p>
            <strong>{DEMO_LABELLING.bannerTitle}.</strong> {DEMO_LABELLING.bannerText} Cases
            you start here are demo state in the reserved demo tenant — visibly labelled,
            never customer state.
          </p>
        </section>
      ) : null}
      <FlowErrorNotice code={flowError} />
      <form
        method="post"
        action={action}
        className="capability-start__form"
        data-arena-start-form="true"
      >
        <input type="hidden" name="intent" value="start" />
        <fieldset>
          <legend>1 · Name the case</legend>
          <Field label="Case id" hint="Stable id inside your tenant (letters, digits, dashes).">
            <input
              name="caseId"
              defaultValue={framing.identity.caseId}
              required
              pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,127}"
            />
          </Field>
          <Field
            label="Problem statement"
            hint="What does your agent fail to do, in your own words?"
          >
            <textarea name="problemStatement" defaultValue={framing.problemStatement} required rows={3} />
          </Field>
        </fieldset>
        <fieldset>
          <legend>2 · The observed failure</legend>
          <Field label="What you saw (one sentence)">
            <textarea
              name="observedFailureSummary"
              defaultValue={framing.observedFailure.summary}
              required
              rows={2}
            />
          </Field>
          <Field label="How to reproduce it">
            <textarea
              name="reproduction"
              defaultValue={framing.observedFailure.reproduction}
              rows={2}
            />
          </Field>
          <Field
            label="Evidence digest (sha256)"
            hint="The content digest of the artifact behind the failure — evidence is digest-addressed and append-only."
          >
            <input
              name="evidenceDigest"
              defaultValue={evidence?.digest}
              required
              pattern="[0-9a-f]{64}"
              placeholder="64 hex characters"
            />
          </Field>
          <Field label="What the evidence shows">
            <input
              name="evidenceDescription"
              defaultValue={evidence?.description}
              required
            />
          </Field>
          <Field label="Where the agent runs (context)">
            <textarea name="context" defaultValue={framing.context} rows={2} />
          </Field>
        </fieldset>
        <fieldset>
          <legend>3 · What you need</legend>
          <Field label="Desired outcome">
            <textarea name="desiredOutcome" defaultValue={framing.desiredOutcome} required rows={2} />
          </Field>
          <Field label="Known unknowns (one per line)" hint="An honest case carries known unknowns.">
            <textarea name="unknowns" defaultValue={framing.unknowns.join('\n')} rows={3} />
          </Field>
          <Field label="Priority">
            <select name="priority" defaultValue={framing.priority}>
              {CASE_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Risk">
            <select name="risk" defaultValue={framing.risk}>
              {CASE_RISK_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>
        <button type="submit" className="capability-start__submit">
          Start the case
        </button>
        <p className="capability-start__disclosure" data-arena-start-disclosure="true">
          Structural requirement references (target capability, domain, expert competency,
          environment, allowed tools, evaluators, verifiers) are carried from the disclosed
          reference framing shown here — versioned and inspectable on the case once created,
          never silently invented. Everything you typed above is recorded verbatim.
        </p>
      </form>
    </div>
  );
}
