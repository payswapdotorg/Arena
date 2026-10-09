/**
 * tests/runtime-host/support/acceptance.ts — the five P002 acceptance
 * proofs (spec/post-roadmap-production-work-items.md "## P002"), shared
 * by the embedded-real-Postgres suite and the live-Neon suite so BOTH
 * evidence classes prove the SAME claims through the SAME production
 * composition (deploy/runtime/src/composition.ts):
 *
 *   (a) a clean database migrates zero → latest;
 *   (b) the real adapter persists + reads back an accepted escalation;
 *   (c) a hard process restart resumes without loss or duplicated
 *       transition ("hard" = a NEW composition over the SAME durable
 *       store with NO graceful stop — process-death semantics);
 *   (d) retries return the deterministic RECORDED outcome;
 *   (e) cross-tenant access fails closed.
 *
 * The transcript records machine-readable proof lines (identifiers,
 * counts, states — never credentials, never connection strings, never
 * full record bodies: redaction at capture time, the P004 transcript
 * discipline).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ManualClock } from '@arena/persistence';
import type { Clock } from '@arena/persistence';
import { verifyAuditChain } from '@arena/job-protocol';
import type { AuditRecord } from '@arena/job-protocol';
import type { RuntimeHostService } from '@arena/runtime-host-service';
import type { SqlTransport } from '@arena/hosted-neon-postgres';
import { composeRuntimeHost } from '@arena/runtime-host-composition';
import { referenceCreateInput } from '@arena/runtime-host-service/test-support';

const T0 = Date.parse('2026-10-07T10:00:00.000Z');
const ACTOR = Object.freeze({
  type: 'service',
  tenant: 'arena',
  principalId: 'runtime-host-battery',
});

export interface AcceptanceRunOptions {
  /** The evidence label ('embedded-postgres' | 'live-neon' | ...). */
  readonly label: string;
  /** The REAL database transport (embedded Postgres or live Neon). */
  readonly transport: SqlTransport;
  /** The clock (ManualClock default — deterministic restart timelines). */
  readonly clock?: Clock;
  /**
   * The migration assertion mode: 'fresh' requires the database to be
   * clean (the canonical evidence run); 'either' accepts an
   * already-migrated database (the DATABASE_URL fallback path).
   */
  readonly migrationMode?: 'fresh' | 'either';
  /** Transcript sink (evidence capture; disabled when undefined). */
  readonly transcript?: string[];
}

export interface AcceptanceVerdict {
  readonly label: string;
  readonly migrationsApplied: readonly { version: number; name: string }[];
  readonly restartRecovery: {
    nonTerminalJobs: number;
    reclaimedLeases: number;
    terminalJobsUntouched: number;
  };
  readonly escalationReadBack: boolean;
  readonly replayDeterministic: boolean;
  readonly crossTenantFailClosed: boolean;
  readonly auditChainLength: number;
  /** The digest linkage verified over the WHOLE chain (pre + post restart). */
  readonly auditChainVerified: boolean;
}

/** Compose the production host over the given transport. */
function compose(transport: SqlTransport, clock: Clock): Promise<RuntimeHostService> {
  // Default routing composition (the REAL EscalationRoutingService —
  // R-007): with no qualified experts configured every escalation
  // settles `matching`, the honest no-match posture.
  return composeRuntimeHost({ transport, clock });
}

/**
 * Run the five acceptance proofs and return the machine-readable
 * verdict (each field is itself an assertion the suites check).
 */
