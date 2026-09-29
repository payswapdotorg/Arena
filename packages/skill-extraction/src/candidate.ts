/**
 * SkillCandidate + the pure mining core (Work Order A019; requirement
 * R17 — "Extract reusable Skills from validated trajectories";
 * architecture-lock rules 5, 6, 18; docs/architecture.md §3 — "A Skill
 * is a versioned artifact with inputs, outputs, prerequisites, evidence,
 * tests and provenance", §11 — learning never rewrites historical facts
 * or evidence).
 *
 * A SkillCandidate is a proposed skill mined from one or more VALIDATED
 * trajectories:
 *
 *   - `signature` — the mined pattern: the ordered action ids of the
 *     eligible entries plus the completion outcome. Deterministic: the
 *     same eligible content always yields the same signature;
 *   - `taxonomy` — the A004-shaped placement (the CapabilityNodeRef the
 *     skill is proposed under, from the policy);
 *   - `proposedSkill` — the proposed skill-node identity (id + version;
 *     the id is derived deterministically from the signature digest);
 *   - `inputs` / `outputs` — declared IO ports, mined deterministically
 *     from the signature (one input port per distinct action, one
 *     output port for the completion outcome);
 *   - `prerequisites` — descriptive prerequisite statements (explicitly
 *     EMPTY at mining time: relational prerequisites are `requires`
 *     edges in the capability graph, not mining outputs);
 *   - `evidence` — the evidence set: the source trajectory digests plus
 *     the evaluation and verification record digests that validated
 *     them;
 *   - `provenance` — which extractor version, which policy digest,
 *     which correlation id, when extracted.
 *
 * Content-addressed and immutable: same content ⇒ same digest; any
 * change ⇒ a different digest. Frozen on creation — no mutation API.
 *
 * mineSkillCandidates is the PURE, DETERMINISTIC heart of extraction
 * (the A019 contract: same inputs + same policy ⇒ same candidates):
 *   1. per-trajectory validation gate (policy.validation) — the
 *      verification outcome/count, evaluation presence and evaluation
 *      judgment gates; rejected trajectories are recorded with a
 *      closed-vocabulary reason and NEVER mined;
 *   2. eligibility projection (policy.eligibility) — only the eligible
 *      entry kinds are read (house default: actions + completions;
 *      Arena does not require hidden chain-of-thought, and none exists
 *      by design — there is nothing else to read);
 *   3. signature grouping across trajectories + threshold gates
 *      (policy.thresholds) — a pattern becomes a candidate only when it
 *      spans enough distinct trajectories / occurrences;
 *   4. accepted patterns are packaged as content-addressed candidates
 *      whose evidence set is the union of the contributing validated
 *      refs.
 *
 * Extraction is READ-ONLY over its sources (lock rule 6): mining never
 * mutates a trajectory, evaluation or verification record.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { CorrelationId } from '@arena/protocol-core';
import type { CapabilityNodeRef } from '@arena/capability-graph';
import type {
  ActionEntryPayload,
  CompletionEntryPayload,
  TrajectoryEntry,
  TrajectoryOutcome,
} from '@arena/trajectory';
import { SKILL_EXTRACTION_ERROR_CODES, SkillExtractionError } from './errors.js';
import type { ExtractionPolicy, PolicyCompletionOutcome } from './policy.js';
import {
  deepFreeze,
  toContentDigest,
  toNeutralId,
  toSkillExtractionTimestamp,
  toSkillExtractionVersion,
} from './shared.js';
import type { ContentDigest, NeutralId, SkillExtractionTimestamp, SkillExtractionVersion } from './shared.js';
import type { ValidatedTrajectoryRef } from './validated-ref.js';

/** Wire version of the skill-candidate shape. */
export const SKILL_CANDIDATE_VERSION = 1 as const;

/**
 * Version of the reference extraction implementation (recorded into
 * every candidate's provenance — extraction accountability).
 */
export const EXTRACTION_IMPLEMENTATION_VERSION = '1.0.0' as const;

// ---------------------------------------------------------------------------
// Closed decision vocabulary (accept/reject with recorded reasons)
// ---------------------------------------------------------------------------

