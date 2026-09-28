/**
 * Isolation-envelope view guards (Work Order A010 gate 5; architecture
 * §16 "Untrusted environments execute only inside approved isolation
 * boundaries"; lock rule 8).
 *
 * The run declaration's isolation envelope is composed of the A009
 * ENV1.0 policy types — ResourceLimits, NetworkPolicy, FilesystemPolicy,
 * SecretPolicy, TimeLimits — and the environment reference is A009's
 * content-addressed EnvironmentVersionRef. Those TYPES are imported
 * type-only from @arena/environment-protocol (gate 12; sibling domain
 * packages enter as types, never as runtime imports), so the STRUCTURAL
 * GUARDS for those shapes live here, typed against the imported types.
 * The guarded shapes mirror A009's own validators character-for-character
 * (closed enums, default-deny egress, explicit mounts, reference-only
 * secret injection points); contracts.parity.test.ts pins the shared
 * pattern sources.
 *
 * RunResourceEnvelope bundles the four policies a run declares; the
 * admission check (admission.ts) proves the bundle FITS the environment
 * the run targets before the run is admitted to execute.
 */

import type {
  EnvironmentVersionRef,
  FilesystemPolicy,
  NetworkPolicy,
  ResourceLimits,
  SecretPolicy,
  TimeLimits,
} from '@arena/environment-protocol';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import { expectFields } from './shared.js';
import { isContentDigest } from './shared.js';

// ---------------------------------------------------------------------------
// Local pattern sources for the guarded shapes (mirror A009's constants)
// ---------------------------------------------------------------------------

export const NAMESPACE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,127}$';
export const SEMVER_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
export const HOSTNAME_PATTERN_SOURCE =
  '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$';
export const MOUNT_PATH_PATTERN_SOURCE =
  '^/(?:[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*)?$';
export const ENVIRONMENT_ID_PATTERN_SOURCE =
  '^arena:environment/[a-z][a-z0-9-]{1,62}/[a-z][a-z0-9-]{1,127}$';

const NAMESPACE_PATTERN = new RegExp(NAMESPACE_PATTERN_SOURCE);
const NAME_PATTERN = new RegExp(NAME_PATTERN_SOURCE);
const SEMVER_PATTERN = new RegExp(SEMVER_PATTERN_SOURCE);
const HOSTNAME_PATTERN = new RegExp(HOSTNAME_PATTERN_SOURCE);
const MOUNT_PATH_PATTERN = new RegExp(MOUNT_PATH_PATTERN_SOURCE);

