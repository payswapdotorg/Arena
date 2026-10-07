/**
 * Developers surface view models (Work Order C017): pure projections
 * for the keys page, the SDK quickstart (snippets generated from the
 * REAL ES1.0 contract vocabulary — never hand-maintained strings), the
 * sandbox console and the observability dashboard.
 */

import {
  CLIENT_APP_ID_PATTERN_SOURCE,
  ESCALATION_MODES,
  ESCALATION_REQUEST_VERSION,
  ESCALATION_URGENCIES,
} from '../../../../packages/escalation/src/index.js';
import type { ClientEscalationProjection } from '../../../../packages/developer-platform/src/index.js';
import type { ObservabilityDashboard } from '../../../../services/developer-platform/src/index.js';
import type { DeveloperTruthLabel } from '../../../../packages/developer-platform/src/index.js';

import type { DemoKeyRow } from './fixtures.js';

// ---------------------------------------------------------------------------
// Keys page
// ---------------------------------------------------------------------------

/** One keys-page row with consequence exposure (UX gate law). */
export interface KeyRowViewModel {
  readonly keyId: string;
  readonly label: string;
  readonly environment: 'live' | 'sandbox';
  readonly scopes: readonly string[];
  readonly status: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  /** The consequence text for destructive/consequential actions (UX gate law). */
  readonly rotateConsequence: string;
  readonly revokeConsequence: string;
}

export function keyRowViewModel(row: DemoKeyRow): KeyRowViewModel {
  return {
    keyId: row.keyId,
    label: row.label,
    environment: row.environment,
    scopes: row.scopes,
    status: row.status,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? null,
    rotateConsequence:
      'Rotating mints a new secret and retires this one: the old secret stops working immediately for new requests (typed KEY_ROTATED on replay). The key record and its history are retained.',
    revokeConsequence:
      'Revoking is terminal: every request signed with this key fails closed immediately (typed KEY_REVOKED on replay). The key record and its full history are retained for audit.',
  };
}

export function keyRowsViewModel(rows: readonly DemoKeyRow[]): readonly KeyRowViewModel[] {
  return rows.map(keyRowViewModel);
}

// ---------------------------------------------------------------------------
// SDK quickstart (snippets generated from the REAL contract types)
// ---------------------------------------------------------------------------

/** The trivial first path (handoff §14): POST /v1/escalations. */
export interface QuickstartSnippet {
  readonly id: string;
  readonly title: string;
  readonly language: string;
  readonly code: string;
}

export interface QuickstartViewModel {
  readonly snippets: readonly QuickstartSnippet[];
  readonly firstPath: string;
  readonly modes: readonly string[];
  readonly urgencies: readonly string[];
  readonly clientAppIdPattern: string;
  readonly requestVersion: number;
}