/** Why one trajectory was or was not mined (closed vocabulary). */
export const TRAJECTORY_DECISION_REASONS = Object.freeze([
  'accepted',
  'verification-outcome-not-met',
  'insufficient-verification-evidence',
  'missing-evaluation-evidence',
  'evaluation-outcome-not-met',
  'outcome-not-completed',
  'no-eligible-entries',
] as const);
export type TrajectoryDecisionReason = (typeof TRAJECTORY_DECISION_REASONS)[number];

/** Why one mined pattern did or did not become a candidate (closed vocabulary). */
export const PATTERN_DECISION_REASONS = Object.freeze([
  'accepted',
  'pattern-below-threshold',
] as const);
export type PatternDecisionReason = (typeof PATTERN_DECISION_REASONS)[number];

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

/** The mined pattern: ordered action ids + the completion outcome. */
export interface SkillPatternSignature {
  readonly actionIds: readonly NeutralId[];
  readonly outcome: TrajectoryOutcome;
}

/** Deterministic signature digest (sha256 over the canonical signature). */
export async function computeSignatureDigest(
  signature: SkillPatternSignature,
): Promise<ContentDigest> {
  return toContentDigest(
    await digestCanonical({
      actionIds: signature.actionIds.map((id) => id as string),
      outcome: signature.outcome,
    }),
    'skill pattern signature digest',
  );
}

/** Stable string key of a signature (map friendly, deterministic). */
export function signatureKey(signature: SkillPatternSignature): string {
  return `${(signature.actionIds as readonly string[]).join('|')}#${signature.outcome}`;
}

// ---------------------------------------------------------------------------
// IO ports (A004 SkillIOPort-shaped, mined deterministically)
// ---------------------------------------------------------------------------

/** One named input or output port of a skill (A004 SkillIOPort shape). */
export interface SkillIOPort {
  readonly name: string;
  readonly description: string;
}

/** Stable field list for a port (tests mirror it). */
export const SKILL_IO_PORT_FIELDS = Object.freeze(['name', 'description'] as const) as readonly string[];

function toSkillIOPort(value: unknown, index: number): SkillIOPort {
  if (typeof value !== 'object' || value === null) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_CANDIDATE, {
      message: `skill candidate io port ${String(index + 1)}: expected a plain object`,
    });
  }
  const record = value as Record<string, unknown>;
  const name = record['name'];
  const description = record['description'];
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_CANDIDATE, {
      message: `skill candidate io port ${String(index + 1)}: invalid port name ${JSON.stringify(name)} (A004 skill-io-port pattern: ^[a-z][a-z0-9-]{0,63}$)`,
    });
  }
  if (typeof description !== 'string' || description.length === 0 || description.length > 4096) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_CANDIDATE, {
      message: `skill candidate io port ${String(index + 1)}: description must be a non-empty string of at most 4096 characters`,
    });
  }
  return deepFreeze({ name, description });
}

// ---------------------------------------------------------------------------
// SkillCandidate
// ---------------------------------------------------------------------------

/** The evidence set behind a candidate (all digests, deduped + sorted). */
export interface CandidateEvidenceSet {
  /** Source trajectory digests (A011 chain heads). */
  readonly trajectories: readonly ContentDigest[];
  /** Evaluation record digests (A012). */
  readonly evaluations: readonly ContentDigest[];
  /** Verification record digests (A013). */
  readonly verifications: readonly ContentDigest[];
}

/** Extraction provenance (which extractor, which policy, which run). */
export interface ExtractionProvenance {
  readonly extractorVersion: SkillExtractionVersion;
  readonly policyDigest: ContentDigest;
  readonly correlationId: CorrelationId;
  readonly extractedAt: SkillExtractionTimestamp;
}

