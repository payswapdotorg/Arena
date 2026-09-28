/**
 * Admission check (Work Order A010 gate 5; architecture §16; lock rule
 * 8; requirements R29, R30 — sandbox untrusted executable workloads).
 *
 * A run is ADMITTED only if its declared isolation envelope FITS the
 * target environment's own bounds, checked BEFORE the run may reach
 * `running` (the reference runner checks at submission, before
 * provisioning):
 *
 *   - resource fit: the run's declared cpuMillis / memoryMiB /
 *     wallClockSeconds must not exceed the environment's bounds — a
 *     bound that does not bound is not a bound (over-quota is rejected
 *     with a typed error, never silently clamped);
 *   - least-privilege egress: every egress allow the run declares must
 *     be an EXPLICIT allow of the environment (default-deny; no
 *     wildcard escape, exact host/port/protocol);
 *   - least-privilege mounts: every mount the run declares must be
 *     covered by an environment mount at the same path or an ancestor,
 *     and a read-write run mount requires a read-write environment
 *     mount (no blanket write);
 *   - secret isolation: every secret injection point the run declares
 *     must be a declared injection point of the environment (reference
 *     equality on secretId + mountPath + mechanism).
 *
 * `evaluateAdmission` is PURE and returns a frozen AdmissionDecision
 * (the observability artifact logged as an admission-decided event —
 * gate 7); `assertAdmissible` throws the typed ADMISSION_REJECTED
 * error carrying every violation (the negative-test path).
 */

import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import type { EnvironmentAdmissionView, RunIsolationEnvelope } from './isolation-envelope.js';
import { isEnvironmentAdmissionView, isRunIsolationEnvelope } from './isolation-envelope.js';
import { deepFreeze } from './shared.js';

/** The pure outcome of an admission check (gate 7 observability artifact). */
export interface AdmissionDecision {
  readonly admitted: boolean;
  /** Every least-privilege / quota violation (empty when admitted). */
  readonly violations: readonly string[];
}

export function isAdmissionDecision(value: unknown): value is AdmissionDecision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['admitted'] === 'boolean' &&
    Array.isArray(candidate['violations']) &&
    candidate['violations'].every((entry) => typeof entry === 'string') &&
    candidate['admitted'] === ((candidate['violations'] as unknown[]).length === 0)
  );
}

/** True iff `path` equals the mount path or lives beneath it. */
function isCoveredByMount(
  mountPath: string,
  access: 'read-only' | 'read-write',
  path: string,
  requireWrite: boolean,
): boolean {
  const covered = path === mountPath || path.startsWith(`${mountPath}/`);
  if (!covered) return false;
  if (requireWrite) return access === 'read-write';
  return true;
}

/**
 * The PURE admission check: prove the run's isolation envelope fits the
 * environment's bounds. Returns a frozen decision enumerating every
 * violation; never mutates its inputs.
 */
export function evaluateAdmission(
  environment: EnvironmentAdmissionView,
  envelope: RunIsolationEnvelope,
): AdmissionDecision {
  if (!isEnvironmentAdmissionView(environment)) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_ADMISSION_VIEW,
      {
        message:
          'admission check: not a structurally valid environment admission view (the environment bounds must be well-formed before they can bound anything)',
      },
    );
  }
  if (!isRunIsolationEnvelope(envelope)) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RECORD,
      {
        message:
          'admission check: not a structurally valid run isolation envelope (the declared envelope must be well-formed before it can be admitted)',
      },
    );
  }

  const violations: string[] = [];

  // --- Resource fit (over-quota is rejected, never clamped) ---
  if (envelope.resource.cpuMillis > environment.resourceLimits.cpuMillis) {
    violations.push(
      `cpu requirement ${envelope.resource.cpuMillis} exceeds the environment bound ${environment.resourceLimits.cpuMillis}`,
    );
  }
  if (envelope.resource.memoryMiB > environment.resourceLimits.memoryMiB) {
    violations.push(
      `memory requirement ${envelope.resource.memoryMiB} MiB exceeds the environment bound ${environment.resourceLimits.memoryMiB} MiB`,
    );
  }
  if (envelope.resource.wallClockSeconds > environment.resourceLimits.wallClockSeconds) {
    violations.push(
      `wall-clock requirement ${envelope.resource.wallClockSeconds}s exceeds the environment bound ${environment.resourceLimits.wallClockSeconds}s`,
    );
  }

  // --- Least-privilege egress (default-deny, explicit allows only) ---
  for (const allow of envelope.network.allows) {
    const granted = environment.networkPolicy.allows.some(
      (candidate) =>
        candidate.host === allow.host &&
        candidate.port === allow.port &&
        candidate.protocol === allow.protocol,
    );
    if (!granted) {
      violations.push(
        `egress allow ${allow.host}:${String(allow.port)}/${allow.protocol} is not an explicit allow of the environment (default-deny)`,
      );
    }
  }

  // --- Least-privilege mounts (explicit mounts only, no blanket write) ---
  for (const mount of envelope.filesystem.mounts) {
    const covered = environment.filesystemPolicy.mounts.some((candidate) =>
      isCoveredByMount(
        candidate.mountPath,
        candidate.access,
        mount.mountPath,
        mount.access === 'read-write',
      ),
    );
    if (!covered) {
      violations.push(
        `mount '${mount.mountPath}' (${mount.access}) is not covered by a declared environment mount with sufficient access`,
      );
    }
  }

  // --- Secret isolation (declared injection points only) ---
  for (const point of envelope.secret.injectionPoints) {
    const declared = environment.secretPolicy.injectionPoints.some(
      (candidate) =>
        candidate.secretId === point.secretId &&
        candidate.mountPath === point.mountPath &&
        candidate.mechanism === point.mechanism,
    );
    if (!declared) {
      violations.push(
        `secret injection point ${point.secretId}@${point.mountPath} (${point.mechanism}) is not a declared injection point of the environment`,
      );
    }
  }

  return deepFreeze({
    admitted: violations.length === 0,
    violations: Object.freeze(violations),
  }) as AdmissionDecision;
}

/**
 * Throwing twin of evaluateAdmission: over-quota / least-privilege
 * violations are rejected with the typed ADMISSION_REJECTED error
 * carrying every violation (gate 5 negative-test path).
 */
export function assertAdmissible(
  environment: EnvironmentAdmissionView,
  envelope: RunIsolationEnvelope,
): AdmissionDecision {
  const decision = evaluateAdmission(environment, envelope);
  if (!decision.admitted) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.ADMISSION_REJECTED, {
      message: `run admission rejected: the declared isolation envelope does not fit the environment bounds (${decision.violations.length} violation(s)): ${decision.violations.join('; ')}`,
      details: { violations: [...decision.violations] },
    });
  }
  return decision;
}
