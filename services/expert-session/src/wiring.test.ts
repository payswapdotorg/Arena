/**
 * Service↔adapter WIRING tests (Work Order C006) — the integration layer
 * proving the expert-session reference service composes with the
 * adapters/expert-environment materializer through the structural
 * CapsuleMaterializer port:
 *
 *   ExpertSessionService.materializer → ExpertEnvironmentMaterializer
 *
 * Direction service → adapter is the approved downward edge (boundary
 * rule B4); this is a TEST-ONLY devDependency — production hosts wire
 * the same composition at their root (see
 * adapters/expert-environment/README.md).
 */

import { describe, expect, it } from 'vitest';
import { ExpertEnvironmentMaterializer, executionCapsuleSourceFromDefinition, makeEnvironmentDefinition } from '@arena/expert-environment-adapters';
import { ExpertSessionService } from './service.js';
import { InMemoryEscalationSessionPort, InMemorySessionStore } from './fabric.js';
import { acceptedEscalation, capsuleSource } from './test-support.js';
import { T0, T1, T2, T3, TENANT_A } from './test-support.js';

async function wiredService() {
  const escalationPort = new InMemoryEscalationSessionPort();
  const service = new ExpertSessionService({
    escalationPort,
    store: new InMemorySessionStore(),
    materializer: new ExpertEnvironmentMaterializer(),
  });
  const escalation = await acceptedEscalation();
  await escalationPort.seed(escalation);
  return { service, escalation };
}

describe('wiring — the service materializes capsules through the expert-environment adapter', () => {
  it('openSession through the adapter: A009-derived capsule, secret-bound tool excluded', async () => {
    const { service, escalation } = await wiredService();
    const record = await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
    });
    // The A009-derived barrier travels with the capsule (identity
    // masking + PII redaction from the escalation policy).
    expect(record.capsule.barrier.identityMasking).toBe(true);
    expect(record.capsule.barrier.redactedFields).toContain('customerEmail');
    expect(record.capsule.authority).toBe('non-authoritative-replica');
    // Source fixture tools are the capsule surface.
    expect(record.capsule.tools).toEqual(['search-vendors', 'compute-reconciliation', 'admin-console']);
    expect(record.state).toBe('open');
  });

  it('the full session lifecycle composes through the adapter materializer', async () => {
    const { service, escalation } = await wiredService();
    const opened = await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source: capsuleSource(),
      now: T0,
    });
    await service.beginSession({ sessionId: opened.capsule.sessionId, tenantId: TENANT_A, expertRef: 'expert-alice', now: T1 });
    await service.recordSessionEvent({
      sessionId: opened.capsule.sessionId,
      tenantId: TENANT_A,
      kind: 'environment-observation',
      payload: { customerEmail: 'acme-buyer@example.com', step: 's1' },
      now: T2,
    });
    const completed = await service.submitSession({
      sessionId: opened.capsule.sessionId,
      tenantId: TENANT_A,
      result: { matched: 'vendor-7' },
      evidence: [{ kind: 'event-ref', ref: opened.capsule.sessionId }],
      consentRightsStatement: { granted: true, statement: 'Reusable under Arena terms.' },
      now: T3,
      actor: 'expert-alice',
    });
    expect(completed.state).toBe('completed');
    const stream = (await service.getObservationStream({ sessionId: opened.capsule.sessionId, tenantId: TENANT_A })) as readonly {
      payload: Record<string, unknown>;
    }[];
    expect(JSON.stringify(stream)).not.toContain('acme-buyer@example.com');
  });

  it('executionCapsuleSourceFromDefinition composes into the same service port (real A009 definition)', async () => {
    const { service, escalation } = await wiredService();
    const definition = await makeEnvironmentDefinition();
    const source = executionCapsuleSourceFromDefinition(definition, { step: 'awaiting-vendor-match' }, { taskRef: 'task-7' });
    const record = await service.openSession({
      requestId: escalation.request.requestId,
      tenantId: TENANT_A,
      source,
      now: T0,
    });
    // A009-derived bounded surface: declared tools minus the
    // secret-bound admin-console; live-world mounts never present.
    expect(record.capsule.tools).toEqual(['search-vendors', 'compute-reconciliation']);
    expect(record.capsule.resources.map((resource) => resource.ref)).toEqual(['/workspace', '/task-inputs']);
    expect(record.capsule.derivedFrom.environmentDigest).toBe(definition.digest);
  });
});
