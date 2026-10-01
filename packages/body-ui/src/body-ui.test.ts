import { describe, expect, it } from 'vitest';

/**
 * Body Studio view-model tests (Work Order B010; issue #82) — the body-ui
 * package battery: positive projections over canonical-read-shaped
 * fixtures (the same payload shape the B006 demo corpus publishes) and
 * NEGATIVE tests (typed kind rejections; honest unknown marking — never
 * guessed values).
 */

import type { CanonicalRead } from '@arena/read-model';

import {
  BODY_UI_VIEW_VERSION,
  buildBodyStudioCard,
  buildBodyVersionIdentityCard,
  buildCertificationClaimCard,
  buildCompositionListing,
  buildPossessionMatrix,
  bodyIdentityLabel,
  certificationAppliesToBody,
  certificationScopeLabel,
  possessionRowLabel,
} from './index.js';
import { BodyUiError } from './index.js';

function canonicalRead(overrides: {
  readonly kind?: string;
  readonly recordId?: string;
  readonly data?: unknown;
}): CanonicalRead {
  return {
    recordVersion: 1,
    recordId: overrides.recordId ?? 'demo.agent-body.software-engineer',
    tenantId: 'arena-demo',
    kind: overrides.kind ?? 'agent-body',
    sourceVersion: 1,
    sourceRevision: 1,
    data: overrides.data ?? {},
    provenance: { createdAt: 1, updatedAt: 1 },
    readAt: 1759286400000,
  } as CanonicalRead;
}

/** The B006 demo corpus software-engineer body payload (published shape). */
const SOFTWARE_ENGINEER_PAYLOAD = {
  demoTime: '2026-10-01T08:00:00.000Z',
  derivedFrom: 'A028 reference body (bodies/software-engineer, tenant arena-reference)',
  displayName: 'Software Engineer (reference body)',
  bodyId: 'body-software-engineer',
  lineage: {
    initialVersion: '1.0.0',
    currentVersion: '1.1.0',
    evolution: 'uncited-skills-allowed under the reference forge policy',
  },
  manifestSummary: {
    skills: 5,
    knowledge: 4,
    tools: 6,
    procedures: 2,
    capabilities: 3,
    evaluationSuites: 1,
    verificationSuites: 1,
  },
  toolNames: [
    'repo-navigator',
    'file-editor',
    'test-runner',
    'build-runner',
    'code-search',
    'vcs-client',
  ],
  substratePossessions: [
    {
      possessionId: 'possession-repository-checkout',
      substrate: 'workspace-mount',
      grantedTo: 'body-software-engineer@1.1.0',
      scope: 'composition-scoped',
    },
  ],
  environmentRequirements: {
    runtime: 'sandboxed-workspace',
    network: 'denied-by-default',
  },
};

describe('Body Version identity card (explicit versioning, immutable)', () => {
  const read = canonicalRead({ data: SOFTWARE_ENGINEER_PAYLOAD });
  const card = buildBodyVersionIdentityCard(read);

  it('carries the body identity with EXPLICIT versioning (positive)', () => {
    expect(card.viewVersion).toBe(BODY_UI_VIEW_VERSION);
    expect(card.bodyId).toBe('body-software-engineer');
    expect(card.displayName).toBe('Software Engineer (reference body)');
    expect(card.versioning.explicit).toBe(true);
    expect(card.versioning.currentVersion).toBe('1.1.0');
    expect(card.versioning.initialVersion).toBe('1.0.0');
    expect(card.versioning.evolution).toBe(
      'uncited-skills-allowed under the reference forge policy',
    );
  });

  it('carries the immutability truth as data (lock rule 5, positive)', () => {
    expect(card.immutabilityNote).toContain('immutable and content-addressed');
    expect(card.immutabilityNote).toContain('NEW version');
  });

  it('lists honestly what the payload does not carry (positive — fail honest)', () => {
    // The demo corpus payload carries no content digest: the card must say
    // so, never fabricate one.
    expect(card.digest).toBeUndefined();
    expect(card.unknownFields).toContain('digest');
    expect(card.unknownFields).not.toContain('bodyId');
  });

  it('labels the identity WITHOUT any substrate name (negative — Body ≠ model)', () => {
    const label = bodyIdentityLabel(card);
    expect(label).toBe('Software Engineer (reference body) (body-software-engineer@1.1.0)');
    expect(label).not.toContain('workspace-mount');
  });

  it('is deterministic — two builds are deep-equal (positive)', () => {
    expect(buildBodyVersionIdentityCard(read)).toEqual(card);
  });

  it('rejects a non-agent-body read with the TYPED kind mismatch (negative)', () => {
    const wrongKind = canonicalRead({ kind: 'certification', data: {} });
    expect(() => buildBodyVersionIdentityCard(wrongKind)).toThrowError(BodyUiError);
    try {
      buildBodyVersionIdentityCard(wrongKind);
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as BodyUiError).code).toBe('BODY_UI_KIND_MISMATCH');
    }
  });

  it('marks an empty payload entirely unknown — never guessed (negative)', () => {
    const empty = buildBodyVersionIdentityCard(canonicalRead({ data: {} }));
    expect(empty.bodyId).toBeUndefined();
    expect(empty.displayName).toBeUndefined();
    expect(empty.versioning.currentVersion).toBeUndefined();
    expect(empty.unknownFields).toContain('bodyId');
    expect(empty.unknownFields).toContain('lineage.currentVersion');
  });
});