const EGRESS_PROTOCOLS: readonly string[] = ['tcp', 'udp', 'http', 'https'];
const MOUNT_ACCESS_MODES: readonly string[] = ['read-only', 'read-write'];
const MOUNT_SOURCES: readonly string[] = ['initial-state', 'ephemeral', 'workspace', 'evidence'];
const FILESYSTEM_WRITE_MODES: readonly string[] = ['read-only', 'declared-mounts-only'];
const SECRET_INJECTION_MECHANISMS: readonly string[] = [
  'environment-binding',
  'file-mount',
  'stream',
];
const DEADLINE_BEHAVIORS: readonly string[] = ['hard-stop', 'grace-then-stop'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHostname(value: unknown): boolean {
  return (
    typeof value === 'string' && value.length <= 253 && HOSTNAME_PATTERN.test(value)
  );
}

function isMountPath(value: unknown): boolean {
  if (typeof value !== 'string' || !MOUNT_PATH_PATTERN.test(value)) return false;
  return value.split('/').every((segment) => segment !== '..' && segment !== '.');
}

// ---------------------------------------------------------------------------
// ResourceLimits (A009 isolation — bounded CPU/memory/time)
// ---------------------------------------------------------------------------

export function isResourceLimits(value: unknown): value is ResourceLimits {
  if (!isPlainObject(value)) return false;
  return (
    typeof value['cpuMillis'] === 'number' &&
    Number.isInteger(value['cpuMillis']) &&
    value['cpuMillis'] > 0 &&
    typeof value['memoryMiB'] === 'number' &&
    Number.isInteger(value['memoryMiB']) &&
    value['memoryMiB'] > 0 &&
    typeof value['wallClockSeconds'] === 'number' &&
    Number.isInteger(value['wallClockSeconds']) &&
    value['wallClockSeconds'] > 0
  );
}

/** Validate and freeze a run's declared resource limits. */
export function toResourceEnvelope(value: {
  cpuMillis: number;
  memoryMiB: number;
  wallClockSeconds: number;
}): ResourceLimits {
  const record = expectFields(
    value,
    ['cpuMillis', 'memoryMiB', 'wallClockSeconds'],
    [],
    ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RESOURCE_ENVELOPE,
    'resource envelope',
  );
  for (const field of ['cpuMillis', 'memoryMiB', 'wallClockSeconds'] as const) {
    const raw = record[field];
    if (
      typeof raw !== 'number' ||
      !Number.isInteger(raw) ||
      raw <= 0
    ) {
      throw new EnvironmentRuntimeError(
        ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RESOURCE_ENVELOPE,
        {
          message: `resource envelope: ${field} must be a positive integer, got: ${String(raw)}`,
          details: { field },
        },
      );
    }
  }
  return Object.freeze({
    cpuMillis: record['cpuMillis'] as number,
    memoryMiB: record['memoryMiB'] as number,
    wallClockSeconds: record['wallClockSeconds'] as number,
  });
}

// ---------------------------------------------------------------------------
// NetworkPolicy (A009 isolation — default-deny egress, explicit allows)
// ---------------------------------------------------------------------------

export function isEgressAllow(
  value: unknown,
): value is NetworkPolicy['allows'][number] {
  if (!isPlainObject(value)) return false;
  return (
    isHostname(value['host']) &&
    typeof value['port'] === 'number' &&
    Number.isInteger(value['port']) &&
    value['port'] >= 1 &&
    value['port'] <= 65535 &&
    typeof value['protocol'] === 'string' &&
    EGRESS_PROTOCOLS.includes(value['protocol'])
  );
}

export function isNetworkPolicy(value: unknown): value is NetworkPolicy {
  if (!isPlainObject(value)) return false;
  return (
    value['egress'] === 'default-deny' &&
    Array.isArray(value['allows']) &&
    value['allows'].every((entry) => isEgressAllow(entry))
  );
}

/** Validate and freeze a run's declared network policy (default-deny only). */
export function toNetworkEnvelope(value: {
  egress: string;
  allows?: readonly { host: string; port: number; protocol: string }[];
}): NetworkPolicy {
  const record = expectFields(
    value,
    ['egress'],
    ['allows'],
    ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_NETWORK_ENVELOPE,
    'network envelope',
  );
  if (record['egress'] !== 'default-deny') {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_NETWORK_ENVELOPE,
      {
        message: `network envelope: the only egress mode is 'default-deny', got: ${String(record['egress'])}`,
      },
    );
  }
  const rawAllows = record['allows'];
  if (rawAllows !== undefined && !Array.isArray(rawAllows)) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_NETWORK_ENVELOPE,
      {
        message: 'network envelope: allows must be an array of explicit egress allows',
      },
    );
  }
  const allows = (rawAllows ?? []).map((entry) => {
    if (!isEgressAllow(entry)) {
      throw new EnvironmentRuntimeError(
        ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_NETWORK_ENVELOPE,
        {
          message: `network envelope: invalid egress allow ${JSON.stringify(entry)} (host/port/protocol required; port in [1, 65535])`,
        },
      );
    }
    return Object.freeze({ ...entry });
  });
  const seen = new Set<string>();
  for (const allow of allows) {
    const key = `${allow.host}:${String(allow.port)}:${allow.protocol}`;
    if (seen.has(key)) {
      throw new EnvironmentRuntimeError(
        ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_NETWORK_ENVELOPE,
        {
          message: `network envelope: duplicate egress allow ${key}`,
          details: { allow: key },
        },
      );
    }
    seen.add(key);
  }
  return Object.freeze({ egress: 'default-deny' as const, allows: Object.freeze(allows) });
}

// ---------------------------------------------------------------------------
// FilesystemPolicy (A009 isolation — explicit mounts, no blanket write)
// ---------------------------------------------------------------------------

