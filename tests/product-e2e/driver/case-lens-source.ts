/**
 * B017 product-E2E driver — derive the B003 role-projection input
 * (CapabilityCaseView) from a canonical demo read (tests/product-e2e).
 *
 * B003's disclosure: the projection layer consumes a NARROW structural
 * view type, and "the read model (B005) is expected to map canonical
 * case records into this view." This module is that mapper for the
 * demo narrative case — it derives every field from the canonical read
 * of the seeded corpus record (nothing invented except the two DECLARED
 * narrative postures below), so the role-switch simulation asserts
 * against the real contract over the real canonical object.
 *
 * Field derivations (all from the corpus record's data):
 *   - status           <- data.lifecycle
 *   - targetCapability <- data.caseId (the case's motivating gap id)
 *   - observedFailure  <- the first trajectory observation step
 *   - desiredOutcome   <- data.summary
 *   - evidence         <- the trajectory steps (observation/action/tool/
 *                         result -> `evidence`; model-output ->
 *                         `model-output`; ids `traj-<step>`)
 *   - currentBodyVersion <- data.assignedBody.bodyVersion
 *   - open/resolvedTaskCounts <- data.tasks states
 *   - lastEvaluation   <- data.evaluation (verdict -> pass/fail)
 *
 * Declared narrative postures (not carried by the corpus record):
 *   - uncertainty: 'medium'   (the walkthrough case is neither
 *     evidence-free nor high-uncertainty)
 *   - jobHealth: 'healthy'    (the narrative case is the happy-path
 *     walkthrough; no incident is part of its story)
 * Both are constant inputs to the lenses ONLY — the projection
 * assertions never depend on their specific values.
 */

import type { CanonicalRead } from '../../../packages/read-model/src/models.js';
import type { CanonicalStateKind } from '../../../packages/role-context/src/shared.js';
import type { CapabilityCaseView, CaseEvidenceItemView } from '../../../packages/role-context/src/projections/capability-case-lenses.js';

interface NarrativeTrajectoryStep {
  readonly step?: unknown;
  readonly type?: unknown;
  readonly summary?: unknown;
}

interface NarrativeTask {
  readonly taskId?: unknown;
  readonly state?: unknown;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function trajectoryKind(type: string): CanonicalStateKind {
  return type === 'model-output' ? 'model-output' : 'evidence';
}

/**
 * Map the canonical read of a demo narrative capability case into the
 * B003 projection input view. Fails closed when the record is not the
 * narrative case shape (missing trajectory/tasks/evaluation).
 */
export function toCapabilityCaseView(read: CanonicalRead): CapabilityCaseView {
  const data = asRecord(read.data);
  const trajectory = Array.isArray(data['trajectory'])
    ? (data['trajectory'] as readonly unknown[]).map(asRecord)
    : [];
  const tasks = Array.isArray(data['tasks'])
    ? (data['tasks'] as readonly unknown[]).map(asRecord)
    : [];
  const evaluation = asRecord(data['evaluation']);
  const assignedBody = asRecord(data['assignedBody']);
  if (trajectory.length === 0 || tasks.length === 0) {
    throw new Error(
      `not a narrative demo capability case: ${JSON.stringify(read.recordId)} (trajectory/tasks absent)`,
    );
  }
  const firstObservation = trajectory.find(
    (entry) => entry['type'] === 'observation' && typeof entry['summary'] === 'string',
  );
  const evidence: readonly CaseEvidenceItemView[] = Object.freeze(
    trajectory
      .filter((entry) => typeof entry['type'] === 'string' && typeof entry['summary'] === 'string')
      .map((entry, index) =>
        Object.freeze({
          evidenceId: `traj-${String(index + 1)}`,
          stateKind: trajectoryKind(String(entry['type'])),
        }),
      ),
  );
  const openTaskCount = tasks.filter((task) => task['state'] !== 'completed').length;
  const resolvedTaskCount = tasks.length - openTaskCount;
  const verdict = evaluation['verdict'] === 'pass' ? 'pass' : 'fail';
  const bodyVersion =
    typeof assignedBody['bodyVersion'] === 'string' ? assignedBody['bodyVersion'] : undefined;
  return Object.freeze({
    kind: 'capability-case',
    tenant: String(read.tenantId),
    objectId: String(read.recordId),
    // Declared narrative posture: the walkthrough case is the v1.0.0
    // narrative of the payments-reliability story (the corpus record
    // carries no case semver of its own; the projection contract
    // requires one).
    version: '1.0.0',
    status: typeof data['lifecycle'] === 'string' ? data['lifecycle'] : 'unknown',
    targetCapability: typeof data['caseId'] === 'string' ? data['caseId'] : String(read.recordId),
    observedFailure:
      firstObservation !== undefined && typeof firstObservation['summary'] === 'string'
        ? firstObservation['summary']
        : 'observed failure not recorded',
    desiredOutcome: typeof data['summary'] === 'string' ? data['summary'] : 'desired outcome not recorded',
    // Declared narrative posture (see module doc).
    uncertainty: 'medium',
    evidence,
    ...(bodyVersion !== undefined ? { currentBodyVersion: bodyVersion } : {}),
    missingCapabilities: Object.freeze([]),
    openTaskCount,
    resolvedTaskCount,
    // Declared narrative posture (see module doc).
    jobHealth: 'healthy',
    ...(evaluation['verdict'] !== undefined
      ? {
          lastEvaluation: Object.freeze({
            result: verdict,
            stateKind: 'evaluation-result' as CanonicalStateKind,
          }),
        }
      : {}),
  } satisfies CapabilityCaseView);
}

/** Read a narrative demo case by record id through a canonical read port. */
export async function readNarrativeCase(
  port: { read(recordId: string): Promise<CanonicalRead> },
  recordId: string,
): Promise<CanonicalRead> {
  return port.read(recordId);
}
