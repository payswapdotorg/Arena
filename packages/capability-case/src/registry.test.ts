/**
 * Registry suite (Work Order A005 gates 4, 5, 6): the append-only,
 * tenant-scoped CaseRegistry query API — admissions (registerCase,
 * recordTransition, recordSupersession), cross-tenant read rejection
 * (lock rule 11) and addressability of every admitted state.
 */

import { describe, expect, it } from 'vitest';
import {
  createCaseRegistry,
  getCase,
  getCaseByDigest,
  hasCase,
  isCaseRegistry,
  isCaseTerminalIn,
  listCases,
  listCaseVersions,
  recordSupersession,
  recordTransition,
  registerCase,
  supersessionChainOf,
} from './registry.js';
import {
  activateCase,
  attachEvidence,
  resolveCase,
  submitCase,
  supersedeCase,
  triageCase,
} from './lifecycle.js';
import { createCapabilityCase } from './case.js';
import { CapabilityCaseError } from './errors.js';
import {
  ACTOR,
  ACTOR_SERVICE,
  AT_EVEN_LATER,
  AT_LATER,
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  DIGEST_D,
  bodylessCaseInput,
  validCaseInput,
} from './test-support.js';
import { toEvidenceRef } from './shared.js';

async function fullLifecycle() {
  const draft = await createCapabilityCase(validCaseInput());
  const submitted = await submitCase(draft, { at: AT_LATER, actor: ACTOR });
  const triaged = await triageCase(submitted, {
    at: AT_LATER,
    actor: ACTOR_SERVICE,
    note: 'Confirmed gap; expected information value high.',
  });
  const active = await activateCase(triaged, { at: AT_EVEN_LATER, actor: ACTOR_SERVICE });
  const resolved = await resolveCase(active, {
    at: AT_EVEN_LATER,
    actor: ACTOR_SERVICE,
    resolution: 'Netting skill shipped and verified.',
  });
  return { draft, submitted, triaged, active, resolved };
}

const TENANT_A = { tenant: 'tenant-a' };
const TENANT_B = { tenant: 'tenant-b' };

describe('registerCase (positive)', () => {
  it('admits a fresh draft and indexes it', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const registry = registerCase(createCaseRegistry(), draft);
    expect(registry.cases.length).toBe(1);
    expect(isCaseRegistry(registry)).toBe(true);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(
      getCase(registry, { tenant: 'tenant-a', caseId: 'case-review-invoices' }, TENANT_A),
    ).toBe(draft);
  });

  it('re-asserting the exact same state is idempotent', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const registry = registerCase(registerCase(createCaseRegistry(), draft), draft);
    expect(registry.cases.length).toBe(1);
  });
});

describe('registerCase (negative)', () => {
  it('a different case under the same logical identity is a conflict', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const other = await createCapabilityCase({
      ...validCaseInput(),
      desiredOutcome: 'A different outcome entirely.',
    });
    const registry = registerCase(createCaseRegistry(), draft);
    expect(() => registerCase(registry, other)).toThrow(
      /already registered/,
    );
  });

  it('a non-fresh case (with history) is rejected', async () => {
    const { draft, submitted } = await fullLifecycle();
    expect(() => registerCase(createCaseRegistry(), submitted)).toThrow(
      /fresh draft case/,
    );
    expect(() => registerCase(createCaseRegistry(), draft)).not.toThrow();
  });
});

describe('recordTransition (positive)', () => {
  it('records each lifecycle step append-only', async () => {
    const { draft, submitted, triaged, active, resolved } = await fullLifecycle();
    let registry = registerCase(createCaseRegistry(), draft);
    registry = recordTransition(registry, submitted);
    registry = recordTransition(registry, triaged);
    registry = recordTransition(registry, active);
    registry = recordTransition(registry, resolved);
    expect(registry.cases.length).toBe(5);
    const current = getCase(
      registry,
      { tenant: 'tenant-a', caseId: 'case-review-invoices' },
      TENANT_A,
    );
    expect(current.status).toBe('resolved');
    expect(isCaseTerminalIn(registry, { tenant: 'tenant-a', caseId: 'case-review-invoices' }, TENANT_A)).toBe(true);
    // every historical state stays addressable by digest
    expect(getCaseByDigest(registry, draft.digest, TENANT_A)).toBe(draft);
    expect(getCaseByDigest(registry, submitted.digest, TENANT_A)).toBe(submitted);
    expect(getCaseByDigest(registry, resolved.digest, TENANT_A)).toBe(resolved);
  });

  it('recording the same state twice is idempotent', async () => {
    const { draft, submitted } = await fullLifecycle();
    const registry = recordTransition(
      registerCase(createCaseRegistry(), draft),
      submitted,
    );
    const again = recordTransition(registry, submitted);
    expect(again.cases.length).toBe(2);
  });
});