export function isMountSpec(value: unknown): value is FilesystemPolicy['mounts'][number] {
  if (!isPlainObject(value)) return false;
  return (
    isMountPath(value['mountPath']) &&
    typeof value['access'] === 'string' &&
    MOUNT_ACCESS_MODES.includes(value['access']) &&
    typeof value['source'] === 'string' &&
    MOUNT_SOURCES.includes(value['source'])
  );
}

export function isFilesystemPolicy(value: unknown): value is FilesystemPolicy {
  if (!isPlainObject(value)) return false;
  return (
    typeof value['writeMode'] === 'string' &&
    FILESYSTEM_WRITE_MODES.includes(value['writeMode']) &&
    Array.isArray(value['mounts']) &&
    value['mounts'].every((entry) => isMountSpec(entry))
  );
}

/** Validate and freeze a run's declared filesystem policy (explicit mounts only). */
export function toFilesystemEnvelope(value: {
  writeMode: string;
  mounts?: readonly { mountPath: string; access: string; source: string }[];
}): FilesystemPolicy {
  const record = expectFields(
    value,
    ['writeMode'],
    ['mounts'],
    ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_FILESYSTEM_ENVELOPE,
    'filesystem envelope',
  );
  if (typeof record['writeMode'] !== 'string' || !FILESYSTEM_WRITE_MODES.includes(record['writeMode'])) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_FILESYSTEM_ENVELOPE,
      {
        message: `filesystem envelope: writeMode must be one of [${FILESYSTEM_WRITE_MODES.join(', ')}], got: ${String(record['writeMode'])}`,
      },
    );
  }
  const writeMode = record['writeMode'] as FilesystemPolicy['writeMode'];
  const rawMounts = record['mounts'];
  if (rawMounts !== undefined && !Array.isArray(rawMounts)) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_FILESYSTEM_ENVELOPE,
      {
        message: 'filesystem envelope: mounts must be an array of mount specs',
      },
    );
  }
  const mounts = (rawMounts ?? []).map((entry) => {
    if (!isMountSpec(entry)) {
      throw new EnvironmentRuntimeError(
        ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_FILESYSTEM_ENVELOPE,
        {
          message: `filesystem envelope: invalid mount ${JSON.stringify(entry)} (absolute mountPath; access in [${MOUNT_ACCESS_MODES.join(', ')}]; source in [${MOUNT_SOURCES.join(', ')}])`,
        },
      );
    }
    return Object.freeze({ ...entry });
  });
  const seen = new Set<string>();
  for (const mount of mounts) {
    if (seen.has(mount.mountPath)) {
      throw new EnvironmentRuntimeError(
        ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_FILESYSTEM_ENVELOPE,
        {
          message: `filesystem envelope: duplicate mount path '${mount.mountPath}'`,
          details: { mountPath: mount.mountPath },
        },
      );
    }
    seen.add(mount.mountPath);
  }
  const hasReadWrite = mounts.some((mount) => mount.access === 'read-write');
  if (hasReadWrite && writeMode === 'read-only') {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_FILESYSTEM_ENVELOPE,
      {
        message:
          'filesystem envelope: writeMode is read-only but a read-write mount is declared (contradiction — there is no blanket write mode)',
      },
    );
  }
  return Object.freeze({ writeMode, mounts: Object.freeze(mounts) });
}

// ---------------------------------------------------------------------------
// SecretPolicy (A009 isolation — reference-only injection points)
// ---------------------------------------------------------------------------

export function isSecretInjectionPoint(
  value: unknown,
): value is SecretPolicy['injectionPoints'][number] {
  if (!isPlainObject(value)) return false;
  const secretId = value['secretId'];
  return (
    typeof secretId === 'string' &&
    /^[a-z][a-z0-9-]{0,63}$/.test(secretId) &&
    isMountPath(value['mountPath']) &&
    typeof value['mechanism'] === 'string' &&
    SECRET_INJECTION_MECHANISMS.includes(value['mechanism'])
  );
}

export function isSecretPolicy(value: unknown): value is SecretPolicy {
  if (!isPlainObject(value)) return false;
  return (
    value['isolation'] === 'isolation-boundary' &&
    Array.isArray(value['injectionPoints']) &&
    value['injectionPoints'].every((entry) => isSecretInjectionPoint(entry))
  );
}

