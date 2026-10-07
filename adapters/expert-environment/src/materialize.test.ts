/**
 * Expert-environment adapter suite (Work Order C006; EES1.0
 * "Environment Capsule") — materialization against the A009 vocabulary.
 *
 * Asserts:
 *   - the A009-derived source: declared tools only; live-world mounts
 *     NEVER replicate (lock rule 28); read-only mounts stay read-only;
 *     secret-bound tools are excluded (EES1.0 secret/tool exclusion);
 *   - DETERMINISM: same inputs ⇒ same capsule digest; any change ⇒ a
 *     new digest;
 *   - the barrier derivation from the escalation's declared policy
 *     (PII redaction, identity masking, deadline-bounded credentials).
 */

import { describe, expect, it } from 'vitest';
import {
  ExpertEnvironmentMaterializer,
  executionCapsuleSourceFromDefinition,
} from './materialize.js';
import type { CapsuleMaterializationCommandLike } from './materialize.js';
import { REQUEST_ID, TENANT_A, EXPIRY, T0, makeEnvironmentDefinition } from './test-support.js';

describe('executionCapsuleSourceFromDefinition — A009 derivation', () => {
  it('declared tools, bounded files, environment digest', async () => {
    const definition = await makeEnvironmentDefinition();
    const source = executionCapsuleSourceFromDefinition(definition, { step: 'awaiting-vendor-match' }, { taskRef: 'task-7' });
    expect(source.toolAvailability).toEqual(['search-vendors', 'compute-reconciliation', 'admin-console']);
    expect(source.environmentDigest).toBe(definition.digest);
    expect(source.taskRef).toBe('task-7');
  });

  it('ADVERSARIAL: live-world mounts NEVER replicate into the capsule (defense-in-depth for forged definitions)', async () => {
    const definition = await makeEnvironmentDefinition();
    // NOTE: A009's own vocabulary is live-world-free by construction
    // (mount sources are the closed enum initial-state|ephemeral|
    // workspace|evidence) — a REAL definition can never carry a live
    // source. This test forges one structurally (bypassing A009
    // validation) to prove the adapter filter fails closed anyway.
    const forged = {
      ...definition,
      filesystemPolicy: {
        ...definition.filesystemPolicy,
        mounts: [
          ...definition.filesystemPolicy.mounts,
          { mountPath: '/live-db', access: 'read-write', source: 'live:prod-db' },
        ] as never,
      },
    };
    const source = executionCapsuleSourceFromDefinition(forged, {}, { taskRef: 'task-7' });
    const paths = source.files.map((file) => file.path);
    expect(paths).toEqual(['/workspace', '/task-inputs']);
    expect(paths).not.toContain('/live-db'); // live:prod-db source dropped
  });

  it('read-only mounts become read-only capsule resources', async () => {
    const definition = await makeEnvironmentDefinition();
    const source = executionCapsuleSourceFromDefinition(definition, {}, { taskRef: 'task-7' });
    const taskInputs = source.files.find((file) => file.path === '/task-inputs');
    expect(taskInputs?.readOnly).toBe(true);
    const workspace = source.files.find((file) => file.path === '/workspace');
    expect(workspace?.readOnly).toBeUndefined();
  });

  it('secret-bound tools (tools/<id> injection mounts) are excluded', async () => {
    const definition = await makeEnvironmentDefinition();
    const source = executionCapsuleSourceFromDefinition(definition, {}, { taskRef: 'task-7' });
    expect(source.excludedTools).toEqual(['admin-console']);
  });
});

describe('ExpertEnvironmentMaterializer — deterministic reference materializer', () => {
  async function command(): Promise<CapsuleMaterializationCommandLike> {
    const definition = await makeEnvironmentDefinition();
    return {
      escalationRef: { requestId: REQUEST_ID, tenantId: TENANT_A },
      sessionMode: 'teach',
      allowedModes: ['observe', 'teach'],
      source: executionCapsuleSourceFromDefinition(definition, { step: 's1' }, { taskRef: 'task-7' }),
      escalationPolicy: {
        permittedActions: ['read-context', 'run-approved-tools', 'propose-patch', 'annotate-evidence', 'signal-tool-gap'],
        privacyClassification: 'confidential',
        pii: 'redact',
        sanitization: 'strict',
        deadline: EXPIRY,
      },
      now: T0,
      expiresAt: EXPIRY,
      sessionId: 'session-adapter-test-1',
    };
  }

  it('materializes a bounded, non-authoritative capsule with the EES1.0 barrier', async () => {
    const materializer = new ExpertEnvironmentMaterializer();
    const capsule = await materializer.materialize(await command());
    expect(capsule.authority).toBe('non-authoritative-replica');
    expect(capsule.sessionId).toBe('session-adapter-test-1');
    expect(capsule.tools).toEqual(['search-vendors', 'compute-reconciliation']); // admin-console excluded
    expect(capsule.barrier.identityMasking).toBe(true);
    expect(capsule.barrier.redactedFields).toContain('customerEmail');
    expect(capsule.barrier.credentials.timeLimited).toBe(true);
    expect(capsule.barrier.readOnlyResources).toEqual(['/task-inputs']);
  });

  it('DETERMINISM: same inputs ⇒ same digest; changed policy ⇒ new digest', async () => {
    const materializer = new ExpertEnvironmentMaterializer();
    const first = await materializer.materialize(await command());
    const second = await materializer.materialize(await command());
    expect(second.digest).toBe(first.digest);
    const changed = await materializer.materialize({
      ...(await command()),
      escalationPolicy: {
        permittedActions: ['read-context'],
        privacyClassification: 'confidential',
        pii: 'allow',
        sanitization: 'standard',
        deadline: EXPIRY,
      },
    });
    expect(changed.digest).not.toBe(first.digest);
    expect(changed.barrier.identityMasking).toBe(false);
  });

  it('host-declared redactions and secret-bound tool exclusions layer on top', async () => {
    const materializer = new ExpertEnvironmentMaterializer({
      redactedFields: ['internalMargin'],
      redactedDocuments: ['/workspace/pricing.md'],
      excludedTools: ['compute-reconciliation'],
    });
    const capsule = await materializer.materialize(await command());
    expect(capsule.barrier.redactedFields).toContain('internalMargin');
    expect(capsule.barrier.redactedDocuments).toEqual(['/workspace/pricing.md']);
    expect(capsule.tools).toEqual(['search-vendors']);
  });

  it('fail-closed: an unpermitted session mode is rejected', async () => {
    const materializer = new ExpertEnvironmentMaterializer();
    await expect(
      materializer.materialize({ ...(await command()), sessionMode: 'takeover' }),
    ).rejects.toThrowError();
  });
});
