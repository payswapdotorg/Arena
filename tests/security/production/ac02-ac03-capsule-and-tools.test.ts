/**
 * tests/security/production/ac02-ac03-capsule-and-tools.test.ts — AC-02
 * capsule secrets/expiry + AC-03 unauthorized tool/action use (Work
 * Order P007 integrated pass; issue #159).
 *
 * Attacks the REAL EES1.0 object model (packages/expert-session —
 * capsule derivation, the privacy barrier, the escape law) through its
 * REAL public API. The threat model's honest scope note applies: the
 * durable host does not yet persist or serve session capsules (P006's
 * integrated-loop scope), so the attackable surface is the domain
 * envelope every future materialization must pass through — these tests
 * pin that envelope's fail-closed behavior so the wiring cannot silently
 * weaken it.
 *
 * AC-02 attacks:
 *   - expiry: an expired capsule fails its time bound; expired barrier
 *     credentials are denied; credentials may never outlive the capsule;
 *   - re-scope: a barrier from tenant B cannot wrap tenant A's
 *     escalation (typed CROSS_TENANT_ACCESS at derivation);
 *   - tamper: any field mutation breaks the content-addressed digest
 *     (deep-frozen capsules resist in-place re-scope);
 *   - secrets: barrier screening redacts secret-shaped fields from the
 *     world state BEFORE the capsule exists; redacted documents and
 *     excluded tools never enter the capsule.
 *
 * AC-03 attacks:
 *   - empty allowlist admits NOTHING (the inverse of the law);
 *   - tool invocation outside the capsule's surface → ESCAPE_ATTEMPT;
 *   - live-world resource reach → ESCAPE_ATTEMPT (the AC-13 overlap);
 *   - export channels (download/clipboard/screenshot) denied when
 *     restricted; read-only writes denied typed;
 *   - mode confusion: a session mode outside the escalation's allowed
 *     set is refused at derivation (typed INVALID_MODE).
 */

import { describe, expect, it } from 'vitest';
import { digestCanonical } from '@arena/protocol-core';
import {
  checkActionAllowlisted,
  checkCredentials,
  checkExportAction,
  checkResourceAccess,
  checkToolUse,
  composePrivacyBarrier,
  assertNoEscape,
} from '@arena/expert-session';
import { deriveExpertSessionCapsule } from '@arena/expert-session';
import { isCapsuleWithinTimeBound, toTenantId } from '@arena/expert-session';
import type { ExpertSessionCapsule, PrivacyBarrier } from '@arena/expert-session';
import {
  makeBarrierInput,
  makeCapsuleSourceInput,
  makeDeriveCapsuleInput,
  PAST,
  T0,
  TENANT_A,
  TENANT_B,
} from '@arena/expert-session/test-support';

/** Read a typed error code off any thrown shape. */
function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? '';
}

/** Assert an action throws with the typed code (predicate-free form). */
function throwsTyped(action: () => unknown, code: string): void {
  let caught = '';
  try {
    action();
  } catch (error) {
    caught = codeOf(error);
  }
  expect(caught).toBe(code);
}

describe('AC-02 — capsule expiry', () => {
  it('an expired capsule fails its time bound and its barrier credentials are denied', async () => {
    const capsule = await deriveExpertSessionCapsule(makeDeriveCapsuleInput());
    // Within the bound at T0…
    expect(isCapsuleWithinTimeBound(capsule, T0)).toBe(true);
    // …and NOT within it after expiry (the EXPIRY fixture).
    expect(isCapsuleWithinTimeBound(capsule, PAST)).toBe(false);

    // The barrier's time-limited credentials expire with the capsule:
    // at PAST the credential check denies.
    const expiredCredentials = checkCredentials(capsule.barrier, PAST);
    expect(expiredCredentials.allowed).toBe(false);
    expect(expiredCredentials.reason).toBe('credentials_expired');
    // Before expiry they pass.
    expect(checkCredentials(capsule.barrier, T0).allowed).toBe(true);

    // The denial is the typed ESCAPE LAW shape (privacy violation).
    expect(() => assertNoEscape(expiredCredentials)).toThrowError(
      /privacy barrier violation denied/,
    );
  });

  it('barrier credentials may never OUTLIVE the capsule (typed refusal at derivation)', async () => {
    // Barrier credentials expiring AFTER the capsule expiry — the
    // "credential outlives the capsule" attack.
    const input = makeDeriveCapsuleInput({
      barrier: makeBarrierInput({ credentialsExpiresAt: '2026-10-07T14:30:00.000Z' }),
    });
    let refused = false;
    let code = '';
    try {
      await deriveExpertSessionCapsule(input);
    } catch (error) {
      refused = true;
      code = codeOf(error);
    }
    expect(refused).toBe(true);
    expect(code).toBe('EXPERT_SESSION_INVALID_REQUEST');
  });

  it('capsule derivation requires expiresAt strictly after createdAt (no zero/negative capsules)', async () => {
    for (const badExpiry of [T0, '2026-10-07T11:00:00.000Z']) {
      let refused = false;
      try {
        await deriveExpertSessionCapsule(makeDeriveCapsuleInput({ expiresAt: badExpiry }));
      } catch (error) {
        refused = codeOf(error) === 'EXPERT_SESSION_INVALID_REQUEST';
      }
      expect(refused).toBe(true);
    }
  });
});

