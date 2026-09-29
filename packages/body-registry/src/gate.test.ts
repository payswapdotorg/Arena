/**
 * Gate tests (Work Order A024) — positive AND adversarial.
 *
 * The admission gate must be REAL: every failure mode below is a
 * structured, closed-vocabulary rejection — the gate never silently
 * admits and never throws on refusable input.
 */

import { describe, expect, it } from 'vitest';
import { bodyVersionRefKey, deepFreeze } from '@arena/agent-body';
import type { BodyVersion } from '@arena/agent-body';
import type { CertificationRecord } from '@arena/certification';
import type { CompatibilityRecord } from '@arena/compatibility';
import {
  CHANNEL_GRANT_REQUIREMENTS,
  RELEASE_CHANNELS,
  RELEASE_GATE_REASONS,
  RELEASE_GATE_SOURCES,
  evaluateReleaseGate,
  isReleaseChannel,
  isReleaseGateEvidence,
  isReleaseGateReason,
  isReleaseGateRejection,
  memoryStore,
  releaseGateEvidenceDigest,
  verifyCertificationRecordIntegrity,
  verifyCompatibilityRecordIntegrity,
} from './gate.js';
import type { ReleaseGateRejection } from './gate.js';
import { BodyRegistryError, BODY_REGISTRY_ERROR_CODES, isBodyRegistryError } from './errors.js';
import {
  DIGEST_A,
  DIGEST_B,
  T2,
  makeAdmittedScenario,
  makeBodyVersion,
  makeCertificationRecord,
  makeCompatibilityRecord,
  makeForgeRecord,
} from './test-support.js';

function reasonsOf(rejections: readonly ReleaseGateRejection[]): string[] {
  return rejections.map((rejection) => rejection.reason);
}

describe('release gate — positive', () => {
  it('admits the happy path with a frozen evidence snapshot', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(scenario.candidate, scenario.stores);
    expect(verdict.admitted).toBe(true);
    expect(verdict.rejections).toEqual([]);
    expect(verdict.evidence).not.toBeNull();
    expect(bodyVersionRefKey(verdict.evidence!.bodyVersionRef)).toBe(
      `${scenario.bodyVersion.body.tenant}/${scenario.bodyVersion.body.name}@${scenario.bodyVersion.version}#${scenario.bodyVersion.digest}`,
    );
    expect(verdict.evidence!.channel).toBe('stable');
    expect(verdict.evidence!.certificationRefs).toEqual([scenario.certification.digest]);
    expect(verdict.evidence!.compatibilityRefs).toEqual([scenario.compatibility.recordDigest]);
    expect(verdict.evidence!.forgeRecordDigest).toBeNull();
    expect(verdict.evidence!.strongestGrant).toBe('CERTIFIED');
    expect(Object.isFrozen(verdict.evidence)).toBe(true);
    expect(isReleaseGateEvidence(verdict.evidence)).toBe(true);
  });

  it('admits with the forge provenance citation resolved and verified', async () => {
    const scenario = await makeAdmittedScenario({ includeForge: true });
    const verdict = await evaluateReleaseGate(scenario.candidate, scenario.stores);
    expect(verdict.admitted).toBe(true);
    expect(verdict.evidence!.forgeRecordDigest).toBe(scenario.forgeRecord!.digest);
  });

  it('admits a development-channel release with a DEVELOPMENT grant', async () => {
    const scenario = await makeAdmittedScenario({ channel: 'development', levelGrant: 'DEVELOPMENT' });
    const verdict = await evaluateReleaseGate(scenario.candidate, scenario.stores);
    expect(verdict.admitted).toBe(true);
    expect(verdict.evidence!.strongestGrant).toBe('DEVELOPMENT');
  });

  it('admits a candidate-channel release with a CANDIDATE grant', async () => {
    const scenario = await makeAdmittedScenario({ channel: 'candidate', levelGrant: 'CANDIDATE' });
    const verdict = await evaluateReleaseGate(scenario.candidate, scenario.stores);
    expect(verdict.admitted).toBe(true);
    expect(verdict.evidence!.strongestGrant).toBe('CANDIDATE');
  });

  it('the evidence snapshot digest is deterministic (reproducibility anchor)', async () => {
    const scenario = await makeAdmittedScenario();
    const first = await evaluateReleaseGate(scenario.candidate, scenario.stores);
    const second = await evaluateReleaseGate(scenario.candidate, scenario.stores);
    expect(await releaseGateEvidenceDigest(first.evidence!)).toBe(
      await releaseGateEvidenceDigest(second.evidence!),
    );
  });

  it('memoryStore resolves only the entries it holds', async () => {
    const store = memoryStore<string | null>([['deadbeef', 'x']]);
    expect(store('deadbeef')).toBe('x');
    expect(store('unknown')).toBeNull();
  });
});