/** The digest-free view — exactly what the candidate digest commits to. */
export interface SkillCandidateView {
  readonly recordVersion: typeof SKILL_CANDIDATE_VERSION;
  /** Deterministic candidate id: `skill-` + first 16 hex of the signature digest. */
  readonly candidateId: NeutralId;
  readonly signature: SkillPatternSignature;
  /** The A004 taxonomy node the skill is proposed under (policy target). */
  readonly taxonomy: { readonly targetNode: CapabilityNodeRef };
  /** The proposed skill-node identity (A004 id + version). */
  readonly proposedSkill: { readonly id: NeutralId; readonly version: SkillExtractionVersion };
  readonly inputs: readonly SkillIOPort[];
  readonly outputs: readonly SkillIOPort[];
  readonly prerequisites: readonly string[];
  readonly evidence: CandidateEvidenceSet;
  readonly provenance: ExtractionProvenance;
}

/** A frozen, content-addressed skill candidate: the view plus its sha256 digest. */
export interface SkillCandidate extends SkillCandidateView {
  readonly digest: ContentDigest;
}

/** Stable field list for the candidate view (tests mirror it). */
export const SKILL_CANDIDATE_FIELDS = Object.freeze([
  'recordVersion',
  'candidateId',
  'signature',
  'taxonomy',
  'proposedSkill',
  'inputs',
  'outputs',
  'prerequisites',
  'evidence',
  'provenance',
] as const) as readonly string[];

function isPortList(value: unknown): value is readonly SkillIOPort[] {
  return (
    Array.isArray(value) &&
    value.every(
      (port) =>
        typeof port === 'object' &&
        port !== null &&
        typeof (port as Record<string, unknown>)['name'] === 'string' &&
        /^[a-z][a-z0-9-]{0,63}$/.test(String((port as Record<string, unknown>)['name'])) &&
        typeof (port as Record<string, unknown>)['description'] === 'string',
    )
  );
}

function isDigestList(value: unknown): value is readonly ContentDigest[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && /^[0-9a-f]{64}$/.test(entry))
  );
}

/** Structural (non-throwing) check for the digest-free candidate view. */
export function isSkillCandidateView(value: unknown): value is SkillCandidateView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== SKILL_CANDIDATE_VERSION) return false;
  if (typeof candidate['candidateId'] !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(candidate['candidateId'])) {
    return false;
  }
  const signature = candidate['signature'];
  if (typeof signature !== 'object' || signature === null) return false;
  const sig = signature as Record<string, unknown>;
  if (
    !Array.isArray(sig['actionIds']) ||
    !sig['actionIds'].every((id) => typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id)) ||
    typeof sig['outcome'] !== 'string' ||
    !['completed', 'failed', 'timed-out'].includes(sig['outcome'])
  ) {
    return false;
  }
  const taxonomy = candidate['taxonomy'];
  if (typeof taxonomy !== 'object' || taxonomy === null) return false;
  const targetNode = (taxonomy as Record<string, unknown>)['targetNode'];
  if (
    typeof targetNode !== 'object' ||
    targetNode === null ||
    typeof (targetNode as Record<string, unknown>)['kind'] !== 'string' ||
    typeof (targetNode as Record<string, unknown>)['id'] !== 'string' ||
    typeof (targetNode as Record<string, unknown>)['version'] !== 'string' ||
    typeof (targetNode as Record<string, unknown>)['digest'] !== 'string' ||
    !/^[0-9a-f]{64}$/.test(String((targetNode as Record<string, unknown>)['digest']))
  ) {
    return false;
  }
  const proposedSkill = candidate['proposedSkill'];
  if (typeof proposedSkill !== 'object' || proposedSkill === null) return false;
  const proposal = proposedSkill as Record<string, unknown>;
  if (
    typeof proposal['id'] !== 'string' ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(proposal['id']) ||
    typeof proposal['version'] !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(proposal['version'])
  ) {
    return false;
  }
  if (!isPortList(candidate['inputs']) || !isPortList(candidate['outputs'])) return false;
  if (
    !Array.isArray(candidate['prerequisites']) ||
    !candidate['prerequisites'].every((entry) => typeof entry === 'string' && entry.length > 0)
  ) {
    return false;
  }
  const evidence = candidate['evidence'];
  if (typeof evidence !== 'object' || evidence === null) return false;
  const ev = evidence as Record<string, unknown>;
  if (!isDigestList(ev['trajectories']) || !isDigestList(ev['evaluations']) || !isDigestList(ev['verifications'])) {
    return false;
  }
  const provenance = candidate['provenance'];
  if (typeof provenance !== 'object' || provenance === null) return false;
  const prov = provenance as Record<string, unknown>;
  return (
    typeof prov['extractorVersion'] === 'string' &&
    typeof prov['policyDigest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(String(prov['policyDigest'])) &&
    typeof prov['correlationId'] === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(prov['correlationId'])) &&
    typeof prov['extractedAt'] === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(prov['extractedAt']))
  );
}

