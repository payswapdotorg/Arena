/**
 * The developers surface views (Work Order C017; apps/web/src/developers).
 * SYNC presentational components — the mounts resolve the experience
 * server-side and render one of these. Every route renders its honest
 * state set: loading/empty/error/permission-denied/demo-data/success
 * (UX quality gates) and every consequential action exposes its
 * consequence (rotate/revoke).
 */

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

import type { DashboardViewModel, EscalationRowViewModel } from './view-models.js';
import type { KeyRowViewModel, QuickstartViewModel, SandboxScenarioViewModel } from './view-models.js';

// ---------------------------------------------------------------------------
// Mount-level honest states
// ---------------------------------------------------------------------------

/** `/developers/**` without an authenticated session: fail closed, honestly. */
export function DevelopersAuthRequiredView() {
  return (
    <div
      className="developers-surface developers-surface--auth-required"
      data-arena-route="developers"
      data-arena-surface-auth="required"
    >
      <PageHeader
        title="Developers"
        description="API keys, sandbox escalations, SDK quickstarts and escalation observability for your client applications — for authenticated application developers."
      />
      <DeniedState
        message="The developer portal requires an authenticated workspace session. Sessions are validated server-side (fail closed) — there is no anonymous developer surface."
        requiredAuthority="authenticated session (B004 session boundary)"
      />
      <p className="developers-surface__auth-hint">
        <a href="/">Go to the Arena home surface</a> to sign in. The sandbox escalations inside the
        portal are always visibly labelled — sandbox money is demo money, never customer money.
      </p>
    </div>
  );
}

/** A portal read that failed: the honest error state (never a fabricated table). */
export function DevelopersErrorView(props: { readonly detail: string }) {
  return (
    <div
      className="developers-surface developers-surface--error"
      data-arena-route="developers"
      data-arena-state="error"
    >
      <PageHeader title="Developers" description="The developer portal could not be read." />
      <ErrorState
        title="Portal read failed"
        detail={props.detail}
        action={<a href="/developers">Retry the developer portal</a>}
      />
    </div>
  );
}