describe('release gate — adversarial (certification)', () => {
  it('rejects an unresolvable certification citation', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(
      { ...scenario.candidate, certificationRefs: [DIGEST_A] },
      scenario.stores,
    );
    expect(verdict.admitted).toBe(false);
    expect(reasonsOf(verdict.rejections)).toContain('certification-unresolved');
  });

  it('rejects a structurally invalid certification record', async () => {
    const scenario = await makeAdmittedScenario();
    const broken = { ...scenario.certification, recordVersion: 99 } as unknown as CertificationRecord;
    const stores = {
      ...scenario.stores,
      certificationRecords: memoryStore<CertificationRecord>([[broken.digest, broken]]),
    };
    const verdict = await evaluateReleaseGate(scenario.candidate, stores);
    expect(reasonsOf(verdict.rejections)).toContain('certification-invalid');
  });

  it('rejects a TAMPERED certification record (digest does not match content)', async () => {
    const scenario = await makeAdmittedScenario();
    // Mutate a covered field without recomputing the digest.
    const tampered = deepFreeze({
      ...scenario.certification,
      finishedAt: T2,
    }) as unknown as CertificationRecord;
    const stores = {
      ...scenario.stores,
      certificationRecords: memoryStore<CertificationRecord>([[tampered.digest, tampered]]),
    };
    const verdict = await evaluateReleaseGate(scenario.candidate, stores);
    expect(reasonsOf(verdict.rejections)).toContain('certification-tampered');
  });

  it('verifyCertificationRecordIntegrity detects tampering and accepts the real record', async () => {
    const scenario = await makeAdmittedScenario();
    expect(await verifyCertificationRecordIntegrity(scenario.certification)).toBe(true);
    const tampered = deepFreeze({
      ...scenario.certification,
      verdict: 'not-satisfied',
    }) as unknown as CertificationRecord;
    expect(await verifyCertificationRecordIntegrity(tampered)).toBe(false);
  });

  it('rejects a NOT-SATISFIED certification record', async () => {
    const bodyVersion = await makeBodyVersion();
    const { record } = await makeCertificationRecord({
      bodyVersionDigest: bodyVersion.digest,
      verdictStages: [{ outcome: 'not-satisfied', reason: 'stage-failed' }],
    });
    const compatibility = await makeCompatibilityRecord(bodyVersion.digest);
    const stores = {
      bodyVersions: memoryStore<BodyVersion>([[bodyVersion.digest, bodyVersion]]),
      certificationRecords: memoryStore<CertificationRecord>([[record.digest, record]]),
      compatibilityRecords: memoryStore<CompatibilityRecord>([
        [compatibility.recordDigest, compatibility],
      ]),
    };
    const verdict = await evaluateReleaseGate(
      {
        bodyVersionRef: {
          tenant: bodyVersion.body.tenant,
          name: bodyVersion.body.name,
          version: bodyVersion.version,
          digest: bodyVersion.digest,
        },
        channel: 'stable',
        certificationRefs: [record.digest],
        compatibilityRefs: [compatibility.recordDigest],
        forgeRecordDigest: null,
      },
      stores,
    );
    expect(reasonsOf(verdict.rejections)).toContain('certification-unsatisfied');
  });

  it('rejects a certification scoped to a DIFFERENT body version', async () => {
    const scenario = await makeAdmittedScenario();
    const other = await makeBodyVersion({ version: '1.5.0' });
    const { record } = await makeCertificationRecord({
      bodyVersionDigest: other.digest,
      bodyVersion: '1.5.0',
    });
    const stores = {
      ...scenario.stores,
      certificationRecords: memoryStore<CertificationRecord>([[record.digest, record]]),
    };
    const verdict = await evaluateReleaseGate(
      { ...scenario.candidate, certificationRefs: [record.digest] },
      stores,
    );
    expect(reasonsOf(verdict.rejections)).toContain('certification-scope-mismatch');
  });

  it('rejects an empty certification citation list (never a rubber stamp)', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(
      { ...scenario.candidate, certificationRefs: [] },
      scenario.stores,
    );
    expect(reasonsOf(verdict.rejections)).toContain('certification-required');
  });

  it('rejects a stable-channel release backed only by a CANDIDATE grant', async () => {
    const scenario = await makeAdmittedScenario({ channel: 'stable', levelGrant: 'CANDIDATE' });
    const verdict = await evaluateReleaseGate(scenario.candidate, scenario.stores);
    expect(reasonsOf(verdict.rejections)).toContain('certification-insufficient-for-channel');
  });

  it('rejects a candidate-channel release backed only by a DEVELOPMENT grant', async () => {
    const scenario = await makeAdmittedScenario({ channel: 'candidate', levelGrant: 'DEVELOPMENT' });
    const verdict = await evaluateReleaseGate(scenario.candidate, scenario.stores);
    expect(reasonsOf(verdict.rejections)).toContain('certification-insufficient-for-channel');
  });

  it('rejects duplicate certification citations', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(
      {
        ...scenario.candidate,
        certificationRefs: [scenario.certification.digest, scenario.certification.digest],
      },
      scenario.stores,
    );
    expect(reasonsOf(verdict.rejections)).toContain('duplicate-citation');
  });

  it('rejects a citation that is not a content digest', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(
      { ...scenario.candidate, certificationRefs: ['not-a-digest'] },
      scenario.stores,
    );
    expect(reasonsOf(verdict.rejections)).toContain('invalid-citation-digest');
  });
});