/** Structural (non-throwing) check for the full candidate (view + digest). */
export function isSkillCandidate(value: unknown): value is SkillCandidate {
  if (!isSkillCandidateView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate['digest'] === 'string' && /^[0-9a-f]{64}$/.test(candidate['digest']);
}

/** Deterministic candidate id from a signature digest: `skill-` + 16 hex. */
export function candidateIdFromSignature(signature: SkillPatternSignature): Promise<NeutralId> {
  return computeSignatureDigest(signature).then((digest) =>
    toNeutralId(`skill-${(digest as string).slice(0, 16)}`, 'candidate id'),
  );
}

/** Deterministic title for a mined skill (≤ 256 chars). */
export function candidateTitle(signature: SkillPatternSignature): string {
  const ids = signature.actionIds as readonly string[];
  const head = ids.slice(0, 6).join(', ');
  const suffix = ids.length > 6 ? `, … +${String(ids.length - 6)} more` : '';
  return `Mined skill: [${head}${suffix}] → ${signature.outcome}`.slice(0, 256);
}

/** Deterministic summary for a mined skill (≤ 2048 chars). */
export function candidateSummary(
  signature: SkillPatternSignature,
  evidence: CandidateEvidenceSet,
  provenance: ExtractionProvenance,
): string {
  const text =
    `Deterministically extracted from ${String(evidence.trajectories.length)} validated ` +
    `trajectory(ies) whose eligible actions form the signature [${(signature.actionIds as readonly string[]).join(', ')}] ` +
    `with completion outcome '${signature.outcome}'; validated by ${String(evidence.evaluations.length)} ` +
    `evaluation record(s) and ${String(evidence.verifications.length)} verification record(s); ` +
    `mined by extractor ${provenance.extractorVersion} under policy digest ${provenance.policyDigest}.`;
  return text.slice(0, 2048);
}

/** Deterministic IO-port derivation from a signature. */
export function portsFromSignature(signature: SkillPatternSignature): {
  readonly inputs: readonly SkillIOPort[];
  readonly outputs: readonly SkillIOPort[];
} {
  const seen = new Set<string>();
  const inputs: SkillIOPort[] = [];
  for (const actionId of signature.actionIds) {
    const name = actionId as string;
    if (seen.has(name)) continue;
    seen.add(name);
    inputs.push(deepFreeze({ name, description: `action input: ${name}` }));
  }
  const outputs: SkillIOPort[] = [
    deepFreeze({
      name: 'completion-outcome',
      description: `terminal completion outcome: ${signature.outcome}`,
    }),
  ];
  return { inputs: Object.freeze(inputs), outputs: Object.freeze(outputs) };
}

/**
 * Create a validated, deep-frozen, content-addressed SkillCandidate.
 * Same content ⇒ same digest; any change ⇒ a different digest.
 */
export async function createSkillCandidate(
  view: SkillCandidateView,
): Promise<SkillCandidate> {
  if (!isSkillCandidateView(view)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_CANDIDATE, {
      message: 'skill candidate creation requires a structurally valid candidate view',
    });
  }
  // Deep-validate the pieces the structural guard cannot express.
  for (const [index, port] of view.inputs.entries()) {
    toSkillIOPort(port, index);
  }
  for (const [index, port] of view.outputs.entries()) {
    toSkillIOPort(port, index);
  }
  toContentDigest(view.provenance.policyDigest as string, 'candidate provenance policyDigest');
  toSkillExtractionVersion(view.provenance.extractorVersion as string, 'candidate extractorVersion');
  toSkillExtractionTimestamp(view.provenance.extractedAt as string, 'candidate extractedAt');
  const digest = await digestCandidateView(view);
  return deepFreeze({ ...view, digest }) as SkillCandidate;
}

