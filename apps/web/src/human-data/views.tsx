/**
 * The human-data studio views (Work Order C012; apps/web/src/human-data).
 * SYNC presentational components — the mounts resolve the experience
 * server-side and render one of these. Every route renders its honest
 * state set: loading/empty/error/permission-denied/demo-data/success
 * (UX quality gates); every rights/retention declaration exposes its
 * consequences (ERF1.0: operational delivery and training-data rights stay
 * separate); demo data is visibly labelled.
 */

import type { ReactElement } from 'react';

import {
  DemoDataBadge,
  DeniedState,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StaleDataNotice,
  Surface,
  TruthBadge,
} from '@arena/ui-platform';

import type {
  CommissionBuilderViewModel,
  DatasetDeliveryViewModel,
  ProductionDashboardViewModel,
} from './view-models.js';

// ---------------------------------------------------------------------------
// Mount-level honest states
// ---------------------------------------------------------------------------

/** `/human-data/**` without an authenticated session: fail closed, honestly. */
export function HumanDataAuthRequiredView() {
  return (
    <div
      className="human-data-surface human-data-surface--auth-required"
      data-arena-route="human-data"
      data-arena-surface-auth="required"
    >
      <PageHeader
        title="Human-data studio"
        description="Commission targeted human data for your AI pipeline — corrections, demonstrations, evaluations and knowledge, validated and rights-cleared, delivered as versioned datasets."
      />
      <DeniedState
        message="The human-data studio requires an authenticated workspace session. Sessions are validated server-side (fail closed) — there is no anonymous studio surface."
        requiredAuthority="authenticated session (B004 session boundary)"
      />
      <p className="human-data-surface__auth-hint">
        <a href="/">Go to the Arena home surface</a> to sign in. Deliverables without an explicit
        granted consent/rights statement never enter a dataset bundle — the rights wall is
        structural, not a checkbox.
      </p>
    </div>
  );
}

/** A studio read that failed: the honest error state (never a fabricated view). */
export function HumanDataErrorView(props: { readonly detail: string }) {
  return (
    <div
      className="human-data-surface human-data-surface--error"
      data-arena-route="human-data"
      data-arena-state="error"
    >
      <PageHeader title="Human-data studio" description="The studio could not be read." />
      <ErrorState
        title="Studio read failed"
        detail={props.detail}
        action={<a href="/human-data">Retry the human-data studio</a>}
      />
    </div>
  );
}

/** The shared loading state (suspense fallback shape for the mounts). */
export function HumanDataLoadingView() {
  return (
    <div
      className="human-data-surface human-data-surface--loading"
      data-arena-route="human-data"
      data-arena-state="loading"
    >
      <PageHeader title="Human-data studio" description="Reading commissions and datasets…" />
      <LoadingState label="Loading the human-data studio" />
    </div>
  );
}