export function quickstartViewModel(): QuickstartViewModel {
  const snippets: readonly QuickstartSnippet[] = Object.freeze([
    Object.freeze({
      id: 'curl-create',
      title: 'Create your first escalation (the trivial first path)',
      language: 'bash',
      code: [
        `curl https://api.arena.dev/v1/escalations \\`,
        `  -H "Authorization: Bearer $ARENA_API_KEY" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "Idempotency-Key: $(uuidgen)" \\`,
        `  -d '{`,
        `    "requestVersion": ${ESCALATION_REQUEST_VERSION},`,
        `    "clientAppId": "your-app",`,
        `    "tenantId": "your-tenant",`,
        `    "sourceWorkflowRef": "workflow-42",`,
        `    "sourceRunRef": "run-001",`,
        `    "capabilityNeed": "boq-estimation.quantity-takeoff",`,
        `    "escalationModes": ${JSON.stringify(ESCALATION_MODES.slice(0, 1))},`,
        `    "urgency": "${ESCALATION_URGENCIES[1]}",`,
        `    "deadlineInMs": 3600000,`,
        `    "budget": { "amountMinorUnits": 25000, "currency": "USD" },`,
        `    "expertRequirements": { "requiredCapabilities": ["boq-estimation.quantity-takeoff"] },`,
        `    "locale": "en",`,
        `    "desiredOutputSchema": { "type": "object" },`,
        `    "environmentSessionPolicy": { "sessionMode": "bounded-replica", "sanitization": "strict" },`,
        `    "privacyPolicy": { "dataClassification": "confidential", "pii": "redact" },`,
        `    "permittedActions": ["read-context", "propose-patch"],`,
        `    "learningPermissions": { "allowKnowledgeCapture": true, "allowToolGapSignals": true, "allowArtifactReuse": false, "requireApproval": true },`,
        `    "retentionPolicy": { "retentionMs": 2592000000, "disposition": "purge" },`,
        `    "correlationId": "corr-001"`,
        `  }'`,
      ].join('\n'),
    }),
    Object.freeze({
      id: 'ts-create',
      title: 'TypeScript (fetch) — create + poll',
      language: 'typescript',
      code: [
        `// EscalationRequest v${ESCALATION_REQUEST_VERSION} — the ES1.0 primary object.`,
        `const created = await fetch("https://api.arena.dev/v1/escalations", {`,
        `  method: "POST",`,
        `  headers: {`,
        `    Authorization: \`Bearer \${process.env.ARENA_API_KEY}\`,`,
        `    "Content-Type": "application/json",`,
        `    "Idempotency-Key": crypto.randomUUID(),`,
        `  },`,
        `  body: JSON.stringify({`,
        `    requestVersion: ${ESCALATION_REQUEST_VERSION},`,
        `    clientAppId: "your-app",`,
        `    tenantId: "your-tenant",`,
        `    sourceWorkflowRef: "workflow-42",`,
        `    sourceRunRef: "run-001",`,
        `    capabilityNeed: "boq-estimation.quantity-takeoff",`,
        `    escalationModes: ${JSON.stringify(ESCALATION_MODES.slice(0, 1))},`,
        `    urgency: "${ESCALATION_URGENCIES[1]}",`,
        `    deadlineInMs: 3_600_000,`,
        `    budget: { amountMinorUnits: 25_000, currency: "USD" },`,
        `    expertRequirements: { requiredCapabilities: ["boq-estimation.quantity-takeoff"] },`,
        `    locale: "en",`,
        `    desiredOutputSchema: { type: "object" },`,
        `    environmentSessionPolicy: { sessionMode: "bounded-replica", sanitization: "strict" },`,
        `    privacyPolicy: { dataClassification: "confidential", pii: "redact" },`,
        `    permittedActions: ["read-context", "propose-patch"],`,
        `    learningPermissions: { allowKnowledgeCapture: true, allowToolGapSignals: true, allowArtifactReuse: false, requireApproval: true },`,
        `    retentionPolicy: { retentionMs: 2_592_000_000, disposition: "purge" },`,
        `    correlationId: "corr-001",`,
        `  }),`,
        `});`,
        ``,
        `// Idempotent status polling: GET /v1/escalations/{request_id}`,
        `const status = await fetch(\`https://api.arena.dev/v1/escalations/\${created.requestId}\`, {`,
        `  headers: { Authorization: \`Bearer \${process.env.ARENA_API_KEY}\` },`,
        `});`,
      ].join('\n'),
    }),
    Object.freeze({
      id: 'webhook-verify',
      title: 'Verify a webhook signature',
      language: 'typescript',
      code: [
        `// Webhook signing secret registered in the developer portal (shown once).`,
        `// The 13 minimum events arrive in order: escalation.created … escalation.learning.updated.`,
        `const expected = createHmac("sha256", process.env.ARENA_WEBHOOK_SECRET!)`,
        `  .update(rawBody)`,
        `  .digest("hex");`,
        `if (expected !== signatureHeader) throw new Error("webhook signature mismatch");`,
      ].join('\n'),
    }),
  ]);
  return {
    snippets,
    firstPath: 'POST /v1/escalations',
    modes: ESCALATION_MODES,
    urgencies: ESCALATION_URGENCIES,
    clientAppIdPattern: CLIENT_APP_ID_PATTERN_SOURCE,
    requestVersion: ESCALATION_REQUEST_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Sandbox console
// ---------------------------------------------------------------------------

export interface SandboxScenarioViewModel {
  readonly scenarioId: string;
  readonly displayName: string;
  readonly description: string;
  readonly capabilityNeed: string;
  readonly escalationMode: string;
  readonly urgency: string;
  readonly budgetLabel: string;
}

export function sandboxScenarioCatalogueViewModel(
  scenarios: readonly {
    scenarioId: string;
    displayName: string;
    description: string;
    capabilityNeed: string;
    escalationMode: string;
    urgency: string;
    budgetMinorUnits: number;
    currency: string;
  }[],
): readonly SandboxScenarioViewModel[] {
  return scenarios.map((scenario) => ({
    scenarioId: scenario.scenarioId,
    displayName: scenario.displayName,
    description: scenario.description,
    capabilityNeed: scenario.capabilityNeed,
    escalationMode: scenario.escalationMode,
    urgency: scenario.urgency,
    budgetLabel: `demo ${scenario.currency} ${(scenario.budgetMinorUnits / 100).toFixed(2)} — demo money is not customer money`,
  }));
}

// ---------------------------------------------------------------------------
// Observability dashboard
// ---------------------------------------------------------------------------

export interface EscalationRowViewModel {
  readonly requestId: string;
  readonly state: string;
  readonly validationStatus: string;
  readonly truthLabel: string;
  readonly environment: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deadline: string;
  readonly slaBreached: boolean;
  readonly costLabel: string | null;
  readonly arenaFeeLabel: string | null;
}

function moneyLabel(minorUnits: number, currency: string): string {
  return `${(minorUnits / 100).toFixed(2)} ${currency}`;
}

export function escalationRowViewModel(projection: ClientEscalationProjection): EscalationRowViewModel {
  return {
    requestId: projection.requestId,
    state: projection.state,
    validationStatus: projection.validationStatus ?? 'not reached',
    truthLabel: projection.truthLabel,
    environment: projection.environment,
    createdAt: projection.createdAt,
    updatedAt: projection.updatedAt,
    deadline: projection.deadline,
    slaBreached: projection.slaBreached,
    costLabel:
      projection.cost !== undefined
        ? moneyLabel(projection.cost.amountMinorUnits, projection.cost.currency)
        : null,
    arenaFeeLabel:
      projection.cost !== undefined
        ? moneyLabel(projection.cost.arenaFeeMinorUnits, projection.cost.currency)
        : null,
  };
}

export function escalationRowsViewModel(
  projections: readonly ClientEscalationProjection[],
): readonly EscalationRowViewModel[] {
  return projections.map(escalationRowViewModel);
}

export interface DashboardViewModel {
  readonly clientAppId: string;
  readonly total: number;
  readonly byState: readonly { readonly state: string; readonly count: number }[];
  readonly validationPassed: number;
  readonly validationFailed: number;
  readonly slaBreachedCount: number;
  readonly costTotals: readonly { readonly currency: string; readonly amountLabel: string; readonly feeLabel: string }[];
  readonly rows: readonly EscalationRowViewModel[];
  readonly webhookEvents: readonly {
    readonly eventId: string;
    readonly eventType: string;
    readonly requestId: string;
  }[];
}

export function dashboardViewModel(dashboard: ObservabilityDashboard): DashboardViewModel {
  return {
    clientAppId: dashboard.clientAppId,
    total: dashboard.summary.total,
    byState: Object.entries(dashboard.summary.byState).map(([state, count]) => ({ state, count })),
    validationPassed: dashboard.summary.validationPassed,
    validationFailed: dashboard.summary.validationFailed,
    slaBreachedCount: dashboard.summary.slaBreachedCount,
    costTotals: Object.entries(dashboard.summary.costTotals).map(([currency, totals]) => ({
      currency,
      amountLabel: moneyLabel(totals.amountMinorUnits, currency),
      feeLabel: moneyLabel(totals.arenaFeeMinorUnits, currency),
    })),
    rows: escalationRowsViewModel(dashboard.projections),
    webhookEvents: dashboard.recentWebhookEvents.map((event) => ({
      eventId: event.eventId,
      eventType: event.eventType,
      requestId: event.requestId,
    })),
  };
}

/**
 * Merge a tenant's per-app observability dashboards into ONE view payload
 * (the demo portal projects both its live and sandbox apps side by side,
 * per-row truth labels intact). Projections, sandbox runs and summary
 * counters merge additively; webhook events are TENANT-scoped (identical
 * across the tenant's per-app dashboards) so one copy is kept — never
 * duplicated. Pure projection; null only for an empty input list.
 */
export function mergeObservabilityDashboards(
  dashboards: readonly ObservabilityDashboard[],
): ObservabilityDashboard | null {
  if (dashboards.length === 0) return null;
  const [first, ...rest] = dashboards;
  if (rest.length === 0) return first;
  const byState: Record<string, number> = { ...first.summary.byState };
  const costTotals: Record<
    string,
    { amountMinorUnits: number; arenaFeeMinorUnits: number }
  > = { ...first.summary.costTotals };
  let validationPassed = first.summary.validationPassed;
  let validationFailed = first.summary.validationFailed;
  let validationPending = first.summary.validationPending;
  let slaBreachedCount = first.summary.slaBreachedCount;
  const projections: ClientEscalationProjection[] = [...first.projections];
  const sandboxRuns = [...first.sandboxRuns];
  for (const next of rest) {
    validationPassed += next.summary.validationPassed;
    validationFailed += next.summary.validationFailed;
    validationPending += next.summary.validationPending;
    slaBreachedCount += next.summary.slaBreachedCount;
    for (const [state, count] of Object.entries(next.summary.byState)) {
      byState[state] = (byState[state] ?? 0) + count;
    }
    for (const [currency, totals] of Object.entries(next.summary.costTotals)) {
      const acc = costTotals[currency] ?? { amountMinorUnits: 0, arenaFeeMinorUnits: 0 };
      costTotals[currency] = {
        amountMinorUnits: acc.amountMinorUnits + totals.amountMinorUnits,
        arenaFeeMinorUnits: acc.arenaFeeMinorUnits + totals.arenaFeeMinorUnits,
      };
    }
    projections.push(...next.projections);
    sandboxRuns.push(...next.sandboxRuns);
  }
  const truthLabel: DeveloperTruthLabel = projections.every((p) => p.truthLabel === 'sandbox')
    ? 'sandbox'
    : projections.every((p) => p.truthLabel === 'demo')
      ? 'demo'
      : 'live';
  return Object.freeze({
    clientAppId: dashboards.map((dashboard) => dashboard.clientAppId).join(' + '),
    tenantId: first.tenantId,
    projections: Object.freeze(projections),
    summary: Object.freeze({
      total: projections.length,
      byState: Object.freeze(byState),
      validationPassed,
      validationFailed,
      validationPending,
      slaBreachedCount,
      costTotals: Object.freeze(costTotals),
      truthLabel,
    }),
    recentWebhookEvents: first.recentWebhookEvents,
    sandboxRuns: Object.freeze(sandboxRuns),
  });
}
