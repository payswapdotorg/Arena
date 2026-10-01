/**
 * Test support for the Upstash Redis adapter (Work Order B002):
 * `FakeRestTransport` — an in-memory implementation of the
 * RestCommandTransport seam mirroring the semantics of every command this
 * adapter issues (GET/SET/PX/NX/DEL/INCR/PEXPIRE-NX/PTTL/PING) with
 * expiry evaluated against an INJECTED clock, so TTL semantics are
 * deterministic under ManualClock (the contract suite relies on this).
 *
 * This is how the FULL persistence contract suite runs against the hosted
 * adapter in CI without live credentials (FT2.0 "Local parity" / "Tests
 * never require live provider credentials"). What remains untested
 * without credentials is the literal REST request/response cycle on a
 * live endpoint — that path is covered by the live run of the same suite
 * when env vars exist.
 *
 * NOT exported from the adapter index (test-support stays private; the
 * A033 hygiene precedent).
 */

import type { Clock } from '@arena/persistence';
import { SystemClock } from '@arena/persistence';
import type { RestCommand, RestCommandTransport, RestResult } from './rest-transport.js';

interface FakeEntry {
  value: string;
  /** Absolute epoch-ms expiry; null = no expiry (persistent until deleted). */
  expiresAt: number | null;
}

export interface FakeRestTransportOptions {
  /** Expiry clock; defaults to the system clock (live-ish runs). */
  readonly clock?: Clock;
  /** When true, every command throws (transport-failure assertions). */
  readonly fails?: boolean;
  /** When set, PING answers this instead of 'PONG' (degraded assertions). */
  readonly pingResult?: string;
}

export class FakeRestTransport implements RestCommandTransport {
  private readonly clock: Clock;
  private readonly fails: boolean;
  private readonly pingResult: string;
  private readonly entries = new Map<string, FakeEntry>();
  /** Commands executed, in order (for ordering assertions). */
  readonly executedCommands: string[] = [];

  constructor(options: FakeRestTransportOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.fails = options.fails ?? false;
    this.pingResult = options.pingResult ?? 'PONG';
  }

  async execute(command: RestCommand): Promise<RestResult> {
    this.executedCommands.push(command.command);
    if (this.fails) {
      throw new Error('connect ETIMEDOUT fake-rest-endpoint.example (credentials redacted)');
    }
    switch (command.command) {
      case 'PING':
        return this.pingResult;
      case 'GET':
        return this.liveValue(command.key);
      case 'SET': {
        const live = this.liveEntry(command.key);
        if (command.nx === true && live !== null) return null;
        this.entries.set(command.key, {
          value: command.value,
          expiresAt:
            command.ttlMs !== undefined ? this.clock.now() + command.ttlMs : null,
        });
        return 'OK';
      }
      case 'DEL': {
        const live = this.liveEntry(command.key);
        if (live === null) return 0;
        this.entries.delete(command.key);
        return 1;
      }
      case 'INCR': {
        const live = this.liveEntry(command.key);
        if (live === null) {
          this.entries.set(command.key, { value: '1', expiresAt: null });
          return 1;
        }
        const current = Number(live.value);
        if (!Number.isInteger(current)) {
          throw new Error('INCR: value is not an integer');
        }
        const next = current + 1;
        live.value = String(next);
        return next;
      }
      case 'PEXPIRE': {
        const entry = this.entries.get(command.key);
        if (entry === undefined || this.isExpired(entry)) return 0;
        if (command.nx === true && entry.expiresAt !== null) return 0;
        entry.expiresAt = this.clock.now() + command.ttlMs;
        return 1;
      }
      case 'PTTL': {
        const entry = this.entries.get(command.key);
        if (entry === undefined || this.isExpired(entry)) return -2;
        if (entry.expiresAt === null) return -1;
        return entry.expiresAt - this.clock.now();
      }
    }
  }

  /** Live keys in the fake store (inspection helper). */
  liveKeys(): readonly string[] {
    const now = this.clock.now();
    return [...this.entries.entries()]
      .filter(([, entry]) => entry.expiresAt === null || entry.expiresAt > now)
      .map(([key]) => key);
  }

  private liveEntry(key: string): FakeEntry | null {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    if (this.isExpired(entry)) {
      // Redis removes expired keys (lazily) — mirror the observable effect.
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  private liveValue(key: string): string | null {
    const entry = this.liveEntry(key);
    return entry === null ? null : entry.value;
  }

  private isExpired(entry: FakeEntry): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= this.clock.now();
  }
}
