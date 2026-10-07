/**
 * Reference fabric (Work Order C017) — the deterministic in-memory
 * implementations of the developer-platform service ports, mirroring
 * services/escalation-api's fabric.ts: FixedClock,
 * InMemoryDeveloperKeyStore. LOCAL PARITY (free-tier contract FT2.0):
 * every hosted adapter has a local fake exercising the same contract.
 */

import type {
  ClientAppRecord,
  DeveloperKeyRecord,
  DeveloperKeySecretBinding,
  SandboxRunRecord,
  WebhookSigningBinding,
} from '@arena/developer-platform';

import type { Clock, DeveloperKeyStore } from './ports.js';

/** Deterministic fixed clock (test/reference wiring). */
export class FixedClock implements Clock {
  constructor(private atMs: number) {}
  now(): number {
    return this.atMs;
  }
  advanceTo(atMs: number): void {
    this.atMs = atMs;
  }
}

/** In-memory key/app/run store (reference fabric; never production). */
export class InMemoryDeveloperKeyStore implements DeveloperKeyStore {
  private readonly keys = new Map<string, DeveloperKeyRecord>();
  private readonly keyBindings = new Map<string, DeveloperKeySecretBinding>();
  private readonly apps = new Map<string, ClientAppRecord>();
  private readonly webhookBindings = new Map<string, WebhookSigningBinding>();
  private readonly sandboxRuns: SandboxRunRecord[] = [];

  async insertKey(record: DeveloperKeyRecord): Promise<void> {
    if (this.keys.has(record.keyId)) {
      throw new Error(`duplicate developer key id: ${record.keyId}`);
    }
    this.keys.set(record.keyId, record);
  }

  async updateKey(record: DeveloperKeyRecord): Promise<void> {
    if (!this.keys.has(record.keyId)) {
      throw new Error(`unknown developer key id: ${record.keyId}`);
    }
    this.keys.set(record.keyId, record);
  }

  async findKey(keyId: string): Promise<DeveloperKeyRecord | undefined> {
    return this.keys.get(keyId);
  }

  async listKeysByClientApp(clientAppId: string): Promise<readonly DeveloperKeyRecord[]> {
    return [...this.keys.values()].filter((key) => key.clientAppId === clientAppId);
  }

  async insertKeyBinding(binding: DeveloperKeySecretBinding): Promise<void> {
    this.keyBindings.set(binding.keyId, binding);
  }

  async findKeyBinding(keyId: string): Promise<DeveloperKeySecretBinding | undefined> {
    return this.keyBindings.get(keyId);
  }

  async deleteKeyBinding(keyId: string): Promise<void> {
    this.keyBindings.delete(keyId);
  }

  async insertClientApp(app: ClientAppRecord): Promise<void> {
    if (this.apps.has(app.clientAppId)) {
      throw new Error(`duplicate client app id: ${app.clientAppId}`);
    }
    this.apps.set(app.clientAppId, app);
  }

  async updateClientApp(app: ClientAppRecord): Promise<void> {
    if (!this.apps.has(app.clientAppId)) {
      throw new Error(`unknown client app id: ${app.clientAppId}`);
    }
    this.apps.set(app.clientAppId, app);
  }

  async findClientApp(clientAppId: string, tenantId: string): Promise<ClientAppRecord | undefined> {
    const app = this.apps.get(clientAppId);
    return app !== undefined && app.tenantId === tenantId ? app : undefined;
  }

  async listClientApps(tenantId: string): Promise<readonly ClientAppRecord[]> {
    return [...this.apps.values()].filter((app) => app.tenantId === tenantId);
  }

  async insertWebhookBinding(binding: WebhookSigningBinding): Promise<void> {
    this.webhookBindings.set(binding.endpointId, binding);
  }

  async appendSandboxRun(run: SandboxRunRecord): Promise<void> {
    this.sandboxRuns.push(run);
  }

  async listSandboxRuns(clientAppId: string): Promise<readonly SandboxRunRecord[]> {
    return this.sandboxRuns.filter((run) => run.clientAppId === clientAppId);
  }
}