describe('recordTransition (negative)', () => {
  it('an unregistered case cannot transition', async () => {
    const { submitted } = await fullLifecycle();
    expect(() => recordTransition(createCaseRegistry(), submitted)).toThrow(
      /unregistered case version/,
    );
  });

  it('a forged transition that drops evidence is rejected (lock rule 6)', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const withEvidence = await attachEvidence(draft, {
      at: AT_LATER,
      actor: ACTOR,
      evidence: [{ digest: DIGEST_A, description: 'second evidence' }],
    });
    const registry = recordTransition(
      registerCase(createCaseRegistry(), draft),
      withEvidence,
    );
    // Forge 1: a history-extending state whose evidence list was TRUNCATED.
    const ghostEvent = { ...withEvidence.lifecycle[1]!, sequence: 3 };
    const dropped = {
      ...withEvidence,
      digest: DIGEST_C,
      evidence: withEvidence.evidence.slice(0, 1),
      lifecycle: [...withEvidence.lifecycle, ghostEvent],
    } as never;
    expect(() => recordTransition(registry, dropped)).toThrow(
      /evidence removal detected/,
    );
    // Forge 2: an evidence-attached event that claims an append the state
    // never made (ghost evidence).
    const ghost = {
      ...withEvidence,
      digest: DIGEST_D,
      lifecycle: [
        ...withEvidence.lifecycle,
        {
          ...ghostEvent,
          evidenceAppended: [toEvidenceRef({ digest: DIGEST_B, description: 'ghost' })],
        },
      ],
    } as never;
    expect(() => recordTransition(registry, ghost)).toThrow(
      /does not match the state's evidence growth/,
    );
  });

  it('a forged transition whose event does not match the state change is rejected', async () => {
    const { draft, submitted } = await fullLifecycle();
    const registry = registerCase(createCaseRegistry(), draft);
    // Forge: status says triaged but the appended event says draft→submitted.
    const forged = { ...submitted, status: 'triaged' };
    expect(() => recordTransition(registry, forged as never)).toThrow(
      /does not match the state change/,
    );
  });

  it('a cross-tenant ACTOR cannot mutate another tenant’s case (lock rule 11)', async () => {
    const { draft, submitted } = await fullLifecycle();
    const registry = registerCase(createCaseRegistry(), draft);
    expect(() =>
      recordTransition(registry, submitted, { actorTenant: 'tenant-b' }),
    ).toThrow(/cross-tenant mutation denied/);
  });

  it('a superseded terminal state must carry its supersededBy ref', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const superseded = await supersedeCase(draft, {
      at: AT_LATER,
      actor: ACTOR,
      superseding: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '2.0.0',
        digest: DIGEST_A,
      },
    });
    const registry = registerCase(createCaseRegistry(), draft);
    const forged = { ...superseded, supersededBy: undefined };
    expect(() => recordTransition(registry, forged as never)).toThrow(
      /superseding version ref/,
    );
  });
});

