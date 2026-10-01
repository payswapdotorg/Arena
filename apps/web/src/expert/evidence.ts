/**
 * Expert evidence submission (Work Order B009; issue #81; apps/web/src/expert).
 * SERVER-ONLY surface: the WRITE path of the expert workbench.
 *
 * Evidence submitted from the workbench is APPENDED through the B002
 * `ControlPlaneRepository` port (in-memory fake for the local/demo posture;
 * a hosted adapter replaces the implementation through the SAME port in the
 * deployment work orders) — there is NO parallel store:
 *
 *   - append-only: submission is an idempotent INSERT under a deterministic
 *     sequence address; the B002 port's idempotency makes a replayed
 *     submission return the stored record (created: false) instead of
 *     duplicating, and a CONFLICTING insert under a used address throws
 *     PERSISTENCE_RECORD_EXISTS (typed, never silently overwritten);
 *   - provenance-shaped: the record carries who submitted it (the
 *     session-derived principal), what work it speaks to (case record id +
 *     task id from the canonical record), and the judgment itself; the
 *     repository's OWN clock stamps createdAt/updatedAt (carried verbatim,
 *     never recomputed by this surface — the demo posture is therefore
 *     deterministic under the frozen narrative clock);
 *   - typed: the closed judgment-verdict vocabulary lives here, and an
 *     expert judgment is an EXPERT-JUDG product truth — submitting evidence
 *     records expert judgment; it NEVER flips task/run state, evaluation,
 *     verification or certification (there is no update call anywhere in
 *     this module);
 *   - read-back THROUGH the canonical read path: the ledger is discovered
 *     by probing the sequential record ids through the B005 read boundary
 *     (read-canonical works for every control-plane record id), stopping
 *     fail-closed at the first typed RECORD_NOT_FOUND. The disclosed kind
 *     vocabulary (B005 READ_MODEL_KINDS) is CLOSED and owned by the read
 *     model — evidence records project through the generic canonical read
 *     shape instead of growing that vocabulary.
 */

import { isRecordId } from '../../../../packages/persistence/src/index.js';
import type {
  ControlPlaneInsertInput,
  ControlPlaneRecord,
  ControlPlaneRepository,
} from '../../../../packages/persistence/src/index.js';

/** The B002 insert payload's data field (canonical-JSON-safe value). */
type ControlPlaneInsertData = ControlPlaneInsertInput['data'];
import { isExpertReadNotFound } from './runtime.js';
import type { ExpertReadPort, ExpertSessionFacts } from './runtime.js';
import { canonicalEqual } from '../../../../packages/persistence/src/index.js';

/** The control-plane record kind of workbench evidence submissions. */
export const EXPERT_EVIDENCE_KIND = 'expert-evidence' as const;

/** The record schema version of workbench evidence submissions (owned by this writer). */
export const EXPERT_EVIDENCE_RECORD_VERSION = 1 as const;

/**
 * The closed verdict vocabulary of an expert judgment on work. These are
 * JUDGMENT terms: an endorsement is not a verification pass, an objection
 * is not a verification failure, and an observation asserts nothing — the
 * vocabulary deliberately shares no term with evaluation/verification.
 */
export const EXPERT_EVIDENCE_VERDICTS = Object.freeze([
  'endorsement',
  'objection',
  'observation',
] as const);

/** One verdict of the closed judgment vocabulary. */
export type ExpertEvidenceVerdict = (typeof EXPERT_EVIDENCE_VERDICTS)[number];

/** True iff the value is one of the closed verdicts. */
export function isExpertEvidenceVerdict(value: unknown): value is ExpertEvidenceVerdict {
  return (
    typeof value === 'string' &&
    (EXPERT_EVIDENCE_VERDICTS as readonly string[]).includes(value)
  );
}

/**
 * The bounded ledger depth this surface will probe per (case, task). The
 * probing is a read-per-address loop through the canonical read path; the
 * bound keeps it finite even against a hostile corpus (fail closed with a
 * typed EXPERT_EVIDENCE_LEDGER_OVERFLOW instead of an unbounded scan).
 */
export const EXPERT_EVIDENCE_MAX_LEDGER = 100 as const;

