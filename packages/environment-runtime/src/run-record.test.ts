/**
 * RunRecord tests (Work Order A010 gates 2, 5, 6, 13):
 *   - content addressing: same inputs ⇒ same digest; ANY field change ⇒
 *     new digest (field-by-field matrix);
 *   - deep freeze: no mutation API;
 *   - tenant isolation at construction (runId tenant must match the
 *     tenant field, and the tenant is part of the digest);
 *   - negative: strict shape, malformed digests/ids/timestamps/seeds,
 *     runtime leakage, secret-material fields.
 */

import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import {
  RUN_RECORD_FIELDS,
  createRunRecord,
  isJobRef,
  isRunRecord,
  runIsolationEnvelope,
  runRecordView,
  toJobRef,
  verifyRunRecord,
} from './run-record.js';
import {
  DIGEST_B,
  DIGEST_C,
  TENANT_A,
  TENANT_B,
  makeDeclarationInput,
} from './test-support.js';

describe('RunRecord content addressing (gate 2)', () => {
  it('same inputs ⇒ same digest (positive)', async () => {
    const a = await createRunRecord(makeDeclarationInput());
    const b = await createRunRecord(makeDeclarationInput());
    expect(a.digest).toBe(b.digest);
    expect(canonicalJson(runRecordView(a))).toBe(canonicalJson(runRecordView(b)));
    expect(isRunRecord(a)).toBe(true);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('any change ⇒ new digest (positive — field-by-field matrix, gate 2)', async () => {
    const base = await createRunRecord(makeDeclarationInput());
    const variants: Array<[string, ReturnType<typeof makeDeclarationInput>]> = [
      ['runKey', makeDeclarationInput({ runKey: 'run-000043' })],
      ['tenantId', makeDeclarationInput({ tenantId: TENANT_B })],
      ['seed', makeDeclarationInput({ seed: 'seed-9999' })],
      ['seed-null', makeDeclarationInput({ seed: null })],
      ['jobRef', makeDeclarationInput({ jobRef: 'job-abc123' })],
      ['initialSnapshotDigest', makeDeclarationInput({ initialSnapshotDigest: DIGEST_C })],
      ['environmentDigest', makeDeclarationInput({ environmentDigest: DIGEST_B })],
      ['cpuMillis', makeDeclarationInput({ cpuMillis: 2001 })],
      ['memoryMiB', makeDeclarationInput({ memoryMiB: 513 })],
      ['wallClockSeconds', makeDeclarationInput({ wallClockSeconds: 601 })],
      [
        'networkAllows',
        makeDeclarationInput({
          networkAllows: [{ host: 'other.example.org', port: 443, protocol: 'https' }],
        }),
      ],
      [
        'mounts',
        makeDeclarationInput({
          mounts: [{ mountPath: '/workspace', access: 'read-only', source: 'workspace' }],
        }),
      ],
      [
        'secretPoints',
        makeDeclarationInput({
          secretPoints: [
            { secretId: 'other-credentials', mountPath: '/run/secrets/other', mechanism: 'stream' },
          ],
        }),
      ],
      ['submittedAt', makeDeclarationInput({ submittedAt: '2026-01-15T09:30:00.001Z' })],
    ];
    expect(variants.length).toBe(14);
    for (const [label, input] of variants) {
      const variant = await createRunRecord(input);
      expect(variant.digest, `changing ${label} must change the digest`).not.toBe(base.digest);
    }
  });

  it('the tenant id is part of the digest (gate 6)', async () => {
    const tenantA = await createRunRecord(makeDeclarationInput({ tenantId: TENANT_A }));
    const tenantB = await createRunRecord(makeDeclarationInput({ tenantId: TENANT_B }));
    expect(tenantA.digest).not.toBe(tenantB.digest);
  });

  it('verifies and detects tampering (positive + negative)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    await expect(verifyRunRecord(record)).resolves.toBe(record.digest);
    await expect(verifyRunRecord(record, record.digest)).resolves.toBe(record.digest);
    const tampered = { ...record, tenantId: TENANT_B };
    await expect(verifyRunRecord(tampered as never)).rejects.toThrow(EnvironmentRuntimeError);
  });

  it('exposes the isolation envelope slice (gate 5)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    const envelope = runIsolationEnvelope(record);
    expect(envelope.resource.cpuMillis).toBe(2000);
    expect(envelope.network.egress).toBe('default-deny');
    expect(envelope.filesystem.writeMode).toBe('declared-mounts-only');
    expect(envelope.secret.isolation).toBe('isolation-boundary');
  });
});

