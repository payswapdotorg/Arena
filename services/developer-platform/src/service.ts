/**
 * DeveloperPlatformService — the reference service facade for the Arena
 * developer platform (Work Order C017; mirrors the escalation-api
 * service pattern: injected dependencies, fail-closed error
 * normalization, NO network layer — hosts own the wire transports).
 *
 * Surfaces:
 *   - client-app registration (the ES1.0 client_app_id) + webhook
 *     endpoint registration (one-time signing secret, hash at rest);
 *   - key issuance / rotation / revocation (append-only history);
 *   - key-authorized LIVE escalation creation (scope
 *     `escalations:create`, live environment only);
 *   - deterministic sandbox runs (scope `sandbox:run`, sandbox
 *     environment only, capacity fail-closed — never faked);
 *   - per-client-app observability queries (lifecycle/validation/SLA/
 *     cost projections + the C010 fee split + webhook event views).
 *
 * LAW: an API key authenticates a CLIENT APPLICATION — it never
 * confers role authority. Every authorization failure is a typed
 * DeveloperPlatformError with a closed code (fail closed).
 */

import {
  DEVELOPER_PLATFORM_ERROR_CODES,
  DeveloperPlatformError,
} from '@arena/developer-platform';
import type {
  ClientAppRecord,
  DeveloperKeyEnvironment,
  DeveloperKeyIssuance,
  WebhookSigningSecret,
  DeveloperKeyRecord,
  DeveloperKeyScope,
  DeveloperKeySecret,
  SandboxCapacityProbe,
  SandboxRunRecord,
} from '@arena/developer-platform';
import {
  authorizeDeveloperKey,
  clientAppWire,
  developerKeyWire,
  issueDeveloperKey,
  registerClientApp,
  registerWebhookEndpoint,
  revokeDeveloperKey,
  rotateDeveloperKey,
  stampDeveloperKeyUsed,
  DENIAL_ERROR_CODES,
} from '@arena/developer-platform';
import {
  SANDBOX_SCENARIOS,
  assertSandboxCapacity,
  constantSandboxCapacity,
  createNodeSecretHasher,
  createNodeSecretMaterialGenerator,
  recordSandboxRun,
  sandboxScenarioById,
} from '@arena/developer-platform';
import {
  buildClientEscalationProjection,
  summarizeClientEscalationProjections,
} from '@arena/developer-platform';
import type {
  ClientEscalationProjection,
  ClientEscalationProjectionSummary,
} from '@arena/developer-platform';
import type { CreateEscalationRequestInput, EscalationRecord } from '@arena/escalation';

import { FixedClock, InMemoryDeveloperKeyStore } from './fabric.js';
import type { Clock, DeveloperKeyStore, EscalationPort, WebhookEventView } from './ports.js';
import type {
  SecretHasher as SecretHasherLike,
  SecretMaterialGenerator as SecretMaterialLike,
} from '@arena/developer-platform';

export interface DeveloperPlatformServiceConfig {
  readonly clock?: Clock;
  readonly store?: DeveloperKeyStore;
  readonly escalation?: EscalationPort;
  readonly capacity?: SandboxCapacityProbe;
  readonly hasher?: SecretHasherLike;
  readonly material?: SecretMaterialLike;
}

/** The one-time issuance outcome surfaced to the portal (secret shown exactly once). */
export interface KeyIssuanceResult {
  readonly record: DeveloperKeyRecord;
  /** The plaintext secret — returned ONCE, never stored, never logged. */
  readonly secret: DeveloperKeySecret;
}

/** A sandbox run outcome: the run record + projection + emitted lifecycle events. */
export interface SandboxRunResult {
  readonly run: SandboxRunRecord;
  readonly projection: ClientEscalationProjection;
  readonly emittedEvents: readonly { readonly eventId: string; readonly eventType: string }[];
}

/** The observability dashboard payload for one client app. */
export interface ObservabilityDashboard {
  readonly clientAppId: string;
  readonly tenantId: string;
  readonly projections: readonly ClientEscalationProjection[];
  readonly summary: ClientEscalationProjectionSummary;
  readonly recentWebhookEvents: readonly WebhookEventView[];
  readonly sandboxRuns: readonly SandboxRunRecord[];
}