/** The candidate digest: sha256 over the canonical digest-free view. */
export async function digestCandidateView(view: SkillCandidateView): Promise<ContentDigest> {
  return toContentDigest(
    await digestCanonical({
      recordVersion: view.recordVersion,
      candidateId: view.candidateId,
      signature: {
        actionIds: view.signature.actionIds.map((id) => id as string),
        outcome: view.signature.outcome,
      },
      taxonomy: { targetNode: view.taxonomy.targetNode },
      proposedSkill: {
        id: view.proposedSkill.id,
        version: view.proposedSkill.version,
      },
      inputs: view.inputs.map((port) => ({ name: port.name, description: port.description })),
      outputs: view.outputs.map((port) => ({ name: port.name, description: port.description })),
      prerequisites: [...view.prerequisites],
      evidence: {
        trajectories: view.evidence.trajectories.map((d) => d as string),
        evaluations: view.evidence.evaluations.map((d) => d as string),
        verifications: view.evidence.verifications.map((d) => d as string),
      },
      provenance: { ...view.provenance },
    }),
    'skill candidate digest',
  );
}

/** The digest-free view of a candidate (what the digest commits to). */
export function skillCandidateView(candidate: SkillCandidate): SkillCandidateView {
  const { digest: _digest, ...view } = candidate;
  return deepFreeze({ ...view }) as SkillCandidateView;
}

// ---------------------------------------------------------------------------
// Mining decisions
// ---------------------------------------------------------------------------

/** The recorded decision for one validated trajectory ref. */
export interface TrajectoryDecision {
  readonly trajectoryRef: string;
  readonly accepted: boolean;
  readonly reason: TrajectoryDecisionReason;
  /** The mined signature key, when accepted. */
  readonly signature: string | null;
}

/** The recorded decision for one mined pattern. */
export interface PatternDecision {
  readonly signature: string;
  readonly occurrences: number;
  readonly distinctTrajectories: number;
  readonly accepted: boolean;
  readonly reason: PatternDecisionReason;
  /** The accepted candidate's digest, when accepted. */
  readonly candidateDigest: string | null;
}

/** The pure mining result: candidates + every recorded decision. */
export interface MiningResult {
  readonly candidates: readonly SkillCandidate[];
  readonly trajectoryDecisions: readonly TrajectoryDecision[];
  readonly patternDecisions: readonly PatternDecision[];
}

/** The mining context (run-level provenance inputs — deterministic). */
export interface MiningContext {
  readonly correlationId: CorrelationId;
  readonly extractedAt: string;
  /** The base version proposed for mined skill nodes (default '1.0.0'). */
  readonly skillVersion?: string;
}

// ---------------------------------------------------------------------------
// The pure mining core
// ---------------------------------------------------------------------------

interface Occurrence {
  readonly refDigest: string;
  readonly trajectoryDigest: string;
  readonly evaluationDigests: readonly string[];
  readonly verificationDigests: readonly string[];
}

function completionOutcomeOf(entries: readonly TrajectoryEntry[]): TrajectoryOutcome | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry !== undefined && entry.kind === 'completion') {
      return (entry.payload as CompletionEntryPayload).outcome;
    }
  }
  return null;
}

/** Union + sort a digest list deterministically (dedup by content). */
function unionSorted(lists: readonly (readonly string[])[]): readonly ContentDigest[] {
  const set = new Set<string>();
  for (const list of lists) {
    for (const entry of list) set.add(entry);
  }
  return Object.freeze([...set].sort().map((digest) => digest as ContentDigest));
}

/**
 * Run an ExtractionPolicy over a set of ValidatedTrajectoryRefs — the
 * PURE, DETERMINISTIC mining core (same refs + same policy + same
 * context ⇒ byte-identical candidates, decisions and digests).
 *
 * The function is READ-ONLY over every input record (lock rule 6).
 */