/** The typed error taxonomy of the evidence write path (fail closed). */
export const EXPERT_EVIDENCE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'EXPERT_EVIDENCE_INVALID_INPUT',
  CASE_NOT_FOUND: 'EXPERT_EVIDENCE_CASE_NOT_FOUND',
  TASK_NOT_FOUND: 'EXPERT_EVIDENCE_TASK_NOT_FOUND',
  NOT_ASSIGNED: 'EXPERT_EVIDENCE_NOT_ASSIGNED',
  LEDGER_OVERFLOW: 'EXPERT_EVIDENCE_LEDGER_OVERFLOW',
  RECORD_ID_INVALID: 'EXPERT_EVIDENCE_RECORD_ID_INVALID',
  WRITE_FAILED: 'EXPERT_EVIDENCE_WRITE_FAILED',
} as const);

export type ExpertEvidenceErrorCode =
  (typeof EXPERT_EVIDENCE_ERROR_CODES)[keyof typeof EXPERT_EVIDENCE_ERROR_CODES];

/** Fail-closed typed error of the evidence write path. */
export class ExpertEvidenceError extends Error {
  readonly code: ExpertEvidenceErrorCode;
  constructor(code: ExpertEvidenceErrorCode, message: string) {
    super(message);
    this.name = 'ExpertEvidenceError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Deterministic ledger addressing (append-only, sequence-addressed)
// ---------------------------------------------------------------------------

/** Render one sequence number as the 4-digit zero-padded address segment. */
function sequenceSegment(sequence: number): string {
  return String(sequence).padStart(4, '0');
}

/**
 * The deterministic record id of the Nth (1-based) evidence submission for
 * one task of one case: `expert-evidence.<caseRecordId>.<taskId>.<NNNN>`.
 * The address is derived ONLY from canonical inputs — the same submission
 * intent always addresses the same slot, so replayed submissions are
 * idempotent and the ledger is enumerable by probing.
 */
export function expertEvidenceRecordId(
  caseRecordId: string,
  taskId: string,
  sequence: number,
): string {
  const id = `expert-evidence.${caseRecordId}.${taskId}.${sequenceSegment(sequence)}`;
  const candidate: unknown = id;
  if (!isRecordId(candidate)) {
    throw new ExpertEvidenceError(
      EXPERT_EVIDENCE_ERROR_CODES.RECORD_ID_INVALID,
      `the composed evidence record id does not fit the bounded control-plane charset/length (128): ${id.slice(0, 160)}`,
    );
  }
  return id;
}

// ---------------------------------------------------------------------------
// The judgment payload (provenance-shaped, JSON-safe, clock-free)
// ---------------------------------------------------------------------------

/** One submitted expert judgment as carried by the evidence record data. */
export interface ExpertEvidenceJudgment {
  /** The canonical product-truth kind this record asserts (always expert-judgment). */
  readonly stateKind: 'expert-judgment';
  /** The closed verdict vocabulary term the expert chose. */
  readonly verdict: ExpertEvidenceVerdict;
  /** The expert's notes (free text, bounded). */
  readonly summary: string;
  /** What the judgment is grounded in, as the expert stated it. */
  readonly basis: string;
}

/** The provenance block of one evidence record (who/what it speaks to). */
export interface ExpertEvidenceProvenance {
  /** The canonical case record the work belongs to. */
  readonly caseRecordId: string;
  /** The task inside that case record the work speaks to. */
  readonly taskId: string;
  /** The session-derived principal who submitted the judgment. */
  readonly submittedBy: string;
  /** The workspace the submission was made in (tenant from the session). */
  readonly tenantId: string;
}

/** The full data payload of one evidence record. */
export interface ExpertEvidenceData extends ExpertEvidenceProvenance {
  readonly recordVersion: typeof EXPERT_EVIDENCE_RECORD_VERSION;
  readonly kind: typeof EXPERT_EVIDENCE_KIND;
  readonly judgment: ExpertEvidenceJudgment;
}

/** The closed summary-length bound (honest input bound, never a silent truncation). */
export const EXPERT_EVIDENCE_SUMMARY_MAX = 2000 as const;

function requireVerdict(value: unknown): ExpertEvidenceVerdict {
  if (!isExpertEvidenceVerdict(value)) {
    throw new ExpertEvidenceError(
      EXPERT_EVIDENCE_ERROR_CODES.INVALID_INPUT,
      `the judgment verdict must be one of the closed vocabulary (${EXPERT_EVIDENCE_VERDICTS.join(' | ')}), got ${JSON.stringify(String(value))}`,
    );
  }
  return value;
}

function requireSummary(value: unknown, field: 'summary' | 'basis'): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) {
    throw new ExpertEvidenceError(
      EXPERT_EVIDENCE_ERROR_CODES.INVALID_INPUT,
      `the judgment ${field} is required (an evidence record never carries a fabricated judgment)`,
    );
  }
  if (text.length > EXPERT_EVIDENCE_SUMMARY_MAX) {
    throw new ExpertEvidenceError(
      EXPERT_EVIDENCE_ERROR_CODES.INVALID_INPUT,
      `the judgment ${field} exceeds the ${String(EXPERT_EVIDENCE_SUMMARY_MAX)}-character bound`,
    );
  }
  return text;
}

