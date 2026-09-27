/**
 * Isolation policy objects (spec ENV1.0 "Isolation"; architecture-lock
 * rule 8 "Environment execution is isolated and bounded"; docs/
 * architecture.md §16 "Untrusted environments execute only inside approved
 * isolation boundaries"; Work Order A009 gate 6).
 *
 *   - ResourceLimits: bounded CPU, memory and wall-clock time. Zero or
 *     negative (or non-integer) values are rejected — a bound that does not
 *     bound is not a bound.
 *   - TimeLimits: the finer-grained time policy — a startup budget and a
 *     cleanup/grace budget, both bounded, with cleanup REQUIRED to fit
 *     inside the run's wall clock.
 *   - NetworkPolicy: DEFAULT-DENY egress. Egress is only possible through
 *     EXPLICIT allows (host, port, protocol); an "allow-all" mode does not
 *     exist in the closed enum.
 *   - FilesystemPolicy: EXPLICIT mounts only — there is no blanket write
 *     mode; writing is possible only on individually declared read-write
 *     mounts, and declaring any read-write mount REQUIRES the
 *     'declared-mounts-only' write mode.
 *   - SecretPolicy: secret isolation. Secrets are referenced by neutral
 *     id and injected at declared points (path + mechanism); secret VALUES
 *     never enter canonical objects (value-carrying field names are
 *     rejected by the shared guard).
 */

import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import type { ContentDigest, Hostname, MountPath, NeutralId } from './shared.js';
import {
  expectEnumMember,
  expectFields,
  expectPositiveInteger,
  isContentDigest,
  isHostname,
  isMountPath,
  isNeutralId,
  toContentDigest,
  toHostname,
  toMountPath,
  toNeutralId,
} from './shared.js';

// ---------------------------------------------------------------------------
// ResourceLimits (declare field 7 — bounded CPU/memory/time)
// ---------------------------------------------------------------------------

export interface ResourceLimits {
  readonly cpuMillis: number;
  readonly memoryMiB: number;
  readonly wallClockSeconds: number;
}

export function isResourceLimits(value: unknown): value is ResourceLimits {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['cpuMillis'] === 'number' &&
    Number.isInteger(candidate['cpuMillis']) &&
    candidate['cpuMillis'] > 0 &&
    typeof candidate['memoryMiB'] === 'number' &&
    Number.isInteger(candidate['memoryMiB']) &&
    candidate['memoryMiB'] > 0 &&
    typeof candidate['wallClockSeconds'] === 'number' &&
    Number.isInteger(candidate['wallClockSeconds']) &&
    candidate['wallClockSeconds'] > 0
  );
}

/** Validate and freeze resource limits (every bound strictly positive). */
export function toResourceLimits(value: {
  cpuMillis: number;
  memoryMiB: number;
  wallClockSeconds: number;
}): ResourceLimits {
  const record = expectFields(
    value,
    ['cpuMillis', 'memoryMiB', 'wallClockSeconds'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_RESOURCE_LIMITS,
    'resource limits',
  );
  const cpuMillis = expectPositiveInteger(
    record['cpuMillis'],
    'cpuMillis',
    ENVIRONMENT_ERROR_CODES.INVALID_RESOURCE_LIMITS,
    'resource limits',
  );
  const memoryMiB = expectPositiveInteger(
    record['memoryMiB'],
    'memoryMiB',
    ENVIRONMENT_ERROR_CODES.INVALID_RESOURCE_LIMITS,
    'resource limits',
  );
  const wallClockSeconds = expectPositiveInteger(
    record['wallClockSeconds'],
    'wallClockSeconds',
    ENVIRONMENT_ERROR_CODES.INVALID_RESOURCE_LIMITS,
    'resource limits',
  );
  return Object.freeze({ cpuMillis, memoryMiB, wallClockSeconds });
}

// ---------------------------------------------------------------------------
// TimeLimits (declare field 11 — time limits)
// ---------------------------------------------------------------------------

/** What the substrate does when the wall clock is exhausted. */
export const DEADLINE_BEHAVIORS = Object.freeze(['hard-stop', 'grace-then-stop'] as const);
export type DeadlineBehavior = (typeof DEADLINE_BEHAVIORS)[number];

export interface TimeLimits {
  readonly startupSeconds: number;
  readonly cleanupGraceSeconds: number;
  readonly deadlineBehavior: DeadlineBehavior;
}

export function isTimeLimits(value: unknown): value is TimeLimits {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['startupSeconds'] === 'number' &&
    Number.isInteger(candidate['startupSeconds']) &&
    candidate['startupSeconds'] > 0 &&
    typeof candidate['cleanupGraceSeconds'] === 'number' &&
    Number.isInteger(candidate['cleanupGraceSeconds']) &&
    candidate['cleanupGraceSeconds'] > 0 &&
    typeof candidate['deadlineBehavior'] === 'string' &&
    (DEADLINE_BEHAVIORS as readonly string[]).includes(candidate['deadlineBehavior'])
  );
}

