/**
 * Body-marketplace views (Work Order C014): the React server components
 * for the capability-body marketplace — the full state set per the UX
 * gates (loading / empty / error / permission-denied / demo-data /
 * success), the persistent ROLE LENS switcher (query state, NOT
 * permission — the shared state vocabulary law), record-backed
 * certification badges ONLY, and the consequence exposure on blocked
 * pretraining runs. Demo compositions are visibly labelled; demo state
 * is never customer state.
 */

import type { ReactElement } from 'react';

import type {
  BrowseViewModel,
  ListingDetailOutcome,
  MyListingsViewModel,
} from './view-models.js';
import { BODY_MARKETPLACE_ROLE_LENSES } from './view-models.js';

function StateChip(props: { readonly state: string }): ReactElement {
  return (
    <span className="state-chip" data-arena-state={props.state}>
      {props.state}
    </span>
  );
}

function DemoStamp(props: { readonly demo: boolean }): ReactElement | null {
  if (!props.demo) return null;
  return (
    <span className="demo-stamp" data-arena-demo="true">
      DEMO DATA — not customer state
    </span>
  );
}

function RoleLensSwitcher(props: { readonly active: string }): ReactElement {
  return (
    <nav className="role-lens" aria-label="Capability-body marketplace role lens" data-arena-ln="true">
      {BODY_MARKETPLACE_ROLE_LENSES.map((lens) => (
        <a
          key={lens}
          className={lens === props.active ? 'lens-active' : 'lens-link'}
          href={`?lens=${lens}`}
          data-arena-lens={lens}
        >
          {lens}
        </a>
      ))}
    </nav>
  );
}

function CertificationBadge(props: {
  readonly state: string;
  readonly grantedLevel: string | null;
}): ReactElement {
  if (props.state !== 'record-backed') {
    // The honest unverified state — NEVER an invented badge.
    return (
      <span className="certification-badge" data-arena-certification="unverified">
        certification: unverified (no record-backed statement)
      </span>
    );
  }
  return (
    <span className="certification-badge" data-arena-certification="record-backed">
      certification: record-backed · {props.grantedLevel}
      <small> (tested composition, never the base model)</small>
    </span>
  );
}

/** The auth-required (permission-denied) experience. */
export function BodyMarketplaceAuthRequiredView(): ReactElement {
  return (
    <section className="body-marketplace auth-required" data-arena-state="permission-denied">
      <h1>Capability-body marketplace</h1>
      <StateChip state="permission-denied" />
      <p>Sign in to browse capability bodies. The marketplace never renders anonymously.</p>
    </section>
  );
}

/** The loading experience. */
export function BodyMarketplaceLoadingView(): ReactElement {
  return (
    <section className="body-marketplace loading" data-arena-state="loading">
      <h1>Capability-body marketplace</h1>
      <StateChip state="loading" />
      <p>Loading capability bodies…</p>
    </section>
  );
}

/** The error experience (fail closed). */
export function BodyMarketplaceErrorView(props: { readonly detail: string }): ReactElement {
  return (
    <section className="body-marketplace error" data-arena-state="error">
      <h1>Capability-body marketplace</h1>
      <StateChip state="error" />
      <p role="alert">{props.detail}</p>
    </section>
  );
}

