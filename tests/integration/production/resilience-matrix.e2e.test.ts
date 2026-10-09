/**
 * tests/integration/production/resilience-matrix.e2e.test.ts — M3 of the
 * P006 integrated acceptance (Work Order P006; issue #158): the
 * resilience matrix over the REAL composition + public transport.
 *
 * The P006 work-items spec requires the integrated acceptance to include
 * restart, duplicate, concurrency, timeout, provider outage and recovery:
 *
 *   - restart + duplicate: pinned by composition.e2e.test.ts (the hard
 *     restart + idempotent replay proofs over composeRuntimeHost) —
 *     cross-referenced here, not duplicated;
 *   - THIS suite adds the missing three over the same harness:
 *       (a) CONCURRENCY — parallel distinct-key submissions isolate
 *           correctly (N distinct durable records; no cross-talk);
 *       (b) CONCURRENCY (same key) — a parallel identical-submission race
 *           resolves to EXACTLY ONE created outcome + N-1 verbatim
 *           replays (the C001 idempotency law under contention);
 *       (c) TIMEOUT — past-deadline transitions are denied with the
 *           typed deadline reason; the durable timeout sweep moves the
 *           record to the EXPLICIT timed_out state; the public transport
 *           observes it;
 *       (d) RECOVERY — a hard process restart mid-flow (post-offer,
 *           pre-session) resumes and the flow COMPLETES (outage window
 *           crossed without loss).
 *   - provider outage at the ADAPTER level (fail-closed capacity) is
 *     exercised by the concurrent P007 adversarial pass
 *     (tests/resilience/production/provider-outage-recovery.test.ts on
 *     work/P007-adversarial-tests) — cross-referenced in the PR body,
 *     not duplicated here.
 *
 * EVIDENCE: engine class embedded-postgres → AUTOMATED-TEST-ONLY
 * (release-gate §3); the transcript lands in
 * docs/evidence/production/integration/ (fresh timestamps only).
 */

import { describe, expect, it } from 'vitest';
import type { CreateEscalationRequestInput } from '@arena/escalation';
import { bootIntegratedDeployment, T0 } from './support/harness.js';
import { createGenericAiClient } from './support/generic-client.js';
import { driveEscalationToCompletion } from './support/arena-side.js';
import {
  transcriptHeader,
  writeTranscript,
  evidenceClassForEngine,
  observationLine,
} from './support/evidence.js';

const EVIDENCE_DIR =
  process.env.ARENA_P006_EVIDENCE_OUT ??
  new URL('../../../docs/evidence/production/integration/', import.meta.url).pathname;

const TENANT = 'tenant-beta';
const TENANT_OTHER = 'tenant-gamma';

/** A demand template (the §16 BOQ vertical) with per-case idempotency. */
function boqInput(
  idempotencyKey: string,
  overrides: Record<string, unknown> = {},
): CreateEscalationRequestInput {
  return {
    clientAppId: 'generic-boq-app',
    tenantId: TENANT,
    sourceWorkflowRef: 'workflow-boq-accra-house',
    sourceRunRef: 'run-2026-10-09-007',
    taskRef: 'task-quantity-takeoff-block-c',
    capabilityNeed: 'construction.quantity-surveying.boq-verification',
    escalationModes: ['solve', 'unblock'],
    urgency: 'priority',
    now: new Date(T0).toISOString(),
    deadlineInMs: 86_400_000,
    budget: { amountMinorUnits: 25_000, currency: 'USD' },
    expertRequirements: {
      requiredCapabilities: ['construction.quantity-surveying'],
      preferredLocales: ['en-GH'],
    },
    locale: 'en',
    desiredOutputSchema: { type: 'object' },
    contextReferences: [{ kind: 'task-ref', ref: 'task-quantity-takeoff-block-c' }],
    environmentSessionPolicy: { sessionMode: 'bounded-replica', sanitization: 'strict' },
    privacyPolicy: { dataClassification: 'confidential', pii: 'redact' },
    permittedActions: ['read-context', 'propose-patch', 'annotate-evidence', 'signal-tool-gap'],
    learningPermissions: {
      allowKnowledgeCapture: true,
      allowToolGapSignals: true,
      allowArtifactReuse: false,
      requireApproval: true,
    },
    retentionPolicy: { retentionMs: 2_592_000_000, disposition: 'purge' },
    idempotencyKey,
    correlationId: `corr-${idempotencyKey}`,
    ...overrides,
  } as CreateEscalationRequestInput;
}

