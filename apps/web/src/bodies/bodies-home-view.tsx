/**
 * BodyStudioView — the presentational `/bodies` studio (Work Order B010;
 * issue #82; apps/web/src/bodies).
 *
 * SYNC presentational component (renderable through react-dom/server in
 * the house test style): the async composition (session probe, canonical
 * reads, lens resolution) happens in the bodies composition helpers, and
 * this component renders the resulting view model deterministically.
 *
 * THE governing truths rendered here:
 *   - Body ≠ model; Substrate ≠ Body; Possession = a versioned
 *     composition binding — the distinction banner is ALWAYS visible;
 *   - Body versioning is EXPLICIT (current/initial/evolution) and Body
 *     Versions are immutable — improvement creates a NEW version;
 *   - skills/knowledge/tools are inspectable on every body card;
 *   - certification claims render as claims about the TESTED composition;
 *   - substrate comparisons are composition-scoped — typed rejections
 *     render as the honest outcome they are;
 *   - every datum carries its canonical state classification;
 *   - demo mode renders under the B006 labelling contract.
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
import type { RoleId } from '../../../../packages/role-context/src/index.js';
import type { CertificationClaimCard, PossessionMatrixRow } from '../../../../packages/body-ui/src/index.js';
import { certificationScopeLabel } from '../../../../packages/body-ui/src/index.js';
import { roleSwitchHref } from '../cockpit/cockpit-view.js';
import { isBadgeTreatment } from '../cockpit/state-mark.js';
import type { CockpitTruthTreatment } from '../cockpit/state-mark.js';
import { BODY_STUDIO_EMPHASIS_LABELS } from './role-lens.js';
import type { BodyStudioRoleLens } from './role-lens.js';
import type {
  BodyStudioViewModel,
  StudioBodyCard,
  StudioPossessionEntry,
} from './studio-view.js';

export interface BodyStudioViewProps {
  readonly view: BodyStudioViewModel;
}

/** The persistent, unmistakable distinction of this surface. */
const BODY_DISTINCTION_NOTE =
  'Body ≠ model · Substrate ≠ Body · Possession = a versioned composition binding (Body Version × Substrate × Runtime × Environment × Policy).';

/** The role-is-a-lens note (RC1.0 — never an authorization). */
const ROLE_LENS_NOTE =
  'Role context is a lens — it changes what the studio emphasizes for you, never what you are authorized to do. Permissions stay server-side and policy-driven.';

/** The distinct mark for the two honesty-critical kinds B001 has no badge for. */
function BodyTruthMark(props: {
  readonly treatment: CockpitTruthTreatment;
  readonly label: string;
  readonly meaning: string;
}) {
  const { treatment, label, meaning } = props;
  if (isBadgeTreatment(treatment)) {
    return <TruthBadge kind={treatment as StateKind} />;
  }
  return (
    <span className="body-truth body-truth--pending-unknown" data-arena-truth={treatment} title={meaning}>
      <span className="body-truth__marker" aria-hidden="true" />
      <span className="body-truth__label">{label}</span>
    </span>
  );
}

/** Render one maybe-unknown value (unknown stays unknown — never guessed). */
function Maybe(props: { readonly value: string | undefined; readonly label?: string }) {
  if (props.value === undefined) {
    return <span className="body-unknown" data-arena-unknown="true">Unknown</span>;
  }
  return <span>{props.value}</span>;
}

/** One possession matrix row: the versioned composition binding, unmistakable. */
function PossessionRow(props: { readonly entry: StudioPossessionEntry }) {
  const { entry } = props;
  const row: PossessionMatrixRow = entry.row;
  const bodyVersion =
    row.bodyVersion !== undefined ? `${row.bodyVersion.bodyId}@${row.bodyVersion.version}` : undefined;
  return (
    <tr
      className="body-possession-row"
      data-arena-possession={row.possessionId ?? 'unknown'}
      data-arena-binding={row.binding}
    >
      <td><a href={`/bodies/${encodeURIComponent(entry.bodyRecordId)}`}>{entry.bodyTitle}</a></td>
      <td data-arena-possession-body-version={bodyVersion ?? 'unknown'}>
        <Maybe value={bodyVersion} />
      </td>
      <td data-arena-possession-substrate={row.substrate ?? 'unknown'}>
        <Maybe value={row.substrate} />
      </td>
      <td><Maybe value={row.runtime} /></td>
      <td><Maybe value={row.environment} /></td>
      <td><Maybe value={row.policy} /></td>
      <td><Maybe value={row.scope} /></td>
    </tr>
  );
}