/** The browse (home) experience. */
export function BodyMarketplaceBrowseView(props: { readonly model: BrowseViewModel }): ReactElement {
  const { model } = props;
  return (
    <section className="body-marketplace browse" data-arena-state={model.state}>
      <h1>Capability bodies</h1>
      <StateChip state={model.state} />
      <DemoStamp demo={model.mode === 'demo'} />
      <p className="tenant">tenant: {model.tenantLabel}</p>
      <RoleLensSwitcher active={model.roleLens} />
      {model.rows.length === 0 ? (
        <p className="empty">
          No capability bodies listed yet. Publish your first pretrained body to see it here.
        </p>
      ) : (
        <ul className="listing-rows">
          {model.rows.map((row) => (
            <li key={row.listingId} className="listing-row" data-arena-listing={row.listingId}>
              <h2>
                <a href={`/body-marketplace/listings/${row.listingId}`}>{row.title}</a>
              </h2>
              <p>{row.summary}</p>
              <p className="meta">
                {row.bodyVersion} · channel {row.channel ?? '—'} · listing v{row.version} · state {row.state}
                {row.pricing === null ? '' : ` · ${row.pricing}`}
              </p>
              <CertificationBadge state={row.certificationState} grantedLevel={row.grantedLevel} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The listing detail experience (lineage/provenance, rights, substrates, history). */
export function BodyMarketplaceDetailView(props: { readonly outcome: ListingDetailOutcome }): ReactElement {
  const { outcome } = props;
  if (outcome.model === null) {
    return (
      <section className="body-marketplace detail" data-arena-state={outcome.state}>
        <h1>Capability body</h1>
        <StateChip state={outcome.state} />
        <p>This listing does not exist (or is not visible to your tenant).</p>
      </section>
    );
  }
  const model = outcome.model;
  return (
    <section className="body-marketplace detail" data-arena-state="success">
      <h1>{model.row.title}</h1>
      <StateChip state="success" />
      <p>{model.row.summary}</p>
      <CertificationBadge state={model.row.certificationState} grantedLevel={model.row.grantedLevel} />
      <dl className="lineage">
        <dt>body version</dt>
        <dd>{model.row.bodyVersion}</dd>
        <dt>forge provenance</dt>
        <dd>{model.forgeRecordDigest ?? '—'}</dd>
        <dt>pretraining run</dt>
        <dd>{model.pretrainingRunId ?? '—'}</dd>
        <dt>certification records</dt>
        <dd>{model.certificationRefs.join(', ') || '—'}</dd>
        <dt>capability evidence</dt>
        <dd>{model.capabilityEvidenceRefs.join(', ') || '—'}</dd>
        <dt>rights</dt>
        <dd>{JSON.stringify(model.rights ?? {})}</dd>
        <dt>substrate compatibility</dt>
        <dd>{JSON.stringify(model.substrateCompatibility ?? {})}</dd>
      </dl>
      <h2>Version history (append-only)</h2>
      <ol className="history">
        {model.history.map((entry, index) => (
          <li key={index}>
            {entry.from} → {entry.to}: {entry.reason}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The request-pretraining experience (rights declarations + consequence exposure). */
export function BodyMarketplaceRequestPretrainingView(props: {
  readonly mode: 'demo' | 'session';
  readonly tenantLabel: string;
  readonly runs: readonly { readonly runId: string; readonly outcome: string; readonly blockedReasons: readonly string[] }[];
}): ReactElement {
  return (
    <section className="body-marketplace request-pretraining" data-arena-state="demo-data">
      <h1>Request pretraining</h1>
      <DemoStamp demo={props.mode === 'demo'} />
      <p className="tenant">tenant: {props.tenantLabel}</p>
      <p className="law">
        Only C009-VALIDATED intervention evidence with explicit rights clearance may train.
        Nothing becomes a reusable marketplace asset merely because an expert typed it.
      </p>
      <form className="pretraining-form" data-arena-form="request-pretraining">
        <label htmlFor="capability-need">capability need</label>
        <input id="capability-need" name="capabilityNeed" />
        <label htmlFor="data-refs">validated data-source refs</label>
        <input id="data-refs" name="dataSourceRefs" />
        <label htmlFor="rights">rights declaration (license, training use, scope)</label>
        <input id="rights" name="rightsDeclaration" />
        <p className="consequence">
          Consequence: declaring forbidden or unspecified training use BLOCKS the run — the forge
          is never invoked and no BodyVersion is proposed.
        </p>
      </form>
      {props.runs.length > 0 ? (
        <ul className="run-rows">
          {props.runs.map((run) => (
            <li key={run.runId} data-arena-run={run.runId} data-arena-run-outcome={run.outcome}>
              <h2>run {run.runId} — {run.outcome}</h2>
              {run.outcome === 'blocked' ? (
                <ul className="blocked-reasons">
                  {run.blockedReasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The my-listings experience (publish flow with explicit versioning). */
export function BodyMarketplaceMyListingsView(props: { readonly model: MyListingsViewModel }): ReactElement {
  const { model } = props;
  return (
    <section className="body-marketplace my-listings" data-arena-state={model.state}>
      <h1>My listings</h1>
      <StateChip state={model.state} />
      <DemoStamp demo={model.mode === 'demo'} />
      <p className="tenant">tenant: {model.tenantLabel}</p>
      {model.rows.length === 0 && model.runs.length === 0 ? (
        <p className="empty">No listings or pretraining runs yet.</p>
      ) : (
        <>
          <ul className="listing-rows">
            {model.rows.map((row) => (
              <li key={row.listingId} data-arena-listing={row.listingId}>
                <h2>{row.title}</h2>
                <p className="meta">
                  listing v{row.version} · state {row.state} · {row.bodyVersion}
                </p>
                <CertificationBadge state={row.certificationState} grantedLevel={row.grantedLevel} />
                <p className="versioning">
                  Publication is an explicit versioned transition: every transition appends to the
                  listing history and bumps the listing revision.
                </p>
              </li>
            ))}
          </ul>
          <h2>Pretraining runs</h2>
          <ul className="run-rows">
            {model.runs.map((run) => (
              <li key={run.runId} data-arena-run={run.runId} data-arena-run-outcome={run.outcome}>
                {run.runId} — {run.outcome}
                {run.outcome === 'blocked' ? (
                  <ul className="blocked-reasons">
                    {run.blockedReasons.map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