/** The shared portal header + sub-navigation (presentation only). */
function PortalHeader(props: { readonly tenantLabel: string; readonly demo: boolean }) {
  return (
    <header className="developers-portal__header">
      <PageHeader
        title="Developers"
        description={`The Arena escalation API for client applications — keys, sandbox, quickstarts and observability. Workspace: ${props.tenantLabel}.`}
      />
      {props.demo ? (
        <p className="developers-portal__truth">
          <DemoDataBadge note="deterministic demo corpus — demo state is never customer state" />
        </p>
      ) : null}
      <nav className="developers-portal__nav" aria-label="Developer portal">
        <a href="/developers">Overview</a>
        <a href="/developers/keys">API keys</a>
        <a href="/developers/quickstart">Quickstart</a>
        <a href="/developers/sandbox">Sandbox console</a>
        <a href="/developers/observability">Observability</a>
      </nav>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Overview (home)
// ---------------------------------------------------------------------------

export function DevelopersHomeView(props: {
  readonly tenantLabel: string;
  readonly demo: boolean;
  readonly clientAppCount: number;
  readonly keyCount: number;
  readonly escalationCount: number;
}) {
  return (
    <div
      className="developers-surface developers-surface--home"
      data-arena-route="developers-home"
      data-arena-demo={props.demo ? 'true' : 'false'}
    >
      <PortalHeader tenantLabel={props.tenantLabel} demo={props.demo} />
      <Surface>
        <h2>Register with Arena, then escalate (completion targets 1 and 14)</h2>
        <p>
          Register a client application, obtain scoped API keys, run visibly-labelled sandbox
          escalations, follow the SDK quickstart (the trivial
          <code> POST /v1/escalations</code> first path) and watch your escalations&rsquo;
          lifecycle, validation and cost through the observability dashboard and webhooks.
        </p>
        <ul className="developers-portal__facts">
          <li data-arena-fact="client-apps">
            Client applications: <strong>{props.clientAppCount}</strong>
          </li>
          <li data-arena-fact="keys">
            API keys: <strong>{props.keyCount}</strong>
          </li>
          <li data-arena-fact="escalations">
            Escalations projected: <strong>{props.escalationCount}</strong>
          </li>
        </ul>
        <p className="developers-portal__law">
          An API key authenticates your client application — it never confers human role
          authority. Scope it minimally; rotate it routinely; revoke it the moment it leaks.
        </p>
        {props.clientAppCount === 0 ? (
          <EmptyState
            title="No client applications registered yet"
            hint="Register your first client application to obtain scoped API keys — the portal renders honest empty states until then."
          />
        ) : null}
      </Surface>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keys page
// ---------------------------------------------------------------------------

export function DevelopersKeysView(props: {
  readonly tenantLabel: string;
  readonly demo: boolean;
  readonly rows: readonly KeyRowViewModel[];
  readonly issuance: {
    readonly keyId: string;
    readonly label: string;
    readonly environment: string;
    readonly scopes: readonly string[];
    readonly secret: string;
  } | null;
}) {
  return (
    <div
      className="developers-surface developers-surface--keys"
      data-arena-route="developers-keys"
      data-arena-demo={props.demo ? 'true' : 'false'}
    >
      <PortalHeader tenantLabel={props.tenantLabel} demo={props.demo} />
      <Surface>
        <h2>API keys</h2>
        <p>
          Keys authenticate your client application against the escalation API. Secrets are shown
          exactly once at issuance and stored only as hashes. Rotation and revocation are
          append-only status transitions — the record and history are always retained.
        </p>
        {props.issuance !== null ? (
          <div
            className="developers-keys__issuance"
            data-arena-state="success"
            data-arena-demo={props.demo ? 'true' : 'false'}
          >
            <h3>Secret shown once</h3>
            <p>
              Copy it now — it will never be shown again.{' '}
              {props.demo ? (
                <DemoDataBadge note="demo-labelled example secret from the deterministic demo corpus" />
              ) : null}
            </p>
            <code data-arena-secret="once" className="developers-keys__secret">
              {props.issuance.secret}
            </code>
            <dl className="developers-keys__meta">
              <dt>Key</dt>
              <dd>{props.issuance.keyId}</dd>
              <dt>Label</dt>
              <dd>{props.issuance.label}</dd>
              <dt>Environment</dt>
              <dd>{props.issuance.environment}</dd>
              <dt>Scopes</dt>
              <dd>{props.issuance.scopes.join(', ')}</dd>
            </dl>
          </div>
        ) : null}
        {props.rows.length === 0 ? (
          <EmptyState
            title="No API keys yet"
            hint="Issue your first key after registering a client application. Sandbox keys never touch live surfaces; live keys never run sandbox escalations."
          />
        ) : (
          <table className="developers-keys__table" data-arena-table="keys">
            <thead>
              <tr>
                <th>Key</th>
                <th>Label</th>
                <th>Environment</th>
                <th>Scopes</th>
                <th>Status</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Consequence of rotate / revoke</th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row) => (
                <tr key={row.keyId} data-arena-key={row.keyId} data-arena-key-status={row.status}>
                  <td>
                    <code>{row.keyId}</code>
                  </td>
                  <td>{row.label}</td>
                  <td>
                    {row.environment === 'sandbox' ? <TruthBadge kind="demo" /> : null}{' '}
                    {row.environment}
                  </td>
                  <td>{row.scopes.join(', ')}</td>
                  <td>{row.status}</td>
                  <td>{row.createdAt}</td>
                  <td>{row.lastUsedAt ?? 'never'}</td>
                  <td>
                    <details>
                      <summary>Consequence exposure (required authority: key owner)</summary>
                      <p>{row.rotateConsequence}</p>
                      <p>{row.revokeConsequence}</p>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quickstart
// ---------------------------------------------------------------------------

export function DevelopersQuickstartView(props: {
  readonly tenantLabel: string;
  readonly demo: boolean;
  readonly model: QuickstartViewModel;
}) {
  return (
    <div
      className="developers-surface developers-surface--quickstart"
      data-arena-route="developers-quickstart"
    >
      <PortalHeader tenantLabel={props.tenantLabel} demo={props.demo} />
      <Surface>
        <h2>SDK quickstart — {props.model.firstPath}</h2>
        <p>
          The first public boundary is simple (handoff §14): create an escalation and keep the
          durable <code>request_id</code>. Snippets are generated from the live ES1.0 contract
          vocabulary — requestVersion{' '}
          <strong data-arena-fact="request-version">{props.model.requestVersion}</strong>, modes{' '}
          <strong data-arena-fact="modes">{props.model.modes.join(' | ')}</strong>, urgencies{' '}
          <strong data-arena-fact="urgencies">{props.model.urgencies.join(' | ')}</strong>, client
          app ids matching <code>{props.model.clientAppIdPattern}</code>.
        </p>
        {props.model.snippets.map((snippet) => (
          <section key={snippet.id} className="developers-quickstart__snippet" data-arena-snippet={snippet.id}>
            <h3>{snippet.title}</h3>
            <pre>
              <code>{snippet.code}</code>
            </pre>
          </section>
        ))}
        <p className="developers-quickstart__note">
          Use an environment variable for the API key secret — never a literal. Sandbox runs are
          labelled; demo money is not customer money.
        </p>
      </Surface>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sandbox console
// ---------------------------------------------------------------------------

export function DevelopersSandboxView(props: {
  readonly tenantLabel: string;
  readonly demo: boolean;
  readonly scenarios: readonly SandboxScenarioViewModel[];
  readonly run: {
    readonly scenarioId: string;
    readonly requestId: string;
    readonly state: string;
    readonly events: readonly { readonly eventId: string; readonly eventType: string }[];
  } | null;
}) {
  return (
    <div
      className="developers-surface developers-surface--sandbox"
      data-arena-route="developers-sandbox"
      data-arena-demo={props.demo ? 'true' : 'false'}
    >
      <PortalHeader tenantLabel={props.tenantLabel} demo={props.demo} />
      <Surface>
        <h2>Sandbox console</h2>
        <p>
          Run a canned escalation end-to-end and watch the lifecycle events arrive.{' '}
          <TruthBadge kind="demo" /> Every sandbox object is labelled <em>sandbox</em>; sandbox
          money is <strong>demo money</strong> — never customer money. A sandbox key can never
          touch live surfaces.
        </p>
        {props.run !== null ? (
          <div className="developers-sandbox__run" data-arena-state="success">
            <h3>Latest run</h3>
            <dl className="developers-sandbox__meta">
              <dt>Scenario</dt>
              <dd>{props.run.scenarioId}</dd>
              <dt>Request</dt>
              <dd>
                <code>{props.run.requestId}</code>
              </dd>
              <dt>State</dt>
              <dd data-arena-fact="sandbox-state">{props.run.state}</dd>
            </dl>
            <h4>Lifecycle events (watch them arrive)</h4>
            <ol className="developers-sandbox__events" data-arena-list="sandbox-events">
              {props.run.events.map((event) => (
                <li key={event.eventId}>
                  <code>{event.eventType}</code> <span aria-hidden="true">·</span>{' '}
                  <code>{event.eventId}</code>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <EmptyState
            title="No sandbox run yet"
            hint="Pick a scenario below — runs are deterministic and visibly labelled."
          />
        )}
        <h3>Canned scenarios</h3>
        <ul className="developers-sandbox__scenarios">
          {props.scenarios.map((scenario) => (
            <li key={scenario.scenarioId} data-arena-scenario={scenario.scenarioId}>
              <strong>{scenario.displayName}</strong>
              <p>{scenario.description}</p>
              <p className="developers-sandbox__scenario-facts">
                capability <code>{scenario.capabilityNeed}</code> · mode{' '}
                <code>{scenario.escalationMode}</code> · urgency <code>{scenario.urgency}</code> ·{' '}
                {scenario.budgetLabel}
              </p>
            </li>
          ))}
        </ul>
      </Surface>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

function EscalationRowView(props: { readonly row: EscalationRowViewModel }) {
  const { row } = props;
  return (
    <tr data-arena-request={row.requestId} data-arena-truth={row.truthLabel}>
      <td>
        <code>{row.requestId}</code>
      </td>
      <td>{row.state}</td>
      <td>{row.validationStatus}</td>
      <td>
        {row.truthLabel === 'sandbox' ? <TruthBadge kind="demo" /> : null} {row.environment}
      </td>
      <td>{row.slaBreached ? 'SLA breached' : 'within deadline'}</td>
      <td>{row.costLabel ?? '—'}</td>
      <td>{row.arenaFeeLabel ?? '—'}</td>
    </tr>
  );
}

export function DevelopersObservabilityView(props: {
  readonly tenantLabel: string;
  readonly demo: boolean;
  readonly model: DashboardViewModel | null;
  readonly staleAsOf?: string;
}) {
  return (
    <div
      className="developers-surface developers-surface--observability"
      data-arena-route="developers-observability"
      data-arena-demo={props.demo ? 'true' : 'false'}
    >
      <PortalHeader tenantLabel={props.tenantLabel} demo={props.demo} />
      {props.staleAsOf !== undefined ? (
        <StaleDataNotice asOf={props.staleAsOf} note="Projections are derived read models — the canonical record lives in the escalation domain." />
      ) : null}
      {props.model === null ? (
        <EmptyState
          title="No client application selected"
          hint="Register a client application first — the observability dashboard projects its escalations, validation statuses, SLA deadlines and cost/fee fields."
        />
      ) : (
        <Surface>
          <h2>Escalation observability — {props.model.clientAppId}</h2>
          <ul className="developers-observability__summary">
            <li data-arena-fact="total">
              Escalations: <strong>{props.model.total}</strong>
            </li>
            <li data-arena-fact="validation">
              Validation passed/failed: <strong>{props.model.validationPassed}</strong>/
              <strong>{props.model.validationFailed}</strong>
            </li>
            <li data-arena-fact="sla">
              SLA breaches: <strong>{props.model.slaBreachedCount}</strong>
            </li>
            {props.model.costTotals.map((total) => (
              <li key={total.currency} data-arena-fact="cost">
                Cost ({total.currency}): <strong>{total.amountLabel}</strong> · Arena fee{' '}
                <strong>{total.feeLabel}</strong>
              </li>
            ))}
          </ul>
          {props.model.rows.length === 0 ? (
            <EmptyState
              title="No escalations yet"
              hint="Create one through the quickstart or run a canned sandbox escalation — the dashboard projects real lifecycle facts, never fabricated rows."
            />
          ) : (
            <table className="developers-observability__table" data-arena-table="escalations">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>State</th>
                  <th>Validation</th>
                  <th>Environment</th>
                  <th>SLA</th>
                  <th>Cost</th>
                  <th>Arena fee</th>
                </tr>
              </thead>
              <tbody>
                {props.model.rows.map((row) => (
                  <EscalationRowView key={row.requestId} row={row} />
                ))}
              </tbody>
            </table>
          )}
          <h3>Webhook events</h3>
          {props.model.webhookEvents.length === 0 ? (
            <EmptyState
              title="No webhook events yet"
              hint="Every lifecycle transition appends one durable event to the at-least-once outbox — they appear here as they are delivered."
            />
          ) : (
            <ol className="developers-observability__events" data-arena-list="webhook-events">
              {props.model.webhookEvents.map((event) => (
                <li key={event.eventId}>
                  <code>{event.eventType}</code> → <code>{event.requestId}</code>
                </li>
              ))}
            </ol>
          )}
        </Surface>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading (the gate every async route owns)
// ---------------------------------------------------------------------------

export function DevelopersLoadingView(props: { readonly label?: string }) {
  return (
    <div
      className="developers-surface developers-surface--loading"
      data-arena-route="developers"
      data-arena-state="loading"
    >
      <LoadingState label={props.label ?? 'Loading the developer portal…'} />
    </div>
  );
}
