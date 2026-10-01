/**
 * BodyDetailView — the presentational `/bodies/:id` studio (Work Order
 * B010; issue #82; apps/web/src/bodies).
 *
 * SYNC presentational component: the async resolution happens in
 * body-detail-view.ts; this component renders the resolved view model.
 * The detail surface makes the SAME truths unmistakable at full size:
 * explicit versioning + immutability, the full composition inspection,
 * the possession matrix of THIS body, the claims scoped to THIS version,
 * and the composition-scoped comparison outcome (typed rejections
 * included, honestly).
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
import type { CertificationClaimCard } from '../../../../packages/body-ui/src/index.js';
import { certificationScopeLabel, possessionRowLabel } from '../../../../packages/body-ui/src/index.js';
import { roleSwitchHref } from '../cockpit/cockpit-view.js';
import { isBadgeTreatment } from '../cockpit/state-mark.js';
import type { CockpitTruthTreatment } from '../cockpit/state-mark.js';
import { BODY_STUDIO_EMPHASIS_LABELS } from './role-lens.js';
import type { BodyDetailViewModel } from './body-detail-view.js';

export interface BodyDetailViewProps {
  readonly view: BodyDetailViewModel;
}

const BODY_DISTINCTION_NOTE =
  'Body ≠ model · Substrate ≠ Body · Possession = a versioned composition binding (Body Version × Substrate × Runtime × Environment × Policy).';

const ROLE_LENS_NOTE =
  'Role context is a lens — it changes what this detail surface emphasizes for you, never what you are authorized to do.';

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

function Maybe(props: { readonly value: string | undefined }) {
  if (props.value === undefined) {
    return <span className="body-unknown" data-arena-unknown="true">Unknown</span>;
  }
  return <span>{props.value}</span>;
}

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
        Claim scope: <code>{certificationScopeLabel(claim)}</code> — verdict <Maybe value={claim.verdict} />
      </p>
      {claim.basis !== undefined ? <p className="body-claim__basis">Basis: {claim.basis}</p> : null}
      <p className="body-claim__note">{claim.scopeNote}</p>
    </li>
  );
}

export function BodyDetailView({ view }: BodyDetailViewProps) {
  const identity = view.card.identity;
  const composition = view.card.composition;
  const counts = composition.counts;
  const lens = view.lens;
  return (
    <div
      className="body-studio body-studio--detail"
      data-arena-route="bodies-detail"
      data-arena-studio-mode={view.mode}
      data-arena-body={view.recordId}
      data-arena-body-version={identity.versioning.currentVersion ?? 'unknown'}
    >
      <PageHeader
        title={view.title}
        description={view.summary}
        actions={
          <PrimaryAction href="/bodies" testId="body-detail-back">
            Back to the body library
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

      <section className="body-roles" aria-label="Body Studio role lens" data-arena-role-switcher="true">
        <p className="body-roles__active">
          Lens: <strong data-arena-active-role={view.roleSwitch.activeRoleId}>{lens.roleName}</strong>
          {' — '}
          {lens.detailTitle} (focus: {BODY_STUDIO_EMPHASIS_LABELS[lens.emphasis]})
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

      <section className="body-detail-identity" aria-labelledby="body-detail-identity-title">
        <h2 id="body-detail-identity-title">Body Version — identity card</h2>
        <div className="body-detail-identity__head">
          <BodyTruthMark
            treatment={view.classification.treatment}
            label={view.classification.stateLabel}
            meaning={`Canonical classification: ${view.classification.stateKind}`}
          />
          {view.demo.isDemo ? <DemoDataBadge /> : null}
        </div>
        <dl className="body-card__identity">
          <div><dt>Body</dt><dd data-arena-body-id={identity.bodyId ?? 'unknown'}><Maybe value={identity.bodyId} /></dd></div>
          <div><dt>Current version</dt><dd data-arena-version-current={identity.versioning.currentVersion ?? 'unknown'}><Maybe value={identity.versioning.currentVersion} /></dd></div>
          <div><dt>Initial version</dt><dd><Maybe value={identity.versioning.initialVersion} /></dd></div>
          {identity.versioning.evolution !== undefined ? (
            <div><dt>Evolution</dt><dd>{identity.versioning.evolution}</dd></div>
          ) : null}
          <div><dt>Content digest</dt><dd><Maybe value={identity.digest} /></dd></div>
          <div><dt>Record</dt><dd><code>{view.recordId}</code></dd></div>
        </dl>
        <p className="body-card__immutability" data-arena-version-immutability="true">
          {identity.immutabilityNote}
        </p>
      </section>

      <section className="body-detail-composition" aria-labelledby="body-detail-composition-title">
        <h2 id="body-detail-composition-title">Composition — skills, knowledge, tools</h2>
        <dl className="body-card__composition-facts" data-arena-composition="true">
          <div><dt>Skills</dt><dd><Maybe value={counts.skills !== undefined ? String(counts.skills) : undefined} /></dd></div>
          <div><dt>Knowledge</dt><dd><Maybe value={counts.knowledge !== undefined ? String(counts.knowledge) : undefined} /></dd></div>
          <div><dt>Tools</dt><dd><Maybe value={counts.tools !== undefined ? String(counts.tools) : undefined} /></dd></div>
          <div><dt>Procedures</dt><dd><Maybe value={counts.procedures !== undefined ? String(counts.procedures) : undefined} /></dd></div>
          <div><dt>Capabilities</dt><dd><Maybe value={counts.capabilities !== undefined ? String(counts.capabilities) : undefined} /></dd></div>
          <div><dt>Evaluation suites</dt><dd><Maybe value={counts.evaluationSuites !== undefined ? String(counts.evaluationSuites) : undefined} /></dd></div>
          <div><dt>Verification suites</dt><dd><Maybe value={counts.verificationSuites !== undefined ? String(counts.verificationSuites) : undefined} /></dd></div>
          <div><dt>Runtime requirement</dt><dd><Maybe value={composition.environmentRequirements.runtime} /></dd></div>
          <div><dt>Network requirement</dt><dd><Maybe value={composition.environmentRequirements.network} /></dd></div>
        </dl>
        {composition.toolNames.length > 0 ? (
          <p className="body-card__tools">Tools: {composition.toolNames.join(', ')}</p>
        ) : (
          <p className="body-card__tools" data-arena-unknown="true">Tools: Unknown</p>
        )}
        <p className="body-card__composition-note">{composition.compositionNote}</p>
      </section>

      <section className="body-matrix" aria-labelledby="body-detail-matrix-title" data-arena-possession-matrix="true">
        <h2 id="body-detail-matrix-title">Possession matrix — this body</h2>
        {view.card.possessionMatrix.rows.length === 0 ? (
          <EmptyState
            title="No possessions yet"
            hint="No possession binds this body version to a cognitive substrate yet. A possession is a versioned composition binding — it is never just the model."
          />
        ) : (
          <ul className="body-matrix__list">
            {view.card.possessionMatrix.rows.map((row) => (
              <li
                key={row.possessionId ?? row.recordId}
                className="body-possession"
                data-arena-possession={row.possessionId ?? 'unknown'}
                data-arena-binding={row.binding}
              >
                <p className="body-possession__label">{possessionRowLabel(row)}</p>
                <dl className="body-possession__facts">
                  <div><dt>Possession</dt><dd><Maybe value={row.possessionId} /></dd></div>
                  <div><dt>Body version</dt><dd data-arena-possession-body-version={row.bodyVersion !== undefined ? `${row.bodyVersion.bodyId}@${row.bodyVersion.version}` : 'unknown'}><Maybe value={row.bodyVersion !== undefined ? `${row.bodyVersion.bodyId}@${row.bodyVersion.version}` : undefined} /></dd></div>
                  <div><dt>Cognitive substrate</dt><dd data-arena-possession-substrate={row.substrate ?? 'unknown'}><Maybe value={row.substrate} /></dd></div>
                  <div><dt>Runtime</dt><dd><Maybe value={row.runtime} /></dd></div>
                  <div><dt>Environment</dt><dd><Maybe value={row.environment} /></dd></div>
                  <div><dt>Policy</dt><dd><Maybe value={row.policy} /></dd></div>
                  <div><dt>Scope</dt><dd><Maybe value={row.scope} /></dd></div>
                </dl>
                <p className="body-possession__note">{row.bindingNote}</p>
              </li>
            ))}
          </ul>
        )}
        {view.card.possessionMatrix.malformedEntries.length > 0 ? (
          <div className="body-matrix__malformed" role="note" data-arena-malformed-possessions="true">
            <p>
              {String(view.card.possessionMatrix.malformedEntries.length)} possession entr
              {view.card.possessionMatrix.malformedEntries.length === 1 ? 'y is' : 'ies are'} unreadable
              and rendered as such — never guessed into rows.
            </p>
          </div>
        ) : null}
      </section>

      <section className="body-detail-claims" aria-labelledby="body-detail-claims-title">
        <h2 id="body-detail-claims-title">Certification claims — this composition</h2>
        {view.claims.length === 0 ? (
          <p className="body-card__claims-empty" data-arena-claims-empty="true">
            No certification claim covers this body’s current version. A claim would assert that a
            TESTED COMPOSITION satisfied its suite — never the model in isolation.
          </p>
        ) : (
          <ul className="body-card__claims-list">
            {view.claims.map((claim) => (
              <ClaimCard key={claim.recordId} claim={claim} demo={view.demo.isDemo} />
            ))}
          </ul>
        )}
        {view.otherClaims.length > 0 ? (
          <p className="body-card__claims-other">
            {String(view.otherClaims.length)} claim
            {view.otherClaims.length === 1 ? '' : 's'} in this workspace tested other compositions —
            a claim never transfers to this version.
          </p>
        ) : null}
      </section>

      <section className="body-compare" aria-labelledby="body-detail-compare-title" data-arena-compare-scope="composition-scoped">
        <h2 id="body-detail-compare-title">Compare substrates — composition-scoped</h2>
        <p className="body-compare__rule">
          Substrate comparisons compare full compositions under identical suite/environment
          semantics — a bare substrate or model ranking is a typed rejection, never a rendered
          comparison.
        </p>
        {view.comparison.kind === 'rejected' ? (
          <div className="body-compare__rejection" data-arena-comparison-rejected={view.comparison.code}>
            <p>
              Typed rejection <code>{view.comparison.code}</code>: {view.comparison.message}.
            </p>
            <p className="body-compare__guidance">{view.comparison.guidance}</p>
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
              {view.comparison.rows.map((row) => (
                <tr key={row.armId} data-arena-comparison-arm={row.armId}>
                  <td>{row.armId}</td>
                  <td>{row.bodyVersion.bodyId}@{row.bodyVersion.version} × {row.substrate}</td>
                  <td><Maybe value={row.runtime} /></td>
                  <td><Maybe value={row.environment} /></td>
                  <td><Maybe value={row.evidence.verdict} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="body-next" aria-labelledby="body-detail-next-title">
        <h2 id="body-detail-next-title">This lens on this body</h2>
        <p className="body-next__intro">{lens.detailIntro}</p>
        <p className="body-next__focus">{lens.detailFocus}</p>
        <ul className="body-next__actions" data-arena-next-actions="true">
          {lens.nextActions.map((action) => (
            <li key={action.href} className="body-next__action">
              <a href={action.href} className="body-next__link">{action.label}</a>
              <p className="body-next__note">{action.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <aside className="body-inspector" aria-label="Detail facts" data-arena-studio-inspector="true">
        <h2>Detail facts</h2>
        <dl className="body-inspector__facts">
          <div><dt>Tenant</dt><dd><code>{view.tenantId}</code></dd></div>
          <div><dt>Workspace</dt><dd><code>{view.workspaceId}</code></dd></div>
          <div><dt>Record</dt><dd><code>{view.recordId}</code></dd></div>
          <div><dt>Possessions</dt><dd>{String(view.card.possessionMatrix.rows.length)}</dd></div>
          <div><dt>Claims (this version)</dt><dd>{String(view.claims.length)}</dd></div>
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
