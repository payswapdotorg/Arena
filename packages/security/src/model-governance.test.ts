/**
 * Model data governance tests (Work Order A034): configurable input/
 * output retention, classification, and the secret gate ("secrets never
 * enter generic trajectories").
 *
 * PUSH-PROTECTION DISCIPLINE: every credential-shaped fixture in this
 * file is ASSEMBLED AT RUNTIME from string fragments — no realistic
 * secret shape ever appears in the committed source.
 */

import { describe, expect, it } from 'vitest';
import {
  assertNoSecretsForTrajectory,
  classifyModelInteraction,
  containsSecrets,
  detectSecrets,
  isModelDataPolicy,
  MODEL_DATA_CLASSIFICATIONS,
  modelInteractionRetention,
  SECRET_KINDS,
  SECRET_REDACTION_MARKER,
  SecurityError,
  scrubSecrets,
  toModelDataPolicy,
} from './index.js';
import { makeModelDataPolicyInput, T0, TENANT_A } from './test-support.js';

// ---------------------------------------------------------------------------
// RUNTIME-ASSEMBLED credential fixtures (never literals in source).
// ---------------------------------------------------------------------------

/** A GitHub-personal-access-token-shaped string, assembled at runtime. */
const FAKE_GH_TOKEN = ['gh', 'p_', 'A'.repeat(30), '9Xk2'].join('');
/** An API-key-shaped string, assembled at runtime. */
const FAKE_SK_KEY = ['sk', '-', 'B'.repeat(30), '7Qm1'].join('');
/** An AWS-access-key-id-shaped string, assembled at runtime. */
const FAKE_AWS_KEY = ['AK', 'IA', 'C'.repeat(18)].join('');
/** A bearer-token-shaped string, assembled at runtime. */
const FAKE_BEARER = ['Bea', 'rer ', 'D'.repeat(30)].join('');
/** A private key block, assembled at runtime. */
const FAKE_PRIVATE_KEY = [
  '-----BEGIN ',
  'RSA ',
  'PRIVATE KEY-----',
  'MIIEowIBAAKCAQEA',
].join('');

