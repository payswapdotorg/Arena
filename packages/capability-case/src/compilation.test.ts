/**
 * Compilation-target suite (Work Order A005 gate 7 + gate 11):
 * TaskCompilationTarget derivation — positive (TRIAGED/ACTIVE cases),
 * negative (draft/submitted: not yet triaged; resolved/superseded:
 * terminal), content addressing and tamper detection. NO compiler logic is
 * tested here because none exists in this package — that is A008.
 */

import { describe, expect, it } from 'vitest';
import {
  COMPILABLE_CASE_STATUSES,
  TASK_COMPILATION_TARGET_VERSION,
  deriveCompilationTarget,
  isCompilableCaseStatus,
  isTaskCompilationTarget,
  verifyTaskCompilationTarget,
} from './compilation.js';
import { activateCase, submitCase, triageCase } from './lifecycle.js';
import { resolveCase } from './lifecycle.js';
import { createCapabilityCase } from './case.js';
import { CapabilityCaseError } from './errors.js';
import {
  ACTOR,
  ACTOR_SERVICE,
  AT,
  AT_EVEN_LATER,
  AT_LATER,
  validCaseInput,
} from './test-support.js';

async function triaged() {
  const draft = await createCapabilityCase(validCaseInput());
  const submitted = await submitCase(draft, { at: AT_LATER, actor: ACTOR });
  return triageCase(submitted, {
    at: AT_LATER,
    actor: ACTOR_SERVICE,
    note: 'Compile-ready after triage.',
  });
}

describe('deriveCompilationTarget (positive)', () => {
  it('derives a content-addressed target from a TRIAGED case', async () => {
    const caseRecord = await triaged();
    const target = await deriveCompilationTarget(caseRecord, { derivedAt: AT_EVEN_LATER });
    expect(target.targetVersion).toBe(TASK_COMPILATION_TARGET_VERSION);
    expect(target.caseRef.digest).toBe(caseRecord.digest);
    expect(target.caseRef.version).toBe('1.0.0');
    expect(target.domain.id).toBe('accounts-payable');
    expect(target.targetCapability.id).toBe('invoice-reconciliation');
    expect(target.taskRequirements.objectives.length).toBe(1);
    expect(target.environmentRequirements.environments.length).toBe(1);
    expect(target.evaluationRequirements.evaluators.length).toBe(1);
    expect(target.verificationRequirements.verifiers.length).toBe(1);
    expect(target.evidence.length).toBe(1);
    expect(target.currentBody?.name).toBe('invoicing-agent');
    expect(target.derivedAt).toBe(AT_EVEN_LATER);
    expect(target.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(target)).toBe(true);
    expect(isTaskCompilationTarget(target)).toBe(true);
  });

  it('derives from an ACTIVE case too, and deterministically', async () => {
    const triagedCase = await triaged();
    const activeCase = await activateCase(triagedCase, {
      at: AT_EVEN_LATER,
      actor: ACTOR_SERVICE,
    });
    const a = await deriveCompilationTarget(activeCase, { derivedAt: AT_EVEN_LATER });
    const b = await deriveCompilationTarget(activeCase, { derivedAt: AT_EVEN_LATER });
    expect(a.digest).toBe(b.digest);
    // a target from a DIFFERENT case state has a different digest
    const fromTriaged = await deriveCompilationTarget(triagedCase, {
      derivedAt: AT_EVEN_LATER,
    });
    expect(fromTriaged.digest).not.toBe(a.digest);
  });

  it('verifyTaskCompilationTarget passes on an honest target', async () => {
    const target = await deriveCompilationTarget(await triaged(), {
      derivedAt: AT_EVEN_LATER,
    });
    await expect(verifyTaskCompilationTarget(target)).resolves.toBe(target.digest);
  });

  it('the compilable status vocabulary is TRIAGED and ACTIVE', () => {
    expect(COMPILABLE_CASE_STATUSES).toEqual(['triaged', 'active']);
    expect(isCompilableCaseStatus('triaged')).toBe(true);
    expect(isCompilableCaseStatus('draft')).toBe(false);
  });
});

describe('deriveCompilationTarget (negative — eligibility, gate 7)', () => {
  it('a DRAFT case is rejected (not yet triaged)', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    await expect(deriveCompilationTarget(draft, { derivedAt: AT })).rejects.toThrow(
      /not yet triaged/,
    );
  });

  it('a SUBMITTED case is rejected (not yet triaged)', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const submitted = await submitCase(draft, { at: AT_LATER, actor: ACTOR });
    await expect(
      deriveCompilationTarget(submitted, { derivedAt: AT_EVEN_LATER }),
    ).rejects.toThrow(/not yet triaged/);
  });

  it('a RESOLVED case is rejected (terminal — open a follow-up case)', async () => {
    const triagedCase = await triaged();
    const active = await activateCase(triagedCase, {
      at: AT_EVEN_LATER,
      actor: ACTOR_SERVICE,
    });
    const resolved = await resolveCase(active, {
      at: AT_EVEN_LATER,
      actor: ACTOR_SERVICE,
      resolution: 'Shipped.',
    });
    await expect(
      deriveCompilationTarget(resolved, { derivedAt: AT_EVEN_LATER }),
    ).rejects.toThrow(/terminal — open a follow-up case/);
  });

  it('a malformed derivedAt timestamp is rejected', async () => {
    const caseRecord = await triaged();
    await expect(
      deriveCompilationTarget(caseRecord, { derivedAt: '2026-09-28T10:00:00Z' }),
    ).rejects.toThrow(CapabilityCaseError);
  });

  it('a tampered target fails verification (fail closed)', async () => {
    const target = await deriveCompilationTarget(await triaged(), {
      derivedAt: AT_EVEN_LATER,
    });
    const tampered = {
      ...target,
      digest: 'e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    } as typeof target;
    await expect(verifyTaskCompilationTarget(tampered)).rejects.toThrow(
      /digest mismatch/,
    );
    expect(isTaskCompilationTarget({ targetVersion: 99 })).toBe(false);
    expect(isTaskCompilationTarget(null)).toBe(false);
  });
});