/** Validate and freeze a run's declared secret policy (references only). */
export function toSecretEnvelope(value: {
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
    ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_SECRET_ENVELOPE,
    'secret envelope',
  );
  if (record['isolation'] !== 'isolation-boundary') {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_SECRET_ENVELOPE,
      {
        message: `secret envelope: the only isolation mode is 'isolation-boundary', got: ${String(record['isolation'])}`,
      },
    );
  }
  const rawPoints = record['injectionPoints'];
  if (rawPoints !== undefined && !Array.isArray(rawPoints)) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_SECRET_ENVELOPE,
      {
        message:
          'secret envelope: injectionPoints must be an array of injection point declarations',
      },
    );
  }
  const injectionPoints = (rawPoints ?? []).map((entry) => {
    if (!isSecretInjectionPoint(entry)) {
      throw new EnvironmentRuntimeError(
        ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_SECRET_ENVELOPE,
        {
          message: `secret envelope: invalid injection point ${JSON.stringify(entry)} (neutral secretId, absolute mountPath, mechanism in [${SECRET_INJECTION_MECHANISMS.join(', ')}]; secret VALUES never enter run declarations)`,
        },
      );
    }
    return Object.freeze({ ...entry });
  });
  const seen = new Set<string>();
  for (const point of injectionPoints) {
    const key = `${point.secretId}@${point.mountPath}`;
    if (seen.has(key)) {
      throw new EnvironmentRuntimeError(
        ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_SECRET_ENVELOPE,
        {
          message: `secret envelope: duplicate injection point ${key}`,
          details: { secretId: point.secretId, mountPath: point.mountPath },
        },
      );
    }
    seen.add(key);
  }
  return Object.freeze({
    isolation: 'isolation-boundary' as const,
    injectionPoints: Object.freeze(injectionPoints),
  });
}

// ---------------------------------------------------------------------------
// TimeLimits (A009 — startup / cleanup budgets)
// ---------------------------------------------------------------------------

export function isTimeLimits(value: unknown): value is TimeLimits {
  if (!isPlainObject(value)) return false;
  return (
    typeof value['startupSeconds'] === 'number' &&
    Number.isInteger(value['startupSeconds']) &&
    value['startupSeconds'] > 0 &&
    typeof value['cleanupGraceSeconds'] === 'number' &&
    Number.isInteger(value['cleanupGraceSeconds']) &&
    value['cleanupGraceSeconds'] > 0 &&
    typeof value['deadlineBehavior'] === 'string' &&
    DEADLINE_BEHAVIORS.includes(value['deadlineBehavior'])
  );
}

// ---------------------------------------------------------------------------
// EnvironmentVersionRef (A009 — content-addressed environment reference)
// ---------------------------------------------------------------------------

export function isEnvironmentVersionRef(value: unknown): value is EnvironmentVersionRef {
  if (!isPlainObject(value)) return false;
  return (
    typeof value['namespace'] === 'string' &&
    NAMESPACE_PATTERN.test(value['namespace']) &&
    typeof value['name'] === 'string' &&
    NAME_PATTERN.test(value['name']) &&
    typeof value['version'] === 'string' &&
    SEMVER_PATTERN.test(value['version']) &&
    isContentDigest(value['digest'])
  );
}

/** Validate and freeze the content-addressed environment reference a run targets. */
export function toEnvironmentRef(value: {
  namespace: string;
  name: string;
  version: string;
  digest: string;
}): EnvironmentVersionRef {
  const record = expectFields(
    value,
    ['namespace', 'name', 'version', 'digest'],
    [],
    ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_ENVIRONMENT_REF,
    'environment ref',
  );
  if (!isEnvironmentVersionRef(record)) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_ENVIRONMENT_REF,
      {
        message: `invalid environment version ref: ${JSON.stringify(value)} (namespace/name lowercase, semver version, lowercase sha256 digest — the run must pin the executable world by content digest)`,
      },
    );
  }
  return Object.freeze({
    namespace: record['namespace'],
    name: record['name'],
    version: record['version'],
    digest: record['digest'],
  });
}

// ---------------------------------------------------------------------------
// The run's isolation envelope + the environment's admission view
// ---------------------------------------------------------------------------

