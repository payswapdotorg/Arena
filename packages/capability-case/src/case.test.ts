/**
 * CapabilityCase suite (Work Order A005 gate 2 + gate 11): the versioned,
 * content-addressed, immutable case object. Positive tests for construction
 * with ALL §5 fields; NEGATIVE tests per FIELD GROUP (a missing or invalid
 * required field is a structured CapabilityCaseError); content-addressing
 * determinism; tamper detection; deep-freeze.
 */

import { describe, expect, it } from 'vitest';
import {
  CASE_PRIORITIES,
  CASE_RISK_LEVELS,
  CAPABILITY_CASE_RECORD_VERSION,
  capabilityCaseContentView,
  caseVersionRef,
  computeCapabilityCaseDigest,
  createCapabilityCase,
  isCapabilityCase,
  verifyCapabilityCase,
} from './case.js';
import type { CreateCapabilityCaseInput } from './case.js';
import { CapabilityCaseError } from './errors.js';
import { formatCaseVersionRef } from './identity.js';
import { DIGEST_A, DIGEST_B, DIGEST_C, DIGEST_D, DIGEST_E, validCaseInput } from './test-support.js';

describe('createCapabilityCase (positive — every §5 field present)', () => {
  it('creates a frozen draft case with all §5 and CC1.0 fields', async () => {
    const caseRecord = await createCapabilityCase(validCaseInput());
    expect(caseRecord.recordVersion).toBe(CAPABILITY_CASE_RECORD_VERSION);
    expect(caseRecord.status).toBe('draft');
    expect(caseRecord.identity.tenant).toBe('tenant-a');
    expect(caseRecord.identity.caseId).toBe('case-review-invoices');
    expect(caseRecord.version).toBe('1.0.0');
    // §5 fields
    expect(caseRecord.targetCapability.kind).toBe('capability');
    expect(caseRecord.domain.kind).toBe('domain');
    expect(caseRecord.context.length).toBeGreaterThan(0);
    expect(caseRecord.observedFailure.summary.length).toBeGreaterThan(0);
    expect(caseRecord.evidence.length).toBe(1);
    expect(caseRecord.evidence[0]?.digest).toBe(DIGEST_C);
    expect(caseRecord.currentBody?.name).toBe('invoicing-agent');
    expect(caseRecord.currentSubstrate?.modelId).toBe('large-reasoner');
    expect(caseRecord.unknowns.length).toBe(1);
    expect(caseRecord.desiredOutcome.length).toBeGreaterThan(0);
    expect(caseRecord.expertRequirements.competencies.length).toBe(1);
    expect(caseRecord.environmentRequirements.environments.length).toBe(1);
    expect(caseRecord.taskRequirements.objectives.length).toBe(1);
    expect(caseRecord.evaluationRequirements.evaluators.length).toBe(1);
    expect(caseRecord.verificationRequirements.verifiers.length).toBe(1);
    // CC1.0 fields
    expect(caseRecord.source.type).toBe('user');
    expect(caseRecord.problemStatement.length).toBeGreaterThan(0);
    expect(caseRecord.priority).toBe('high');
    expect(caseRecord.risk).toBe('moderate');
    expect(caseRecord.provenance.recordDigest).toBe(DIGEST_A);
    // lifecycle: exactly one case-created event
    expect(caseRecord.lifecycle.length).toBe(1);
    expect(caseRecord.lifecycle[0]?.kind).toBe('case-created');
    expect(caseRecord.lifecycle[0]?.sequence).toBe(1);
    // digest
    expect(caseRecord.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(isCapabilityCase(caseRecord)).toBe(true);
  });

  it('a case may predate a body: currentBody/currentSubstrate are optional', async () => {
    const { currentBody: _b, currentSubstrate: _s, ...input } = validCaseInput();
    const caseRecord = await createCapabilityCase(input);
    expect(caseRecord.currentBody).toBeUndefined();
    expect(caseRecord.currentSubstrate).toBeUndefined();
    expect(await verifyCapabilityCase(caseRecord)).toBe(caseRecord.digest);
  });

  it('content addressing is deterministic: same input ⇒ same digest', async () => {
    const a = await createCapabilityCase(validCaseInput());
    const b = await createCapabilityCase(validCaseInput());
    expect(a.digest).toBe(b.digest);
    // and different content ⇒ different digest
    const other = await createCapabilityCase({
      ...validCaseInput(),
      desiredOutcome: 'A materially different desired outcome.',
    });
    expect(other.digest).not.toBe(a.digest);
  });

  it('the digest covers the ENTIRE content view (status + evidence + history)', async () => {
    const caseRecord = await createCapabilityCase(validCaseInput());
    const view = capabilityCaseContentView(caseRecord);
    const recomputed = await computeCapabilityCaseDigest(view);
    expect(recomputed).toBe(caseRecord.digest);
    const tamperedView = { ...view, desiredOutcome: 'tampered' };
    expect(await computeCapabilityCaseDigest(tamperedView)).not.toBe(caseRecord.digest);
  });

  it('verifyCapabilityCase passes and returns the digest', async () => {
    const caseRecord = await createCapabilityCase(validCaseInput());
    await expect(verifyCapabilityCase(caseRecord)).resolves.toBe(caseRecord.digest);
    await expect(verifyCapabilityCase(caseRecord, caseRecord.digest)).resolves.toBe(
      caseRecord.digest,
    );
  });

  it('caseVersionRef addresses the exact state (R3-style addressability)', async () => {
    const caseRecord = await createCapabilityCase(validCaseInput());
    const ref = caseVersionRef(caseRecord);
    expect(formatCaseVersionRef(ref)).toBe(
      `arena:case/tenant-a/case-review-invoices@1.0.0#${caseRecord.digest}`,
    );
  });

  it('supersession refs are accepted when strictly version-increasing', async () => {
    const first = await createCapabilityCase(validCaseInput());
    const second = await createCapabilityCase({
      ...validCaseInput(),
      version: '1.1.0',
      supersedes: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '1.0.0',
        digest: first.digest,
      },
    });
    expect(second.supersedes?.digest).toBe(first.digest);
  });

  it('parent refs support follow-up cases across case ids (CC1.0 branches)', async () => {
    const original = await createCapabilityCase(validCaseInput());
    const followUp = await createCapabilityCase({
      ...validCaseInput(),
      identity: { tenant: 'tenant-a', caseId: 'case-review-invoices-followup' },
      parent: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '1.0.0',
        digest: original.digest,
      },
    });
    expect(followUp.parent?.caseId).toBe('case-review-invoices');
  });

  it('the case object graph is deep-frozen', async () => {
    const caseRecord = await createCapabilityCase(validCaseInput());
    expect(Object.isFrozen(caseRecord)).toBe(true);
    expect(Object.isFrozen(caseRecord.identity)).toBe(true);
    expect(Object.isFrozen(caseRecord.evidence)).toBe(true);
    expect(Object.isFrozen(caseRecord.evidence[0])).toBe(true);
    expect(Object.isFrozen(caseRecord.expertRequirements)).toBe(true);
    expect(Object.isFrozen(caseRecord.lifecycle)).toBe(true);
    expect(Object.isFrozen(caseRecord.lifecycle[0])).toBe(true);
  });
});

