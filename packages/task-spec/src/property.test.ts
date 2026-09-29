/**
 * Property suite (Work Order A008) — determinism and purity properties of
 * the TaskSpec + CompilationPolicy objects, run over deterministic input
 * variation (no randomness: a fixed variation table).
 */

import { describe, expect, it } from 'vitest';
import { validSpecInput, validPolicyInput } from './test-support.js';
import { createTaskSpec } from './spec.js';
import { createCompilationPolicy } from './compilation-policy.js';
import { digestCanonical } from '@arena/protocol-core';
import { taskSpecContentView } from './spec.js';
import { guardTaskSpecView } from './guards.js';

/** Deterministic variation table (no Math.random — reproducibility). */
const VARIATIONS = [
  { label: 'baseline' },
  { label: 'class-diagnosis', taskClass: 'diagnosis' },
  { label: 'class-benchmark', taskClass: 'benchmark' },
  { label: 'version-2', version: '2.0.0' },
  { label: 'more-objectives', objectives: ['objective one', 'objective two', 'objective three'] },
  { label: 'no-shortcuts', prohibitedShortcuts: [] },
  { label: 'no-tools', permittedTools: [] },
  { label: 'public-data-rights', dataRights: {
    classification: 'public',
    tenantScope: 'tenant-alpha',
    crossTenantReuse: false,
    licensing: 'CC-BY-4.0',
    privacyNotes: null,
  } },
] as const;

describe('determinism properties', () => {
  it('same content ⇒ same digest, across all variations', async () => {
    for (const variation of VARIATIONS) {
      const { label, ...fields } = variation;
      const input = validSpecInput(fields as never);
      const a = await createTaskSpec(input);
      const b = await createTaskSpec(validSpecInput(fields as never));
      expect(a.digest, `variation ${label}`).toBe(b.digest);
    }
  });

  it('ANY content difference ⇒ different digest (avalanche over the view)', async () => {
    const baseline = await createTaskSpec(validSpecInput());
    for (const variation of VARIATIONS.slice(1)) {
      const { label, ...fields } = variation;
      const variant = await createTaskSpec(validSpecInput(fields as never));
      expect(variant.digest, `variation ${label}`).not.toBe(baseline.digest);
    }
  });

  it('the digest covers the ENTIRE view (recompute equals claim, always)', async () => {
    for (const variation of VARIATIONS) {
      const { label, ...fields } = variation;
      const spec = await createTaskSpec(validSpecInput(fields as never));
      const recomputed = await digestCanonical(taskSpecContentView(spec));
      expect(recomputed, `variation ${label}`).toBe(spec.digest);
    }
  });

  it('guards are idempotent: guarding a guarded view is a no-op', () => {
    const input = validSpecInput();
    const once = guardTaskSpecView(input);
    const twice = guardTaskSpecView(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('policy: same rules ⇒ same digest, across deterministic policy variations', async () => {
    const variations = [
      validPolicyInput(),
      { ...validPolicyInput(), identity: { taskIdPrefix: 'other-', initialVersion: '1.0.0' } },
      {
        ...validPolicyInput(),
        difficulty: { mode: 'declared', scale: 'arena:task-difficulty@1', declaredClass: 'routine' },
      },
      {
        ...validPolicyInput(),
        environment: { selection: 'each', seed: null, note: 'one spec per env' },
      },
    ];
    for (const [index, input] of variations.entries()) {
      const a = await createCompilationPolicy(input);
      const b = await createCompilationPolicy(variations[index] as never);
      expect(a.digest).toBe(b.digest);
    }
    for (let i = 1; i < variations.length; i += 1) {
      const a = await createCompilationPolicy(variations[0] as never);
      const b = await createCompilationPolicy(variations[i] as never);
      expect(a.digest).not.toBe(b.digest);
    }
  });

  it('purity: construction never mutates its input', async () => {
    const input = validSpecInput();
    const before = JSON.stringify(input);
    await createTaskSpec(input);
    expect(JSON.stringify(input)).toBe(before);

    const policyInput = validPolicyInput();
    const policyBefore = JSON.stringify(policyInput);
    await createCompilationPolicy(policyInput);
    expect(JSON.stringify(policyInput)).toBe(policyBefore);
  });
});