/** The workspace possession matrix (Body × Substrate × runtime/environment × policy). */
function PossessionMatrixTable(props: { readonly view: BodyStudioViewModel }) {
  const { view } = props;
  return (
    <section
      className="body-matrix"
      aria-labelledby="body-matrix-title"
      data-arena-possession-matrix="true"
    >
      <h2 id="body-matrix-title">Possession matrix</h2>
      <p className="body-matrix__note">{view.bodies.length > 0 && view.matrix.length > 0 ? view.matrix[0]?.row.bindingNote : ''}</p>
      {view.matrix.length === 0 ? (
        <EmptyState
          title="No possessions yet"
          hint="No possession binding exists in this workspace yet. A possession binds a Body Version to a Cognitive Substrate under a runtime and environment — it is never just the model."
        />
      ) : (
        <div className="body-matrix__scroll" role="region" aria-label="Possession matrix table" tabIndex={0}>
          <table className="body-matrix__table">
            <thead>
              <tr>
                <th scope="col">Body</th>
                <th scope="col">Body Version</th>
                <th scope="col">Cognitive Substrate</th>
                <th scope="col">Runtime</th>
                <th scope="col">Environment</th>
                <th scope="col">Policy</th>
                <th scope="col">Scope</th>
              </tr>
            </thead>
            <tbody>
              {view.matrix.map((entry) => (
                <PossessionRow key={`${entry.bodyRecordId}:${entry.row.possessionId ?? 'unknown'}`} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** One certification claim rendered as a claim about the tested composition. */
function ClaimCard(props: { readonly claim: CertificationClaimCard; readonly demo: boolean }) {
  const { claim, demo } = props;
  return (
    <li
      className="body-claim"
      data-arena-claim={claim.recordId}
      data-arena-claim-scope={claim.subject !== undefined ? `${claim.subject.bodyId}@${claim.subject.version}` : 'unknown'}
    >
      <div className="body-claim__head">
        <strong>{claim.certificationId ?? claim.recordId}</strong>
        <TruthBadge kind="certification" />
        {demo ? <DemoDataBadge /> : null}
      </div>
      <p className="body-claim__scope">
        Claim scope: <code>{certificationScopeLabel(claim)}</code> — verdict{' '}
        <Maybe value={claim.verdict} />
      </p>
      {claim.basis !== undefined ? <p className="body-claim__basis">Basis: {claim.basis}</p> : null}
      <p className="body-claim__note">{claim.scopeNote}</p>
    </li>
  );
}

/** One studio body card: identity (explicit versioning) + composition + claims. */
function StudioBody(props: { readonly body: StudioBodyCard }) {
  const { body } = props;
  const identity = body.card.identity;
  const composition = body.card.composition;
  const counts = composition.counts;
  return (
    <article
      className="body-card"
      data-arena-body={body.recordId}
      data-arena-body-version={identity.versioning.currentVersion ?? 'unknown'}
    >
      <header className="body-card__head">
        <h3>
          <a href={`/bodies/${encodeURIComponent(body.recordId)}`}>{body.title}</a>
        </h3>
        <BodyTruthMark
          treatment={body.classification.treatment}
          label={body.classification.stateLabel}
          meaning={`Canonical classification: ${body.classification.stateKind}`}
        />
        {body.demo ? <DemoDataBadge /> : null}
      </header>
      <p className="body-card__summary">{body.summary}</p>

      <dl className="body-card__identity">
        <div>
          <dt>Body</dt>
          <dd data-arena-body-id={identity.bodyId ?? 'unknown'}><Maybe value={identity.bodyId} /></dd>
        </div>
        <div>
          <dt>Current version</dt>
          <dd data-arena-version-current={identity.versioning.currentVersion ?? 'unknown'}>
            <Maybe value={identity.versioning.currentVersion} />
          </dd>
        </div>
        <div>
          <dt>Initial version</dt>
          <dd><Maybe value={identity.versioning.initialVersion} /></dd>
        </div>
        {identity.versioning.evolution !== undefined ? (
          <div>
            <dt>Evolution</dt>
            <dd>{identity.versioning.evolution}</dd>
          </div>
        ) : null}
        <div>
          <dt>Content digest</dt>
          <dd><Maybe value={identity.digest} /></dd>
        </div>
      </dl>
      <p className="body-card__immutability" data-arena-version-immutability="true">
        {identity.immutabilityNote}
      </p>

      <details className="body-card__composition" open data-arena-composition="true">
        <summary>Composition — skills, knowledge, tools</summary>
        <dl className="body-card__composition-facts">
          <div><dt>Skills</dt><dd><Maybe value={counts.skills !== undefined ? String(counts.skills) : undefined} /></dd></div>
          <div><dt>Knowledge</dt><dd><Maybe value={counts.knowledge !== undefined ? String(counts.knowledge) : undefined} /></dd></div>
          <div><dt>Tools</dt><dd><Maybe value={counts.tools !== undefined ? String(counts.tools) : undefined} /></dd></div>
          <div><dt>Procedures</dt><dd><Maybe value={counts.procedures !== undefined ? String(counts.procedures) : undefined} /></dd></div>
          <div><dt>Capabilities</dt><dd><Maybe value={counts.capabilities !== undefined ? String(counts.capabilities) : undefined} /></dd></div>
          <div><dt>Evaluation suites</dt><dd><Maybe value={counts.evaluationSuites !== undefined ? String(counts.evaluationSuites) : undefined} /></dd></div>
          <div><dt>Verification suites</dt><dd><Maybe value={counts.verificationSuites !== undefined ? String(counts.verificationSuites) : undefined} /></dd></div>
        </dl>
        {composition.toolNames.length > 0 ? (
          <p className="body-card__tools">
            Tools: {composition.toolNames.join(', ')}
          </p>
        ) : (
          <p className="body-card__tools" data-arena-unknown="true">Tools: Unknown</p>
        )}
        <p className="body-card__composition-note">{composition.compositionNote}</p>
      </details>

      <div className="body-card__claims">
        <h4>Certification claims</h4>
        {body.claims.length === 0 ? (
          <p className="body-card__claims-empty" data-arena-claims-empty="true">
            No certification claim covers this body’s current version. A claim would attach to a
            tested composition, never to the model in isolation.
          </p>
        ) : (
          <ul className="body-card__claims-list">
            {body.claims.map((claim) => (
              <ClaimCard key={claim.recordId} claim={claim} demo={body.demo} />
            ))}
          </ul>
        )}
        {body.otherClaims.length > 0 ? (
          <p className="body-card__claims-other">
            {String(body.otherClaims.length)} claim
            {body.otherClaims.length === 1 ? '' : 's'} exist
            {body.otherClaims.length === 1 ? 's' : ''} scoped to other compositions in this
            workspace — shown on the bodies they actually tested.
          </p>
        ) : null}
      </div>

      <p className="body-card__ref">
        canonical read: <code>{body.recordId}</code> · schema v
        {String(body.card.sourceVersion)} · rev {String(body.card.sourceRevision)}
      </p>
    </article>
  );
}

/** The composition-scoped comparison panel (scope contract + honest outcomes). */
function ComparisonPanel(props: { readonly view: BodyStudioViewModel }) {
  const { view } = props;
  return (
    <section
      className="body-compare"
      aria-labelledby="body-compare-title"
      data-arena-compare-scope={view.comparisonScope.scope}
    >
      <h2 id="body-compare-title">Compare substrates — composition-scoped</h2>
      <p className="body-compare__rule">{view.comparisonScope.rule}</p>
      <ul className="body-compare__outcomes">
        {view.comparisons.map((comparison) => {
          const body = view.bodies.find((candidate) => candidate.recordId === comparison.bodyRecordId);
          return (
            <li
              key={comparison.bodyRecordId}
              className="body-compare__outcome"
              data-arena-comparison-for={comparison.bodyRecordId}
              data-arena-comparison-status={comparison.outcome.kind}
            >
              <strong>{body === undefined ? comparison.bodyRecordId : body.title}</strong>
              {comparison.outcome.kind === 'rejected' ? (
                <div className="body-compare__rejection" data-arena-comparison-rejected={comparison.outcome.code}>
                  <p>
                    Typed rejection <code>{comparison.outcome.code}</code>: {comparison.outcome.message}.
                  </p>
                  <p className="body-compare__guidance">{comparison.outcome.guidance}</p>
                </div>
              ) : (
                <table className="body-compare__table">
                  <thead>
                    <tr>
                      <th scope="col">Arm</th>
                      <th scope="col">Composition (pinned body version × substrate)</th>
                      <th scope="col">Runtime</th>
                      <th scope="col">Environment</th>
                      <th scope="col">Evidence verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.outcome.rows.map((row) => (
                      <tr key={row.armId} data-arena-comparison-arm={row.armId}>
                        <td>{row.armId}</td>
                        <td>
                          {row.bodyVersion.bodyId}@{row.bodyVersion.version} × {row.substrate}
                        </td>
                        <td><Maybe value={row.runtime} /></td>
                        <td><Maybe value={row.environment} /></td>
                        <td>
                          <Maybe value={row.evidence.verdict} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The role switcher (explicit query state — B007 pattern). */
function StudioRoleSwitcher(props: { readonly view: BodyStudioViewModel }) {
  const { view } = props;
  return (
    <section className="body-roles" aria-label="Body Studio role lens" data-arena-role-switcher="true">
      <p className="body-roles__active">
        Lens: <strong data-arena-active-role={view.roleSwitch.activeRoleId}>{view.lens.roleName}</strong>
        {' — '}
        {view.lens.libraryTitle} (focus: {BODY_STUDIO_EMPHASIS_LABELS[view.lens.emphasis]})
      </p>
      <ul className="body-roles__list">
        {view.roleSwitch.grantedRoleIds.map((roleId: RoleId) => {
          const active = roleId === view.roleSwitch.activeRoleId;
          return (
            <li key={roleId} className="body-role">
              <a
                href={roleSwitchHref(view.roleHrefBase, roleId)}
                className={active ? 'body-role__link body-role__link--active' : 'body-role__link'}
                {...(active ? { 'aria-current': 'page' as const } : {})}
              >
                {roleId}
              </a>
            </li>
          );
        })}
      </ul>
      <p className="body-roles__note" data-arena-role-lens-note="true">{ROLE_LENS_NOTE}</p>
      {view.roleSwitch.denied ? (
        <DeniedState
          message={`The requested role context (${String(view.roleSwitch.deniedRequested)}) is not granted to you in this workspace — showing your granted ${String(view.roleSwitch.activeRoleId)} lens instead.`}
          requiredAuthority={`granted role: ${String(view.roleSwitch.deniedRequested)}`}
        />
      ) : null}
    </section>
  );
}

export function BodyStudioView({ view }: BodyStudioViewProps) {
  const lens: BodyStudioRoleLens = view.lens;
  return (
    <div className="body-studio" data-arena-route="bodies" data-arena-studio-mode={view.mode}>
      <PageHeader
        title={lens.libraryTitle}
        description={lens.libraryIntro}
        actions={
          <PrimaryAction href={lens.heroAction.href} testId="body-studio-hero">
            {lens.heroAction.label}
          </PrimaryAction>
        }
      />

      {view.demo.isDemo ? (
        <section className="body-demo-banner" aria-label="Demo mode notice" data-arena-demo-banner="true">
          <DemoDataBadge note="deterministic seed" />
          <p>
            <strong>{DEMO_LABELLING.bannerTitle}.</strong> {DEMO_LABELLING.bannerText}
          </p>
        </section>
      ) : null}

      <section
        className="body-distinction"
        aria-label="Body, Substrate and Possession distinction"
        data-arena-body-distinction="true"
      >
        <p>{BODY_DISTINCTION_NOTE}</p>
      </section>

      <StudioRoleSwitcher view={view} />

      {view.bodies.length === 0 ? (
        <EmptyState
          title="No Agent Bodies yet"
          hint="The canonical read path returned no agent-body records in this workspace. Nothing is fabricated to fill the space."
        />
      ) : (
        <section className="body-library" aria-labelledby="body-library-title">
          <h2 id="body-library-title">Body library</h2>
          <ul className="body-library__cards" data-arena-body-cards="true">
            {view.bodies.map((body) => (
              <li key={body.recordId} className="body-library__item">
                <StudioBody body={body} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <PossessionMatrixTable view={view} />

      <ComparisonPanel view={view} />

      <section className="body-next" aria-labelledby="body-next-title">
        <h2 id="body-next-title">What can I do next?</h2>
        <ul className="body-next__actions" data-arena-next-actions="true">
          {lens.nextActions.map((action) => (
            <li key={action.href} className="body-next__action">
              <a href={action.href} className="body-next__link">{action.label}</a>
              <p className="body-next__note">{action.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <aside className="body-inspector" aria-label="Studio facts" data-arena-studio-inspector="true">
        <h2>Studio facts</h2>
        <dl className="body-inspector__facts">
          <div><dt>Tenant</dt><dd><code>{view.tenantId}</code></dd></div>
          <div><dt>Workspace</dt><dd><code>{view.workspaceId}</code></dd></div>
          <div><dt>Bodies</dt><dd>{String(view.bodies.length)}</dd></div>
          <div><dt>Possessions</dt><dd>{String(view.matrix.length)}</dd></div>
          <div><dt>Certification claims</dt><dd>{String(view.claimsTotal)}</dd></div>
          <div><dt>Read at</dt><dd>{view.readAt > 0 ? new Date(view.readAt).toISOString() : 'Unknown'}</dd></div>
        </dl>
        {view.demo.isDemo && view.demo.corpusHash !== undefined ? (
          <p className="body-inspector__hash" data-arena-corpus-hash="true">
            Demo corpus hash: <code>{view.demo.corpusHash.slice(0, 72)}…</code>
          </p>
        ) : null}
      </aside>
    </div>
  );
}