/** The shared studio header + sub-navigation (presentation only). */
function StudioHeader(props: { readonly tenantLabel: string; readonly demo: boolean }) {
  return (
    <header className="human-data-studio__header">
      <PageHeader
        title="Human-data studio"
        description={`Commission targeted human data for your AI pipeline — the full escalation machinery produces it, C009 validation gates it, rights clear it, A014 bundles it. Workspace: ${props.tenantLabel}.`}
      />
      {props.demo ? (
        <p className="human-data-studio__truth">
          <DemoDataBadge note="deterministic demo corpus — demo state is never customer state" />
        </p>
      ) : null}
      <nav className="human-data-studio__nav" aria-label="Human-data studio">
        <a href="/human-data">Commission builder</a>
        <a href="/human-data/production">Production dashboard</a>
        <a href="/human-data/datasets">Dataset delivery</a>
      </nav>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Commission builder (home)
// ---------------------------------------------------------------------------

export function HumanDataHomeView(props: {
  readonly tenantLabel: string;
  readonly demo: boolean;
  readonly builder: CommissionBuilderViewModel | null;
}) {
  return (
    <div
      className="human-data-surface human-data-surface--home"
      data-arena-route="human-data-home"
      data-arena-demo={props.demo ? 'true' : 'false'}
    >
      <StudioHeader tenantLabel={props.tenantLabel} demo={props.demo} />
      <Surface>
        <h2>Declare the dataset shape (capability need, modes, schema, rights)</h2>
        <p>
          A commission compiles to ES1.0 escalation requests through the C001 public port — one
          seam, no new lifecycle. Each item runs the full machinery (session → intervention →
          validation); only C009-ACCEPTED outputs become deliverables.
        </p>
        {props.builder === null ? (
          <EmptyState
            title="No commission declared yet"
            hint="Declare your first commission (capability need, permitted modes, per-item output schema, quantity, acceptance criteria, budget/urgency and the rights/retention posture) — the studio renders honest empty states until then."
          />
        ) : (
          <CommissionDeclaration model={props.builder} demo={props.demo} />
        )}
      </Surface>
    </div>
  );
}

function CommissionDeclaration(props: {
  readonly model: CommissionBuilderViewModel;
  readonly demo: boolean;
}): ReactElement {
  const { model } = props;
  return (
    <div className="human-data-builder" data-arena-commission={model.commissionId}>
      {props.demo ? <StaleDataNotice note="demo commission — deterministic corpus" /> : null}
      <dl className="human-data-builder__facts">
        <div data-arena-fact="dataset">
          <dt>Dataset</dt>
          <dd>
            <code>{model.datasetName}</code> ({model.deliverableKind}, {model.quantity} items)
          </dd>
        </div>
        <div data-arena-fact="capability">
          <dt>Capability need</dt>
          <dd>
            <code>{model.capabilityNeed}</code>
          </dd>
        </div>
        <div data-arena-fact="modes">
          <dt>Permitted modes</dt>
          <dd>{model.escalationModes.join(', ')}</dd>
        </div>
        <div data-arena-fact="urgency">
          <dt>Urgency / budget</dt>
          <dd>
            {model.urgency} · {model.budget}
          </dd>
        </div>
        <div data-arena-fact="acceptance">
          <dt>Acceptance criteria</dt>
          <dd>
            {model.acceptanceCriteria.join('; ')} — minimum accepted ratio{' '}
            {model.minAcceptedRatio} (evaluated through the C009 validation seam; no
            self-certified deliverables)
          </dd>
        </div>
        <div data-arena-fact="rights">
          <dt>Rights posture (consequence exposure)</dt>
          <dd>
            <ul>
              {model.rightsConsequences.map((consequence) => (
                <li key={consequence}>{consequence}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div data-arena-fact="retention">
          <dt>Retention</dt>
          <dd>{model.retention}</dd>
        </div>
        <div data-arena-fact="learning">
          <dt>Learning permissions</dt>
          <dd>
            <ul>
              {model.learningPermissions.map((permission) => (
                <li key={permission}>{permission}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div data-arena-fact="consent">
          <dt>Consent declaration</dt>
          <dd>{model.consentStatement}</dd>
        </div>
      </dl>
      <p className="human-data-builder__law">
        <TruthBadge kind="evidence" /> ERF1.0: the immediate operational result is delivered
        independently of training-data rights — declaring the rights posture here governs the
        DATASET, never the escalation result.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Production dashboard
// ---------------------------------------------------------------------------

export function HumanDataProductionView(props: {
  readonly tenantLabel: string;
  readonly demo: boolean;
  readonly dashboard: ProductionDashboardViewModel | null;
}) {
  return (
    <div
      className="human-data-surface human-data-surface--production"
      data-arena-route="human-data-production"
      data-arena-demo={props.demo ? 'true' : 'false'}
    >
      <StudioHeader tenantLabel={props.tenantLabel} demo={props.demo} />
      <Surface>
        <h2>Live escalations feeding the commission (C001 event projections)</h2>
        {props.dashboard === null ? (
          <EmptyState
            title="No commission in production"
            hint="Submit a commission to see its escalations progress through the C001 lifecycle here — honest empty states until then."
          />
        ) : (
          <ProductionTable model={props.dashboard} />
        )}
      </Surface>
    </div>
  );
}

function ProductionTable(props: { readonly model: ProductionDashboardViewModel }): ReactElement {
  const { model } = props;
  return (
    <div className="human-data-production" data-arena-commission={model.commissionId}>
      <p>
        Commission <code>{model.commissionId}</code> — {model.datasetName} ({model.deliverableKind},
        state <strong>{model.state}</strong>, {model.quantity} items).
      </p>
      <table className="human-data-production__table">
        <thead>
          <tr>
            <th>Escalation</th>
            <th>C001 state</th>
            <th>Validation</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.requestId} data-arena-escalation={row.requestId}>
              <td>
                <code>{row.requestId}</code>
              </td>
              <td>{row.state}</td>
              <td>{row.validationStatus}</td>
              <td>{row.updatedAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {model.unreadableCount > 0 ? (
        <p className="human-data-production__unreadable">
          {model.unreadableCount} escalation(s) unreadable (fail-closed, honestly surfaced — never
          fabricated).
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dataset delivery
// ---------------------------------------------------------------------------

export function HumanDataDatasetsView(props: {
  readonly tenantLabel: string;
  readonly demo: boolean;
  readonly delivery: DatasetDeliveryViewModel | null;
}) {
  return (
    <div
      className="human-data-surface human-data-surface--datasets"
      data-arena-route="human-data-datasets"
      data-arena-demo={props.demo ? 'true' : 'false'}
    >
      <StudioHeader tenantLabel={props.tenantLabel} demo={props.demo} />
      <Surface>
        <h2>Delivered datasets (bundle manifest, rights/lineage view, download gate)</h2>
        {props.delivery === null ? (
          <EmptyState
            title="No dataset delivered yet"
            hint="When a commission's accepted, rights-gated deliverables assemble, its versioned immutable bundle appears here with the full manifest, rights and lineage view."
          />
        ) : (
          <DeliveryView model={props.delivery} demo={props.demo} />
        )}
      </Surface>
    </div>
  );
}

function DeliveryView(props: { readonly model: DatasetDeliveryViewModel; readonly demo: boolean }): ReactElement {
  const { model } = props;
  return (
    <div className="human-data-delivery" data-arena-dataset={model.identity}>
      {props.demo ? <StaleDataNotice note="demo dataset — deterministic corpus" /> : null}
      <dl className="human-data-delivery__facts">
        <div data-arena-fact="identity">
          <dt>Dataset</dt>
          <dd>
            <code>{model.identity}</code> @ {model.version}
          </dd>
        </div>
        <div data-arena-fact="manifest">
          <dt>Manifest digest</dt>
          <dd>
            <code>{model.manifestDigest}</code>
          </dd>
        </div>
        <div data-arena-fact="entries">
          <dt>Entries checksum</dt>
          <dd>
            <code>{model.entriesChecksum}</code>
          </dd>
        </div>
        <div data-arena-fact="deliverables">
          <dt>Deliverables / verification evidence</dt>
          <dd>
            {model.deliverableCount} rights-gated deliverable(s); {model.verificationCount} C009
            verification ref(s) shipped with the bundle (no self-certified deliverables).
          </dd>
        </div>
        <div data-arena-fact="rights">
          <dt>Rights</dt>
          <dd>
            <ul>
              {model.rights.map((right) => (
                <li key={right}>{right}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div data-arena-fact="lineage">
          <dt>Lineage</dt>
          <dd>
            {model.lineage.length === 0 ? (
              <span>initial version (no parents)</span>
            ) : (
              <ul>
                {model.lineage.map((edge) => (
                  <li key={edge.parent}>
                    {edge.relation} → <code>{edge.parent}</code>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      <p className="human-data-delivery__download">
        {model.downloadPermitted ? (
          <a
            href="#download"
            data-arena-download="permitted"
            title="Download is permitted by the declared redistribution policy"
          >
            Download bundle (permitted by the declared redistribution policy)
          </a>
        ) : (
          <DeniedState
            message="Download is NOT permitted: the declared redistribution policy is prohibited — the rights metadata governs the delivery surface."
            requiredAuthority="redistribution policy: allowed or tenant-only"
          />
        )}
      </p>
      <p className="human-data-delivery__law">
        <TruthBadge kind="evidence" /> A deliverable without an explicit granted consent/rights
        statement can never enter a dataset bundle — the wall is structural (EES1.0 consent; lock
        rules 11/18/31).
      </p>
    </div>
  );
}