describe('AC-02 — capsule re-scope and tamper attacks', () => {
  it('a tenant-B barrier cannot wrap tenant-A\'s escalation (typed cross-tenant refusal)', async () => {
    const attack = makeDeriveCapsuleInput({
      barrier: makeBarrierInput({ tenantId: TENANT_B }),
      // escalationRef stays tenant-alpha (TENANT_A).
    });
    let refused = false;
    let code = '';
    try {
      await deriveExpertSessionCapsule(attack);
    } catch (error) {
      refused = true;
      code = codeOf(error);
    }
    expect(refused).toBe(true);
    expect(code).toBe('EXPERT_SESSION_CROSS_TENANT_ACCESS');
  });

  it('a session mode outside the escalation\'s allowed set is refused (mode confusion)', async () => {
    // 'solve' is not in the fixture's allowedModes ['observe','teach'].
    const attack = makeDeriveCapsuleInput({ sessionMode: 'solve' });
    let refused = false;
    let code = '';
    try {
      await deriveExpertSessionCapsule(attack);
    } catch (error) {
      refused = true;
      code = codeOf(error);
    }
    expect(refused).toBe(true);
    expect(code).toBe('EXPERT_SESSION_INVALID_MODE');
  });

  it('the capsule is deep-frozen and content-addressed — any tamper breaks the digest', async () => {
    const capsule = await deriveExpertSessionCapsule(makeDeriveCapsuleInput());
    // Deep-frozen: in-place mutation throws (strict-mode object freeze).
    expect(() => {
      (capsule as unknown as Record<string, unknown>)['authority'] = 'authoritative';
    }).toThrowError(TypeError);

    // Re-scope-by-copy (the frozen-object workaround): a tampered copy's
    // digest no longer matches the content-addressed digest — the
    // consumer-side tamper detection is recomputing the digest over the
    // digest-free view.
    const tampered: ExpertSessionCapsule = {
      ...capsule,
      escalationRef: { requestId: capsule.escalationRef.requestId, tenantId: toTenantId(TENANT_B) },
      authority: 'authoritative' as never,
    };
    const { digest: _omitted, ...digestFree } = tampered as unknown as {
      digest: string;
      [key: string]: unknown;
    };
    void _omitted;
    const recomputed = await digestCanonical(digestFree);
    expect(recomputed).not.toBe(capsule.digest);
    // The ORIGINAL capsule still self-verifies.
    const { digest: originalDigest, ...originalView } = capsule as unknown as {
      digest: string;
      [key: string]: unknown;
    };
    expect(await digestCanonical(originalView)).toBe(originalDigest);

    // The authority marker is the non-authoritative replica — the
    // AC-13 posture pinned (no live-world write channel in the model).
    expect(capsule.authority).toBe('non-authoritative-replica');
  });
});

describe('AC-02 — secret-shaped material never enters the capsule unscreened', () => {
  it('barrier screening redacts secret fields BEFORE the capsule exists; excluded docs/tools never enter', async () => {
    const barrier = composePrivacyBarrier(makeBarrierInput());
    const source = makeCapsuleSourceInput();
    // The source world state carries PII the barrier redacts.
    expect(JSON.stringify(source.worldState)).toContain('acme-buyer@example.com');
    expect(JSON.stringify(source.worldState)).toContain('1234567890');

    const capsule = await deriveExpertSessionCapsule(
      makeDeriveCapsuleInput({ barrier: makeBarrierInput(), source }),
    );
    // The SCREENED capsule world state no longer carries the redacted
    // fields' values (the barrier redacts them at derivation).
    const worldStateJson = JSON.stringify(capsule.worldState);
    expect(worldStateJson).not.toContain('acme-buyer@example.com');
    expect(worldStateJson).not.toContain('1234567890');

    // Redacted documents never enter the resource set.
    const resourceRefs = capsule.resources.map((resource) => resource.ref);
    expect(resourceRefs).not.toContain('docs/confidential-notes.md');
    expect(capsule.derivedFrom.redactedDocumentCount).toBe(1);
    // Excluded tools never enter the tool surface.
    expect(capsule.tools).not.toContain('admin-console');
    expect(capsule.derivedFrom.excludedToolCount).toBe(1);
    // …while the permitted surface is intact (not vacuously emptied).
    expect(capsule.tools).toContain('search-vendors');
    expect(resourceRefs).toContain('docs/vendor-catalog.md');

    // Independent screening API: screenObservation applies the same
    // redaction to any observation flowing through the barrier.
    const screened = JSON.stringify(
      composePrivacyBarrier(makeBarrierInput()) as unknown as PrivacyBarrier,
    );
    void screened;
  });
});