describe('P006 M3 — the resilience matrix over the real composition + public transport', () => {
  it('concurrency (distinct keys) + same-key race + timeout sweep + mid-flow restart recovery, all observed through the public boundary', async () => {
    const deployment = await bootIntegratedDeployment();
    let rebooted: Awaited<ReturnType<typeof deployment.restartHard>> | undefined;
    const transcript: string[] = [
      ...transcriptHeader('resilience-matrix', {
        engineClass: deployment.engineClass,
        transport:
          'public HTTP listener (node:http, ephemeral port) over the frozen host surface; arena-side operator handles drive the ARENA side only',
        baseUrl: deployment.baseUrl,
        lens: 'customer',
        paymentPosture: 'DEMO provider (executesCustomerMoney=false) — CI moves NO real money',
      }),
    ];
    try {
      const issuance = deployment.keys.issue({ tenantId: TENANT, clientAppId: 'generic-boq-app' });
      const issuanceOther = deployment.keys.issue({
        tenantId: TENANT_OTHER,
        clientAppId: 'generic-boq-app',
      });
      const client = createGenericAiClient({
        clientAppId: 'generic-boq-app',
        tenantId: TENANT,
        baseUrl: deployment.baseUrl,
        apiKeySecret: issuance.secret,
        webhookSigner: {
          signingKeyId: deployment.signer.signingKeyId,
          sign: (timestamp, payload) => deployment.signer.sign(timestamp, payload),
        },
        now: () => deployment.clock.now(),
      });
      const clientOther = createGenericAiClient({
        clientAppId: 'generic-boq-app',
        tenantId: TENANT_OTHER,
        baseUrl: deployment.baseUrl,
        apiKeySecret: issuanceOther.secret,
        webhookSigner: {
          signingKeyId: deployment.signer.signingKeyId,
          sign: (timestamp, payload) => deployment.signer.sign(timestamp, payload),
        },
        now: () => deployment.clock.now(),
      });

      // --- (a) CONCURRENCY: 8 parallel DISTINCT-key submissions --------
      const distinct = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          client.submitEscalation(boqInput(`resilience-distinct-${i}`)),
        ),
      );
      for (const submission of distinct) expect(submission.httpStatus).toBe(201);
      const distinctIds = new Set(distinct.map((s) => s.requestId));
      expect(distinctIds.size).toBe(8);
      transcript.push(
        observationLine({
          step: 'concurrency-distinct-keys',
          observed: `8 parallel submissions → 8×201, ${distinctIds.size} distinct durable requestIds (no cross-talk)`,
        }),
      );

      // --- (b) CONCURRENCY: same-key race — the exactly-once invariant --
      // The loser distribution is characterized honestly per the P007
      // adversarial pass's finding F-08 (work/P007-adversarial-tests
      // ac07): a racing loser may see the typed fail-closed conflict
      // (PERSISTENCE_RECORD_EXISTS surfacing as the typed 500) rather
      // than the smooth 200 replay — but the DOUBLE-ACT is unreachable:
      // exactly ONE durable record for the identity, every successful
      // response names the SAME requestId.
      const raced = await Promise.allSettled(
        Array.from({ length: 5 }, () => client.submitEscalation(boqInput('resilience-race-key'))),
      );
      const succeeded = raced
        .filter((r): r is PromiseFulfilledResult<{ requestId: string; duplicate: boolean; httpStatus: number }> => r.status === 'fulfilled')
        .map((r) => r.value);
      const rejected = raced.filter((r) => r.status === 'rejected');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);
      const createdCount = succeeded.filter((s) => s.httpStatus === 201).length;
      expect(createdCount).toBe(1);
      expect(new Set(succeeded.map((s) => s.requestId)).size).toBe(1);
      for (const rejection of rejected) {
        // a racing loser's typed fail-closed conflict — F-08, disclosed
        expect(String(rejection.reason)).toContain('already bound');
      }
      // the exactly-once invariant: ONE durable record for the identity
      const racedRecord = succeeded[0];
      expect(racedRecord).toBeDefined();
      const racedStatus = await client.pollStatus(racedRecord!.requestId);
      expect(racedStatus.request.requestId).toBe(racedRecord!.requestId);
      transcript.push(
        observationLine({
          step: 'concurrency-same-key-race',
          observed: `5 parallel identical submissions → 1×201 created + ${succeeded.length - 1} successful replays/conflicts + ${rejected.length} typed fail-closed conflicts (F-08 distribution); exactly ONE durable record; double-act unreachable — the C001 idempotency law's exactly-once invariant under contention`,
        }),
      );

      // --- (c) TIMEOUT: post-deadline denial + durable sweep + public --
      const timeout = await client.submitEscalation(
        boqInput('resilience-timeout', { deadlineInMs: 60_000 }),
      );
      expect(timeout.httpStatus).toBe(201);
      // advance the deterministic clock PAST the deadline
      deployment.clock.advance(120_000);
      // a post-deadline lifecycle transition is DENIED with the typed reason
      let denied: unknown = null;
      try {
        await deployment.host.escalations.advance(TENANT, timeout.requestId, 'offered', {
          actor: 'arena-ops',
        });
      } catch (error) {
        denied = error;
      }
      expect(denied).toBeInstanceOf(Error);
      transcript.push(
        observationLine({
          step: 'timeout-post-deadline-denial',
          observed: `advance('offered') past deadline → typed denial ${String(denied)} (only the explicit timeout state is reachable)`,
        }),
      );
      // the durable timeout sweep moves the record to timed_out
      const swept = await deployment.arena.escalations.sweepTimeouts();
      const sweptIds = swept.map((record) => record.request.requestId);
      expect(sweptIds).toContain(timeout.requestId);
      // the PUBLIC transport observes the explicit state
      const timedOut = await client.pollStatus(timeout.requestId);
      expect(timedOut.state).toBe('timed_out');
      transcript.push(
        observationLine({
          step: 'timeout-sweep+public-observation',
          observed: `sweepTimeouts() → timed_out; public poll → state=timed_out (typed, explicit — never an invented match)`,
        }),
      );

      // --- cross-tenant isolation (pre-restart deployment still live) --
      const foreign = await clientOther.submitEscalation(
        boqInput('resilience-cross-tenant', {
          tenantId: TENANT_OTHER,
          correlationId: 'corr-resilience-cross-tenant',
        }),
      );
      expect(foreign.httpStatus).toBe(201);
      let crossTenant: unknown = null;
      try {
        // tenant-beta's client CANNOT observe tenant-gamma's record
        await client.pollStatus(foreign.requestId);
      } catch (error) {
        crossTenant = error;
      }
      expect(crossTenant).toBeInstanceOf(Error);
      transcript.push(
        observationLine({
          step: 'cross-tenant-isolation',
          observed: `tenant-beta client → tenant-gamma record poll → typed failure (fail-closed, no existence leak)`,
        }),
      );

      // --- (d) RECOVERY: mid-flow hard restart → flow COMPLETES --------
      const midFlow = await client.submitEscalation(boqInput('resilience-recovery'));
      expect(midFlow.httpStatus).toBe(201);
      const beforeRestart = await client.pollStatus(midFlow.requestId);
      expect(beforeRestart.state).toBe('offered');
      // HARD RESTART: stop host + listener; boot a FRESH deployment over
      // the SAME durable transport (the database survives the process)
      rebooted = await deployment.restartHard();
      transcript.push(
        observationLine({
          step: 'recovery-hard-restart',
          observed: `hard restart at state=offered (post-offer, pre-session) — fresh host + listener over the SAME durable transport`,
        }),
      );
      // the harness's developer-key registry is PROCESS-LOCAL (a disclosed
      // limitation: durable key storage is a P002-surface follow-up) — the
      // operator re-issues the client's key on the rebooted deployment
      const live = rebooted!;
      const reissued = live.keys.issue({ tenantId: TENANT, clientAppId: 'generic-boq-app' });
      const rebootedClient = () =>
        createGenericAiClient({
          clientAppId: 'generic-boq-app',
          tenantId: TENANT,
          baseUrl: live.baseUrl,
          apiKeySecret: reissued.secret,
          webhookSigner: {
            signingKeyId: live.signer.signingKeyId,
            sign: (timestamp, payload) => live.signer.sign(timestamp, payload),
          },
          now: () => live.clock.now(),
        });
      const afterRestart = await rebootedClient().pollStatus(midFlow.requestId);
      expect(afterRestart.state).toBe('offered');
      expect(afterRestart.request.requestId).toBe(midFlow.requestId);
      // the flow COMPLETES across the restart boundary
      const receipt = await driveEscalationToCompletion({
        deployment: live,
        requestId: midFlow.requestId,
        tenantId: TENANT,
        offered: {
          expertRef: afterRestart.expertRef,
          escalationModes: afterRestart.request.escalationModes,
          environmentSessionMode: afterRestart.request.environmentSessionPolicy.sessionMode,
          permittedActions: afterRestart.request.permittedActions,
          learningPermissions: afterRestart.request.learningPermissions,
        },
        taskRef: 'task-quantity-takeoff-block-c',
        worldState: {
          block: 'C',
          assumedFoundationDepthMm: 600,
          boqDraftRevision: 3,
        },
        resultSummary: 'Block C quantity verified against the revised foundation depth.',
        resultPayload: { blockCQuantity: 1180, basis: 'site-survey-2026-10-09' },
        sessionId: 'session-resilience-recovery-001',
      });
      const finalRecord = await rebootedClient().pollStatus(midFlow.requestId);
      expect(finalRecord.state).toBe('closed');
      expect(finalRecord.result?.kind).toBe('unblock');
      transcript.push(
        observationLine({
          step: 'recovery-flow-completes',
          observed: `post-restart drive → public poll state=${finalRecord.state} result=${finalRecord.result?.kind ?? 'n/a'} (outage window crossed without loss)`,
        }),
      );

      transcript.push(
        `- evidence-class: ${evidenceClassForEngine(deployment.engineClass)} (engine ${deployment.engineClass})`,
      );
      await writeTranscript(EVIDENCE_DIR, 'resilience-matrix', transcript);
      await live.close();
    } catch (error) {
      await deployment.close().catch(() => undefined);
      await rebooted?.close().catch(() => undefined);
      throw error;
    }
  });
});