describe('createCapabilityCase (negative — per field group, gate 2)', () => {
  /** CreateCapabilityCaseInput with readonly stripped, for mutation-based negatives. */
  type MutableInput = {
    -readonly [K in keyof CreateCapabilityCaseInput]: CreateCapabilityCaseInput[K];
  };
  const expectFieldError = async (
    mutate: (input: MutableInput) => void,
    message: RegExp | ErrorConstructor,
  ): Promise<void> => {
    const input = validCaseInput() as MutableInput;
    mutate(input);
    await expect(createCapabilityCase(input)).rejects.toThrow(message);
  };

  it('identity: invalid tenant is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.identity = { tenant: 'Bad Tenant', caseId: 'case-x' };
      },
      /invalid tenant scope/,
    );
  });

  it('identity: invalid case id is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.identity = { tenant: 'tenant-a', caseId: 'Bad Id' };
      },
      /invalid case id/,
    );
  });

  it('version: build metadata is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.version = '1.0.0+build.1';
      },
      /invalid case version/,
    );
  });

  it('source: an invalid principal is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.source = { type: 'model', tenant: 'tenant-a', principalId: 'x' };
      },
      /unknown principal type/,
    );
  });

  it('problemStatement: empty is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.problemStatement = '';
      },
      /non-empty problem statement/,
    );
  });

  it('targetCapability: a non-capability kind is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.targetCapability = { kind: 'domain', id: 'd', version: '1.0.0', digest: DIGEST_A };
      },
      /is not allowed here/,
    );
  });

  it('domain: a non-domain kind is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.domain = { kind: 'skill', id: 's', version: '1.0.0', digest: DIGEST_A };
      },
      /is not allowed here/,
    );
  });

  it('context: empty is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.context = '';
      },
      /non-empty known-context/,
    );
  });

  it('observedFailure: an invalid record is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.observedFailure = { ...input.observedFailure, summary: '' };
      },
      /non-empty summary/,
    );
  });

  it('evidence: an empty evidence list is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.evidence = [];
      },
      /at least one digest-addressed evidence/,
    );
  });

  it('evidence: a malformed evidence ref is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.evidence = [{ digest: 'not-a-digest', description: 'x' }];
      },
      /sha256 content digest/,
    );
  });

  it('evidence: duplicate digests are rejected', async () => {
    await expectFieldError(
      (input) => {
        input.evidence = [
          { digest: DIGEST_C, description: 'first' },
          { digest: DIGEST_C, description: 'duplicate' },
        ];
      },
      /attached more than once/,
    );
  });

  it('unknowns: an empty uncertainty assessment is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.unknowns = [];
      },
      /at least one unknown/,
    );
  });

  it('desiredOutcome: empty is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.desiredOutcome = '';
      },
      /non-empty desired-outcome/,
    );
  });

  it('expertRequirements: zero competencies is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.expertRequirements = { competencies: [] };
      },
      /at least one competency/,
    );
  });

  it('environmentRequirements: zero environments is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.environmentRequirements = { environments: [] };
      },
      /at least one/,
    );
  });

  it('taskRequirements: zero objectives is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.taskRequirements = { ...input.taskRequirements, objectives: [] };
      },
      /objectives.*at least 1/,
    );
  });

  it('evaluationRequirements: zero evaluators is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.evaluationRequirements = { evaluators: [], criteria: ['c'] };
      },
      /at least one evaluator/,
    );
  });

  it('verificationRequirements: zero verifiers is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.verificationRequirements = { verifiers: [], evidenceStandards: ['s'] };
      },
      /at least one verifier/,
    );
  });

  it('currentBody: a cross-tenant body ref is rejected (lock rule 11)', async () => {
    await expectFieldError(
      (input) => {
        input.currentBody = {
          tenant: 'tenant-b',
          name: 'invoicing-agent',
          version: '3.2.1',
          digest: DIGEST_D,
        };
      },
      /case's tenant scope/,
    );
  });

  it('provenance: an invalid ref is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.provenance = { recordDigest: 'nope' };
      },
      /valid provenance reference/,
    );
  });

  it('priority: an unknown class is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.priority = 'urgent-plus';
      },
      /unknown case priority/,
    );
  });

  it('risk: an unknown class is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.risk = 'catastrophic';
      },
      /unknown case risk/,
    );
  });

  it('createdAt: a non-canonical timestamp is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.createdAt = '2026-09-28T10:00:00Z';
      },
      /invalid capability-case timestamp/,
    );
  });

  it('supersedes: a cross-case ref is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.supersedes = {
          tenant: 'tenant-a',
          caseId: 'some-other-case',
          version: '0.9.0',
          digest: DIGEST_B,
        };
      },
      /same logical case/,
    );
  });

  it('supersedes: a non-increasing version is rejected', async () => {
    await expectFieldError(
      (input) => {
        input.version = '1.0.0';
        input.supersedes = {
          tenant: 'tenant-a',
          caseId: 'case-review-invoices',
          version: '2.0.0',
          digest: DIGEST_B,
        };
      },
      /STRICTLY higher/,
    );
  });
});