export async function mineSkillCandidates(
  refs: readonly ValidatedTrajectoryRef[],
  policy: ExtractionPolicy,
  context: MiningContext,
): Promise<MiningResult> {
  const skillVersion = context.skillVersion === undefined ? '1.0.0' : context.skillVersion;
  toSkillExtractionVersion(skillVersion, 'mining context skillVersion');

  const trajectoryDecisions: TrajectoryDecision[] = [];
  const occurrencesBySignature = new Map<string, { signature: SkillPatternSignature; occurrences: Occurrence[] }>();

  for (const ref of refs) {
    const decision = gateAndProject(ref, policy);
    if (!decision.accepted) {
      trajectoryDecisions.push({
        trajectoryRef: ref.trajectory.chainHead as string,
        accepted: false,
        reason: decision.reason,
        signature: null,
      });
      continue;
    }
    const key = signatureKey(decision.signature);
    const bucket = occurrencesBySignature.get(key);
    const occurrence: Occurrence = {
      refDigest: ref.digest as string,
      trajectoryDigest: ref.trajectory.chainHead as string,
      evaluationDigests: ref.evaluations.map((entry) => entry.digest as string),
      verificationDigests: ref.verifications.map((entry) => entry.digest as string),
    };
    if (bucket === undefined) {
      occurrencesBySignature.set(key, { signature: decision.signature, occurrences: [occurrence] });
    } else {
      bucket.occurrences.push(occurrence);
    }
    trajectoryDecisions.push({
      trajectoryRef: ref.trajectory.chainHead as string,
      accepted: true,
      reason: 'accepted',
      signature: key,
    });
  }

  const candidates: SkillCandidate[] = [];
  const patternDecisions: PatternDecision[] = [];
  const sortedKeys = [...occurrencesBySignature.keys()].sort();
  for (const key of sortedKeys) {
    const bucket = occurrencesBySignature.get(key);
    if (bucket === undefined) continue;
    const distinctTrajectories = new Set(
      bucket.occurrences.map((occurrence) => occurrence.trajectoryDigest),
    ).size;
    const totalOccurrences = bucket.occurrences.length;
    if (
      distinctTrajectories < policy.thresholds.minTrajectories ||
      totalOccurrences < policy.thresholds.minOccurrences
    ) {
      patternDecisions.push({
        signature: key,
        occurrences: totalOccurrences,
        distinctTrajectories,
        accepted: false,
        reason: 'pattern-below-threshold',
        candidateDigest: null,
      });
      continue;
    }
    const candidate = await packageCandidate(bucket.signature, bucket.occurrences, policy, context, skillVersion);
    candidates.push(candidate);
    patternDecisions.push({
      signature: key,
      occurrences: totalOccurrences,
      distinctTrajectories,
      accepted: true,
      reason: 'accepted',
      candidateDigest: candidate.digest as string,
    });
  }

  return deepFreeze({
    candidates: Object.freeze([...candidates].sort((a, b) => ((a.candidateId as string) < (b.candidateId as string) ? -1 : 1))),
    trajectoryDecisions: Object.freeze(trajectoryDecisions),
    patternDecisions: Object.freeze(patternDecisions),
  }) as MiningResult;
}