describe('recordSupersession (gate 4)', () => {
  it('admits a new version superseding the current one', async () => {
    const v1 = await createCapabilityCase(validCaseInput());
    let registry = registerCase(createCaseRegistry(), v1);
    const v2 = await createCapabilityCase({
      ...validCaseInput(),
      version: '1.1.0',
      evidence: [
        ...validCaseInput().evidence,
        { digest: DIGEST_B, description: 'additional evidence for v2' },
      ],
      supersedes: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '1.0.0',
        digest: v1.digest,
      },
    });
    registry = recordSupersession(registry, v2);
    const current = getCase(
      registry,
      { tenant: 'tenant-a', caseId: 'case-review-invoices' },
      TENANT_A,
    );
    expect(current.version).toBe('1.1.0');
    // v1 is STILL addressable (immutable + addressable — gate 4)
    expect(getCaseByDigest(registry, v1.digest, TENANT_A)).toBe(v1);
    const versions = listCaseVersions(
      registry,
      { tenant: 'tenant-a', caseId: 'case-review-invoices' },
      TENANT_A,
    );
    expect(versions.map((c) => c.version)).toEqual(['1.0.0', '1.1.0']);
  });

  it('the supersession chain is inspectable end-to-end', async () => {
    const v1 = await createCapabilityCase(validCaseInput());
    let registry = registerCase(createCaseRegistry(), v1);
    const v1Final = await supersedeCase(v1, {
      at: AT_LATER,
      actor: ACTOR,
      superseding: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '2.0.0',
        digest: DIGEST_A,
      },
    });
    registry = recordTransition(registry, v1Final);
    const v2 = await createCapabilityCase({
      ...validCaseInput(),
      version: '2.0.0',
      supersedes: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '1.0.0',
        digest: v1Final.digest,
      },
    });
    registry = recordSupersession(registry, v2);
    const chain = supersessionChainOf(
      registry,
      { tenant: 'tenant-a', caseId: 'case-review-invoices' },
      TENANT_A,
    );
    expect(chain.length).toBe(1);
    expect(chain[0]?.status).toBe('superseded');
    expect(chain[0]?.supersededBy?.version).toBe('2.0.0');
  });

  it('a superseding version that drops evidence is rejected (lock rule 6 across versions)', async () => {
    const v1 = await createCapabilityCase(validCaseInput());
    const registry = registerCase(createCaseRegistry(), v1);
    const v2 = await createCapabilityCase({
      ...validCaseInput(),
      version: '2.0.0',
      evidence: [
        { digest: DIGEST_B, description: 'replacement evidence (drops the original!)' },
      ],
      supersedes: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '1.0.0',
        digest: v1.digest,
      },
    });
    expect(() => recordSupersession(registry, v2)).toThrow(
      /cannot drop evidence|cannot rewrite evidence/,
    );
  });

  it('a superseding version must target the CURRENT state', async () => {
    const v1 = await createCapabilityCase(validCaseInput());
    const registry = registerCase(createCaseRegistry(), v1);
    const v2 = await createCapabilityCase({
      ...validCaseInput(),
      version: '2.0.0',
      supersedes: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '1.0.0',
        digest: DIGEST_A, // NOT the current state's digest
      },
    });
    expect(() => recordSupersession(registry, v2)).toThrow(
      /must address the CURRENT admitted state/,
    );
  });

  it('a non-increasing superseding version is rejected (defense in depth)', async () => {
    const v1 = await createCapabilityCase(validCaseInput());
    const registry = registerCase(createCaseRegistry(), v1);
    // A forged case claiming version 0.9.0 supersedes 1.0.0: the constructor
    // rejects this at creation; the registry enforces it again.
    const forged = {
      ...v1,
      digest: DIGEST_C,
      version: '0.9.0',
      supersedes: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '1.0.0',
        digest: v1.digest,
      },
    } as never;
    expect(() => recordSupersession(registry, forged)).toThrow(
      /strictly higher semver precedence/,
    );
  });

  it('an unknown base case is rejected', async () => {
    const v2 = await createCapabilityCase({
      ...validCaseInput(),
      version: '2.0.0',
      supersedes: {
        tenant: 'tenant-a',
        caseId: 'case-review-invoices',
        version: '1.0.0',
        digest: DIGEST_A,
      },
    });
    expect(() => recordSupersession(createCaseRegistry(), v2)).toThrow(
      /unknown case/,
    );
  });
});

