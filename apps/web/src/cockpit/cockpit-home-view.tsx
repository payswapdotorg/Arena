/**
 * CockpitHomeView — the presentational cockpit home (Work Order B007;
 * issue #78; apps/web/src/cockpit).
 *
 * SYNC presentational component (renderable through react-dom/server in
 * the house test style): the async composition (session probe, canonical
 * reads, lens resolution) happens in apps/web/src/cockpit composition
 * helpers, and this component renders the resulting view model
 * deterministically — no Date.now(), no randomness, no implicit time.
 *
 * THE governing truths rendered here:
 *   - the shared shell wiring (workspace selector, active role switcher,
 *     global search/command, job/activity indicator, profile, contextual
 *     navigation) with the active role as an unmistakable UI LENS —
 *     permission enforcement stays server-side/policy-driven;
 *   - a requested-but-not-granted role renders as a truthful denial, never
 *     a faked authorization;
 *   - every surfaced datum carries its canonical state classification
 *     (distinct treatments; unknown/pending render as unknown/pending);
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
import type { CockpitDatumCard, CockpitHomeViewModel, CockpitNavItem } from './cockpit-view.js';
import { roleSwitchHref } from './cockpit-view.js';
import { isBadgeTreatment } from './state-mark.js';
import type { CockpitTruthTreatment } from './state-mark.js';
import type { RoleId } from '../../../../packages/role-context/src/index.js';

export interface CockpitHomeViewProps {
  readonly view: CockpitHomeViewModel;
}

/** The persistent, unmistakable "role is a lens, not authorization" note. */
const ROLE_LENS_NOTE =
  'Role context is a lens — it changes what the product emphasizes for you, never what you are authorized to do. Permissions stay server-side and policy-driven.';

/** The distinct cockpit mark for the two honesty-critical kinds B001 has no badge for. */
function CockpitTruthMark(props: {
  readonly treatment: CockpitTruthTreatment;
  readonly label: string;
  readonly meaning: string;
}) {
  const { treatment, label, meaning } = props;
  if (isBadgeTreatment(treatment)) {
    return <TruthBadge kind={treatment as StateKind} />;
  }
  return (
    <span
      className={`cockpit-truth cockpit-truth--${treatment}`}
      data-arena-truth={treatment}
      title={meaning}
    >
      <span className="cockpit-truth__marker" aria-hidden="true" />
      <span className="cockpit-truth__label">{label}</span>
    </span>
  );
}

/** One canonical datum card with its truth treatment (+ demo badge in demo mode). */
function CockpitDatum(props: { readonly card: CockpitDatumCard }) {
  const { card } = props;
  return (
    <li className="cockpit-datum" data-arena-datum={card.recordId} data-arena-datum-kind={card.kind}>
      <div className="cockpit-datum__head">
        <strong>{card.title}</strong>
        <CockpitTruthMark
          treatment={card.treatment}
          label={card.stateLabel}
          meaning={`Canonical classification: ${card.stateKind}`}
        />
        {card.demo ? <DemoDataBadge /> : null}
      </div>
      <p className="cockpit-datum__summary">{card.summary}</p>
      <p className="cockpit-datum__ref">
        canonical read: <code>{card.kind}</code> · <code>{card.recordId}</code> · schema v
        {String(card.sourceVersion)} · rev {String(card.sourceRevision)}
      </p>
    </li>
  );
}