/** Gate one ref against the policy + project its eligible content. */
function gateAndProject(
  ref: ValidatedTrajectoryRef,
  policy: ExtractionPolicy,
): { accepted: true; signature: SkillPatternSignature } | { accepted: false; reason: TrajectoryDecisionReason } {
  const chainHead = ref.trajectory.chainHead as string;

  // 1. Validation gate (policy.validation) — the R17 'validated' bar.
  const requiredOutcome = policy.validation.requiredVerificationOutcome;
  const passingVerifications = ref.verifications.filter(
    (record) => record.outcome === requiredOutcome,
  ).length;
  if (passingVerifications === 0) {
    return {
      accepted: false,
      reason: 'verification-outcome-not-met',
    };
  }
  if (passingVerifications < policy.validation.minVerificationRecords) {
    return {
      accepted: false,
      reason: 'insufficient-verification-evidence',
    };
  }
  if (policy.validation.requireEvaluations && ref.evaluations.length === 0) {
    return { accepted: false, reason: 'missing-evaluation-evidence' };
  }
  const requiredEvaluationOutcome = policy.validation.requiredEvaluationOutcome;
  if (
    requiredEvaluationOutcome !== null &&
    !ref.evaluations.some((record) => record.aggregate.outcome === requiredEvaluationOutcome)
  ) {
    return { accepted: false, reason: 'evaluation-outcome-not-met' };
  }

  // 2. Eligibility projection (policy.eligibility).
  const outcome = completionOutcomeOf(ref.trajectory.entries);
  if (outcome === null) {
    // Defensive integrity tripwire: the ValidatedTrajectoryRef guard
    // rejects non-completed trajectories at construction, so reaching
    // this branch means the ref bypassed its own guard — fail loudly.
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.TRAJECTORY_NOT_COMPLETED, {
      message: `mining found trajectory ${ref.trajectory.header.trajectoryId} without a completion entry — the validated-ref guard was bypassed`,
      details: { trajectoryId: ref.trajectory.header.trajectoryId, chainHead },
    });
  }
  const requiredCompletion: PolicyCompletionOutcome | null = policy.eligibility.requireCompletedOutcome;
  if (requiredCompletion !== null && outcome !== requiredCompletion) {
    return { accepted: false, reason: 'outcome-not-completed' };
  }
  const eligibleKinds = new Set<string>(policy.eligibility.entryKinds as readonly string[]);
  // Cross-brand note: A011's ActionEntryPayload.actionId carries
  // @arena/trajectory's branded NeutralId. The value has been validated
  // against the SAME charset (the pattern sources are character-for-
  // character copies), so the cast below is exact — the brands differ
  // only by owning package, never by shape (mirrors @arena/trajectory's
  // run-ref.ts TaskVersionRef note).
  const actionIds: NeutralId[] = [];
  for (const entry of ref.trajectory.entries) {
    if (!eligibleKinds.has(entry.kind)) continue;
    if (entry.kind === 'action') {
      actionIds.push((entry.payload as ActionEntryPayload).actionId as unknown as NeutralId);
    }
  }
  if (actionIds.length === 0) {
    return { accepted: false, reason: 'no-eligible-entries' };
  }
  return { accepted: true, signature: { actionIds: Object.freeze(actionIds), outcome } };
}

/** Package one accepted pattern into a content-addressed candidate. */
async function packageCandidate(
  signature: SkillPatternSignature,
  occurrences: readonly Occurrence[],
  policy: ExtractionPolicy,
  context: MiningContext,
  skillVersion: string,
): Promise<SkillCandidate> {
  const candidateId = await candidateIdFromSignature(signature);
  const evidence: CandidateEvidenceSet = deepFreeze({
    trajectories: unionSorted(occurrences.map((o) => [o.trajectoryDigest])),
    evaluations: unionSorted(occurrences.map((o) => o.evaluationDigests)),
    verifications: unionSorted(occurrences.map((o) => o.verificationDigests)),
  });
  const provenance: ExtractionProvenance = deepFreeze({
    extractorVersion: EXTRACTION_IMPLEMENTATION_VERSION as SkillExtractionVersion,
    policyDigest: policy.digest as ContentDigest,
    correlationId: context.correlationId,
    extractedAt: toSkillExtractionTimestamp(context.extractedAt, 'mining context extractedAt'),
  });
  const ports = portsFromSignature(signature);
  const view: SkillCandidateView = deepFreeze({
    recordVersion: SKILL_CANDIDATE_VERSION,
    candidateId,
    signature,
    taxonomy: { targetNode: policy.taxonomy.targetNode },
    proposedSkill: { id: candidateId, version: skillVersion as SkillExtractionVersion },
    inputs: ports.inputs,
    outputs: ports.outputs,
    prerequisites: Object.freeze([]),
    evidence,
    provenance,
  });
  return createSkillCandidate(view);
}
