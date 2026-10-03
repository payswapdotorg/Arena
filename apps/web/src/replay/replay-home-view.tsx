/**
 * ReplayHomeView — the presentational run-list surface (Work Order
 * B011; issue #86; apps/web/src/replay).
 *
 * SYNC presentational component (renderable through react-dom/server in
 * the house test style): the async composition (session probe, demo
 * corpus, protocol reads) happens in the replay-route helpers, and this
 * component renders the resulting view model deterministically.
 *
 * THE governing truths rendered here:
 *   - REPLAY IS OBSERVATIONAL — the observational banner is ALWAYS
 *     visible ("replay — no live-world mutation"), and there is no
 *     re-run affordance anywhere;
 *   - every run row carries its OWN truth-class mark (simulation-replay
 *     / pending / unknown — never one generic "AI result");
 *   - the run list scrolls with bounded pages + opaque continuation
 *     tokens (deterministic ordering, never cached state);
 *   - the session posture's empty list is an HONEST empty state — no
 *     runs are recorded, nothing is fabricated;
 *   - role context is a LENS: the switcher renders granted roles; a
 *     not-granted request renders the truthful denial;
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
import { isReplayBadgeTreatment } from './state-mark.js';
import type { ReplayTruthTreatment } from './state-mark.js';
import { replayTruthClassTreatment, replayTruthLabel } from './state-mark.js';
import type {
  ReplayHomeViewModel,
  ReplayRoleSwitchModel,
  ReplaySurfaceFacts,
} from './replay-route.js';
import { replayContinuationHref } from './replay-route.js';
import type { ReplayRunSummary, ReplayTruthClass } from '../../../../packages/replay-ui/src/index.js';

// ---------------------------------------------------------------------------
// Shared presentational atoms (also used by the run-detail view)
// ---------------------------------------------------------------------------

/** Render one maybe-unknown value (unknown stays unknown — never guessed). */
export function Maybe(props: { readonly value: string | null }) {
  if (props.value === null) {
    return (
      <span className="replay-unknown" data-arena-unknown="true">
        Unknown
      </span>
    );
  }
  return <span>{props.value}</span>;
}

/** The distinct mark for the honesty-critical kinds B001 has no badge for (pending/unknown). */
export function ReplayTruthMark(props: {
  readonly truthClass: ReplayTruthClass;
}) {
  const treatment: ReplayTruthTreatment = replayTruthClassTreatment(props.truthClass);
  const label = replayTruthLabel(props.truthClass);
  if (isReplayBadgeTreatment(treatment)) {
    return <TruthBadge kind={treatment as StateKind} />;
  }
  return (
    <span
      className={`replay-truth replay-truth--${treatment}`}
      data-arena-truth={treatment}
      title={treatment === 'pending' ? 'Pending — the datum is honestly undecided, never guessed.' : 'Unknown — no basis for a truth claim; rendered as unknown, never guessed.'}
    >
      <span className="replay-truth__marker" aria-hidden="true" />
      <span className="replay-truth__label">{label}</span>
    </span>
  );
}

/** The ALWAYS-visible observational banner — every replay screen carries it prominently. */
export function ReplayObservationalBanner(props: { readonly note: string }) {
  return (
    <section
      className="replay-observational"
      aria-label="Observational notice"
      data-arena-replay-observational="true"
    >
      <p>
        <strong>Replay — no live-world mutation.</strong> {props.note}
      </p>
    </section>
  );
}

/** The demo banner (B006 labelling contract — demo state is never customer state). */
export function ReplayDemoBanner(props: { readonly corpusHash?: string }) {
  return (
    <section
      className="replay-demo-banner"
      aria-label="Demo mode notice"
      data-arena-demo-banner="true"
    >
      <DemoDataBadge note="deterministic seed" />
      <p>
        <strong>{DEMO_LABELLING.bannerTitle}.</strong> {DEMO_LABELLING.bannerText}
      </p>
      {props.corpusHash !== undefined ? (
        <p className="replay-demo-banner__hash" data-arena-corpus-hash="true">
          Demo corpus hash: <code>{props.corpusHash.slice(0, 72)}…</code>
        </p>
      ) : null}
    </section>
  );
}