describe('release gate — adversarial (compatibility)', () => {
  it('rejects an unresolvable compatibility citation', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(
      { ...scenario.candidate, compatibilityRefs: [DIGEST_B] },
      scenario.stores,
    );
    expect(reasonsOf(verdict.rejections)).toContain('compatibility-unresolved');
  });

  it('rejects a structurally invalid compatibility record', async () => {
    const scenario = await makeAdmittedScenario();
    const broken = {
      ...scenario.compatibility,
      recordVersion: 99,
    } as unknown as CompatibilityRecord;
    const stores = {
      ...scenario.stores,
      compatibilityRecords: memoryStore<CompatibilityRecord>([
        [broken.recordDigest, broken],
      ]),
    };
    const verdict = await evaluateReleaseGate(scenario.candidate, stores);
    expect(reasonsOf(verdict.rejections)).toContain('compatibility-invalid');
  });

  it('rejects a TAMPERED compatibility record (verdict mutated, digest stale)', async () => {
    const scenario = await makeAdmittedScenario();
    const tampered = deepFreeze({
      ...scenario.compatibility,
      verdict: 'incompatible-with-reasons',
    }) as unknown as CompatibilityRecord;
    const stores = {
      ...scenario.stores,
      compatibilityRecords: memoryStore<CompatibilityRecord>([
        [tampered.recordDigest, tampered],
      ]),
    };
    const verdict = await evaluateReleaseGate(scenario.candidate, stores);
    expect(reasonsOf(verdict.rejections)).toContain('compatibility-tampered');
  });

  it('verifyCompatibilityRecordIntegrity accepts BOTH documented A022 digest schemes', async () => {
    const scenario = await makeAdmittedScenario();
    // package scheme (canonical, built by the A022 registry constructor)
    expect(await verifyCompatibilityRecordIntegrity(scenario.compatibility)).toBe(true);
    // service scheme (fixed key order, null-normalized, details excluded)
    const { createHash } = await import('node:crypto');
    const serviceDigest = createHash('sha256')
      .update(
        JSON.stringify({
          recordVersion: scenario.compatibility.recordVersion,
          bodyVersionRef: scenario.compatibility.bodyVersionRef,
          substrateRef: scenario.compatibility.substrateRef,
          verdict: scenario.compatibility.verdict,
          reasons: scenario.compatibility.reasons,
          evaluatedAt: scenario.compatibility.evaluatedAt,
          parentDigest: scenario.compatibility.parentDigest ?? null,
          tenantId: scenario.compatibility.tenantId ?? null,
          workspaceId: scenario.compatibility.workspaceId ?? null,
        }),
      )
      .digest('hex');
    const serviceRecord = { ...scenario.compatibility, recordDigest: serviceDigest };
    expect(await verifyCompatibilityRecordIntegrity(serviceRecord)).toBe(true);
  });

  it('rejects an INCOMPATIBLE compatibility record', async () => {
    const bodyVersion = await makeBodyVersion();
    const { record } = await makeCertificationRecord({
      bodyVersionDigest: bodyVersion.digest,
    });
    const incompatible = await makeCompatibilityRecord(bodyVersion.digest, {
      verdict: 'incompatible-with-reasons',
    });
    const stores = {
      bodyVersions: memoryStore<BodyVersion>([[bodyVersion.digest, bodyVersion]]),
      certificationRecords: memoryStore<CertificationRecord>([[record.digest, record]]),
      compatibilityRecords: memoryStore<CompatibilityRecord>([
        [incompatible.recordDigest, incompatible],
      ]),
    };
    const verdict = await evaluateReleaseGate(
      {
        bodyVersionRef: {
          tenant: bodyVersion.body.tenant,
          name: bodyVersion.body.name,
          version: bodyVersion.version,
          digest: bodyVersion.digest,
        },
        channel: 'stable',
        certificationRefs: [record.digest],
        compatibilityRefs: [incompatible.recordDigest],
        forgeRecordDigest: null,
      },
      stores,
    );
    expect(reasonsOf(verdict.rejections)).toContain('compatibility-incompatible');
  });

  it('rejects a compatibility record addressing a different body version', async () => {
    const scenario = await makeAdmittedScenario();
    const other = await makeBodyVersion({ version: '1.5.0' });
    const mismatched = await makeCompatibilityRecord(other.digest, {
      bodyVersionAddress: `acme/structural-engineer-body@1.5.0#${other.digest}`,
    });
    const stores = {
      ...scenario.stores,
      compatibilityRecords: memoryStore<CompatibilityRecord>([
        [mismatched.recordDigest, mismatched],
      ]),
    };
    const verdict = await evaluateReleaseGate(
      { ...scenario.candidate, compatibilityRefs: [mismatched.recordDigest] },
      stores,
    );
    expect(reasonsOf(verdict.rejections)).toContain('compatibility-scope-mismatch');
  });

  it('rejects an empty compatibility citation list (never a rubber stamp)', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(
      { ...scenario.candidate, compatibilityRefs: [] },
      scenario.stores,
    );
    expect(reasonsOf(verdict.rejections)).toContain('compatibility-required');
  });
});