describe('composition listing (skills/knowledge/tools inspectable)', () => {
  const listing = buildCompositionListing(
    canonicalRead({ data: SOFTWARE_ENGINEER_PAYLOAD }),
  );

  it('carries the manifest counts and named tools as stored (positive)', () => {
    expect(listing.counts.skills).toBe(5);
    expect(listing.counts.knowledge).toBe(4);
    expect(listing.counts.tools).toBe(6);
    expect(listing.counts.procedures).toBe(2);
    expect(listing.counts.capabilities).toBe(3);
    expect(listing.counts.evaluationSuites).toBe(1);
    expect(listing.counts.verificationSuites).toBe(1);
    expect(listing.toolNames).toContain('repo-navigator');
    expect(listing.toolNames).toHaveLength(6);
    expect(listing.environmentRequirements.runtime).toBe('sandboxed-workspace');
    expect(listing.environmentRequirements.network).toBe('denied-by-default');
  });

  it('carries the body-≠-model note as data (positive)', () => {
    expect(listing.compositionNote).toContain('never just a model');
  });

  it('rejects a non-agent-body read with the TYPED kind mismatch (negative)', () => {
    expect(() =>
      buildCompositionListing(canonicalRead({ kind: 'capability-case', data: {} })),
    ).toThrowError(/BODY_UI_KIND_MISMATCH|expected a canonical read of kind/);
  });

  it('marks unknown manifest fields instead of guessing counts (negative)', () => {
    const partial = buildCompositionListing(
      canonicalRead({ data: { manifestSummary: { skills: 2 } } }),
    );
    expect(partial.counts.skills).toBe(2);
    expect(partial.counts.tools).toBeUndefined();
    expect(partial.unknownFields).toContain('manifestSummary.tools');
    expect(partial.unknownFields).toContain('toolNames');
  });
});

describe('possession matrix (versioned composition binding)', () => {
  const matrix = buildPossessionMatrix(canonicalRead({ data: SOFTWARE_ENGINEER_PAYLOAD }));

  it('projects the possession as a VERSIONED COMPOSITION BINDING row (positive)', () => {
    expect(matrix.rows).toHaveLength(1);
    const row = matrix.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.binding).toBe('versioned-composition-binding');
    expect(row.bindingNote).toContain('versioned composition binding');
    expect(row.possessionId).toBe('possession-repository-checkout');
    expect(row.bodyVersion).toEqual({ bodyId: 'body-software-engineer', version: '1.1.0' });
    expect(row.substrate).toBe('workspace-mount');
    expect(row.runtime).toBe('sandboxed-workspace');
    expect(row.scope).toBe('composition-scoped');
  });

  it('never carries the substrate where the body version belongs (negative — structural distinction)', () => {
    const row = matrix.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.bodyVersion?.bodyId).toBe('body-software-engineer');
    expect(row.substrate).not.toBe(row.bodyVersion?.bodyId);
    expect(possessionRowLabel(row)).toContain('body-software-engineer@1.1.0');
    expect(possessionRowLabel(row)).toContain('workspace-mount');
    expect(possessionRowLabel(row)).toContain('runtime sandboxed-workspace');
  });

  it('marks environment/policy unknown when the payload does not carry them (negative — fail honest)', () => {
    const row = matrix.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.environment).toBeUndefined();
    expect(row.policy).toBeUndefined();
    expect(row.unknownFields).toContain('environment');
    expect(row.unknownFields).toContain('policy');
  });

  it('projects an EMPTY matrix when no possessions exist — a fact, not an error (positive)', () => {
    const empty = buildPossessionMatrix(canonicalRead({ data: { bodyId: 'b' } }));
    expect(empty.rows).toHaveLength(0);
    expect(empty.malformedEntries).toHaveLength(0);
  });

  it('reports unreadable possession entries honestly, never as rows (negative)', () => {
    const malformed = buildPossessionMatrix(
      canonicalRead({
        data: {
          bodyId: 'b',
          substratePossessions: ['not-an-object', null, { possessionId: 'p1' }],
        },
      }),
    );
    expect(malformed.rows).toHaveLength(1);
    expect(malformed.malformedEntries).toHaveLength(2);
    expect(malformed.malformedEntries[0]?.possessionIndex).toBe(0);
    expect(malformed.malformedEntries[1]?.reason).toBe('possession entry is not a JSON object');
    // The readable-but-partial row still renders unknowns honestly:
    const partial = malformed.rows[0];
    expect(partial?.substrate).toBeUndefined();
    expect(partial?.unknownFields).toContain('substrate');
    expect(partial?.unknownFields).toContain('grantedTo (body@version)');
  });

  it('rejects a non-agent-body read with the TYPED kind mismatch (negative)', () => {
    expect(() =>
      buildPossessionMatrix(canonicalRead({ kind: 'arena-session', data: {} })),
    ).toThrowError(BodyUiError);
  });

  it('is deterministic — two builds are deep-equal (positive)', () => {
    expect(
      buildPossessionMatrix(canonicalRead({ data: SOFTWARE_ENGINEER_PAYLOAD })),
    ).toEqual(matrix);
  });
});

