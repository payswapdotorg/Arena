/**
 * TaskCompilerFabric — the in-process reference ORCHESTRATOR over the
 * pure compiler and the append-only spec registry (Work Order A008;
 * requirements R6; architecture-lock rules 6, 17, 18; mirrors the
 * A007/A012/A013 reference fabrics structurally).
 *
 * Pure TypeScript, ZERO external runtime dependencies (only
 * @arena/task-spec + @arena/capability-case + @arena/protocol-core — the
 * REAL A008 protocol objects and the REAL A005 case/target constructors
 * are the substrate).
 *
 * `runCompilation` (a COMMAND, idempotency key REQUIRED — lock rule 17):
 *   1. idempotency replay — the same key + the same command tuple replays
 *      as a no-op returning the stored record; the same key + a different
 *      tuple is an IDEMPOTENCY_CONFLICT;
 *   2. resolve refs — the case by digest and the policy by identity
 *      triple (CASE_NOT_FOUND / POLICY_NOT_FOUND when absent — fail
 *      loudly, never partial compilation);
 *   3. eligibility — the LIVE case status must be in the policy's
 *      compilableStatuses (narrowing A005's own triaged|active gate);
 *   4. derive the A005 target (deriveCompilationTarget re-enforces
 *      triaged|active);
 *   5. run the PURE compiler (compileTarget — deterministic proposals);
 *   6. pin the proposals (append-only registry; content-dedup; supersede
 *      by append when a slot's content changed);
 *   7. append the CompilationRecord (idempotency-keyed, correlation-
 *      addressed) and emit compilation-recorded-event.
 *
 * THE CASE IS NEVER MUTATED: compilation reads the case and emits
 * proposals; the append-only case lifecycle is untouched (lock rule 6).
 */

import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { Envelope } from '@arena/protocol-core';
import {
  TASK_SPEC_ERROR_CODES,
  TaskSpecError,
  createCompilationRecord,
  makeCompilationRecordedEvent,
  recomputeCompilationPolicyDigest,
  compilationPolicyIdentityKey,
  verifyTaskSpec,
} from '@arena/task-spec';
import type {
  CompilationPolicy,
  CompilationRecord,
  CompilationRecordedEventPayload,
  TaskSpec,
} from '@arena/task-spec';
import {
  deriveCompilationTarget,
  verifyCapabilityCase,
} from '@arena/capability-case';
import type { CapabilityCase } from '@arena/capability-case';
import { compileTarget } from './compiler.js';
import { TaskSpecRegistry } from './registry.js';

/** Options for one fabric command run. */
export interface CommandOptions {
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

/** The run-compilation command tuple (all explicit — no clock reads). */
export interface RunCompilationCommand {
  readonly caseDigest: string;
  readonly policyRef: { policyId: string; version: string; digest: string };
  readonly derivedAt: string;
  readonly compiledAt: string;
}

/** The outcome of one compilation run. */
export interface CompilationRunResult {
  readonly record: CompilationRecord;
  readonly specs: readonly TaskSpec[];
  /** True when the idempotency key replayed a stored run. */
  readonly replayed: boolean;
}

interface IdempotencyBinding {
  readonly commandCanonical: string;
  readonly recordDigest: string;
}

function commandCanonicalOf(command: RunCompilationCommand): string {
  return JSON.stringify([
    command.caseDigest,
    command.policyRef.policyId,
    command.policyRef.version,
    command.policyRef.digest,
    command.derivedAt,
    command.compiledAt,
  ]);
}

/**
 * The in-process reference fabric: case pool + policy pool + pure compiler
 * + append-only spec registry + idempotent compilation records + event
 * log. Construct with `new TaskCompilerFabric()` (fresh pools).
 */
export class TaskCompilerFabric {
  readonly registry: TaskSpecRegistry;

  private readonly cases = new Map<string, CapabilityCase>();
  private readonly policies = new Map<string, CompilationPolicy>();
  private readonly policyIdentities = new Map<string, string>();
  private readonly records = new Map<string, CompilationRecord>();
  private readonly idempotency = new Map<string, IdempotencyBinding>();
  private readonly events: Envelope<CompilationRecordedEventPayload>[] = [];

  constructor(registry: TaskSpecRegistry = new TaskSpecRegistry()) {
    this.registry = registry;
  }

  // -------------------------------------------------------------------------
  // Registration (append-only pools)
  // -------------------------------------------------------------------------

  /** Register a verified case (digest-fail-closed; idempotent by digest). */
  async registerCase(caseRecord: CapabilityCase): Promise<CapabilityCase> {
    await verifyCapabilityCase(caseRecord);
    const existing = this.cases.get(caseRecord.digest);
    if (existing !== undefined) return existing;
    this.cases.set(caseRecord.digest, caseRecord);
    return caseRecord;
  }

  /**
   * Register a verified compilation policy. The same (policyId, version)
   * with a DIFFERENT digest is an IDENTITY CONFLICT (changing the rules
   * requires a new policy version — never a silent improvement).
   */
  async registerPolicy(policy: CompilationPolicy): Promise<CompilationPolicy> {
    await recomputeCompilationPolicyDigest(policy);
    const identityKey = compilationPolicyIdentityKey(policy);
    const boundDigest = this.policyIdentities.get(identityKey);
    if (boundDigest !== undefined) {
      if (boundDigest !== policy.digest) {
        throw new TaskSpecError(TASK_SPEC_ERROR_CODES.IDENTITY_CONFLICT, {
          message: `policy identity conflict: ${identityKey} is already registered with digest ${boundDigest}, refusing ${policy.digest} (changing compilation rules requires a new policy version)`,
          details: { policyIdentity: identityKey, registered: boundDigest, attempted: policy.digest },
        });
      }
      return this.policies.get(boundDigest) as CompilationPolicy;
    }
    this.policyIdentities.set(identityKey, policy.digest);
    this.policies.set(policy.digest, policy);
    return policy;
  }