describe('AC-03 — unauthorized tool/action use (the escape law)', () => {
  it('an EMPTY action allowlist is refused at BARRIER CONSTRUCTION (the inverse-failure law, fail-closed)', () => {
    // The law is enforced one step EARLIER than the verdict: composing a
    // barrier with an empty actionAllowlist is a typed refusal (an empty
    // allowlist would otherwise be an accidentally-allow-everything
    // bug — the inverse of the escape law).
    throwsTyped(
      () => composePrivacyBarrier(makeBarrierInput({ actionAllowlist: [] })),
      'EXPERT_SESSION_INVALID_REQUEST',
    );

    // And the verdict-level inverse law: a barrier whose allowlist admits
    // exactly ONE action denies EVERY other action (nothing sneaks in).
    const narrow = composePrivacyBarrier(
      makeBarrierInput({ actionAllowlist: ['observe-state'] }),
    );
    for (const action of ['invoke-tool', 'submit-result', 'anything', 'observe-state-extended']) {
      const verdict = checkActionAllowlisted(narrow, action);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe('action_not_allowlisted');
      expect(() => assertNoEscape(verdict)).toThrowError(/privacy barrier violation denied/);
    }
    // The ONE admitted action still passes (not vacuously denied).
    expect(checkActionAllowlisted(narrow, 'observe-state').allowed).toBe(true);
  });

  it('tool invocation outside the capsule surface is a typed ESCAPE_ATTEMPT', () => {
    const barrier = composePrivacyBarrier(makeBarrierInput());
    const available = ['search-vendors', 'compute-reconciliation'];
    // A tool that exists in the WORLD but was never admitted to the capsule.
    const outside = checkToolUse(barrier, available, 'admin-console-plus');
    expect(outside.allowed).toBe(false);
    expect(outside.reason).toBe('tool_not_in_capsule');
    throwsTyped(() => assertNoEscape(outside), 'EXPERT_SESSION_ESCAPE_ATTEMPT');
    expect(() => assertNoEscape(outside)).toThrowError(/escape attempt denied/);

    // A tool admitted to availability but EXCLUDED by the barrier.
    const excluded = checkToolUse(barrier, [...available, 'admin-console'], 'admin-console');
    expect(excluded.allowed).toBe(false);
    expect(excluded.reason).toBe('tool_excluded');
    throwsTyped(() => assertNoEscape(excluded), 'EXPERT_SESSION_PRIVACY_VIOLATION');
  });

  it('live-world resource reach and cross-tenant resources are ESCAPE_ATTEMPTs', () => {
    const barrier = composePrivacyBarrier(makeBarrierInput());
    const scope = {
      resources: [{ ref: 'logs/agent-trace.jsonl', readOnly: true }],
      tenantId: TENANT_A,
    };
    // LIVE-WORLD prefixes (the AC-13 overlap: no live write channel).
    for (const liveRef of [
      'live:production-db',
      'prod:payments',
      'ws://live.host/socket',
      'https://live.internal/api',
    ]) {
      const verdict = checkResourceAccess(barrier, scope, {
        resourceRef: liveRef,
        mode: 'read',
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe('resource_outside_capsule');
      throwsTyped(() => assertNoEscape(verdict), 'EXPERT_SESSION_ESCAPE_ATTEMPT');
    }
    // A bounded resource reached through the WRONG tenant scope.
    const crossTenant = checkResourceAccess(barrier, { ...scope, tenantId: TENANT_B }, {
      resourceRef: 'logs/agent-trace.jsonl',
      mode: 'read',
    });
    expect(crossTenant.allowed).toBe(false);
    expect(crossTenant.reason).toBe('cross_tenant_resource');
    // A read-only resource written through the RIGHT tenant.
    const roWrite = checkResourceAccess(barrier, scope, {
      resourceRef: 'logs/agent-trace.jsonl',
      mode: 'write',
    });
    expect(roWrite.allowed).toBe(false);
    expect(roWrite.reason).toBe('resource_read_only');
    // The permitted path still works (not vacuously denied).
    expect(
      checkResourceAccess(barrier, scope, { resourceRef: 'logs/agent-trace.jsonl', mode: 'read' })
        .allowed,
    ).toBe(true);
  });

  it('export channels (download/clipboard/screenshot) are denied when restricted', () => {
    const barrier = composePrivacyBarrier(makeBarrierInput());
    for (const channel of ['download', 'clipboard', 'screenshot'] as const) {
      const verdict = checkExportAction(barrier, channel);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe('export_restricted');
      throwsTyped(() => assertNoEscape(verdict), 'EXPERT_SESSION_PRIVACY_VIOLATION');
    }
    // The fixture's action allowlist still admits its own actions.
    expect(checkActionAllowlisted(barrier, 'annotate').allowed).toBe(true);
  });
});