describe('tenant scoping (gate 5, lock rule 11)', () => {
  async function tenantRegistry() {
    const tenantACase = await createCapabilityCase(validCaseInput());
    const publicCase = await createCapabilityCase({
      ...bodylessCaseInput(),
      identity: { tenant: 'public', caseId: 'case-shared-observation' },
      source: { type: 'user', tenant: 'public', principalId: 'analyst-0' },
    });
    const tenantBCase = await createCapabilityCase({
      ...bodylessCaseInput(),
      identity: { tenant: 'tenant-b', caseId: 'case-b-private' },
      source: { type: 'user', tenant: 'tenant-b', principalId: 'analyst-2' },
    });
    let registry = registerCase(createCaseRegistry(), tenantACase);
    registry = registerCase(registry, publicCase);
    registry = registerCase(registry, tenantBCase);
    return { registry, tenantACase, publicCase, tenantBCase };
  }

  it('a tenant reads its own cases (positive)', async () => {
    const { registry } = await tenantRegistry();
    const own = getCase(
      registry,
      { tenant: 'tenant-a', caseId: 'case-review-invoices' },
      TENANT_A,
    );
    expect(own.identity.tenant).toBe('tenant-a');
  });

  it('the reserved public namespace is globally readable (positive)', async () => {
    const { registry } = await tenantRegistry();
    const shared = getCase(
      registry,
      { tenant: 'public', caseId: 'case-shared-observation' },
      TENANT_B,
    );
    expect(shared.identity.tenant).toBe('public');
  });

  it('CROSS-TENANT READS ARE REJECTED (negative, gate 5)', async () => {
    const { registry } = await tenantRegistry();
    expect(() =>
      getCase(registry, { tenant: 'tenant-a', caseId: 'case-review-invoices' }, TENANT_B),
    ).toThrow(CapabilityCaseError);
    expect(() =>
      getCase(registry, { tenant: 'tenant-a', caseId: 'case-review-invoices' }, TENANT_B),
    ).toThrow(/cross-tenant access denied/);
    // by-digest reads are tenant-checked too
    const { registry: reg2, tenantACase } = await tenantRegistry();
    expect(() => getCaseByDigest(reg2, tenantACase.digest, TENANT_B)).toThrow(
      /cross-tenant access denied/,
    );
    // listCaseVersions is tenant-checked
    expect(() =>
      listCaseVersions(
        registry,
        { tenant: 'tenant-a', caseId: 'case-review-invoices' },
        TENANT_B,
      ),
    ).toThrow(/cross-tenant access denied/);
    // and the supersession chain
    expect(() =>
      supersessionChainOf(registry, { tenant: 'tenant-a', caseId: 'case-review-invoices' }, TENANT_B),
    ).toThrow(/cross-tenant access denied/);
  });

  it('listCases returns own + public, never other tenants (lock rule 11)', async () => {
    const { registry } = await tenantRegistry();
    const visibleToA = listCases(registry, TENANT_A);
    expect(visibleToA.map((c) => c.identity.tenant).sort()).toEqual([
      'public',
      'tenant-a',
    ]);
    const visibleToB = listCases(registry, TENANT_B);
    expect(visibleToB.map((c) => c.identity.tenant).sort()).toEqual([
      'public',
      'tenant-b',
    ]);
  });

  it('hasCase is tenant-scoped', async () => {
    const { registry } = await tenantRegistry();
    expect(
      hasCase(registry, { tenant: 'tenant-a', caseId: 'case-review-invoices' }, TENANT_A),
    ).toBe(true);
    expect(
      hasCase(registry, { tenant: 'tenant-a', caseId: 'case-review-invoices' }, TENANT_B),
    ).toBe(false);
    expect(
      hasCase(registry, { tenant: 'public', caseId: 'case-shared-observation' }, TENANT_B),
    ).toBe(true);
  });

  it('invalid reader tenants are rejected', async () => {
    const { registry } = await tenantRegistry();
    expect(() =>
      getCase(
        registry,
        { tenant: 'tenant-a', caseId: 'case-review-invoices' },
        { tenant: 'Not A Tenant' },
      ),
    ).toThrow(/invalid reader tenant scope/);
  });
});

describe('addressability (R3-style)', () => {
  it('unknown cases fail closed with CASE_NOT_FOUND', async () => {
    const registry = createCaseRegistry();
    expect(() =>
      getCase(registry, { tenant: 'tenant-a', caseId: 'nope' }, TENANT_A),
    ).toThrow(/case not found/);
    expect(() => getCaseByDigest(registry, DIGEST_A, TENANT_A)).toThrow(
      /case state not found/,
    );
  });

  it('getCase by version returns that version’s latest recorded state', async () => {
    const { draft, submitted } = await fullLifecycle();
    const registry = recordTransition(registerCase(createCaseRegistry(), draft), submitted);
    const v1 = getCase(
      registry,
      { tenant: 'tenant-a', caseId: 'case-review-invoices' },
      TENANT_A,
      '1.0.0',
    );
    expect(v1.status).toBe('submitted');
    expect(() =>
      getCase(
        registry,
        { tenant: 'tenant-a', caseId: 'case-review-invoices' },
        TENANT_A,
        '9.9.9',
      ),
    ).toThrow(/case not found/);
  });
});