  // -------------------------------------------------------------------------
  // The command (idempotent, correlation-addressed — lock rule 17)
  // -------------------------------------------------------------------------

  /**
   * Run one compilation: eligibility → target derivation → pure compile →
   * pinning → record + event. Re-running the same idempotency key with the
   * same command tuple replays the stored result (no re-run, no new
   * record); the same key with a different tuple is a conflict.
   */
  async runCompilation(
    command: RunCompilationCommand,
    options: CommandOptions,
  ): Promise<CompilationRunResult> {
    const correlationId = toCorrelationId(options.correlationId);
    const idempotencyKey = toIdempotencyKey(options.idempotencyKey);

    const binding = this.idempotency.get(idempotencyKey);
    if (binding !== undefined) {
      if (binding.commandCanonical !== commandCanonicalOf(command)) {
        throw new TaskSpecError(TASK_SPEC_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency conflict: key ${JSON.stringify(idempotencyKey)} is already bound to a different compilation command`,
          details: { idempotencyKey },
        });
      }
      const record = this.records.get(idempotencyKey) as CompilationRecord;
      const specs = record.emittedSpecs
        .map((ref) => this.registry.get({ tenant: ref.tenant, taskId: ref.taskId }, ref.version))
        .filter((spec): spec is TaskSpec => spec !== null);
      return { record, specs, replayed: true };
    }

    // Resolve refs — fail loudly when absent.
    const caseRecord = this.cases.get(command.caseDigest);
    if (caseRecord === undefined) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.CASE_NOT_FOUND, {
        message: `case ${command.caseDigest} is not registered with this fabric`,
        details: { caseDigest: command.caseDigest },
      });
    }
    const policy = this.policies.get(command.policyRef.digest);
    if (policy === undefined) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.POLICY_NOT_FOUND, {
        message: `policy ${command.policyRef.policyId}@${command.policyRef.version} (${command.policyRef.digest}) is not registered with this fabric`,
        details: { policyRef: { ...command.policyRef } },
      });
    }

    // Eligibility: the LIVE case status under the policy's narrowable set.
    if (
      !policy.eligibility.compilableStatuses.includes(
        caseRecord.status as (typeof policy.eligibility.compilableStatuses)[number],
      )
    ) {
      throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_POLICY, {
        message: `case ${caseRecord.identity.caseId} is ${caseRecord.status} but policy ${policy.policyId}@${policy.version} compiles only [${policy.eligibility.compilableStatuses.join(', ')}]`,
        details: {
          caseStatus: caseRecord.status,
          compilableStatuses: [...policy.eligibility.compilableStatuses],
        },
      });
    }

    // Derive the A005 target (re-enforces triaged|active inside A005).
    const target = await deriveCompilationTarget(caseRecord, {
      derivedAt: command.derivedAt,
    });

    // Pure compile → pin (append-only; content-dedup; supersede by append).
    const proposals = await compileTarget(target, policy);
    const pinned: TaskSpec[] = [];
    for (const proposal of proposals) {
      const outcome = await this.registry.pin(proposal);
      pinned.push(outcome.spec);
    }
    for (const spec of pinned) {
      await verifyTaskSpec(spec);
    }

    // Record + event (append-only).
    const record = await createCompilationRecord({
      compilationKey: idempotencyKey,
      correlationId,
      caseRef: {
        tenant: caseRecord.identity.tenant,
        caseId: caseRecord.identity.caseId,
        version: caseRecord.version,
        digest: caseRecord.digest,
      },
      targetDigest: target.digest,
      policyRef: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
      emittedSpecs: pinned.map((spec) => ({
        tenant: spec.identity.tenant,
        taskId: spec.identity.taskId,
        version: spec.version,
        digest: spec.digest,
      })),
      compiledAt: command.compiledAt,
    });
    this.records.set(idempotencyKey, record);
    this.idempotency.set(idempotencyKey, {
      commandCanonical: commandCanonicalOf(command),
      recordDigest: record.digest,
    });
    this.events.push(
      makeCompilationRecordedEvent(
        { record, specs: pinned },
        { correlationId },
      ),
    );
    return { record, specs: pinned, replayed: false };
  }

  // -------------------------------------------------------------------------
  // Queries (pure reads)
  // -------------------------------------------------------------------------

  /** The compilation record for one idempotency key, or null. */
  getRecord(idempotencyKey: string): CompilationRecord | null {
    return this.records.get(idempotencyKey) ?? null;
  }

  /** All compilation records, insertion-ordered. */
  listRecords(): readonly CompilationRecord[] {
    return [...this.records.values()];
  }

  /** The emitted event envelopes, insertion-ordered. */
  listEvents(): readonly Envelope<CompilationRecordedEventPayload>[] {
    return [...this.events];
  }

  /** The registered case for a digest, or null. */
  getCase(caseDigest: string): CapabilityCase | null {
    return this.cases.get(caseDigest) ?? null;
  }

  /** The registered policy for a digest, or null. */
  getPolicy(policyDigest: string): CompilationPolicy | null {
    return this.policies.get(policyDigest) ?? null;
  }
}
