/**
 * Adversarial suite (Work Order C003, service level): cross-tenant
 * transcript access, tampered store state, port fault containment,
 * intake-output-as-authorization masquerade, and answer PII smuggling.
 */

import { describe, expect, it } from 'vitest';
import { EXPERT_INTAKE_ERROR_CODES, screenProfileFieldNames } from '@arena/expert-intake';
import type { ExpertIntakeService } from './fabric.js';
import { createServiceFixture, runServiceInterview, TENANT, OTHER_TENANT, EXPERT_ID, CATALOG_SEED, defaultAnswer } from './test-support.js';

async function startSession(
  service: ExpertIntakeService,
  sessionId: string,
  tenant: string = TENANT,
): Promise<void> {
  await service.startInterview(
    {
      sessionId,
      tenant,
      expertId: EXPERT_ID,
      catalogSeed: CATALOG_SEED,
      selectionSeed: 'seed-adv-svc',
      privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
    },
    { correlationId: 'corr-adv-start', idempotencyKey: `key-adv-start-${sessionId}`, at: '2026-10-07T12:00:00.000Z' },
  );
}

describe('cross-tenant isolation (lock rule 11 — fail closed)', () => {
  it('another tenant cannot read the transcript', async () => {
    const fixture = createServiceFixture();
    await startSession(fixture.service, 'intake-x-tenant-01');
    await expect(
      fixture.service.getTranscript('intake-x-tenant-01', OTHER_TENANT, { correlationId: 'corr-x1' }),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.TENANT_MISMATCH });
  });

  it('another tenant cannot ask questions, record answers or submit', async () => {
    const fixture = createServiceFixture();
    await startSession(fixture.service, 'intake-x-tenant-02');
    await expect(
      fixture.service.askNextQuestionAt('intake-x-tenant-02', OTHER_TENANT, { correlationId: 'corr-x2', at: '2026-10-07T12:01:00.000Z' }),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.TENANT_MISMATCH });
    await expect(
      fixture.service.recordAnswer('intake-x-tenant-02', OTHER_TENANT, 'cap:locale', {}, { correlationId: 'corr-x3', at: '2026-10-07T12:01:00.000Z' }),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.TENANT_MISMATCH });
    await expect(
      fixture.service.submitInterview('intake-x-tenant-02', OTHER_TENANT, { correlationId: 'corr-x4', idempotencyKey: 'key-x4', at: '2026-10-07T12:01:00.000Z' }),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.TENANT_MISMATCH });
  });

  it('unknown sessions fail closed with NOT_FOUND (never a silent empty read)', async () => {
    const fixture = createServiceFixture();
    await expect(fixture.service.getTranscript('intake-ghost-01', TENANT, { correlationId: 'corr-x5' })).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.NOT_FOUND,
    });
  });
});

describe('tampered store state (fail closed)', () => {
  it('a mutated session in the store fails every operation with TAMPERED', async () => {
    const fixture = createServiceFixture();
    await startSession(fixture.service, 'intake-tamper-svc-01');
    const asked = await fixture.service.askNextQuestionAt('intake-tamper-svc-01', TENANT, { correlationId: 'corr-t1', at: '2026-10-07T12:01:00.000Z' });
    // Simulate an out-of-band store mutation: splice the private store via
    // the prototype-verified accessors is not possible — use a mutated copy
    // through a fresh service instance is not applicable either; instead we
    // verify the digest gate via the engine-level session object.
    const store = (fixture.service as unknown as { sessions: Map<string, unknown> }).sessions;
    const session = store.get('intake-tamper-svc-01') as Record<string, unknown>;
    store.set('intake-tamper-svc-01', { ...session, selectionSeed: 'mutated-seed' });
    await expect(
      fixture.service.askNextQuestionAt('intake-tamper-svc-01', TENANT, { correlationId: 'corr-t2', at: '2026-10-07T12:02:00.000Z' }),
    ).rejects.toMatchObject({ code: EXPERT_INTAKE_ERROR_CODES.TAMPERED });
    void asked;
  });
});