export async function runAcceptanceProofs(
  options: AcceptanceRunOptions,
): Promise<AcceptanceVerdict> {
  const clock = options.clock ?? new ManualClock(T0);
  const t = options.transcript ?? [];
  const migrationMode = options.migrationMode ?? 'fresh';
  const line = (text: string) => {
    t.push(text);
  };
  line(`# P002 acceptance proofs — ${options.label}`);
  line(`- clock: ManualClock pinned at ${new Date(T0).toISOString()} (A015 injected time)`);

  // -- (a) clean database migrates zero → latest --------------------------
  const hostA = await compose(options.transport, clock);
  const startA = await hostA.start();
  line(
    `- (a) start #1 applied migrations: ${JSON.stringify(startA.migrationsApplied.map((m) => m.version))}`,
  );
  if (migrationMode === 'fresh') {
    if (startA.migrationsApplied.length !== 6) {
      throw new Error(
        `expected a clean database to migrate 6 versions, got ${String(startA.migrationsApplied.length)}`,
      );
    }
  } else if (startA.migrationsApplied.length !== 0 && startA.migrationsApplied.length !== 6) {
    throw new Error(
      `expected 0 (already migrated) or 6 (fresh) applied migrations, got ${String(startA.migrationsApplied.length)}`,
    );
  }

  // -- (b) persist + read back an accepted escalation ---------------------
  const create = await hostA.escalations.create('tenant-alpha', input());
  if (create.outcome !== 'created' || create.duplicate !== false) {
    throw new Error(`expected a created escalation, got ${JSON.stringify(create.outcome)}`);
  }
  const status = await hostA.escalations.status('tenant-alpha', create.requestId);
  const escalationReadBack =
    status.record.request.requestId === create.requestId &&
    status.record.state === create.record.state &&
    status.lens === 'customer';
  if (!escalationReadBack) {
    throw new Error('escalation did not round-trip through the durable store');
  }
  const lens = await hostA.lensOf(create.requestId);
  line(
    `- (b) escalation persisted + read back: requestId=${redactId(create.requestId)} state=${status.record.state} lens=${String(lens)}`,
  );

  // A durable job mid-flight (claim + lease, no completion) — the
  // hard-restart setup for (c).
  const submitted = await hostA.jobs.submitByKind({
    kindName: 'escalation-recompute',
    input: {},
    correlationId: 'corr-restart-battery' as never,
    idempotencyKey: 'idem-restart-battery' as never,
    actor: ACTOR,
  });
  const claimed = await hostA.claimWithLease({ jobId: submitted.jobId, actor: ACTOR });
  if (claimed.status !== 'running') {
    throw new Error(`expected the claimed job to be running, got ${JSON.stringify(claimed.status)}`);
  }
  const eventsBeforeRestart = claimed.events.length;
  const historyBeforeRestart = status.record.history.length;
  const auditBeforeRestart = (await hostA.auditRecords()).length;
  // (no stop() — the process DIES here)

  // -- (c) hard process restart resumes ------------------------------------
  (clock as ManualClock).advance(120_000); // beyond lease + attempt timeout
  const hostB = await compose(options.transport, clock);
  const startB = await hostB.start();
  line(
    `- (c) restart: migrationsApplied=${JSON.stringify(startB.migrationsApplied.map((m) => m.version))} recovery=${JSON.stringify(startB.recovery)}`,
  );
  const after = await hostB.jobs.get(submitted.jobId);
  if (after === undefined) {
    throw new Error('the durable job was lost across the hard restart');
  }
  if (after.events.length <= eventsBeforeRestart) {
    throw new Error('the orphaned running job was not advanced by the recovery sweep');
  }
  if (canonicalJson(after.events.slice(0, eventsBeforeRestart)) !== canonicalJson(claimed.events)) {
    throw new Error('the pre-restart event history was not preserved verbatim (loss/rewrite)');
  }
  const statusAfter = await hostB.escalations.status('tenant-alpha', create.requestId);
  if (
    statusAfter.record.history.length !== historyBeforeRestart ||
    statusAfter.record.state !== status.record.state
  ) {
    throw new Error('the escalation gained a duplicated transition across the restart');
  }
  const auditAfterRestart = (await hostB.auditRecords()).length;
  if (auditAfterRestart < auditBeforeRestart) {
    throw new Error('the audit chain lost records across the restart');
  }
  // The recovery sweep's own mutation MUST be audited — the chain
  // continues (never resets) across the hard-restart boundary, and the
  // digest linkage still verifies over the WHOLE chain (pre-restart
  // records + the post-restart continuation).
  if (auditAfterRestart < auditBeforeRestart + 1) {
    throw new Error(
      `the recovery sweep's requeue/timeout mutation was not audited (before ${String(auditBeforeRestart)}, after ${String(auditAfterRestart)})`,
    );
  }
  const chain = (await hostB.auditRecords()) as readonly AuditRecord[];
  const chainHead = await verifyAuditChain({ records: [...chain] });
  line(
    `- audit chain: ${String(auditAfterRestart)} records, digest-linked across the restart boundary (head ${redactDigest(chainHead)})`,
  );

  // -- (d) retries return the deterministic recorded outcome ---------------
  const identity = {
    idempotencyScope: 'escalation-tenant-alpha',
    idempotencyKey: 'idem-0001' as never,
    correlationId: 'corr-0001' as never,
  };
  const recorded = await hostB.recordedOutcome(identity);
  if (recorded === undefined) {
    throw new Error('the accepted outcome was not recorded durably');
  }
  const recordedJson = JSON.stringify(recorded.outcome);
  const replay = await hostB.escalations.create('tenant-alpha', input());
  if (replay.outcome !== 'replay' || replay.requestId !== create.requestId) {
    throw new Error(
      `expected a deterministic replay, got ${JSON.stringify(replay.outcome)}/${redactId(replay.requestId)}`,
    );
  }
  const recordedAgain = await hostB.recordedOutcome(identity);
  if (JSON.stringify(recordedAgain?.outcome) !== recordedJson) {
    throw new Error('the recorded outcome changed across the replay (non-deterministic)');
  }
  line(
    `- (d) replay returned requestId=${redactId(replay.requestId)} outcome=${JSON.stringify(replay.outcome)}; recorded outcome stable (${String(recordedJson.length)} bytes)`,
  );

  // -- (e) cross-tenant access fails closed ---------------------------------
  let crossTenantCreate = false;
  try {
    await hostB.escalations.create('tenant-beta', input({ tenantId: 'tenant-alpha' }));
  } catch (error) {
    crossTenantCreate = (error as { code?: string }).code === 'RUNTIME_CROSS_TENANT_ACCESS';
  }
  let crossTenantRead = false;
  try {
    await hostB.escalations.status('tenant-beta', create.requestId);
  } catch (error) {
    crossTenantRead = (error as { code?: string }).code === 'RUNTIME_ESCALATION_NOT_FOUND';
  }
  let crossTenantAct = false;
  try {
    await hostB.escalations.advance('tenant-beta', create.requestId, 'cancelled');
  } catch (error) {
    crossTenantAct = (error as { code?: string }).code === 'ESCALATION_CROSS_TENANT_ACCESS';
  }
  const tenantBetaList = await hostB.escalations.listByCorrelationId('tenant-beta', 'corr-0001');
  const crossTenantFailClosed =
    crossTenantCreate && crossTenantRead && crossTenantAct && tenantBetaList.length === 0;
  if (!crossTenantFailClosed) {
    throw new Error(
      `cross-tenant posture: create=${String(crossTenantCreate)} read=${String(crossTenantRead)} act=${String(crossTenantAct)} list=${String(tenantBetaList.length)}`,
    );
  }
  line(
    `- (e) cross-tenant fail-closed: create=RUNTIME_CROSS_TENANT_ACCESS read=RUNTIME_ESCALATION_NOT_FOUND act=ESCALATION_CROSS_TENANT_ACCESS list=0`,
  );

  const health = await hostB.health();
  line(
    `- health: state=${JSON.stringify(health.state)} ready=${String(health.ready)} capacity=${JSON.stringify(health.capacity.status)}`,
  );

  await hostA.stop();
  await hostB.stop();

  return {
    label: options.label,
    migrationsApplied: startA.migrationsApplied,
    restartRecovery: startB.recovery,
    escalationReadBack,
    replayDeterministic: replay.outcome === 'replay' && replay.requestId === create.requestId,
    crossTenantFailClosed,
    auditChainLength: auditAfterRestart,
    auditChainVerified: true,
  };
}