/** Validate and freeze time limits (both budgets strictly positive). */
export function toTimeLimits(value: {
  startupSeconds: number;
  cleanupGraceSeconds: number;
  deadlineBehavior: string;
}): TimeLimits {
  const record = expectFields(
    value,
    ['startupSeconds', 'cleanupGraceSeconds', 'deadlineBehavior'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_TIME_LIMITS,
    'time limits',
  );
  const startupSeconds = expectPositiveInteger(
    record['startupSeconds'],
    'startupSeconds',
    ENVIRONMENT_ERROR_CODES.INVALID_TIME_LIMITS,
    'time limits',
  );
  const cleanupGraceSeconds = expectPositiveInteger(
    record['cleanupGraceSeconds'],
    'cleanupGraceSeconds',
    ENVIRONMENT_ERROR_CODES.INVALID_TIME_LIMITS,
    'time limits',
  );
  const deadlineBehavior = expectEnumMember(
    record['deadlineBehavior'],
    DEADLINE_BEHAVIORS,
    'deadlineBehavior',
    ENVIRONMENT_ERROR_CODES.INVALID_TIME_LIMITS,
    'time limits',
  );
  return Object.freeze({ startupSeconds, cleanupGraceSeconds, deadlineBehavior });
}

/**
 * Invariant: the cleanup/grace budget must fit inside the run's wall
 * clock — an environment that cannot clean up inside its own bounds is
 * not bounded (architecture-lock rule 8).
 */
export function assertTimeLimitsFitWallClock(
  timeLimits: TimeLimits,
  resourceLimits: ResourceLimits,
): void {
  if (timeLimits.cleanupGraceSeconds > resourceLimits.wallClockSeconds) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_TIME_LIMITS, {
      message: `time limits: cleanupGraceSeconds (${timeLimits.cleanupGraceSeconds}) exceeds the wall-clock bound (${resourceLimits.wallClockSeconds})`,
      details: {
        cleanupGraceSeconds: timeLimits.cleanupGraceSeconds,
        wallClockSeconds: resourceLimits.wallClockSeconds,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// NetworkPolicy (declare field 8 — default-deny egress, explicit allows)
// ---------------------------------------------------------------------------

/** Closed protocol vocabulary for explicit egress allows. */
export const EGRESS_PROTOCOLS = Object.freeze(['tcp', 'udp', 'http', 'https'] as const);
export type EgressProtocol = (typeof EGRESS_PROTOCOLS)[number];

export interface EgressAllow {
  readonly host: Hostname;
  readonly port: number;
  readonly protocol: EgressProtocol;
}

export interface NetworkPolicy {
  /** The only egress mode: deny by default. */
  readonly egress: 'default-deny';
  readonly allows: readonly EgressAllow[];
}

export function isEgressAllow(value: unknown): value is EgressAllow {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isHostname(candidate['host']) &&
    typeof candidate['port'] === 'number' &&
    Number.isInteger(candidate['port']) &&
    candidate['port'] >= 1 &&
    candidate['port'] <= 65535 &&
    typeof candidate['protocol'] === 'string' &&
    (EGRESS_PROTOCOLS as readonly string[]).includes(candidate['protocol'])
  );
}

export function isNetworkPolicy(value: unknown): value is NetworkPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['egress'] === 'default-deny' &&
    Array.isArray(candidate['allows']) &&
    candidate['allows'].every((entry) => isEgressAllow(entry))
  );
}

function toEgressAllow(value: unknown): EgressAllow {
  const record = expectFields(
    value,
    ['host', 'port', 'protocol'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_NETWORK_POLICY,
    'egress allow',
  );
  const host = toHostname(typeof record['host'] === 'string' ? record['host'] : '');
  const port = record['port'];
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_NETWORK_POLICY, {
      message: `egress allow: port must be an integer in [1, 65535], got: ${String(port)}`,
    });
  }
  const protocol = expectEnumMember(
    record['protocol'],
    EGRESS_PROTOCOLS,
    'protocol',
    ENVIRONMENT_ERROR_CODES.INVALID_NETWORK_POLICY,
    'egress allow',
  );
  return Object.freeze({ host, port, protocol });
}