describe('port fault containment (fail closed)', () => {
  it('a throwing A006 port fails the assessment with PORT_FAILURE and NO proposal lands', async () => {
    const fixture = createServiceFixture();
    fixture.registry.failMode = 'throw';
    await expect(runServiceInterview(fixture, 'intake-port-01')).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.PORT_FAILURE,
    });
    expect(fixture.registry.proposals.length).toBe(0);
    expect(fixture.qualification.claims.length).toBe(0);
  });

  it('a rejecting A006 port fails the assessment with PORT_FAILURE (reasons surface)', async () => {
    const fixture = createServiceFixture();
    fixture.registry.failMode = 'reject';
    await expect(runServiceInterview(fixture, 'intake-port-02')).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.PORT_FAILURE,
    });
  });

  it('a rejecting A007 claim port fails the assessment with PORT_FAILURE (no silent partial handoff)', async () => {
    const fixture = createServiceFixture();
    fixture.qualification.failMode = 'reject';
    await expect(runServiceInterview(fixture, 'intake-port-03')).rejects.toMatchObject({
      code: EXPERT_INTAKE_ERROR_CODES.PORT_FAILURE,
    });
    // The A006 proposal already landed (ordering: registry first) — the
    // typed error surfaces the partial handoff rather than pretending
    // success; documented limitation (see PR).
    expect(fixture.registry.proposals.length).toBe(1);
  });
});

describe('intake output consumed as authorization (must fail closed)', () => {
  it('the service exposes no access-granting operation; the handoff is declaration data only', async () => {
    const fixture = createServiceFixture();
    const result = await runServiceInterview(fixture, 'intake-masq-01');
    // The ONLY outputs are the typed outcome + receipts about data.
    expect(result.outcome.outcome).toBe('complete-with-claims');
    for (const receipt of result.handoff.claimCandidates) {
      expect(receipt.accepted).toBe(true);
      expect(receipt.claimRef).toBeDefined();
    }
    // The port interfaces carry no grant/imply/record-permission method.
    const registryPortMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(fixture.registry)).filter((name) => name !== 'constructor');
    expect(registryPortMethods).toEqual(['submitRegistryProposal']);
    const qualificationPortMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(fixture.qualification)).filter((name) => name !== 'constructor');
    expect(qualificationPortMethods).toEqual(['submitClaimCandidate']);
  });

  it('an authority-shaped smuggle into the handoff data fails at the domain screen', async () => {
    const fixture = createServiceFixture();
    await runServiceInterview(fixture, 'intake-masq-02');
    const proposal = fixture.registry.proposals[0]!;
    // Widening the proposal with an authority-shaped field is rejected by
    // the domain-level field-name screen (defense in depth — the data
    // layer refuses to carry it even before any consumer could act on it).
    expect(() => screenProfileFieldNames({ ...proposal, grantedPermissions: ['escalate-anything'] }, 'proposal')).toThrow(/authority-shaped/);
    expect(() => screenProfileFieldNames(proposal, 'proposal')).not.toThrow();
  });
});

describe('answer payload PII smuggling (service-level fail closed)', () => {
  it('email-shaped answers are rejected at capture time', async () => {
    const fixture = createServiceFixture();
    await startSession(fixture.service, 'intake-pii-01');
    const asked = await fixture.service.askNextQuestionAt('intake-pii-01', TENANT, { correlationId: 'corr-p1', at: '2026-10-07T12:01:00.000Z' });
    const badAnswer =
      asked.item.expected.answerKind === 'scenario-response'
        ? { answerKind: 'scenario-response', response: 'contact alice@example.com for details' }
        : { ...defaultAnswer(asked.item), extra: 'alice@example.com' };
    await expect(
      fixture.service.recordAnswer('intake-pii-01', TENANT, asked.item.itemId, badAnswer, { correlationId: 'corr-p2', at: '2026-10-07T12:02:00.000Z' }),
    ).rejects.toBeInstanceOf(Error);
  });
});