describe('release gate — adversarial (body version + forge + infra)', () => {
  it('rejects an unresolvable body version', async () => {
    const scenario = await makeAdmittedScenario();
    const candidate = {
      ...scenario.candidate,
      bodyVersionRef: { ...scenario.candidate.bodyVersionRef, digest: DIGEST_B },
    };
    const verdict = await evaluateReleaseGate(candidate, scenario.stores);
    expect(reasonsOf(verdict.rejections)).toContain('body-version-unresolved');
  });

  it('rejects when the resolved body version is a DIFFERENT identity than cited', async () => {
    const scenario = await makeAdmittedScenario();
    const candidate = {
      ...scenario.candidate,
      bodyVersionRef: { ...scenario.candidate.bodyVersionRef, version: '9.9.9' },
    };
    const verdict = await evaluateReleaseGate(candidate, scenario.stores);
    expect(reasonsOf(verdict.rejections)).toContain('body-version-ref-mismatch');
  });

  it('rejects an invalid bodyVersionRef shape outright', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(
      {
        ...scenario.candidate,
        bodyVersionRef: { tenant: '', name: '', version: '', digest: 'x' },
      },
      scenario.stores,
    );
    expect(reasonsOf(verdict.rejections)).toContain('invalid-body-version-ref');
    expect(verdict.evidence).toBeNull();
  });

  it('rejects an unknown channel', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(
      { ...scenario.candidate, channel: 'nightly' },
      scenario.stores,
    );
    expect(reasonsOf(verdict.rejections)).toContain('invalid-channel');
  });

  it('rejects a forge citation when no forge store is injected (fail-closed)', async () => {
    const scenario = await makeAdmittedScenario();
    const forgeRecord = await makeForgeRecord(scenario.bodyVersion.digest);
    const verdict = await evaluateReleaseGate(
      { ...scenario.candidate, forgeRecordDigest: forgeRecord.digest },
      scenario.stores, // no forgeRecords store
    );
    expect(reasonsOf(verdict.rejections)).toContain('forge-unresolved');
  });

  it('rejects an unresolvable forge citation', async () => {
    const scenario = await makeAdmittedScenario({ includeForge: true });
    const verdict = await evaluateReleaseGate(
      { ...scenario.candidate, forgeRecordDigest: DIGEST_A },
      scenario.stores,
    );
    expect(reasonsOf(verdict.rejections)).toContain('forge-unresolved');
  });

  it('rejects a forge record that forged a different body version', async () => {
    const scenario = await makeAdmittedScenario({ includeForge: true });
    const other = await makeForgeRecord(
      (await makeBodyVersion({ version: '1.5.0' })).digest,
      '1.5.0',
    );
    const stores = {
      ...scenario.stores,
      forgeRecords: (digest: string) => (digest === other.digest ? other : null),
    };
    const verdict = await evaluateReleaseGate(
      { ...scenario.candidate, forgeRecordDigest: other.digest },
      stores,
    );
    expect(reasonsOf(verdict.rejections)).toContain('forge-scope-mismatch');
  });

  it('fails CLOSED (throws) when an evidence store throws', async () => {
    const scenario = await makeAdmittedScenario();
    const stores = {
      ...scenario.stores,
      certificationRecords: () => {
        throw new Error('store down');
      },
    };
    await expect(evaluateReleaseGate(scenario.candidate, stores)).rejects.toSatisfy(
      (error: unknown) => isBodyRegistryError(error),
    );
    try {
      await evaluateReleaseGate(scenario.candidate, stores);
    } catch (error) {
      expect((error as BodyRegistryError).code).toBe(
        BODY_REGISTRY_ERROR_CODES.EVIDENCE_UNRESOLVABLE,
      );
    }
  });

  it('collects MULTIPLE rejections in one verdict (structured, not first-fail)', async () => {
    const scenario = await makeAdmittedScenario();
    const verdict = await evaluateReleaseGate(
      {
        ...scenario.candidate,
        channel: 'nightly',
        certificationRefs: [DIGEST_A],
        compatibilityRefs: [DIGEST_B],
      },
      scenario.stores,
    );
    const reasons = reasonsOf(verdict.rejections);
    expect(reasons).toContain('invalid-channel');
    expect(reasons).toContain('certification-unresolved');
    expect(reasons).toContain('compatibility-unresolved');
  });
});

