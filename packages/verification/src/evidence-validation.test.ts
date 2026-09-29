/**
 * Evidence validation primitive tests (Work Order A013 core objects
 * §3.3): evidence-kind matching, reference resolution, digest
 * verification and provenance-chain validation — with the adversarial
 * tamper cases (tampered evidence NEVER silently passes; missing or
 * unresolvable evidence NEVER fails silently — it records `missing`).
 */

import { describe, expect, it } from 'vitest';
import { createMaterialArtifact } from '@arena/artifact-protocol';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import { VERIFICATION_ERROR_CODES } from './errors.js';
import {
  EVIDENCE_VALIDATION_FAILURES,
  assessEvidenceForRequirements,
  matchEvidenceForRequirement,
  selectEvidenceForRequirement,
  validateEvidenceReference,
} from './evidence-validation.js';
import type { EvidenceReference } from './evidence.js';
import { toEvidenceBundle } from './evidence.js';
import { defaultRequirements, evidenceFor, makeArtifact } from './test-support.js';

/** An in-process resolver over a digest-keyed artifact map. */
function resolverOver(store: Map<string, MaterialArtifact<unknown>>) {
  return (ref: { digest: string }) => store.get(ref.digest) ?? null;
}

function toRef(fixture: ReturnType<typeof evidenceFor>): EvidenceReference {
  return toEvidenceBundle([fixture])[0] as EvidenceReference;
}

describe('evidence-kind matching (primitive 1)', () => {
  it('matches by kind; pins demand exact artifact refs', async () => {
    const report = await makeArtifact(1);
    const balance = await makeArtifact(2);
    const bundle = [toRef(evidenceFor(report, 'test-report')), toRef(evidenceFor(balance, 'balance-proof'))];
    const [reportRequirement, balanceRequirement] = defaultRequirements();
    expect(matchEvidenceForRequirement(reportRequirement as never, bundle)).toHaveLength(1);
    expect(matchEvidenceForRequirement(balanceRequirement as never, bundle)).toHaveLength(1);
    expect(selectEvidenceForRequirement(reportRequirement as never, bundle)?.artifact.digest).toBe(report.digest);

    const pinned = {
      ...reportRequirement,
      artifact: {
        namespace: report.identity.namespace,
        name: report.identity.name,
        version: report.identity.version,
        digest: report.digest,
      },
    };
    expect(matchEvidenceForRequirement(pinned as never, bundle)).toHaveLength(1);
    const wrongPin = { ...pinned, artifact: { ...pinned.artifact!, digest: 'f'.repeat(64) } };
    expect(matchEvidenceForRequirement(wrongPin as never, bundle)).toHaveLength(0);
  });

  it('deterministic first-match selection in bundle order', async () => {
    const first = await makeArtifact(3);
    const second = await makeArtifact(4);
    const bundle = [toRef(evidenceFor(first, 'test-report')), toRef(evidenceFor(second, 'test-report'))];
    const [requirement] = defaultRequirements();
    expect(selectEvidenceForRequirement(requirement as never, bundle)?.artifact.digest).toBe(first.digest);
  });

  it('rejects structurally invalid requirements (fail-loud inputs)', () => {
    expect(() => matchEvidenceForRequirement('nope' as never, [])).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_REQUIREMENT }),
    );
  });
});