/** Validate and freeze a default-deny network policy with explicit allows. */
export function toNetworkPolicy(value: {
  egress: string;
  allows?: readonly { host: string; port: number; protocol: string }[];
}): NetworkPolicy {
  const record = expectFields(
    value,
    ['egress'],
    ['allows'],
    ENVIRONMENT_ERROR_CODES.INVALID_NETWORK_POLICY,
    'network policy',
  );
  const egress = expectEnumMember(
    record['egress'],
    ['default-deny'] as const,
    'egress',
    ENVIRONMENT_ERROR_CODES.INVALID_NETWORK_POLICY,
    'network policy',
  );
  const rawAllows = record['allows'];
  if (rawAllows !== undefined && !Array.isArray(rawAllows)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_NETWORK_POLICY, {
      message: 'network policy: allows must be an array of explicit egress allows',
    });
  }
  const allows = Object.freeze((rawAllows ?? []).map((entry) => toEgressAllow(entry)));
  const seen = new Set<string>();
  for (const allow of allows) {
    const key = `${allow.host}:${allow.port}:${allow.protocol}`;
    if (seen.has(key)) {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_NETWORK_POLICY, {
        message: `network policy: duplicate egress allow ${key}`,
        details: { allow: key },
      });
    }
    seen.add(key);
  }
  return Object.freeze({ egress, allows });
}

/** True iff the policy explicitly allows the given host/port/protocol egress. */
export function allowsEgress(
  policy: NetworkPolicy,
  host: string,
  port: number,
  protocol: string,
): boolean {
  return policy.allows.some(
    (allow) =>
      allow.host === host && allow.port === port && allow.protocol === protocol,
  );
}

// ---------------------------------------------------------------------------
// FilesystemPolicy (declare field 9 — explicit mounts, no blanket write)
// ---------------------------------------------------------------------------

export const MOUNT_ACCESS_MODES = Object.freeze(['read-only', 'read-write'] as const);
export type MountAccess = (typeof MOUNT_ACCESS_MODES)[number];

/** Where a mount's content comes from (closed, runtime-neutral). */
export const MOUNT_SOURCES = Object.freeze(['initial-state', 'ephemeral', 'workspace', 'evidence'] as const);
export type MountSource = (typeof MOUNT_SOURCES)[number];

export const FILESYSTEM_WRITE_MODES = Object.freeze(['read-only', 'declared-mounts-only'] as const);
export type FilesystemWriteMode = (typeof FILESYSTEM_WRITE_MODES)[number];

export interface MountSpec {
  readonly mountPath: MountPath;
  readonly access: MountAccess;
  readonly source: MountSource;
}

export interface FilesystemPolicy {
  readonly writeMode: FilesystemWriteMode;
  readonly mounts: readonly MountSpec[];
}

export function isMountSpec(value: unknown): value is MountSpec {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isMountPath(candidate['mountPath']) &&
    typeof candidate['access'] === 'string' &&
    (MOUNT_ACCESS_MODES as readonly string[]).includes(candidate['access']) &&
    typeof candidate['source'] === 'string' &&
    (MOUNT_SOURCES as readonly string[]).includes(candidate['source'])
  );
}

export function isFilesystemPolicy(value: unknown): value is FilesystemPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['writeMode'] === 'string' &&
    (FILESYSTEM_WRITE_MODES as readonly string[]).includes(candidate['writeMode']) &&
    Array.isArray(candidate['mounts']) &&
    candidate['mounts'].every((entry) => isMountSpec(entry))
  );
}