/** The role lens bar: switcher over GRANTED roles + the lens note + the truthful denial. */
export function ReplayRoleBar(props: {
  readonly roleSwitch: ReplayRoleSwitchModel;
  readonly preserveQuery?: string;
}) {
  const { roleSwitch } = props;
  const preserve = props.preserveQuery !== undefined ? `&${props.preserveQuery}` : '';
  return (
    <section
      className="replay-rolebar"
      aria-label="Role lens"
      data-arena-role-switcher="true"
      data-arena-active-role={roleSwitch.activeRoleId}
    >
      <p className="replay-rolebar__lens">
        Viewing through the <strong>{roleSwitch.activeLens.roleName}</strong> lens —{' '}
        {roleSwitch.activeLens.landingTitle}. {roleSwitch.lensNote}
      </p>
      <ul className="replay-rolebar__roles">
        {roleSwitch.grantedRoleIds.map((roleId) => {
          const active = roleId === roleSwitch.activeRoleId;
          return (
            <li key={roleId} className="replay-rolebar__role">
              <a
                href={`${roleSwitch.roleHrefBase}?role=${roleId}${preserve}`}
                className={
                  active
                    ? 'replay-rolebar__link replay-rolebar__link--active'
                    : 'replay-rolebar__link'
                }
                {...(active ? { 'aria-current': 'page' as const } : {})}
              >
                {roleId}
              </a>
            </li>
          );
        })}
      </ul>
      {roleSwitch.denied ? (
        <div
          className="replay-rolebar__denied"
          data-arena-role-denied="true"
          data-arena-state="denied"
          role="alert"
        >
          <p>
            <strong>Role not granted.</strong> The requested role{' '}
            <code>{String(roleSwitch.deniedRequested)}</code> is not in your granted set (
            {roleSwitch.grantedRoleIds.join(', ')}) — rendering truthfully through the{' '}
            {roleSwitch.activeLens.roleName} lens instead. The switch is never faked.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** The truth-class legend (the teaching UI — no mystery glyphs). */
export function ReplayTruthLegend() {
  const classes: readonly ReplayTruthClass[] = [
    'simulation-replay',
    'evidence',
    'evaluation-result',
    'verified-fact',
    'pending',
    'unknown',
  ];
  const meanings: Readonly<Record<string, string>> = {
    'simulation-replay':
      'The append-only record of what the agent did inside the run — never a result.',
    evidence: 'An append-only content address identifying evidence produced by a run.',
    'evaluation-result': 'A score against explicit, versioned criteria — never a verification claim.',
    'verified-fact': 'A fact about what a named verifier decided (pass or fail), with its evidence.',
    pending: 'Honestly undecided (e.g. an in-flight run) — never guessed.',
    unknown: 'No basis for a truth claim — rendered as unknown, never guessed.',
  };
  return (
    <section className="replay-legend" aria-labelledby="replay-legend-title" data-arena-truth-legend="true">
      <h2 id="replay-legend-title">Truth classes on this surface</h2>
      <p className="replay-legend__note">
        Every datum carries one of these classes — replay is simulation-replay, and there is no
        generic &quot;AI result&quot; badge anywhere.
      </p>
      <ul className="replay-legend__list">
        {classes.map((truthClass) => (
          <li
            key={truthClass}
            className="replay-legend__row"
            data-arena-truth-class={truthClass}
          >
            <ReplayTruthMark truthClass={truthClass} />
            <span className="replay-legend__meaning">{meanings[truthClass] ?? ''}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The surface facts aside (tenant, workspace, counts). */
export function ReplaySurfaceFactsAside(props: {
  readonly facts: ReplaySurfaceFacts;
  readonly rows: readonly unknown[];
  readonly totalKnown: number;
}) {
  return (
    <aside className="replay-inspector" aria-label="Surface facts" data-arena-surface-inspector="true">
      <h2>Surface facts</h2>
      <dl className="replay-inspector__facts">
        <div>
          <dt>Tenant</dt>
          <dd>
            <code>{props.facts.tenantId}</code>
          </dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>
            <code>{props.facts.workspaceId}</code>
          </dd>
        </div>
        <div>
          <dt>Principal</dt>
          <dd>{props.facts.principalLabel}</dd>
        </div>
        <div>
          <dt>Runs on this page</dt>
          <dd>{String(props.rows.length)}</dd>
        </div>
        <div>
          <dt>Runs known</dt>
          <dd>{String(props.totalKnown)}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{props.facts.mode === 'demo' ? 'demo (deterministic corpus)' : 'session'}</dd>
        </div>
      </dl>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// The run list
// ---------------------------------------------------------------------------

function shortDigest(digest: string | null): string {
  if (digest === null) return 'unknown';
  return `${digest.slice(0, 16)}…`;
}

/** One run-list row: identity + outcome + truth mark (simulation-replay, never "result"). */
function RunRow(props: {
  readonly view: ReplayHomeViewModel;
  readonly run: ReplayRunSummary;
}) {
  const { view, run } = props;
  return (
    <tr className="replay-run-row" data-arena-run={run.runId} data-arena-run-outcome={run.outcome}>
      <td>
        <a href={`${view.runHrefBase}/${encodeURIComponent(run.runKey)}`}>
          <code>{run.runId}</code>
        </a>
      </td>
      <td>
        <Maybe value={run.submittedAt} />
      </td>
      <td data-arena-run-outcome={run.outcome}>
        <ReplayTruthMark truthClass={run.truthClass} />
        {view.demo.isDemo ? <DemoDataBadge /> : null} {run.outcome}
      </td>
      <td>{run.stepCount === null ? <Maybe value={null} /> : String(run.stepCount)}</td>
      <td>
        <code>{shortDigest(run.trajectoryDigest)}</code>
      </td>
    </tr>
  );
}

export function ReplayHomeView({ view }: { readonly view: ReplayHomeViewModel }) {
  return (
    <div
      className="replay-surface"
      data-arena-route="replay"
      data-arena-surface-mode={view.mode}
    >
      <PageHeader
        title="Run replay"
        description={view.roleSwitch.activeLens.landingIntro}
      />

      <ReplayObservationalBanner note={view.observationalNote} />

      {view.demo.isDemo ? (
        <ReplayDemoBanner {...(view.demo.corpusHash !== undefined ? { corpusHash: view.demo.corpusHash } : {})} />
      ) : null}

      <ReplayRoleBar roleSwitch={view.roleSwitch} />

      <section
        className="replay-runs"
        aria-labelledby="replay-runs-title"
        data-arena-runs-section="true"
      >
        <h2 id="replay-runs-title">Recorded runs</h2>
        <p className="replay-runs__note" data-arena-runs-ordering="true">
          Deterministic (run id) ordering; bounded pages addressed by opaque continuation
          tokens — every page re-reads the authority.
        </p>
        {view.runs.length === 0 ? (
          <EmptyState title="No runs recorded yet" hint={view.emptyNote ?? 'Nothing to replay.'} />
        ) : (
          <div
            className="replay-runs__scroll"
            role="region"
            aria-label="Recorded runs table"
            tabIndex={0}
          >
            <table className="replay-runs__table">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Steps</th>
                  <th scope="col">Trajectory digest</th>
                </tr>
              </thead>
              <tbody>
                {view.runs.map((run) => (
                  <RunRow key={run.runId} view={view} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view.nextContinuation !== null ? (
          <p className="replay-runs__continuation" data-arena-continuation="true">
            <a
              href={replayContinuationHref({
                runHrefBase: view.runHrefBase,
                continuation: view.nextContinuation,
                ...(view.roleSwitch.activeRoleId !== undefined
                  ? { activeRoleId: view.roleSwitch.activeRoleId }
                  : {}),
              })}
            >
              More runs (continuation)
            </a>{' '}
            — {String(view.totalKnown)} runs known; this page shows{' '}
            {String(view.runs.length)}.
          </p>
        ) : (
          <p className="replay-runs__continuation" data-arena-continuation="none">
            {view.runs.length > 0
              ? `End of the run list — ${String(view.totalKnown)} run(s) known, all pages shown.`
              : ''}
          </p>
        )}
      </section>

      <ReplayTruthLegend />

      <ReplaySurfaceFactsAside facts={view} rows={view.runs} totalKnown={view.totalKnown} />
    </div>
  );
}