// ---------------------------------------------------------------------------
// The submission write (INSERT ONLY — never an update, never a state flip)
// ---------------------------------------------------------------------------

/** The intent of one evidence submission. */
export interface SubmitExpertEvidenceInput {
  /** The canonical case record id the work belongs to. */
  readonly caseRecordId: string;
  /** The task inside that case record the work speaks to. */
  readonly taskId: string;
  /** The closed-vocabulary verdict of the judgment. */
  readonly verdict: ExpertEvidenceVerdict;
  /** The expert's notes. */
  readonly summary: string;
  /** What the judgment is grounded in. */
  readonly basis: string;
}

/** The outcome of one evidence submission. */
export interface SubmitExpertEvidenceResult {
  /** The stored record (as the B002 repository returned it — frozen, provenance intact). */
  readonly record: ControlPlaneRecord;
  /** True iff THIS call created the record (false on an idempotent replay). */
  readonly created: boolean;
  /** The 1-based sequence address the judgment landed at. */
  readonly sequence: number;
}

export interface SubmitExpertEvidenceDeps {
  /** The B002 repository port — the canonical write path (injected). */
  readonly repository: ControlPlaneRepository;
  /** The B005 read port — the canonical read path used to verify the work exists. */
  readonly port: ExpertReadPort;
  /** The validated session facts (tenant + principal from the session, never the client). */
  readonly facts: ExpertSessionFacts;
}

function asRecord(data: unknown): Readonly<Record<string, unknown>> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Readonly<Record<string, unknown>>)
    : {};
}

/**
 * Verify the addressed work exists in a canonical case record, and that the
 * session's expert is the one the record assigns it to (assignment identity
 * is carried by the record — a task assigned to ANOTHER expert is not this
 * expert's to submit judgment on; a task with no named assignee is open to
 * the expert lens). This is assignment honesty, NOT authorization: role and
 * permission enforcement stays server-side and policy-driven elsewhere.
 */
async function requireAddressableWork(
  deps: SubmitExpertEvidenceDeps,
  caseRecordId: string,
  taskId: string,
): Promise<void> {
  let read;
  try {
    read = await deps.port.read(caseRecordId);
  } catch (error) {
    if (isExpertReadNotFound(error)) {
      throw new ExpertEvidenceError(
        EXPERT_EVIDENCE_ERROR_CODES.CASE_NOT_FOUND,
        `no canonical case record ${JSON.stringify(caseRecordId)} exists in this workspace`,
      );
    }
    throw error;
  }
  const tasks = asRecord(read.data)['tasks'];
  if (!Array.isArray(tasks)) {
    throw new ExpertEvidenceError(
      EXPERT_EVIDENCE_ERROR_CODES.TASK_NOT_FOUND,
      `the canonical case record ${JSON.stringify(caseRecordId)} carries no task list`,
    );
  }
  for (const entry of tasks) {
    const task = asRecord(entry);
    if (task['taskId'] !== taskId) continue;
    const assigned = task['assignedExpertId'];
    if (
      typeof assigned === 'string' &&
      assigned.length > 0 &&
      assigned !== deps.facts.principalId
    ) {
      throw new ExpertEvidenceError(
        EXPERT_EVIDENCE_ERROR_CODES.NOT_ASSIGNED,
        `task ${JSON.stringify(taskId)} is assigned by the record to ${JSON.stringify(assigned)}, not to this principal (assignment identity is carried by the record)`,
      );
    }
    return;
  }
  throw new ExpertEvidenceError(
    EXPERT_EVIDENCE_ERROR_CODES.TASK_NOT_FOUND,
    `task ${JSON.stringify(taskId)} is not carried by the canonical case record ${JSON.stringify(caseRecordId)}`,
  );
}

