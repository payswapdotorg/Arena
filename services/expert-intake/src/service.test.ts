/**
 * Service integration suite (Work Order C003): the full lifecycle over the
 * reference service with injected A006/A007 fakes — start/resume/abandon/
 * submit/assess, envelope emission, idempotency (replay + conflict), and
 * the profile handoff to the public ports.
 */

import { describe, expect, it } from 'vitest';
import { EXPERT_INTAKE_ERROR_CODES } from '@arena/expert-intake';
import { createServiceFixture, runServiceInterview, TENANT, EXPERT_ID, CATALOG_SEED, defaultAnswer } from './test-support.js';

describe('expert-intake reference service', () => {
  it('runs the full lifecycle and hands the IntakeProfile to the A006/A007 ports', async () => {
    const fixture = createServiceFixture();
    const result = await runServiceInterview(fixture);
    expect(result.outcome.outcome).toBe('complete-with-claims');
    // The A006 port received exactly one registry-field proposal.
    expect(fixture.registry.proposals.length).toBe(1);
    const proposal = fixture.registry.proposals[0]!;
    expect(proposal.expertId).toBe(EXPERT_ID);
    expect(proposal.tenant).toBe(TENANT);
    expect(proposal.competencies.length).toBe(2);
    expect(proposal.privacyPolicy.transcriptRetentionConsent).toBe(true);
    // The A007 port received one claim candidate per claimed capability,
    // each with evidence digests riding along.
    expect(fixture.qualification.claims.length).toBe(2);
    for (const claim of fixture.qualification.claims) {
      expect(claim.evidence.length).toBeGreaterThan(0);
    }
    expect(result.handoff.claimCandidates.length).toBe(2);
    expect(result.handoff.registryProposal?.accepted).toBe(true);
  });

  it('emits the command + event envelopes in the house convention', async () => {
    const fixture = createServiceFixture();
    const result = await runServiceInterview(fixture);
    const kinds = result.envelopes.map((envelope) => `${envelope.kind}:${envelope.schema.split('/').pop()?.split('@')[0]}`);
    expect(kinds).toContain('command:assess-interview-command');
    expect(kinds).toContain('event:intake-assessed-event');
    expect(kinds).toContain('event:intake-profile-proposed-event');
    expect(fixture.service.listEvents().length).toBeGreaterThanOrEqual(2);
  });

  it('start is idempotent: the same key + tuple replays the stored session', async () => {
    const fixture = createServiceFixture();
    const command = {
      sessionId: 'intake-idem-01',
      tenant: TENANT,
      expertId: EXPERT_ID,
      catalogSeed: CATALOG_SEED,
      selectionSeed: 'seed-idem',
      privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
    };
    const options = { correlationId: 'corr-1', idempotencyKey: 'key-idem-1', at: '2026-10-07T12:00:00.000Z' };
    const first = await fixture.service.startInterview(command, options);
    const replay = await fixture.service.startInterview(command, options);
    expect(replay.session.digest).toBe(first.session.digest);
    expect(fixture.service.describe().sessions).toBe(1);
  });

  it('the same key + a different tuple is an IDEMPOTENCY_CONFLICT', async () => {
    const fixture = createServiceFixture();
    await fixture.service.startInterview(
      {
        sessionId: 'intake-idem-02',
        tenant: TENANT,
        expertId: EXPERT_ID,
        catalogSeed: CATALOG_SEED,
        selectionSeed: 'seed-a',
        privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
      },
      { correlationId: 'corr-2', idempotencyKey: 'key-idem-2', at: '2026-10-07T12:00:00.000Z' },
    );
    await expect(
      fixture.service.startInterview(
        {
          sessionId: 'intake-idem-02b',
          tenant: TENANT,
          expertId: EXPERT_ID,
          catalogSeed: CATALOG_SEED,
          selectionSeed: 'seed-b',
          privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
        },
        { correlationId: 'corr-2', idempotencyKey: 'key-idem-2', at: '2026-10-07T12:00:00.000Z' },
      ),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.IDEMPOTENCY_CONFLICT });
  });

  it('replayed submissions do not duplicate the handoff (assess is single-run per key)', async () => {
    const fixture = createServiceFixture();
    await runServiceInterview(fixture, 'intake-replay-01');
    await expect(
      fixture.service.assessInterview('intake-replay-01', TENANT, {
        correlationId: 'corr-again',
        idempotencyKey: 'key-assess-intake-replay-01',
        at: '2026-10-07T12:04:00.000Z',
      }),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT });
    expect(fixture.registry.proposals.length).toBe(1);
  });

  it('supports abandon (terminal) with the idempotency-key convention', async () => {
    const fixture = createServiceFixture();
    await fixture.service.startInterview(
      {
        sessionId: 'intake-abandon-01',
        tenant: TENANT,
        expertId: EXPERT_ID,
        catalogSeed: CATALOG_SEED,
        selectionSeed: 'seed-abandon',
        privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
      },
      { correlationId: 'corr-3', idempotencyKey: 'key-abandon-start', at: '2026-10-07T12:00:00.000Z' },
    );
    const { envelopes } = await fixture.service.abandonInterview('intake-abandon-01', TENANT, {
      correlationId: 'corr-4',
      idempotencyKey: 'key-abandon-1',
      at: '2026-10-07T12:05:00.000Z',
    });
    expect(envelopes[0]?.kind).toBe('command');
    // After abandon, no further questions can be asked.
    await expect(
      fixture.service.askNextQuestionAt('intake-abandon-01', TENANT, { correlationId: 'corr-5', at: '2026-10-07T12:06:00.000Z' }),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT });
  });

  it('the transcript query returns the declared questions/answers', async () => {
    const fixture = createServiceFixture();
    await fixture.service.startInterview(
      {
        sessionId: 'intake-query-01',
        tenant: TENANT,
        expertId: EXPERT_ID,
        catalogSeed: CATALOG_SEED,
        selectionSeed: 'seed-query',
        privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
      },
      { correlationId: 'corr-6', idempotencyKey: 'key-query-start', at: '2026-10-07T12:00:00.000Z' },
    );
    const asked = await fixture.service.askNextQuestionAt('intake-query-01', TENANT, {
      correlationId: 'corr-7',
      at: '2026-10-07T12:01:00.000Z',
    });
    await fixture.service.recordAnswer('intake-query-01', TENANT, asked.item.itemId, defaultAnswer(asked.item), {
      correlationId: 'corr-8',
      at: '2026-10-07T12:02:00.000Z',
    });
    const transcript = await fixture.service.getTranscript('intake-query-01', TENANT, { correlationId: 'corr-9' });
    expect(transcript.entries.length).toBe(1);
    expect(transcript.entries[0]?.answered).toBe(true);
    expect(transcript.response.kind).toBe('response');
  });
});
