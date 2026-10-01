/**
 * Local composition for @arena/auth-service (Work Order B004; FT2.0
 * "Local parity": the full session lifecycle with ZERO providers).
 *
 * `createLocalAuthStack` composes the B002 in-memory fakes behind the
 * same ports the hosted adapters implement (control plane + coordination
 * + injected clock) into a `ControlPlaneSessionStore`, then an
 * `AuthService` over it with a caller-supplied credential seam
 * (`StaticCredentialVerifier` over CALLER-REGISTERED entries — no demo
 * users are hardcoded here; B006 owns Demo mode) and a caller-supplied
 * session secret.
 *
 * The secret is REQUIRED (string or a resolved SessionSecretResolution):
 * a missing/short secret resolves DISABLED and the AuthService factory
 * REFUSES TO CONSTRUCT (typed AUTH_DISABLED) — there is no default key
 * anywhere. Generation guidance:
 *   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
 */

import { FakeControlPlaneRepository, FakeCoordinationStore } from '@arena/persistence';
import type { Clock } from '@arena/persistence';
import { ManualClock } from '@arena/persistence';
import { FakeSessionStore } from '@arena/auth';
import type {
  SessionPolicy,
  SessionSecretResolution,
  SessionStore,
} from '@arena/auth';
import { resolveSessionSecret } from '@arena/auth';
import { AuthService } from './service.js';
import { StaticCredentialVerifier } from './ports.js';
import type { CredentialVerifier, StaticCredentialEntry } from './ports.js';
import { ControlPlaneSessionStore } from './control-plane-session-store.js';

/** The local in-memory auth stack (full port parity; zero providers). */
export interface LocalAuthStack {
  /** The composed durable session store (over the B002 fakes). */
  readonly store: ControlPlaneSessionStore;
  /** The in-memory session store alternative (parity seam). */
  readonly memoryStore: FakeSessionStore;
  /** The composed auth service. */
  readonly service: AuthService;
  /** The credential seam (caller-registered entries). */
  readonly verifier: StaticCredentialVerifier;
  /** The B002 fakes the store composes (inspection/test seam). */
  readonly controlPlane: FakeControlPlaneRepository;
  readonly coordination: FakeCoordinationStore;
  readonly clock: Clock;
}

export interface LocalAuthStackOptions {
  /**
   * The session secret: a raw string (>= 32 chars) or a resolved
   * SessionSecretResolution. REQUIRED — no default key exists; a DISABLED
   * resolution makes the AuthService factory throw typed AUTH_DISABLED.
   */
  readonly secret: string | SessionSecretResolution;
  /**
   * Caller-registered credentials (the B006 Demo-mode seam). Empty by
   * default: with no registered entry, authenticate fails closed with the
   * typed AUTH_INVALID_CREDENTIALS — never an anonymous fallback.
   */
  readonly credentials?: readonly StaticCredentialEntry[];
  /** Deterministic clock for tests/demo replay; defaults to ManualClock(0). */
  readonly clock?: Clock;
  /** Session policy override (defaults to the 12h/1h house default). */
  readonly policy?: SessionPolicy;
  /** Cookie Secure flag; false by default (plain-HTTP local dev). */
  readonly cookieSecure?: boolean;
  /**
   * Use the pure in-memory FakeSessionStore instead of the control-plane
   * backed durable store (both pass the SAME contract suite). Defaults to
   * the durable store (the production-shaped posture).
   */
  readonly useMemoryStore?: boolean;
  /** Revocation-epoch cache TTL; 0 disables the cache entirely. */
  readonly epochCacheTtlMs?: number;
}

/** Normalize the secret option into a SessionSecretResolution. */
function resolveSecret(
  secret: string | SessionSecretResolution,
): SessionSecretResolution {
  if (typeof secret === 'string') {
    return resolveSessionSecret((): string => secret);
  }
  return secret;
}

/**
 * Compose the local auth stack (FT2.0 local parity): B002 fakes behind
 * the ports, a durable session store over them, and the AuthService —
 * the same composition shape the hosted adapters will slot into.
 */
export function createLocalAuthStack(
  options: LocalAuthStackOptions,
): LocalAuthStack {
  const clock = options.clock ?? new ManualClock(0);
  const controlPlane = new FakeControlPlaneRepository({ clock });
  const coordination = new FakeCoordinationStore({ clock });
  const durable = new ControlPlaneSessionStore({
    controlPlane,
    coordination,
    clock,
    ...(options.epochCacheTtlMs !== undefined
      ? { epochCacheTtlMs: options.epochCacheTtlMs }
      : {}),
  });
  const memoryStore = new FakeSessionStore({ clock });
  const store: SessionStore = options.useMemoryStore === true ? memoryStore : durable;
  const verifier = new StaticCredentialVerifier(options.credentials ?? []);
  const service = new AuthService({
    clock,
    store,
    secret: resolveSecret(options.secret),
    verifier: verifier satisfies CredentialVerifier,
    ...(options.policy !== undefined ? { policy: options.policy } : {}),
    cookieSecure: options.cookieSecure ?? false,
  });
  return {
    store: durable,
    memoryStore,
    service,
    verifier,
    controlPlane,
    coordination,
    clock,
  };
}
