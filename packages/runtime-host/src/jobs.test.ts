import { describe, expect, it } from 'vitest';
import { isJobDefinition, jobKindKey } from '@arena/job-protocol';
import {
  createRuntimeJobKindRegistrations,
  findRegistrationForRecord,
  isRuntimeJobKindName,
  LEARNING_CANDIDATE_PROJECTION_STUB_EXECUTOR,
  registrationKey,
  RUNTIME_JOB_KIND_NAMES,
  RUNTIME_JOB_NAMESPACE,
} from './jobs.js';

describe('registered host job kinds (ADR-P001-01 / ADR-P001-06)', () => {
  it('registers the closed kind-name vocabulary', async () => {
    expect(RUNTIME_JOB_KIND_NAMES).toEqual([
      'escalation-recompute',
      'escalation-projection',
      'learning-candidate-projection',
      'retention-sweep',
    ]);
    expect(isRuntimeJobKindName('retention-sweep')).toBe(true);
    expect(isRuntimeJobKindName('webhook-dispatch')).toBe(false);

    const registrations = await createRuntimeJobKindRegistrations();
    expect(registrations).toHaveLength(4);
    const keys = registrations.map(registrationKey);
    expect(keys).toEqual([
      `${RUNTIME_JOB_NAMESPACE}/escalation-recompute@1.0.0`,
      `${RUNTIME_JOB_NAMESPACE}/escalation-projection@1.0.0`,
      `${RUNTIME_JOB_NAMESPACE}/learning-candidate-projection@1.0.0`,
      `${RUNTIME_JOB_NAMESPACE}/retention-sweep@1.0.0`,
    ]);
  });

  it('builds digest-stable definitions (deterministic registry bytes)', async () => {
    const first = await createRuntimeJobKindRegistrations();
    const second = await createRuntimeJobKindRegistrations();
    expect(first.map((r) => r.definition.digest)).toEqual(second.map((r) => r.definition.digest));
    for (const registration of first) {
      expect(isJobDefinition(registration.definition)).toBe(true);
      // Pure-data policies (R-022/R-035/R-043): timeout and retry are data.
      expect(registration.definition.timeout.timeoutMs).toBeGreaterThan(0);
      expect(registration.definition.retry.maxAttempts).toBeGreaterThanOrEqual(1);
    }
  });

  it('records the honest stub verdict for the learning-candidate projection seam (ADR-P001-06)', async () => {
    const verdict = await LEARNING_CANDIDATE_PROJECTION_STUB_EXECUTOR(
      { records: [{ digest: 'a'.repeat(64) }, { digest: 'b'.repeat(64) }] },
      { jobId: 'job-1', attempt: 1, clockNow: 0 },
    );
    const document = verdict as Record<string, unknown>;
    expect(document['kind']).toBe('learning-candidate-projection');
    expect(document['disposition']).toBe('stub-not-implemented');
    // The stub never fabricates candidates — it reports its input count.
    expect(document['inputEchoDigestKeys']).toBe(2);
    expect(String(document['note'])).toContain('ADR-P001-06');
  });

  it('finds the registration for a persisted record by kind identity', async () => {
    const registrations = await createRuntimeJobKindRegistrations();
    const retention = registrations[3];
    expect(retention).toBeDefined();
    if (retention === undefined) return;
    const record = {
      jobId: 'job-x',
      kind: retention.definition.kind,
    } as Parameters<typeof findRegistrationForRecord>[1];
    expect(findRegistrationForRecord(registrations, record)).toBe(retention);
    expect(
      findRegistrationForRecord(registrations, {
        ...record,
        kind: { namespace: 'other', name: 'nope', version: '1.0.0' },
      } as Parameters<typeof findRegistrationForRecord>[1]),
    ).toBeUndefined();
  });

  it('keys kinds the same way the protocol does', async () => {
    const registrations = await createRuntimeJobKindRegistrations();
    for (const registration of registrations) {
      expect(registrationKey(registration)).toBe(jobKindKey(registration.definition.kind));
    }
  });
});