export class DeveloperPlatformService {
  readonly clock: Clock;
  readonly store: DeveloperKeyStore;
  readonly escalation: EscalationPort;
  readonly capacity: SandboxCapacityProbe;
  private readonly hasher: SecretHasherLike;
  private readonly material: SecretMaterialLike;

  constructor(config: DeveloperPlatformServiceConfig = {}) {
    this.clock = config.clock ?? new FixedClock(0);
    this.store = config.store ?? new InMemoryDeveloperKeyStore();
    this.escalation =
      config.escalation ??
      ({
        createEscalation: async () => {
          throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
            message: 'no escalation port wired (fail closed)',
          });
        },
        getEscalationStatus: async () => {
          throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
            message: 'no escalation port wired (fail closed)',
          });
        },
        listRecentEscalations: async () => [],
        listRecentWebhookEvents: async () => [],
      } satisfies EscalationPort);
    this.capacity = config.capacity ?? constantSandboxCapacity('AVAILABLE');
    this.hasher = config.hasher ?? createNodeSecretHasher();
    this.material = config.material ?? createNodeSecretMaterialGenerator();
  }

  // -----------------------------------------------------------------------
  // Client-app + webhook registration
  // -----------------------------------------------------------------------

  /** Register a client application (auto id `app-<8 hex>`; tenant-bound). */
  async registerClientApp(input: {
    readonly tenantId: string;
    readonly displayName: string;
    readonly environment: DeveloperKeyEnvironment;
  }): Promise<ClientAppRecord> {
    const suffix = this.material.bytes32Hex().slice(0, 8);
    const app = registerClientApp({
      clientAppId: `app-${suffix}`,
      tenantId: input.tenantId,
      displayName: input.displayName,
      environment: input.environment,
      now: this.clock.now(),
    });
    await this.store.insertClientApp(app);
    return app;
  }

  /** Register a webhook endpoint (requires a key with `webhooks:manage`). */
  async registerWebhookEndpoint(input: {
    readonly presentedSecret: string;
    readonly tenantId: string;
    readonly url: string;
  }): Promise<{ app: ClientAppRecord; endpointId: string; signingKeyId: string; signingSecret: WebhookSigningSecret }> {
    const key = await this.authorize({
      presentedSecret: input.presentedSecret,
      tenantId: input.tenantId,
      environment: undefined,
      scope: 'webhooks:manage',
    });
    const app = await this.store.findClientApp(key.record.clientAppId, input.tenantId);
    if (app === undefined) {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.CLIENT_APP_NOT_FOUND, {
        message: `client app ${key.record.clientAppId} not found for tenant ${input.tenantId}`,
      });
    }
    const registration = registerWebhookEndpoint(
      app,
      { url: input.url, now: this.clock.now() },
      { hasher: this.hasher, material: this.material },
    );
    await this.store.updateClientApp(registration.app);
    await this.store.insertWebhookBinding(registration.binding);
    await this.store.updateKey(stampDeveloperKeyUsed(key.record, { now: this.clock.now() }));
    return {
      app: registration.app,
      endpointId: registration.endpoint.endpointId,
      signingKeyId: registration.endpoint.signingKeyId,
      signingSecret: registration.signingSecret,
    };
  }

  // -----------------------------------------------------------------------
  // Key lifecycle
  // -----------------------------------------------------------------------

  /** Issue a key for a registered client app (secret returned exactly once). */
  async issueKey(input: {
    readonly tenantId: string;
    readonly clientAppId: string;
    readonly environment: DeveloperKeyEnvironment;
    readonly scopes: readonly string[];
    readonly label: string;
  }): Promise<KeyIssuanceResult> {
    const app = await this.store.findClientApp(input.clientAppId, input.tenantId);
    if (app === undefined) {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.CLIENT_APP_NOT_FOUND, {
        message: `client app ${input.clientAppId} not found for tenant ${input.tenantId}`,
        details: { clientAppId: input.clientAppId, tenantId: input.tenantId },
      });
    }
    if (app.environment !== input.environment) {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.ENVIRONMENT_MISMATCH, {
        message: `client app ${input.clientAppId} is a ${app.environment} app — a ${input.environment} key cannot be issued against it`,
        details: { clientAppId: input.clientAppId, appEnvironment: app.environment },
      });
    }
    const issuance: DeveloperKeyIssuance = issueDeveloperKey(
      {
        clientAppId: input.clientAppId,
        tenantId: input.tenantId,
        environment: input.environment,
        scopes: input.scopes,
        label: input.label,
        now: this.clock.now(),
      },
      { hasher: this.hasher, material: this.material },
    );
    await this.store.insertKey(issuance.record);
    await this.store.insertKeyBinding(issuance.binding);
    return { record: issuance.record, secret: issuance.secret };
  }

  /** Rotate a key (old key → `rotated`, successor secret shown once). */
  async rotateKey(input: {
    readonly keyId: string;
    readonly tenantId: string;
  }): Promise<KeyIssuanceResult> {
    const record = await this.requireTenantKey(input.keyId, input.tenantId);
    const { successor, rotated } = rotateDeveloperKey(
      record,
      { hasher: this.hasher, material: this.material },
      { now: this.clock.now() },
    );
    await this.store.updateKey(rotated);
    // The rotated key's secret binding is RETAINED (hash only) so a
    // replay of the old secret fails closed with the typed
    // KEY_ROTATED reason instead of an anonymous SECRET_INVALID.
    await this.store.insertKey(successor.record);
    await this.store.insertKeyBinding(successor.binding);
    return { record: successor.record, secret: successor.secret };
  }

  /** Revoke a key (terminal, append-only, history retained). */
  async revokeKey(input: { readonly keyId: string; readonly tenantId: string }): Promise<DeveloperKeyRecord> {
    const record = await this.requireTenantKey(input.keyId, input.tenantId);
    const revoked = revokeDeveloperKey(record, { now: this.clock.now() });
    await this.store.updateKey(revoked);
    // The secret binding is RETAINED (hash only) so a revoked-key replay
    // fails closed with the typed KEY_REVOKED reason (audit surface).
    return revoked;
  }

  /** List a client app's keys (wire projections — never secret material). */
  async listKeys(input: {
    readonly tenantId: string;
    readonly clientAppId: string;
  }): Promise<readonly Record<string, unknown>[]> {
    const app = await this.store.findClientApp(input.clientAppId, input.tenantId);
    if (app === undefined) {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.CLIENT_APP_NOT_FOUND, {
        message: `client app ${input.clientAppId} not found for tenant ${input.tenantId}`,
      });
    }
    const keys = await this.store.listKeysByClientApp(input.clientAppId);
    return keys.map((key) => developerKeyWire(key));
  }

  private async requireTenantKey(keyId: string, tenantId: string): Promise<DeveloperKeyRecord> {
    const record = await this.store.findKey(keyId);
    if (record === undefined) {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.KEY_NOT_FOUND, {
        message: `developer key ${keyId} not found`,
        details: { keyId },
      });
    }
    if (record.tenantId !== tenantId) {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `developer key ${keyId} belongs to tenant ${record.tenantId}; tenant ${tenantId} may not manage it`,
        details: { keyId, keyTenant: record.tenantId },
      });
    }
    return record;
  }

  // -----------------------------------------------------------------------
  // Key authorization (the fail-closed seam every request passes through)
  // -----------------------------------------------------------------------

  private async authorize(input: {
    readonly presentedSecret: string;
    readonly tenantId: string;
    /** Undefined = accept either environment (webhook management keys exist in both). */
    readonly environment: DeveloperKeyEnvironment | undefined;
    readonly scope: DeveloperKeyScope;
  }): Promise<{ readonly record: DeveloperKeyRecord }> {
    // Callers present the SECRET; the key record is resolved by hash
    // match over the tenant's keys (no cross-tenant enumeration).
    const apps = await this.store.listClientApps(input.tenantId);
    let sawAnyKey = false;
    for (const app of apps) {
      const keys = await this.store.listKeysByClientApp(app.clientAppId);
      for (const key of keys) {
        const binding = await this.store.findKeyBinding(key.keyId);
        const verdict = authorizeDeveloperKey(
          {
            record: key,
            binding,
            presentedSecret: input.presentedSecret,
            tenantId: input.tenantId,
            environment: input.environment ?? key.environment,
            scope: input.scope,
          },
          { hasher: this.hasher },
        );
        if (verdict.outcome === 'authorized') {
          return { record: verdict.record };
        }
        // A wrong secret is just the wrong key — keep scanning.
        if (verdict.reason === 'secret-invalid' || verdict.reason === 'key-not-found') {
          sawAnyKey = true;
          continue;
        }
        // The secret MATCHED this key and the request was denied for a
        // structural reason (revoked / rotated / tenant / environment /
        // scope) — fail closed immediately with the typed reason.
        throw new DeveloperPlatformError(DENIAL_ERROR_CODES[verdict.reason], {
          message: `developer key authorization denied: ${verdict.reason}`,
          details: { reason: verdict.reason, scope: input.scope },
        });
      }
    }
    throw new DeveloperPlatformError(
      sawAnyKey || apps.length > 0
        ? DEVELOPER_PLATFORM_ERROR_CODES.SECRET_INVALID
        : DEVELOPER_PLATFORM_ERROR_CODES.KEY_NOT_FOUND,
      {
        message: 'no developer key matches the presented secret for this tenant (fail closed)',
      },
    );
  }

  // -----------------------------------------------------------------------
  // LIVE escalation creation (scope escalations:create, live only)
  // -----------------------------------------------------------------------

  /** Create a LIVE escalation authorized by a key (the ES1.0 first path). */
  async createLiveEscalation(input: {
    readonly presentedSecret: string;
    readonly tenantId: string;
    readonly escalation: CreateEscalationRequestInput;
  }): Promise<{
    readonly requestId: string;
    readonly record: EscalationRecord;
    readonly projection: ClientEscalationProjection;
  }> {
    const key = await this.authorize({
      presentedSecret: input.presentedSecret,
      tenantId: input.tenantId,
      environment: 'live',
      scope: 'escalations:create',
    });
    if (input.escalation.tenantId !== input.tenantId) {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `escalation input declares tenant ${input.escalation.tenantId}; the key's tenant is ${input.tenantId}`,
      });
    }
    if (input.escalation.clientAppId !== key.record.clientAppId) {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_CLIENT_APP, {
        message: `escalation input declares clientAppId ${input.escalation.clientAppId}; the key is bound to ${key.record.clientAppId}`,
      });
    }
    const outcome = await this.escalation.createEscalation(input.escalation);
    await this.store.updateKey(stampDeveloperKeyUsed(key.record, { now: this.clock.now() }));
    return {
      requestId: outcome.requestId,
      record: outcome.record,
      projection: buildClientEscalationProjection(outcome.record, {
        environment: 'live',
        now: this.clock.now(),
      }),
    };
  }

  // -----------------------------------------------------------------------
  // Sandbox runs (scope sandbox:run, sandbox only, capacity fail-closed)
  // -----------------------------------------------------------------------

  /** Run a deterministic canned sandbox escalation end-to-end. */
  async runSandboxEscalation(input: {
    readonly presentedSecret: string;
    readonly tenantId: string;
    readonly scenarioId: string;
  }): Promise<SandboxRunResult> {
    const key = await this.authorize({
      presentedSecret: input.presentedSecret,
      tenantId: input.tenantId,
      environment: 'sandbox',
      scope: 'sandbox:run',
    });
    // Capacity is NEVER faked (FT2.0): EXHAUSTED/DISABLED fail closed.
    assertSandboxCapacity(this.capacity.state());
    const scenario = sandboxScenarioById(input.scenarioId);
    const now = this.clock.now();
    const outcome = await this.escalation.createEscalation({
      clientAppId: key.record.clientAppId,
      tenantId: input.tenantId,
      sourceWorkflowRef: `sandbox-${scenario.scenarioId}`,
      sourceRunRef: `sandbox-run-${now}`,
      capabilityNeed: scenario.capabilityNeed,
      escalationModes: [scenario.escalationMode],
      urgency: scenario.urgency,
      now,
      deadlineInMs: 3_600_000,
      budget: { amountMinorUnits: scenario.budgetMinorUnits, currency: scenario.currency },
      expertRequirements: { requiredCapabilities: [scenario.capabilityNeed] },
      locale: 'en',
      desiredOutputSchema: { type: 'object' },
      contextReferences: [],
      environmentSessionPolicy: { sessionMode: 'none', sanitization: 'standard' },
      privacyPolicy: { dataClassification: 'public', pii: 'forbid' },
      permittedActions: ['read-context'],
      learningPermissions: {
        allowKnowledgeCapture: false,
        allowToolGapSignals: false,
        allowArtifactReuse: false,
        requireApproval: true,
      },
      retentionPolicy: { retentionMs: 86_400_000, disposition: 'purge' },
      idempotencyKey: `sandbox-${scenario.scenarioId}-${now}`,
      correlationId: `sandbox-${scenario.scenarioId}`,
    });
    const run = recordSandboxRun(
      {
        keyId: key.record.keyId,
        clientAppId: key.record.clientAppId,
        tenantId: input.tenantId,
        requestId: outcome.requestId,
        scenarioId: scenario.scenarioId,
        now,
      },
      { material: this.material },
    );
    await this.store.appendSandboxRun(run);
    await this.store.updateKey(stampDeveloperKeyUsed(key.record, { now }));
    return {
      run,
      projection: buildClientEscalationProjection(outcome.record, { environment: 'sandbox', now }),
      emittedEvents: outcome.emittedEvents.map((event) => ({
        eventId: event.eventId,
        eventType: event.eventType,
      })),
    };
  }

  /** The canned scenarios (the sandbox console's catalogue). */
  sandboxScenarios(): readonly {
    readonly scenarioId: string;
    readonly displayName: string;
    readonly description: string;
    readonly capabilityNeed: string;
    readonly escalationMode: string;
    readonly urgency: string;
    readonly budgetMinorUnits: number;
    readonly currency: string;
  }[] {
    return SANDBOX_SCENARIOS;
  }

  // -----------------------------------------------------------------------
  // Observability queries (projections only — no domain truth)
  // -----------------------------------------------------------------------

  /** The observability dashboard payload for one client app. */
  async observabilityDashboard(input: {
    readonly tenantId: string;
    readonly clientAppId: string;
  }): Promise<ObservabilityDashboard> {
    const app = await this.store.findClientApp(input.clientAppId, input.tenantId);
    if (app === undefined) {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.CLIENT_APP_NOT_FOUND, {
        message: `client app ${input.clientAppId} not found for tenant ${input.tenantId}`,
      });
    }
    const records = await this.escalation.listRecentEscalations(input.tenantId);
    const sandboxRuns = await this.store.listSandboxRuns(input.clientAppId);
    const sandboxRequestIds = new Set(sandboxRuns.map((run) => run.requestId));
    const projections = records
      .filter((record) => record.request.clientAppId === input.clientAppId)
      .map((record) =>
        buildClientEscalationProjection(record, {
          environment: sandboxRequestIds.has(record.request.requestId) ? 'sandbox' : 'live',
          now: this.clock.now(),
        }),
      );
    const recentWebhookEvents = await this.escalation.listRecentWebhookEvents(input.tenantId);
    return Object.freeze({
      clientAppId: input.clientAppId,
      tenantId: input.tenantId,
      projections: Object.freeze(projections),
      summary: summarizeClientEscalationProjections(projections),
      recentWebhookEvents: Object.freeze(
        recentWebhookEvents.filter((event) => event.tenantId === input.tenantId),
      ),
      sandboxRuns: Object.freeze([...sandboxRuns]),
    });
  }

  /** One escalation's projected detail (tenant-scoped, fail closed). */
  async escalationDetail(input: {
    readonly tenantId: string;
    readonly requestId: string;
    readonly clientAppId: string;
  }): Promise<ClientEscalationProjection> {
    const { record } = await this.escalation.getEscalationStatus({
      requestId: input.requestId,
      tenantId: input.tenantId,
    });
    if (record.request.clientAppId !== input.clientAppId) {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_CLIENT_APP, {
        message: `escalation ${input.requestId} does not belong to client app ${input.clientAppId}`,
      });
    }
    const sandboxRuns = await this.store.listSandboxRuns(input.clientAppId);
    const isSandbox = sandboxRuns.some((run) => run.requestId === input.requestId);
    return buildClientEscalationProjection(record, {
      environment: isSandbox ? 'sandbox' : 'live',
      now: this.clock.now(),
    });
  }

  /** The client app's wire projection (portal lists). */
  async clientApp(input: { readonly tenantId: string; readonly clientAppId: string }): Promise<Record<string, unknown>> {
    const app = await this.store.findClientApp(input.clientAppId, input.tenantId);
    if (app === undefined) {
      throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.CLIENT_APP_NOT_FOUND, {
        message: `client app ${input.clientAppId} not found for tenant ${input.tenantId}`,
      });
    }
    return clientAppWire(app);
  }
}