describe('model data policy validation', () => {
  it('accepts a well-formed per-tenant policy with input/output retention', () => {
    const policy = toModelDataPolicy(makeModelDataPolicyInput());
    expect(policy.tenantId).toBe(TENANT_A);
    expect(policy.inputRetention.mode).toBe('fixed-days');
    expect(policy.outputRetention.mode).toBe('none');
    expect(policy.defaultClassification).toBe('tenant-internal');
    expect(isModelDataPolicy(policy)).toBe(true);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('a per-task policy overrides retention per task reference', () => {
    const policy = toModelDataPolicy(
      makeModelDataPolicyInput({ taskPolicyRef: 'task-policy-sev2' }),
    );
    expect(policy.taskPolicyRef).toBe('task-policy-sev2');
  });

  it('input and output retention project independently', () => {
    const policy = toModelDataPolicy(makeModelDataPolicyInput());
    const input = modelInteractionRetention(policy, 'input', T0);
    const output = modelInteractionRetention(policy, 'output', T0);
    expect(input.policy.mode).toBe('fixed-days');
    expect(input.expiresAt).toBe('2026-10-30T00:00:00.000Z');
    expect(output.policy.mode).toBe('none');
    expect(output.expiresAt).toBeNull();
  });

  it('closed classification vocabulary', () => {
    expect(MODEL_DATA_CLASSIFICATIONS).toEqual(['public', 'tenant-internal', 'sensitive']);
    expect(() =>
      toModelDataPolicy(makeModelDataPolicyInput({ defaultClassification: 'top-secret' })),
    ).toThrowError(/must be one of/);
  });
});

describe('secret detection (runtime-assembled fixtures)', () => {
  it('detects github-token-shaped content', () => {
    const text = `deploy with token ${FAKE_GH_TOKEN} please`;
    const findings = detectSecrets(text);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.kind).toBe('github-token');
    expect(containsSecrets(text)).toBe(true);
    // previews are redacted — the raw secret never appears in a finding
    expect(JSON.stringify(findings)).not.toContain(FAKE_GH_TOKEN);
  });

  it('detects api-key-, aws-, bearer- and private-key-shaped content', () => {
    for (const [secret, expectedKind] of [
      [FAKE_SK_KEY, 'api-key-prefix'],
      [FAKE_AWS_KEY, 'aws-access-key-id'],
      [FAKE_BEARER, 'generic-bearer'],
      [FAKE_PRIVATE_KEY, 'private-key-block'],
    ] as const) {
      const findings = detectSecrets(`prefix ${secret} suffix`);
      expect(findings.map((finding) => finding.kind)).toContain(expectedKind);
    }
  });

  it('does NOT flag ordinary content (no false-positive storm)', () => {
    for (const text of [
      'read the README and fix the parser',
      'tenant-alpha dataset 42, run 7, score 0.83',
      'Bearer authentication is configured at the gateway',
      'the sk- prefix is documented',
    ]) {
      expect(containsSecrets(text), text).toBe(false);
    }
  });

  it('the closed finding-kind vocabulary is frozen', () => {
    expect(Object.isFrozen(SECRET_KINDS)).toBe(true);
    expect(SECRET_KINDS).not.toContain('anything');
  });

  it('scrubSecrets redacts every secret shape and returns the findings', () => {
    const text = `one ${FAKE_GH_TOKEN} two ${FAKE_SK_KEY} three`;
    const { scrubbed, findings } = scrubSecrets(text);
    expect(scrubbed).not.toContain(FAKE_GH_TOKEN);
    expect(scrubbed).not.toContain(FAKE_SK_KEY);
    expect(scrubbed).toContain(SECRET_REDACTION_MARKER);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(containsSecrets(scrubbed)).toBe(false);
  });

  it('the trajectory gate throws typed SECURITY_SECRET_DETECTED', () => {
    expect(() =>
      assertNoSecretsForTrajectory(`log: ${FAKE_GH_TOKEN}`, 'trajectory-append'),
    ).toThrowError(SecurityError);
    try {
      assertNoSecretsForTrajectory(`log: ${FAKE_AWS_KEY}`, 'trajectory-append');
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as SecurityError).code).toBe('SECURITY_SECRET_DETECTED');
      // the error never carries the raw secret either
      expect((error as SecurityError).details.message).not.toContain(FAKE_AWS_KEY);
    }
  });

  it('clean content passes the trajectory gate', () => {
    expect(() =>
      assertNoSecretsForTrajectory('ordinary model interaction output', 'trajectory-append'),
    ).not.toThrow();
  });
});

describe('classification', () => {
  it('credential-bearing content is ALWAYS sensitive (and flagged for scrubbing)', () => {
    const policy = toModelDataPolicy(makeModelDataPolicyInput());
    const classified = classifyModelInteraction(policy, `output with ${FAKE_GH_TOKEN} inside`);
    expect(classified.classification).toBe('sensitive');
    expect(classified.scrubbed).toBe(false);
    expect(classified.findingKinds).toContain('github-token');
  });

  it('clean content takes the policy default classification', () => {
    const policy = toModelDataPolicy(makeModelDataPolicyInput());
    const classified = classifyModelInteraction(policy, 'clean output');
    expect(classified.classification).toBe('tenant-internal');
    expect(classified.scrubbed).toBe(true);
    expect(classified.findingKinds).toEqual([]);
  });

  it('classification is a pure total function (never throws on content)', () => {
    const policy = toModelDataPolicy(makeModelDataPolicyInput());
    for (const content of ['', 'x'.repeat(10_000), 'null\x00bytes\n']) {
      expect(() => classifyModelInteraction(policy, content)).not.toThrow();
    }
  });
});