/**
 * The four A009 policy objects a run declares as its isolation envelope.
 * The admission check proves each one FITS inside the target
 * environment's own limits before the run may reach `running`.
 */
export interface RunIsolationEnvelope {
  readonly resource: ResourceLimits;
  readonly network: NetworkPolicy;
  readonly filesystem: FilesystemPolicy;
  readonly secret: SecretPolicy;
}

export function isRunIsolationEnvelope(value: unknown): value is RunIsolationEnvelope {
  if (!isPlainObject(value)) return false;
  return (
    isResourceLimits(value['resource']) &&
    isNetworkPolicy(value['network']) &&
    isFilesystemPolicy(value['filesystem']) &&
    isSecretPolicy(value['secret'])
  );
}

/**
 * The environment-side bounds an admission check compares a run's
 * isolation envelope against (the relevant slice of an A009
 * EnvironmentDefinition: resource limits, the three isolation policies
 * and the time limits).
 */
export interface EnvironmentAdmissionView {
  readonly resourceLimits: ResourceLimits;
  readonly networkPolicy: NetworkPolicy;
  readonly filesystemPolicy: FilesystemPolicy;
  readonly secretPolicy: SecretPolicy;
  readonly timeLimits: TimeLimits;
}

export function isEnvironmentAdmissionView(value: unknown): value is EnvironmentAdmissionView {
  if (!isPlainObject(value)) return false;
  return (
    isResourceLimits(value['resourceLimits']) &&
    isNetworkPolicy(value['networkPolicy']) &&
    isFilesystemPolicy(value['filesystemPolicy']) &&
    isSecretPolicy(value['secretPolicy']) &&
    isTimeLimits(value['timeLimits'])
  );
}

/** Validate and freeze an environment admission view. */
export function toEnvironmentAdmissionView(value: {
  resourceLimits: { cpuMillis: number; memoryMiB: number; wallClockSeconds: number };
  networkPolicy: { egress: string; allows?: readonly unknown[] };
  filesystemPolicy: { writeMode: string; mounts?: readonly unknown[] };
  secretPolicy: { isolation: string; injectionPoints?: readonly unknown[] };
  timeLimits: { startupSeconds: number; cleanupGraceSeconds: number; deadlineBehavior: string };
}): EnvironmentAdmissionView {
  const record = expectFields(
    value,
    ['resourceLimits', 'networkPolicy', 'filesystemPolicy', 'secretPolicy', 'timeLimits'],
    [],
    ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_ADMISSION_VIEW,
    'environment admission view',
  );
  const resourceLimits = toResourceEnvelope(
    record['resourceLimits'] as {
      cpuMillis: number;
      memoryMiB: number;
      wallClockSeconds: number;
    },
  );
  const networkPolicy = toNetworkEnvelope(
    record['networkPolicy'] as {
      egress: string;
      allows?: readonly { host: string; port: number; protocol: string }[];
    },
  );
  const filesystemPolicy = toFilesystemEnvelope(
    record['filesystemPolicy'] as {
      writeMode: string;
      mounts?: readonly { mountPath: string; access: string; source: string }[];
    },
  );
  const secretPolicy = toSecretEnvelope(
    record['secretPolicy'] as {
      isolation: string;
      injectionPoints?: readonly {
        secretId: string;
        mountPath: string;
        mechanism: string;
      }[];
    },
  );
  const rawTime = record['timeLimits'];
  if (!isTimeLimits(rawTime)) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_ADMISSION_VIEW,
      {
        message: `environment admission view: invalid time limits ${JSON.stringify(rawTime)} (startupSeconds/cleanupGraceSeconds positive integers; deadlineBehavior in [${DEADLINE_BEHAVIORS.join(', ')}])`,
      },
    );
  }
  const timeLimits = Object.freeze({
    startupSeconds: rawTime.startupSeconds,
    cleanupGraceSeconds: rawTime.cleanupGraceSeconds,
    deadlineBehavior: rawTime.deadlineBehavior,
  });
  return Object.freeze({
    resourceLimits,
    networkPolicy,
    filesystemPolicy,
    secretPolicy,
    timeLimits,
  });
}
