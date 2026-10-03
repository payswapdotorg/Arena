/**
 * Replay run-inspection view model (Work Order B011; issue #86;
 * packages/replay-ui — the pure view-model layer).
 *
 * The INTERACTIVE RUN-INSPECTION assembly: one run detail = timeline +
 * environment event stream + result linkage + STEP SELECTION. Step
 * selection is explicit query state (`?step=N`, the cockpit role-switch
 * posture): the model carries the selected step's full I/O inspection
 * view (action input, observation channel + content, checkpoint digest,
 * error code + message, completion outcome + evidence addresses) plus
 * the honest outcome of the selection itself (selected / out-of-range /
 * none — an out-of-range request renders a truthful note, never a
 * clamped silent neighbour).
 *
 * Also projects the run's A010 RunRecord and RunResult summaries through
 * their PUBLIC guards, and carries the async full-chain verification
 * outcome the runtime layer computed (`verifyReplayTrajectoryChain`).
 * Total, synchronous, never-throwing over any input.
 */

import { isRunRecord, isRunResult } from '@arena/environment-runtime';
import type { RunRecord, RunResult } from '@arena/environment-runtime';
import { toReplayEventStream } from './event-stream.js';
import type { ReplayEventStreamModel } from './event-stream.js';
import { toReplayLinkage } from './linkage.js';
import type { ReplayLinkageModel } from './linkage.js';
import { toReplayTimeline } from './timeline.js';
import type { ReplayChainVerification, ReplayTimelineModel } from './timeline.js';
import { REPLAY_OBSERVATIONAL_NOTE } from './truth.js';

// ---------------------------------------------------------------------------
// Run record / run result summaries (A010 public guards)
// ---------------------------------------------------------------------------

/** The projected A010 RunRecord summary of the replayed run. */
export interface ReplayRunRecordModel {
  readonly runId: string | null;
  readonly tenantId: string | null;
  readonly environmentId: string | null;
  readonly environmentVersion: string | null;
  readonly jobRef: string | null;
  readonly initialSnapshotDigest: string | null;
  readonly seed: string | null;
  readonly submittedAt: string | null;
  readonly digest: string | null;
  readonly readable: boolean;
  readonly note: string;
}

/** The projected A010 RunResult summary (completed runs only — A010 rule). */
export interface ReplayRunResultModel {
  readonly runId: string | null;
  readonly finalState: string | null;
  readonly finishedAt: string | null;
  readonly trajectoryDigest: string | null;
  readonly evidenceDigests: readonly string[];
  readonly initialSnapshotDigest: string | null;
  readonly digest: string | null;
  readonly readable: boolean;
  readonly note: string;
}

/** Project ANY payload into the run-record summary (total, never-throwing). */
export function toReplayRunRecordSummary(payload: unknown): ReplayRunRecordModel {
  if (!isRunRecord(payload)) {
    return Object.freeze({
      runId: null,
      tenantId: null,
      environmentId: null,
      environmentVersion: null,
      jobRef: null,
      initialSnapshotDigest: null,
      seed: null,
      submittedAt: null,
      digest: null,
      readable: false,
      note: 'run record payload failed the structural guard (isRunRecord) — rendered as unknown, never guessed',
    } satisfies ReplayRunRecordModel);
  }
  const record = payload as RunRecord;
  return Object.freeze({
    runId: record.runId,
    tenantId: record.tenantId,
    environmentId: `${record.environment.namespace}/${record.environment.name}`,
    environmentVersion: record.environment.version,
    jobRef: record.jobRef,
    initialSnapshotDigest: record.initialSnapshotDigest,
    seed: record.seed,
    submittedAt: record.submittedAt,
    digest: record.digest,
    readable: true,
    note: 'the A010 run record — the content-addressed declaration of the run (tenant-scoped, environment-pinned)',
  } satisfies ReplayRunRecordModel);
}