function toMountSpec(value: unknown): MountSpec {
  const record = expectFields(
    value,
    ['mountPath', 'access', 'source'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY,
    'mount',
  );
  const mountPath = toMountPath(
    typeof record['mountPath'] === 'string' ? record['mountPath'] : '',
  );
  const access = expectEnumMember(
    record['access'],
    MOUNT_ACCESS_MODES,
    'access',
    ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY,
    'mount',
  );
  const source = expectEnumMember(
    record['source'],
    MOUNT_SOURCES,
    'source',
    ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY,
    'mount',
  );
  return Object.freeze({ mountPath, access, source });
}

/** Validate and freeze the filesystem policy (explicit mounts only). */
export function toFilesystemPolicy(value: {
  writeMode: string;
  mounts?: readonly { mountPath: string; access: string; source: string }[];
}): FilesystemPolicy {
  const record = expectFields(
    value,
    ['writeMode'],
    ['mounts'],
    ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY,
    'filesystem policy',
  );
  const writeMode = expectEnumMember(
    record['writeMode'],
    FILESYSTEM_WRITE_MODES,
    'writeMode',
    ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY,
    'filesystem policy',
  );
  const rawMounts = record['mounts'];
  if (rawMounts !== undefined && !Array.isArray(rawMounts)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY, {
      message: 'filesystem policy: mounts must be an array of mount specs',
    });
  }
  const mounts = Object.freeze((rawMounts ?? []).map((entry) => toMountSpec(entry)));
  const seen = new Set<string>();
  for (const mount of mounts) {
    if (seen.has(mount.mountPath)) {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY, {
        message: `filesystem policy: duplicate mount path '${mount.mountPath}'`,
        details: { mountPath: mount.mountPath },
      });
    }
    seen.add(mount.mountPath);
  }
  // Contradiction: read-write mounts require the declared-mounts-only mode
  // (there is no blanket write in the closed enum — this keeps the intent
  // unambiguous even when the enum evolves).
  const hasReadWrite = mounts.some((mount) => mount.access === 'read-write');
  if (hasReadWrite && writeMode === 'read-only') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY, {
      message:
        'filesystem policy: writeMode is read-only but a read-write mount is declared (contradiction)',
      details: { writeMode },
    });
  }
  return Object.freeze({ writeMode, mounts });
}

/** True iff `path` is covered by a declared mount (exact or ancestor mount). */
export function isPathMounted(policy: FilesystemPolicy, path: string): boolean {
  return policy.mounts.some(
    (mount) => path === mount.mountPath || path.startsWith(`${mount.mountPath}/`),
  );
}

/** True iff `path` is covered by a declared READ-WRITE mount. */
export function isPathWritable(policy: FilesystemPolicy, path: string): boolean {
  return policy.mounts.some(
    (mount) =>
      mount.access === 'read-write' &&
      (path === mount.mountPath || path.startsWith(`${mount.mountPath}/`)),
  );
}

// ---------------------------------------------------------------------------
// SecretPolicy (declare field 10 — secret isolation, declared injection)
// ---------------------------------------------------------------------------

/** How a referenced secret is injected at its declared point. */
export const SECRET_INJECTION_MECHANISMS = Object.freeze(['environment-binding', 'file-mount', 'stream'] as const);
export type SecretInjectionMechanism = (typeof SECRET_INJECTION_MECHANISMS)[number];

/**
 * A declared injection point: the secret is REFERENCED by neutral id and
 * injected at a declared path through a declared mechanism. There is
 * deliberately NO field for secret material — value-carrying field names
 * are rejected by the shared guard (secrets never enter canonical
 * objects).
 */
export interface SecretInjectionPoint {
  readonly secretId: NeutralId;
  readonly mountPath: MountPath;
  readonly mechanism: SecretInjectionMechanism;
}

export interface SecretPolicy {
  readonly isolation: 'isolation-boundary';
  readonly injectionPoints: readonly SecretInjectionPoint[];
}