/**
 * Append one expert judgment to the evidence ledger of a task, through the
 * B002 repository port. APPEND-ONLY by construction:
 *   - the next sequence address is derived from the ledger's current tail
 *     (probed through the canonical read path), so a replayed submission
 *     lands on the SAME address and the port's idempotent insert returns
 *     the stored record (created: false);
 *   - a conflicting payload under a used address fails with the port's
 *     typed PERSISTENCE_RECORD_EXISTS — never an overwrite;
 *   - this module NEVER calls update/delete and NEVER writes the case
 *     record: task/run/evaluation/verification state cannot move because
 *     of an evidence submission. Evidence records judgment; it does not
 *     flip verification.
 */
export async function submitExpertEvidence(
  deps: SubmitExpertEvidenceDeps,
  input: SubmitExpertEvidenceInput,
): Promise<SubmitExpertEvidenceResult> {
  const verdict = requireVerdict(input.verdict);
  const summary = requireSummary(input.summary, 'summary');
  const basis = requireSummary(input.basis, 'basis');
  if (typeof input.caseRecordId !== 'string' || input.caseRecordId.length === 0) {
    throw new ExpertEvidenceError(
      EXPERT_EVIDENCE_ERROR_CODES.INVALID_INPUT,
      'evidence submission requires the canonical case record id',
    );
  }
  if (typeof input.taskId !== 'string' || input.taskId.length === 0) {
    throw new ExpertEvidenceError(
      EXPERT_EVIDENCE_ERROR_CODES.INVALID_INPUT,
      'evidence submission requires the task id',
    );
  }
  await requireAddressableWork(deps, input.caseRecordId, input.taskId);

  const data: ExpertEvidenceData = Object.freeze({
    recordVersion: EXPERT_EVIDENCE_RECORD_VERSION,
    kind: EXPERT_EVIDENCE_KIND,
    caseRecordId: input.caseRecordId,
    taskId: input.taskId,
    submittedBy: deps.facts.principalId,
    tenantId: deps.facts.tenantId,
    judgment: Object.freeze({
      stateKind: 'expert-judgment',
      verdict,
      summary,
      basis,
    }),
  });

  // Walk the ledger through the canonical read path (fail-closed stop at
  // the first not-found address; the bound keeps the loop finite). A slot
  // that already carries the IDENTICAL judgment makes this submission a
  // REPLAY: it returns the stored record (created: false) — the same
  // idempotency the B002 port itself gives an identical insert. A slot
  // carrying a DIFFERENT judgment is history: the walk advances past it.
  let sequence = 0;
  while (sequence < EXPERT_EVIDENCE_MAX_LEDGER) {
    const candidateId = expertEvidenceRecordId(input.caseRecordId, input.taskId, sequence + 1);
    let existing: { readonly data: unknown } | undefined;
    try {
      existing = await deps.port.read(candidateId);
    } catch (error) {
      if (isExpertReadNotFound(error)) {
        break; // the ledger's tail: append here
      }
      throw error;
    }
    if (canonicalEqual(existing.data, data)) {
      // Idempotent replay: the identical judgment is already recorded at
      // this address — return it, append nothing.
      const stored = await deps.repository.get(candidateId);
      if (stored === null) {
        throw new ExpertEvidenceError(
          EXPERT_EVIDENCE_ERROR_CODES.WRITE_FAILED,
          `the ledger slot ${JSON.stringify(candidateId)} read back through the read path but is absent from the repository (fail closed)`,
        );
      }
      return Object.freeze({ record: stored, created: false, sequence: sequence + 1 });
    }
    sequence += 1;
  }
  if (sequence >= EXPERT_EVIDENCE_MAX_LEDGER) {
    throw new ExpertEvidenceError(
      EXPERT_EVIDENCE_ERROR_CODES.LEDGER_OVERFLOW,
      `the evidence ledger for task ${JSON.stringify(input.taskId)} of case ${JSON.stringify(input.caseRecordId)} is at the bounded depth ${String(EXPERT_EVIDENCE_MAX_LEDGER)} (fail closed)`,
    );
  }

  const recordId = expertEvidenceRecordId(input.caseRecordId, input.taskId, sequence + 1);
  try {
    const result = await deps.repository.insert({
      recordId,
      tenantId: deps.facts.tenantId,
      kind: EXPERT_EVIDENCE_KIND,
      version: EXPERT_EVIDENCE_RECORD_VERSION,
      // The frozen judgment payload is canonical-JSON-safe by construction
      // (strings + the closed verdict vocabulary); the cast is only the
      // interface-to-index-signature bridge the B002 input type needs.
      data: data as unknown as ControlPlaneInsertData,
    });
    return Object.freeze({
      record: result.record,
      created: result.created,
      sequence: sequence + 1,
    });
  } catch (error) {
    // Fail closed with a typed wrapper — a broken write path NEVER renders
    // as a success state.
    throw new ExpertEvidenceError(
      EXPERT_EVIDENCE_ERROR_CODES.WRITE_FAILED,
      `the evidence append through the control-plane repository failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The ledger read-back (THROUGH the canonical read path)
// ---------------------------------------------------------------------------

/** One evidence record as the workbench renders it (classified + provenance-carried). */
export interface ExpertEvidenceCard {
  readonly recordId: string;
  /** The 1-based sequence address in the task's ledger. */
  readonly sequence: number;
  readonly taskId: string;
  readonly caseRecordId: string;
  readonly verdict: ExpertEvidenceVerdict | undefined;
  readonly summary: string;
  readonly basis: string;
  readonly submittedBy: string;
  /** The record's stored provenance, carried verbatim (never recomputed). */
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sourceVersion: number;
  readonly sourceRevision: number;
  readonly demo: boolean;
}

function toEvidenceCard(read: { recordId: string; data: unknown; provenance: { createdAt: number; updatedAt: number }; sourceVersion: number; sourceRevision: number }, isDemo: boolean): ExpertEvidenceCard {
  const data = asRecord(read.data);
  const judgment = asRecord(data['judgment']);
  const sequenceMatch = /(\d{4})$/.exec(read.recordId);
  return Object.freeze({
    recordId: read.recordId,
    sequence: sequenceMatch !== null ? Number.parseInt(sequenceMatch[1] as string, 10) : 0,
    taskId: typeof data['taskId'] === 'string' ? data['taskId'] : '',
    caseRecordId: typeof data['caseRecordId'] === 'string' ? data['caseRecordId'] : '',
    verdict: isExpertEvidenceVerdict(judgment['verdict']) ? judgment['verdict'] : undefined,
    summary: typeof judgment['summary'] === 'string' ? judgment['summary'] : '',
    basis: typeof judgment['basis'] === 'string' ? judgment['basis'] : '',
    submittedBy: typeof data['submittedBy'] === 'string' ? data['submittedBy'] : '',
    createdAt: read.provenance.createdAt,
    updatedAt: read.provenance.updatedAt,
    sourceVersion: read.sourceVersion,
    sourceRevision: read.sourceRevision,
    demo: isDemo,
  });
}

/**
 * Read the evidence ledger of one task back THROUGH the canonical read
 * path: probe the deterministic sequence addresses (read-canonical works
 * for every control-plane record id) and stop at the first typed
 * RECORD_NOT_FOUND. Malformed ledger records (a non-numeric verdict, a
 * missing judgment) are still rendered — with the fields they truly carry
 * (verdict: undefined renders as unknown, never guessed) — because the
 * canonical record is the authority and history is append-only.
 */
export async function readExpertEvidenceLedger(
  port: ExpertReadPort,
  caseRecordId: string,
  taskId: string,
  options: { readonly isDemo?: boolean } = {},
): Promise<readonly ExpertEvidenceCard[]> {
  const cards: ExpertEvidenceCard[] = [];
  for (let sequence = 1; sequence <= EXPERT_EVIDENCE_MAX_LEDGER; sequence += 1) {
    const recordId = expertEvidenceRecordId(caseRecordId, taskId, sequence);
    let read;
    try {
      read = await port.read(recordId);
    } catch (error) {
      if (isExpertReadNotFound(error)) {
        break; // the fail-closed stop condition: the ledger's tail
      }
      throw error;
    }
    cards.push(toEvidenceCard(read, options.isDemo === true));
  }
  return Object.freeze(cards);
}