/** The five shared-shell regions, wired as cockpit controls (server-rendered, JavaScript-free). */
function CockpitBar(props: { readonly view: CockpitHomeViewModel }) {
  const { view } = props;
  const recordCount = view.inventory.kinds.reduce((total, entry) => total + entry.count, 0);
  const commandItems: readonly CockpitNavItem[] = view.nav;
  return (
    <section
      className="cockpit-bar"
      aria-label="Workspace controls"
      data-arena-cockpit-bar="true"
      data-arena-cockpit-mode={view.mode}
    >
      <div className="cockpit-bar__region" data-arena-cockpit-region="workspace">
        <details className="cockpit-bar__details">
          <summary>
            Workspace: <strong>{view.workspaceId}</strong>
          </summary>
          <div className="cockpit-bar__region-body">
            <p>
              Tenant <code>{view.tenantId}</code> — one workspace is granted in this session. The
              workspace is a context, never an authorization.
            </p>
          </div>
        </details>
      </div>

      <div className="cockpit-bar__region" data-arena-cockpit-region="role">
        <details className="cockpit-bar__details" open>
          <summary>
            Role: <strong>{view.lens.roleName}</strong>
          </summary>
          <div className="cockpit-bar__region-body">
            <ul className="cockpit-roles" data-arena-role-switcher="true">
              {view.roleSwitch.grantedRoleIds.map((roleId: RoleId) => {
                const active = roleId === view.roleSwitch.activeRoleId;
                return (
                  <li key={roleId} className="cockpit-role">
                    <a
                      href={roleSwitchHref(view.roleHrefBase, roleId)}
                      className={active ? 'cockpit-role__link cockpit-role__link--active' : 'cockpit-role__link'}
                      {...(active ? { 'aria-current': 'page' as const } : {})}
                    >
                      {roleId}
                    </a>
                  </li>
                );
              })}
            </ul>
            <p className="cockpit-bar__note" data-arena-role-lens-note="true">
              {ROLE_LENS_NOTE}
            </p>
          </div>
        </details>
      </div>

      <div className="cockpit-bar__region" data-arena-cockpit-region="search">
        <details className="cockpit-bar__details">
          <summary>Search / commands</summary>
          <div className="cockpit-bar__region-body">
            <ul className="cockpit-commands" data-arena-command-menu="true">
              {commandItems.map((item) => (
                <li key={`command-${item.href}`}>
                  <a href={item.href}>
                    Go to {item.label.toLowerCase()}
                    {item.emphasized ? ' (role focus)' : ''}
                  </a>
                </li>
              ))}
            </ul>
            <p className="cockpit-bar__note">
              Free-text search across canonical objects arrives with the workflow routes (B008+);
              these navigation commands are what the shell can honestly run today.
            </p>
          </div>
        </details>
      </div>

      <div className="cockpit-bar__region" data-arena-cockpit-region="jobs">
        <p className="cockpit-activity" data-arena-activity="true">
          Read-model activity: {String(recordCount)} record
          {recordCount === 1 ? '' : 's'} across{' '}
          {String(view.inventory.kinds.length)} kind
          {view.inventory.kinds.length === 1 ? '' : 's'}
          {view.readAt > 0 ? ` · read at ${new Date(view.readAt).toISOString()}` : ''}.
          <span className="cockpit-bar__note">
            {' '}Job, SLO and quota indicators land with the operations surface (B014).
          </span>
        </p>
      </div>

      <div className="cockpit-bar__region" data-arena-cockpit-region="profile">
        <p className="cockpit-profile" data-arena-profile="true">
          {view.principalLabel} · tenant <code>{view.tenantId}</code>
        </p>
      </div>
    </section>
  );
}