function input(overrides: Record<string, unknown> = {}): Parameters<
  RuntimeHostService['escalations']['create']
>[1] {
  return referenceCreateInput(overrides) as unknown as Parameters<
    RuntimeHostService['escalations']['create']
  >[1];
}

/** Redact a generated identifier to its stable prefix + length. */
function redactId(id: string): string {
  return `${id.slice(0, id.indexOf('_') + 1)}…(${String(id.length)} chars)`;
}

/** Redact a digest to its stable 12-char prefix (never the full value). */
function redactDigest(digest: string): string {
  return `${digest.slice(0, 12)}…(${String(digest.length)} hex)`;
}

/**
 * Canonical JSON: object keys sorted recursively, undefined-valued keys
 * dropped (JSON.stringify's own object semantics), array order PRESERVED.
 *
 * Why the verbatim-history check canonicalizes: PostgreSQL jsonb is a
 * NORMALIZED binary format that does not preserve object key order — a
 * real database (embedded PGlite AND live Neon alike) round-trips an
 * event envelope with its keys reordered. "Preserved verbatim" for a
 * durable event log therefore means semantic equality: identical
 * values, identical nesting, identical LOG order (append-only), keys in
 * any order. Comparing raw JSON.stringify would flag the benign jsonb
 * key normalization as a phantom rewrite (found by the real-database
 * battery; the in-memory reference transport preserves insertion order
 * and so never surfaces it).
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
      .sort();
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Write the transcript (redacted at capture time) to the evidence dir. */
export async function writeTranscript(
  evidenceDir: string,
  label: string,
  transcript: readonly string[],
): Promise<string> {
  await mkdir(evidenceDir, { recursive: true });
  const file = join(evidenceDir, `${label}-transcript.md`);
  await writeFile(file, `${transcript.join('\n')}\n`, 'utf-8');
  return file;
}
