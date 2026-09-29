/**
 * Reference verifier tests (Work Order A013): the constraint_check and
 * evidence_provenance_validation reference implementations — real
 * content-based and provenance-based checks over REAL A002 artifacts.
 */

import { describe, expect, it } from 'vitest';
import { createVerifierDescriptor } from '@arena/verification';
import {
  HOOK_VERDICTS,
  IMPLEMENTED_VERIFIER_METHODS,
  UNIMPLEMENTED_VERIFIER_METHODS,
  makeConstraintCheckVerifier,
  makeEvidenceProvenanceValidationVerifier,
} from './verifiers.js';
import {
  CORR,
  IDEM,
  T0,
  T1,
  makeBalanceProof,
  makeConstraintDescriptorInput,
  makeConstraintReport,
  evidenceInput,
} from './test-support.js';
import type { VerifierHookInput } from './verifiers.js';

async function hookInputFixture(): Promise<{
  constraintInput: VerifierHookInput;
  provenanceDescriptor: Awaited<ReturnType<typeof createVerifierDescriptor>>;
  balance: Awaited<ReturnType<typeof makeBalanceProof>>;
  source: Awaited<ReturnType<typeof makeBalanceProof>>;
}> {
  const constraintDescriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
  const provenanceDescriptor = await createVerifierDescriptor(
    makeConstraintDescriptorInput({ verifierId: 'verifier-provenance-0001', method: 'evidence_provenance_validation' }),
  );
  const report = await makeConstraintReport(1, [
    { requirementId: 'requirement-001', satisfied: true, detail: 'suite 12/12 green' },
  ]);
  const source = await makeBalanceProof(90, undefined, { export: 'erp-close-2026-02' });
  const balance = await makeBalanceProof(2, source);
  return {
    constraintInput: {
      descriptor: constraintDescriptor,
      requirement: constraintDescriptor.requiredEvidence[0]!,
      reference: evidenceInput(report, 'test-report') as never,
      artifact: report,
    },
    provenanceDescriptor,
    balance,
    source,
  };
}

describe('the hook surface', () => {
  it('the verdict vocabulary is closed and quantitative-free', () => {
    expect([...HOOK_VERDICTS]).toEqual(['supported', 'unsupported', 'indeterminate']);
    expect(Object.isFrozen(HOOK_VERDICTS)).toBe(true);
  });

  it('exactly two methods have reference implementations (A013 scope NOTE)', () => {
    expect([...IMPLEMENTED_VERIFIER_METHODS]).toEqual([
      'constraint_check',
      'evidence_provenance_validation',
    ]);
    expect([...UNIMPLEMENTED_VERIFIER_METHODS]).toEqual([
      'unit_integration_test',
      'deterministic_formal_check',
      'simulation',
      'measurement',
      'inspection',
      'expert_review',
    ]);
  });
});

describe('makeConstraintCheckVerifier (content-based)', () => {
  it('supported when the constraint entry is satisfied', async () => {
    const { constraintInput } = await hookInputFixture();
    const verdicts = await makeConstraintCheckVerifier()(constraintInput);
    expect(verdicts).toEqual([
      {
        requirementId: 'requirement-001',
        verdict: 'supported',
        notes: 'constraint satisfied: suite 12/12 green',
      },
    ]);
  });

  it('unsupported when the constraint entry is NOT satisfied', async () => {
    const descriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
    const report = await makeConstraintReport(3, [
      { requirementId: 'requirement-001', satisfied: false, detail: 'suite 11/12, one regression' },
    ]);
    const verdicts = await makeConstraintCheckVerifier()({
      descriptor,
      requirement: descriptor.requiredEvidence[0]!,
      reference: evidenceInput(report, 'test-report') as never,
      artifact: report,
    });
    expect(verdicts[0]?.verdict).toBe('unsupported');
    expect(verdicts[0]?.notes).toContain('regression');
  });

  it('unsupported when the content carries NO entry for the requirement (never a silent pass)', async () => {
    const descriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
    const report = await makeConstraintReport(4, [
      { requirementId: 'some-other-requirement', satisfied: true },
    ]);
    const verdicts = await makeConstraintCheckVerifier()({
      descriptor,
      requirement: descriptor.requiredEvidence[0]!,
      reference: evidenceInput(report, 'test-report') as never,
      artifact: report,
    });
    expect(verdicts[0]?.verdict).toBe('unsupported');
    expect(verdicts[0]?.notes).toContain('no entry');
  });

  it('malformed content (no constraints array) is unsupported, never a crash', async () => {
    const descriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
    const report = await makeBalanceProof(5); // balance content, not constraint content
    const verdicts = await makeConstraintCheckVerifier()({
      descriptor,
      requirement: descriptor.requiredEvidence[0]!,
      reference: evidenceInput(report, 'test-report') as never,
      artifact: report,
    });
    expect(verdicts[0]?.verdict).toBe('unsupported');
  });
});

describe('makeEvidenceProvenanceValidationVerifier (producer/lineage-based)', () => {
  it('supported when the pinned producer matches', async () => {
    const { provenanceDescriptor, balance } = await hookInputFixture();
    const requirement = provenanceDescriptor.requiredEvidence[1]!; // pins erp-close-sandbox
    const verdicts = await makeEvidenceProvenanceValidationVerifier()({
      descriptor: provenanceDescriptor,
      requirement,
      reference: evidenceInput(balance, 'balance-proof', 'erp-close-sandbox') as never,
      artifact: balance,
    });
    expect(verdicts[0]?.verdict).toBe('supported');
    expect(verdicts[0]?.notes).toContain('erp-close-sandbox');
  });

  it('unsupported when the producer does NOT match the pin', async () => {
    const { provenanceDescriptor, balance } = await hookInputFixture();
    const requirement = provenanceDescriptor.requiredEvidence[1]!;
    const verdicts = await makeEvidenceProvenanceValidationVerifier()({
      descriptor: provenanceDescriptor,
      requirement,
      reference: evidenceInput(balance, 'balance-proof', 'someone-else') as never,
      artifact: balance,
    });
    expect(verdicts[0]?.verdict).toBe('unsupported');
    expect(verdicts[0]?.notes).toContain('someone-else');
  });

  it('indeterminate for lineage-free evidence (method limitation)', async () => {
    const { provenanceDescriptor } = await hookInputFixture();
    const requirement = provenanceDescriptor.requiredEvidence[0]!; // unpinned
    const lineageFree = await makeBalanceProof(6, undefined);
    const verdicts = await makeEvidenceProvenanceValidationVerifier()({
      descriptor: provenanceDescriptor,
      requirement,
      reference: evidenceInput(lineageFree, 'test-report') as never,
      artifact: lineageFree,
    });
    expect(verdicts[0]?.verdict).toBe('indeterminate');
    expect(verdicts[0]?.notes).toContain('method limitation');
  });

  it('supported for unpinned requirements with complete provenance and lineage', async () => {
    const { provenanceDescriptor, balance, source } = await hookInputFixture();
    const requirement = provenanceDescriptor.requiredEvidence[0]!;
    const verdicts = await makeEvidenceProvenanceValidationVerifier()({
      descriptor: provenanceDescriptor,
      requirement,
      reference: evidenceInput(balance, 'balance-proof', 'erp-close-sandbox') as never,
      artifact: { ...balance, refs: [{ ...source.identity, digest: source.digest }] } as never,
    });
    expect(verdicts[0]?.verdict).toBe('supported');
  });
});

// keep fixtures referenced for coherence
void CORR;
void IDEM;
void T0;
void T1;