/** Project ANY payload into the run-result summary (total, never-throwing). */
export function toReplayRunResultSummary(payload: unknown): ReplayRunResultModel {
  if (!isRunResult(payload)) {
    return Object.freeze({
      runId: null,
      finalState: null,
      finishedAt: null,
      trajectoryDigest: null,
      evidenceDigests: Object.freeze([]),
      initialSnapshotDigest: null,
      digest: null,
      readable: false,
      note: 'run result payload failed the structural guard (isRunResult) — rendered as unknown, never guessed (failed and timed-out runs are evidenced by their event streams, not results)',
    } satisfies ReplayRunResultModel);
  }
  const result = payload as RunResult;
  return Object.freeze({
    runId: result.runId,
    finalState: result.finalState,
    finishedAt: result.finishedAt,
    trajectoryDigest: result.runAddress.trajectoryDigest,
    evidenceDigests: Object.freeze([...result.runAddress.evidenceDigests]),
    initialSnapshotDigest: result.runAddress.initialSnapshotDigest,
    digest: result.digest,
    readable: true,
    note: 'the A010 run result — the evidence-addressable outcome of the completed run (binds the trajectory digest and evidence addresses)',
  } satisfies ReplayRunResultModel);
}

// ---------------------------------------------------------------------------
// Step selection (explicit query state; honest out-of-range)
// ---------------------------------------------------------------------------

/** The selection state of the step inspector. */
export type ReplayStepSelectionState = 'selected' | 'out-of-range' | 'none';

/** One step-inspection view: the selected step plus navigation truth. */
export interface ReplayStepInspectionModel {
  readonly state: ReplayStepSelectionState;
  /** The requested sequence (verbatim — observability, never silently clamped). */
  readonly requestedSequence: number | null;
  readonly step: Readonly<{
    readonly sequence: number;
    readonly kind: string;
    readonly kindLabel: string;
    readonly truthClass: string;
    readonly summary: string;
    readonly occurredAt: string | null;
    readonly wallClockDeltaMs: number | null;
    readonly payloadView: unknown;
    readonly stepDigest: string | null;
    readonly prevDigest: string | null;
  }> | null;
  readonly previousSequence: number | null;
  readonly nextSequence: number | null;
  readonly note: string;
}

/**
 * Select a timeline step by explicit sequence. Honest outcomes only:
 * `selected` (the step view), `out-of-range` (the truthful note — the
 * request is kept verbatim, never clamped), `none` (no readable steps or
 * no request — the inspector then shows the last readable step's summary
 * slot as empty, never a fabricated default).
 */
export function selectReplayStep(
  timeline: ReplayTimelineModel,
  requestedSequence: number | null,
): ReplayStepInspectionModel {
  // Every timeline row is inspectable — including gap markers and
  // unreadable rows (inspecting a gap shows the no-data truth).
  const rows = timeline.steps;
  if (rows.length === 0 || requestedSequence === null) {
    return Object.freeze({
      state: 'none',
      requestedSequence,
      step: null,
      previousSequence: null,
      nextSequence: null,
      note:
        rows.length === 0
          ? 'no timeline steps are readable — nothing to inspect (no data, never fabricated)'
          : 'no step selected — choose a timeline step to inspect its I/O',
    } satisfies ReplayStepInspectionModel);
  }
  const index = rows.findIndex((step) => step.sequence === requestedSequence);
  if (index === -1) {
    return Object.freeze({
      state: 'out-of-range',
      requestedSequence,
      step: null,
      previousSequence: null,
      nextSequence: null,
      note: `step ${String(requestedSequence)} does not exist in this timeline (existing sequences: ${rows.map((step) => String(step.sequence)).join(', ')}) — the request is kept verbatim, never clamped`,
    } satisfies ReplayStepInspectionModel);
  }
  const step = rows[index];
  if (step === undefined) {
    return Object.freeze({
      state: 'out-of-range',
      requestedSequence,
      step: null,
      previousSequence: null,
      nextSequence: null,
      note: `step ${String(requestedSequence)} could not be resolved — rendered as unknown`,
    } satisfies ReplayStepInspectionModel);
  }
  const previous = rows[index - 1];
  const next = rows[index + 1];
  return Object.freeze({
    state: 'selected',
    requestedSequence,
    step: Object.freeze({
      sequence: step.sequence,
      kind: step.kind,
      kindLabel: step.kindLabel,
      truthClass: step.truthClass,
      summary: step.summary,
      occurredAt: step.occurredAt,
      wallClockDeltaMs: step.wallClockDeltaMs,
      payloadView: step.payloadView,
      stepDigest: step.stepDigest,
      prevDigest: step.prevDigest,
    }),
    previousSequence: previous !== undefined ? previous.sequence : null,
    nextSequence: next !== undefined ? next.sequence : null,
    note: `inspecting step ${String(step.sequence)} (${step.kindLabel}) — per-step I/O inspection; the step renders under its own truth class`,
  } satisfies ReplayStepInspectionModel);
}