describe('verifyCapabilityCase (negative — tamper detection)', () => {
  it('a tampered digest fails closed with CAPABILITY_CASE_TAMPERED', async () => {
    const caseRecord = await createCapabilityCase(validCaseInput());
    const tampered = { ...caseRecord, digest: DIGEST_E } as typeof caseRecord;
    await expect(verifyCapabilityCase(tampered)).rejects.toThrow(/digest mismatch/);
    await expect(verifyCapabilityCase(caseRecord, DIGEST_E)).rejects.toThrow(
      CapabilityCaseError,
    );
  });

  it('in-place mutation of a frozen case throws (deep-freeze)', async () => {
    const caseRecord = await createCapabilityCase(validCaseInput());
    expect(() => {
      (caseRecord as unknown as Record<string, unknown>)['status'] = 'active';
    }).toThrow(TypeError);
    expect(() => {
      (caseRecord.evidence as unknown as Record<string, unknown>)['0'] = {};
    }).toThrow(TypeError);
  });

  it('isCapabilityCase rejects non-case values', async () => {
    expect(isCapabilityCase(null)).toBe(false);
    expect(isCapabilityCase({})).toBe(false);
    expect(isCapabilityCase({ recordVersion: 2 })).toBe(false);
    const caseRecord = await createCapabilityCase(validCaseInput());
    expect(isCapabilityCase({ ...caseRecord, recordVersion: 99 })).toBe(false);
  });
});

describe('vocabulary exports (parity anchors)', () => {
  it('exposes the priority and risk vocabularies', () => {
    expect(CASE_PRIORITIES).toEqual(['low', 'normal', 'high', 'critical']);
    expect(CASE_RISK_LEVELS).toEqual(['low', 'moderate', 'high', 'severe']);
  });
});