describe('certification claim cards (claims about the tested composition)', () => {
  const claim = buildCertificationClaimCard(
    canonicalRead({
      kind: 'certification',
      recordId: 'demo.certification.software-engineer-v1-1-0',
      data: {
        certificationId: 'cert-software-engineer-1-1-0',
        subject: { bodyId: 'body-software-engineer', bodyVersion: '1.1.0' },
        certificationKind: 'body-release',
        verdict: 'certified',
        basis: 'evaluation pass + independent verification pass',
        certifiedAt: '2026-10-01T08:00:00.000Z',
      },
    }),
  );

  it('carries the tested-composition subject + scope note (positive)', () => {
    expect(claim.certificationId).toBe('cert-software-engineer-1-1-0');
    expect(claim.subject).toEqual({ bodyId: 'body-software-engineer', version: '1.1.0' });
    expect(claim.verdict).toBe('certified');
    expect(claim.scopeNote).toContain('tested composition');
    expect(claim.scopeNote).toContain('never the bare model');
  });

  it('matches claims to bodies EXACTLY by bodyId@version (positive + negative)', () => {
    expect(
      certificationAppliesToBody(claim, { bodyId: 'body-software-engineer', version: '1.1.0' }),
    ).toBe(true);
    // A claim over v1.1.0 never attaches to another version…
    expect(
      certificationAppliesToBody(claim, { bodyId: 'body-software-engineer', version: '1.2.0' }),
    ).toBe(false);
    // …or to another body…
    expect(
      certificationAppliesToBody(claim, { bodyId: 'body-structural-engineer', version: '1.1.0' }),
    ).toBe(false);
    // …and a subject-less claim applies to nothing.
    const subjectless = buildCertificationClaimCard(
      canonicalRead({ kind: 'certification', data: { verdict: 'certified' } }),
    );
    expect(certificationAppliesToBody(subjectless, { bodyId: 'b', version: 'v' })).toBe(false);
    expect(certificationScopeLabel(subjectless)).toContain('subject unknown');
  });

  it('scope labels always name the tested composition (positive)', () => {
    expect(certificationScopeLabel(claim)).toBe(
      'body-software-engineer@1.1.0 (tested composition)',
    );
  });

  it('rejects a non-certification read with the TYPED kind mismatch (negative)', () => {
    expect(() =>
      buildCertificationClaimCard(canonicalRead({ kind: 'agent-body', data: {} })),
    ).toThrowError(BodyUiError);
    try {
      buildCertificationClaimCard(canonicalRead({ kind: 'agent-body', data: {} }));
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as BodyUiError).code).toBe('BODY_UI_KIND_MISMATCH');
    }
  });
});

describe('body studio card assembly', () => {
  const card = buildBodyStudioCard(canonicalRead({ data: SOFTWARE_ENGINEER_PAYLOAD }));

  it('assembles identity + composition + possession matrix from one read (positive)', () => {
    expect(card.recordId).toBe('demo.agent-body.software-engineer');
    expect(card.identity.bodyId).toBe('body-software-engineer');
    expect(card.composition.counts.tools).toBe(6);
    expect(card.possessionMatrix.rows).toHaveLength(1);
    expect(card.sourceVersion).toBe(1);
    expect(card.sourceRevision).toBe(1);
  });

  it('rejects a non-agent-body read with the TYPED kind mismatch (negative)', () => {
    expect(() =>
      buildBodyStudioCard(canonicalRead({ kind: 'expert-qualification', data: {} })),
    ).toThrowError(BodyUiError);
  });
});