describe('release gate — vocabularies', () => {
  it('the channel vocabulary is closed and frozen', () => {
    expect([...RELEASE_CHANNELS]).toEqual(['development', 'candidate', 'stable']);
    expect(Object.isFrozen(RELEASE_CHANNELS)).toBe(true);
    expect(isReleaseChannel('stable')).toBe(true);
    expect(isReleaseChannel('nightly')).toBe(false);
  });

  it('the channel grant requirements encode the quality-model discipline', () => {
    expect([...CHANNEL_GRANT_REQUIREMENTS.stable]).toEqual(['CERTIFIED']);
    expect([...CHANNEL_GRANT_REQUIREMENTS.candidate]).toEqual(['CANDIDATE', 'CERTIFIED']);
    expect(CHANNEL_GRANT_REQUIREMENTS.development).toHaveLength(3);
  });

  it('the rejection reason vocabulary is closed and frozen', () => {
    expect(Object.isFrozen(RELEASE_GATE_REASONS)).toBe(true);
    expect(RELEASE_GATE_REASONS.length).toBeGreaterThanOrEqual(20);
    expect(isReleaseGateReason('certification-tampered')).toBe(true);
    expect(isReleaseGateReason('definitely-not-a-reason')).toBe(false);
  });

  it('rejections are structurally checkable and wire-safe', () => {
    const scenario = makeRejectionFixture();
    expect(isReleaseGateRejection(scenario)).toBe(true);
    expect(isReleaseGateRejection({ reason: 'nope', source: 'x', ref: null, detail: '' })).toBe(
      false,
    );
    expect(RELEASE_GATE_SOURCES).toContain('certification');
  });
});

function makeRejectionFixture(): ReleaseGateRejection {
  return {
    reason: 'certification-unresolved',
    source: 'certification',
    ref: DIGEST_A,
    detail: 'cited certification record does not resolve',
  };
}