export function isSecretInjectionPoint(value: unknown): value is SecretInjectionPoint {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['secretId']) &&
    isMountPath(candidate['mountPath']) &&
    typeof candidate['mechanism'] === 'string' &&
    (SECRET_INJECTION_MECHANISMS as readonly string[]).includes(candidate['mechanism'])
  );
}

export function isSecretPolicy(value: unknown): value is SecretPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['isolation'] === 'isolation-boundary' &&
    Array.isArray(candidate['injectionPoints']) &&
    candidate['injectionPoints'].every((entry) => isSecretInjectionPoint(entry))
  );
}

function toSecretInjectionPoint(value: unknown): SecretInjectionPoint {
  const record = expectFields(
    value,
    ['secretId', 'mountPath', 'mechanism'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_SECRET_POLICY,
    'secret injection point',
  );
  const secretId = toNeutralId(
    typeof record['secretId'] === 'string' ? record['secretId'] : '',
  );
  const mountPath = toMountPath(
    typeof record['mountPath'] === 'string' ? record['mountPath'] : '',
  );
  const mechanism = expectEnumMember(
    record['mechanism'],
    SECRET_INJECTION_MECHANISMS,
    'mechanism',
    ENVIRONMENT_ERROR_CODES.INVALID_SECRET_POLICY,
    'secret injection point',
  );
  return Object.freeze({ secretId, mountPath, mechanism });
}

/** Validate and freeze the secret policy (reference-only injection points). */
export function toSecretPolicy(value: {
  isolation: string;
  injectionPoints?: readonly {
    secretId: string;
    mountPath: string;
    mechanism: string;
  }[];
}): SecretPolicy {
  const record = expectFields(
    value,
    ['isolation'],
    ['injectionPoints'],
    ENVIRONMENT_ERROR_CODES.INVALID_SECRET_POLICY,
    'secret policy',
  );
  const isolation = expectEnumMember(
    record['isolation'],
    ['isolation-boundary'] as const,
    'isolation',
    ENVIRONMENT_ERROR_CODES.INVALID_SECRET_POLICY,
    'secret policy',
  );
  const rawPoints = record['injectionPoints'];
  if (rawPoints !== undefined && !Array.isArray(rawPoints)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_SECRET_POLICY, {
      message: 'secret policy: injectionPoints must be an array of injection point declarations',
    });
  }
  const injectionPoints = Object.freeze(
    (rawPoints ?? []).map((entry) => toSecretInjectionPoint(entry)),
  );
  const seen = new Set<string>();
  for (const point of injectionPoints) {
    const key = `${point.secretId}@${point.mountPath}`;
    if (seen.has(key)) {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_SECRET_POLICY, {
        message: `secret policy: duplicate injection point ${key}`,
        details: { secretId: point.secretId, mountPath: point.mountPath },
      });
    }
    seen.add(key);
  }
  return Object.freeze({ isolation, injectionPoints });
}

/** True iff the policy declares an injection point for the given secret id. */
export function declaresSecret(policy: SecretPolicy, secretId: string): boolean {
  return policy.injectionPoints.some((point) => point.secretId === secretId);
}

// ---------------------------------------------------------------------------
// CheckpointRef (shared with lifecycle.ts — defined here to avoid an
// import cycle; lifecycle re-exports it)
// ---------------------------------------------------------------------------

/** Content-addressed reference to a checkpoint. */
export interface CheckpointRef {
  readonly checkpointId: NeutralId;
  readonly digest: ContentDigest;
}

export function isCheckpointRef(value: unknown): value is CheckpointRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isNeutralId(candidate['checkpointId']) && isContentDigest(candidate['digest']);
}

/** Validate and freeze a checkpoint reference. */
export function toCheckpointRef(value: {
  checkpointId: string;
  digest: string;
}): CheckpointRef {
  const record = expectFields(
    value,
    ['checkpointId', 'digest'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_CHECKPOINT_SEMANTICS,
    'checkpoint ref',
  );
  const checkpointId = toNeutralId(
    typeof record['checkpointId'] === 'string' ? record['checkpointId'] : '',
  );
  const digest = toContentDigest(
    typeof record['digest'] === 'string' ? record['digest'] : '',
  );
  return Object.freeze({ checkpointId, digest });
}