describe('RunRecord construction rejections (gate 2 negatives)', () => {
  it('rejects a tenant field contradicting the run id tenant (gate 6 negative)', async () => {
    const error = await capture(async () => {
      const input = makeDeclarationInput();
      await createRunRecord({ ...input, tenantId: TENANT_B });
    });
    expect(error?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.TENANT_ISOLATION_VIOLATION);
  });

  it('rejects malformed fields (negative)', async () => {
    const cases: Array<[string, unknown]> = [
      ['bad run id', { ...makeDeclarationInput(), runId: 'not scoped' }],
      ['bad tenant', { ...makeDeclarationInput(), tenantId: 'Bad Tenant' }],
      [
        'bad environment digest',
        { ...makeDeclarationInput(), environment: { namespace: 'a', name: 'b', version: '1.0.0', digest: 'zz' } },
      ],
      ['bad job ref', { ...makeDeclarationInput(), jobRef: 'not a job ref!' }],
      ['bad snapshot digest', { ...makeDeclarationInput(), initialSnapshotDigest: 'xyz' }],
      ['bad seed charset', { ...makeDeclarationInput(), seed: 'bad seed!' }],
      ['bad timestamp', { ...makeDeclarationInput(), submittedAt: '2026-01-15 09:30' }],
      ['zero cpu', { ...makeDeclarationInput(), resourceEnvelope: { cpuMillis: 0, memoryMiB: 512, wallClockSeconds: 600 } }],
      [
        'network allow-all',
        { ...makeDeclarationInput(), networkEnvelope: { egress: 'allow-all' } },
      ],
      [
        'blanket write mode',
        { ...makeDeclarationInput(), filesystemEnvelope: { writeMode: 'read-write-anywhere' } },
      ],
      [
        'secret isolation off',
        { ...makeDeclarationInput(), secretEnvelope: { isolation: 'none' } },
      ],
      ['unknown field', { ...makeDeclarationInput(), extra: true }],
    ];
    for (const [label, input] of cases) {
      const error = await capture(() => createRunRecord(input as never));
      expect(error, label).toBeInstanceOf(EnvironmentRuntimeError);
    }
  });

  it('rejects missing required fields (negative)', async () => {
    const input = makeDeclarationInput() as unknown as Record<string, unknown>;
    for (const field of ['runId', 'tenantId', 'environment', 'jobRef', 'seed', 'submittedAt']) {
      const partial = { ...input };
      delete partial[field];
      const error = await capture(() => createRunRecord(partial as never));
      expect(error?.message).toContain('missing required field');
    }
    expect(RUN_RECORD_FIELDS.length).toBe(12);
  });

  it('rejects runner/provider leakage and secret material (gate 13 negatives)', async () => {
    const leak = await capture(() =>
      createRunRecord(makeDeclarationInput({ runKey: 'docker-run-1' })),
    );
    expect(leak?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.RUNTIME_LEAKAGE);

    const withSecretValue = {
      ...makeDeclarationInput(),
      password: 'hunter2',
    };
    const secret = await capture(() => createRunRecord(withSecretValue as never));
    expect(secret?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.CREDENTIAL_REJECTED);
  });

  it('job ref guards (positive + negative)', () => {
    expect(isJobRef('job-7f3a2b')).toBe(true);
    expect(isJobRef('Job.42_x')).toBe(true);
    expect(isJobRef('')).toBe(false);
    expect(isJobRef('has space')).toBe(false);
    expect(toJobRef('job-1')).toBe('job-1');
    expect(() => toJobRef('no!')).toThrow(EnvironmentRuntimeError);
  });
});

async function capture(fn: () => Promise<unknown>): Promise<EnvironmentRuntimeError | undefined> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof EnvironmentRuntimeError) return error;
  }
  return undefined;
}