describe('reference resolution + digest verification + chain (primitives 2-4)', () => {
  it('a fully verified artifact yields failure: null', async () => {
    const artifact = await makeArtifact(5);
    const reference = toRef(evidenceFor(artifact, 'test-report'));
    const validation = await validateEvidenceReference(reference, resolverOver(new Map([[artifact.digest, artifact]])));
    expect(validation.failure).toBe(null);
    expect(validation.detail).toBe(null);
    expect(validation.artifact?.digest).toBe(artifact.digest);
  });

  it('an unresolvable reference yields unresolvable (never a crash)', async () => {
    const artifact = await makeArtifact(6);
    const reference = toRef(evidenceFor(artifact, 'test-report'));
    const validation = await validateEvidenceReference(reference, resolverOver(new Map()));
    expect(validation.failure).toBe('unresolvable');
    expect(validation.artifact).toBe(null);
  });

  it('a TAMPERED artifact digest yields digest-mismatch — never a silent pass', async () => {
    const artifact = await makeArtifact(7);
    // Tamper AFTER digest computation: mutate the frozen content via a
    // re-created object with different content but the ORIGINAL digest claim.
    const tampered = {
      ...artifact,
      content: { kind: 'fixture', index: 7, payload: 'TAMPERED CONTENT' },
    } as MaterialArtifact<unknown>;
    const reference = toRef(evidenceFor(artifact, 'test-report'));
    const validation = await validateEvidenceReference(
      reference,
      resolverOver(new Map([[artifact.digest, tampered]])),
    );
    expect(validation.failure).toBe('digest-mismatch');
  });

  it('a reference whose declared digest differs from the resolved artifact is a mismatch', async () => {
    const artifact = await makeArtifact(8);
    const other = await makeArtifact(9);
    const reference = toRef(evidenceFor(artifact, 'test-report'));
    // Resolver returns a DIFFERENT artifact than the reference names.
    const validation = await validateEvidenceReference(
      reference,
      resolverOver(new Map([[other.digest, other]])),
    );
    expect(validation.failure).toBe('unresolvable');
    // Now return the other artifact under the referenced digest key: the
    // reference-digest check catches the substitution.
    const validation2 = await validateEvidenceReference(
      reference,
      () => other,
    );
    expect(validation2.failure).toBe('reference-digest-mismatch');
  });

  it('a broken provenance chain yields provenance-chain-broken', async () => {
    const parent = await makeArtifact(10);
    // Child references a parent digest that will NOT be resolvable.
    const child = await createMaterialArtifact({
      identity: { namespace: 'tenant-a', name: 'child-evidence', version: '1.0.0' },
      refs: [
        {
          namespace: parent.identity.namespace,
          name: parent.identity.name,
          version: parent.identity.version,
          digest: parent.digest,
        },
      ],
      content: { child: true },
    });
    const reference = toRef(evidenceFor(child, 'test-report'));
    // Only the child is stored — the parent ref dangles.
    const validation = await validateEvidenceReference(
      reference,
      resolverOver(new Map([[child.digest, child]])),
    );
    expect(validation.failure).toBe('provenance-chain-broken');
    // With the parent stored too, the chain verifies.
    const full = await validateEvidenceReference(
      reference,
      resolverOver(
        new Map([
          [child.digest, child],
          [parent.digest, parent],
        ]),
      ),
    );
    expect(full.failure).toBe(null);
  });

  it('the failure taxonomy is closed and frozen', () => {
    expect([...EVIDENCE_VALIDATION_FAILURES]).toEqual([
      'unresolvable',
      'reference-digest-mismatch',
      'digest-mismatch',
      'provenance-chain-broken',
    ]);
    expect(Object.isFrozen(EVIDENCE_VALIDATION_FAILURES)).toBe(true);
  });

  it('structurally invalid references throw (fail-loud inputs, not evidence failures)', async () => {
    await expect(validateEvidenceReference('nope' as never, () => null)).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_EVIDENCE }),
    );
  });
});

describe('assessEvidenceForRequirements (the composition)', () => {
  it('full happy path: every requirement verified', async () => {
    const report = await makeArtifact(11);
    const balance = await makeArtifact(12);
    const bundle = [
      toRef(evidenceFor(report, 'test-report')),
      toRef(evidenceFor(balance, 'balance-proof', 'erp-close-sandbox')),
    ];
    const assessments = await assessEvidenceForRequirements(
      defaultRequirements() as never[],
      bundle,
      resolverOver(
        new Map([
          [report.digest, report],
          [balance.digest, balance],
        ]),
      ),
    );
    expect(assessments).toHaveLength(2);
    for (const assessment of assessments) {
      expect(assessment.state).toBe('verified');
      expect(assessment.artifact).not.toBe(null);
      expect(assessment.note).toBe(null);
    }
  });

  it('missing kind ⇒ missing with a deterministic note', async () => {
    const report = await makeArtifact(13);
    const bundle = [toRef(evidenceFor(report, 'test-report'))];
    const assessments = await assessEvidenceForRequirements(
      defaultRequirements() as never[],
      bundle,
      resolverOver(new Map([[report.digest, report]])),
    );
    expect(assessments[1]?.state).toBe('missing');
    expect(assessments[1]?.note).toContain('balance-proof');
  });

  it('declared-but-unresolvable ⇒ missing (dangling refs establish nothing)', async () => {
    const report = await makeArtifact(14);
    const bundle = [toRef(evidenceFor(report, 'test-report'))];
    const assessments = await assessEvidenceForRequirements(
      defaultRequirements() as never[],
      bundle,
      resolverOver(new Map()), // nothing stored at all
    );
    expect(assessments[0]?.state).toBe('missing');
    expect(assessments[0]?.note).toContain('unresolvable');
  });

  it('tampered evidence ⇒ present-unverified (adversarial: never missing, never verified)', async () => {
    const report = await makeArtifact(15);
    const tampered = {
      ...report,
      content: { kind: 'fixture', index: 15, payload: 'TAMPERED' },
    } as MaterialArtifact<unknown>;
    const bundle = [toRef(evidenceFor(report, 'test-report'))];
    const assessments = await assessEvidenceForRequirements(
      defaultRequirements() as never[],
      bundle,
      resolverOver(new Map([[report.digest, tampered]])),
    );
    expect(assessments[0]?.state).toBe('present-unverified');
    expect(assessments[0]?.note).toContain('digest-mismatch');
  });

  it('deterministic: same inputs ⇒ identical assessments', async () => {
    const report = await makeArtifact(16);
    const bundle = [toRef(evidenceFor(report, 'test-report'))];
    const run = () =>
      assessEvidenceForRequirements(
        defaultRequirements() as never[],
        bundle,
        resolverOver(new Map([[report.digest, report]])),
      );
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
  });
});