/** Role-emphasized contextual navigation (emphasis only — routes are capabilities of the shell). */
function CockpitNav(props: { readonly view: CockpitHomeViewModel }) {
  const { view } = props;
  const currentPath = view.mode === 'demo' ? '/demo/cockpit' : '/';
  return (
    <nav
      className="cockpit-nav"
      aria-label="Context navigation"
      data-arena-cockpit-nav="true"
      data-arena-active-role={view.roleSwitch.activeRoleId}
    >
      <ul className="cockpit-nav__list">
        {view.nav.map((item) => {
          const isCurrent = currentPath === item.href;
          return (
            <li key={item.href} className="cockpit-nav__item">
              <a
                href={item.href}
                className={
                  isCurrent ? 'cockpit-nav__link cockpit-nav__link--current' : 'cockpit-nav__link'
                }
                {...(item.emphasized ? { 'data-arena-nav-emphasis': 'true' } : {})}
                {...(isCurrent ? { 'aria-current': 'page' as const } : {})}
              >
                {item.label}
                {item.emphasized ? <span className="cockpit-nav__focus" aria-hidden="true"> ·</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function CockpitHomeView({ view }: CockpitHomeViewProps) {
  const doingCards = view.doing.cards;
  return (
    <div
      className="cockpit"
      data-arena-route="cockpit"
      data-arena-cockpit-mode={view.mode}
      data-arena-active-role={view.roleSwitch.activeRoleId}
    >
      <PageHeader
        title={view.lens.landingTitle}
        description={view.lens.landingIntro}
        actions={
          <PrimaryAction href={view.lens.heroAction.href} testId="cockpit-hero">
            {view.lens.heroAction.label}
          </PrimaryAction>
        }
      />

      {view.demo.isDemo ? (
        <section
          className="cockpit-demo-banner"
          aria-label="Demo mode notice"
          data-arena-demo-banner="true"
        >
          <DemoDataBadge note="deterministic seed" />
          <p>
            <strong>{DEMO_LABELLING.bannerTitle}.</strong> {DEMO_LABELLING.bannerText}
          </p>
        </section>
      ) : null}

      <CockpitBar view={view} />

      {view.roleSwitch.denied ? (
        <section aria-label="Role request outcome" data-arena-role-denied="true">
          <DeniedState
            message={`The requested role context (${String(
              view.roleSwitch.deniedRequested,
            )}) is not granted to you in this workspace — showing your granted ${String(
              view.roleSwitch.activeRoleId,
            )} lens instead.`}
            requiredAuthority={`granted role: ${String(view.roleSwitch.deniedRequested)}`}
          />
        </section>
      ) : null}

      <section className="cockpit-doing" aria-labelledby="cockpit-doing-title">
        <h2 id="cockpit-doing-title">{view.doing.heading}</h2>
        <p className="cockpit-doing__intro">{view.doing.intro}</p>
        {doingCards.length === 0 ? (
          <EmptyState
            title="No canonical records for this lens yet"
            hint="The read model exposes nothing for this role's primary kinds in this workspace. Nothing is fabricated to fill the space."
          />
        ) : (
          <ul className="cockpit-doing__cards" data-arena-doing-cards="true">
            {doingCards.map((card) => (
              <CockpitDatum key={card.recordId} card={card} />
            ))}
          </ul>
        )}
        {view.doing.emptyKinds.map((kind) => (
          <EmptyState
            key={`empty-${kind}`}
            title={`No ${kind} records yet`}
            hint={`The canonical read path returned an empty page for ${kind} in this workspace.`}
          />
        ))}
      </section>

      <section className="cockpit-next" aria-labelledby="cockpit-next-title">
        <h2 id="cockpit-next-title">What can I do next?</h2>
        <ul className="cockpit-next__actions" data-arena-next-actions="true">
          {view.next.actions.map((action) => (
            <li key={action.href} className="cockpit-next__action">
              <a href={action.href} className="cockpit-next__link">
                {action.label}
              </a>
              <p className="cockpit-next__note">{action.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <CockpitNav view={view} />

      <aside
        className="cockpit-inspector"
        aria-label="Role context inspector"
        data-arena-cockpit-inspector="true"
      >
        <h2>Role context</h2>
        <dl className="cockpit-inspector__facts">
          <div>
            <dt>Active role</dt>
            <dd data-arena-inspector-role={view.roleSwitch.activeRoleId}>
              {view.lens.roleName}
            </dd>
          </div>
          <div>
            <dt>Role goal (RC1.0)</dt>
            <dd>{view.lens.roleGoal}</dd>
          </div>
          <div>
            <dt>Granted roles in this workspace</dt>
            <dd>{view.roleSwitch.grantedRoleIds.join(', ')}</dd>
          </div>
          <div>
            <dt>Authorization</dt>
            <dd data-arena-inspector-authorization="server-side">
              Unchanged by role switching — enforced server-side by the tenant permission policy.
            </dd>
          </div>
          <div>
            <dt>Read model</dt>
            <dd>
              {view.inventory.kinds
                .map((entry) => `${entry.kind} (${String(entry.count)})`)
                .join(', ')}
            </dd>
          </div>
        </dl>
        <p className="cockpit-inspector__note">{ROLE_LENS_NOTE}</p>
        {view.demo.isDemo && view.demo.corpusHash !== undefined ? (
          <p className="cockpit-inspector__hash" data-arena-corpus-hash="true">
            Demo corpus hash: <code>{view.demo.corpusHash.slice(0, 72)}…</code>
          </p>
        ) : null}
      </aside>
    </div>
  );
}