// ---------------------------------------------------------------------------
// The run detail assembly
// ---------------------------------------------------------------------------

/** The complete run-detail view model (everything the screen renders). */
export interface ReplayRunDetailModel {
  readonly runId: string;
  readonly runKey: string;
  readonly timeline: ReplayTimelineModel;
  readonly eventStream: ReplayEventStreamModel;
  readonly linkage: ReplayLinkageModel;
  readonly inspection: ReplayStepInspectionModel;
  readonly chainVerification: ReplayChainVerification;
  readonly runRecord: ReplayRunRecordModel;
  readonly runResult: ReplayRunResultModel;
  /** The observational contract, carried on every replay screen. */
  readonly observationalNote: string;
}

/**
 * Assemble the complete run-detail view model from raw payloads. Total,
 * synchronous, never-throwing: every sub-model degrades honestly on
 * malformed input. `chainVerification` is supplied by the runtime layer
 * (the async full-chain recomputation); when omitted it renders as
 * `not-attempted`, never as verified.
 */
export function toReplayRunDetail(input: {
  readonly runId: string;
  readonly trajectoryPayload: unknown;
  readonly eventStreamPayload?: unknown;
  readonly trajectoryEvidenceDigests?: readonly unknown[];
  readonly runResultEvidenceDigests?: readonly unknown[];
  readonly evaluationRecords?: readonly unknown[];
  readonly verificationRecords?: readonly unknown[];
  readonly requestedSequence?: number | null;
  readonly chainVerification?: ReplayChainVerification;
  readonly runRecordPayload?: unknown;
  readonly runResultPayload?: unknown;
}): ReplayRunDetailModel {
  const timeline = toReplayTimeline(input.trajectoryPayload);
  const eventStream = toReplayEventStream(input.eventStreamPayload ?? null);
  const linkage = toReplayLinkage({
    trajectoryEvidenceDigests: input.trajectoryEvidenceDigests ?? timeline.evidenceDigests,
    runResultEvidenceDigests: input.runResultEvidenceDigests ?? [],
    evaluationRecords: input.evaluationRecords ?? [],
    verificationRecords: input.verificationRecords ?? [],
  });
  const inspection = selectReplayStep(
    timeline,
    input.requestedSequence === undefined ? null : input.requestedSequence,
  );
  const chainVerification: ReplayChainVerification =
    input.chainVerification ??
    Object.freeze({
      status: 'not-attempted',
      chainHead: timeline.chainHead,
      errorCode: null,
      detail: null,
    } satisfies ReplayChainVerification);
  const runRecord = toReplayRunRecordSummary(input.runRecordPayload ?? null);
  const runResult = toReplayRunResultSummary(input.runResultPayload ?? null);
  const slash = input.runId.indexOf('/');
  return Object.freeze({
    runId: input.runId,
    runKey: slash === -1 ? input.runId : input.runId.slice(slash + 1),
    timeline,
    eventStream,
    linkage,
    inspection,
    chainVerification,
    runRecord,
    runResult,
    observationalNote: REPLAY_OBSERVATIONAL_NOTE,
  } satisfies ReplayRunDetailModel);
}
