/**
 * Pretraining request compilation tests (Work Order C014): the typed
 * closed outcomes — compilable | blocked-with-reasons — over the
 * resolved C009/C008 seams. Pure unit level: no I/O, no clock.
 */

import { describe, expect, it } from 'vitest';

import {
  compilePretrainingRequest,
  toPretrainingRequest,
} from './pretraining.js';
import { BodyMarketplaceError } from './errors.js';
import {
  makeAcceptedEvidence,
  makeCandidate,
  makePretrainingRequest,
  EVIDENCE_DIGEST,
  CANDIDATE_ID,
  TENANT,
} from './test-support.js';

describe('pretraining request compilation', () => {
  it('compiles a rights-cleared request with accepted evidence into COMPILABLE', () => {
    const request = toPretrainingRequest(makePretrainingRequest());
    const compilation = compilePretrainingRequest(request, {
      resolvedEvidence: new Map([[EVIDENCE_DIGEST, makeAcceptedEvidence()]]),
      resolvedCandidates: new Map([[CANDIDATE_ID, makeCandidate()]]),
    });
    expect(compilation.outcome).toBe('compilable');
    if (compilation.outcome !== 'compilable') return;
    expect(compilation.totalInputs).toBe(2);
    expect(compilation.validatedEvidenceRefs).toEqual([EVIDENCE_DIGEST]);
    expect(compilation.candidateRefs).toEqual([CANDIDATE_ID]);
    expect(compilation.commission?.commissionId).toBe('commission-0001');
  });

  it('BLOCKS on rights-insufficient when an input forbids training use', () => {
    const base = makePretrainingRequest();
    const request = toPretrainingRequest({
      ...base,
      inputs: [
        { ...base.inputs[0]!, rights: { ...base.inputs[0]!.rights, trainingUse: 'forbidden' } },
      ],
    });
    const compilation = compilePretrainingRequest(request, {
      resolvedEvidence: new Map([[EVIDENCE_DIGEST, makeAcceptedEvidence()]]),
    });
    expect(compilation.outcome).toBe('blocked');
    if (compilation.outcome !== 'blocked') return;
    expect(compilation.reasons.map((reason) => reason.code)).toContain('rights-insufficient');
    const rightsReason = compilation.reasons.find((reason) => reason.code === 'rights-insufficient');
    expect(rightsReason?.refId).toBe(EVIDENCE_DIGEST);
    expect(rightsReason?.inputIndex).toBe(0);
  });

  it('BLOCKS on evidence-insufficient when the C009 verdict is not accepted', () => {
    const base = makePretrainingRequest();
    const request = toPretrainingRequest({
      ...base,
      inputs: [base.inputs[0]!],
    });
    const compilation = compilePretrainingRequest(request, {
      resolvedEvidence: new Map([
        [EVIDENCE_DIGEST, makeAcceptedEvidence({ verdict: 'revision_required' })],
      ]),
    });
    expect(compilation.outcome).toBe('blocked');
    if (compilation.outcome !== 'blocked') return;
    expect(compilation.reasons.map((reason) => reason.code)).toContain('evidence-insufficient');
  });

  it('BLOCKS when validated evidence does not resolve through the C009 seam', () => {
    const base = makePretrainingRequest();
    const request = toPretrainingRequest({ ...base, inputs: [base.inputs[0]!] });
    const compilation = compilePretrainingRequest(request, {
      resolvedEvidence: new Map(),
    });
    expect(compilation.outcome).toBe('blocked');
    if (compilation.outcome !== 'blocked') return;
    expect(
      compilation.reasons.filter((reason) => reason.code === 'evidence-insufficient').length,
    ).toBeGreaterThanOrEqual(2); // the unresolved input + the no-evidence summary reason
  });

  it('BLOCKS cross-tenant evidence (tenant-scoped admissibility)', () => {
    const base = makePretrainingRequest();
    const request = toPretrainingRequest({ ...base, inputs: [base.inputs[0]!] });
    const compilation = compilePretrainingRequest(request, {
      resolvedEvidence: new Map([
        [EVIDENCE_DIGEST, makeAcceptedEvidence({ tenantId: 'other-tenant' })],
      ]),
    });
    expect(compilation.outcome).toBe('blocked');
    if (compilation.outcome !== 'blocked') return;
    expect(compilation.reasons.map((reason) => reason.code)).toContain('evidence-insufficient');
  });

  it('drops unresolvable C008 candidates into a blocked outcome (never silent admission)', () => {
    const base = makePretrainingRequest();
    const request = toPretrainingRequest({ ...base, inputs: [base.inputs[1]!] });
    const compilation = compilePretrainingRequest(request, {
      resolvedEvidence: new Map(),
      resolvedCandidates: new Map(),
    });
    expect(compilation.outcome).toBe('blocked');
  });

  it('fail-closes on malformed requests (typed INVALID_REQUEST)', () => {
    expect(() => toPretrainingRequest({ nope: 1 })).toThrow(BodyMarketplaceError);
    const base = makePretrainingRequest();
    expect(() => toPretrainingRequest({ ...base, inputs: [] })).toThrow(/at least one input/);
    expect(() =>
      toPretrainingRequest({ ...base, tenantId: 'NOT_A_TENANT' }),
    ).toThrow(BodyMarketplaceError);
  });

  it('compilation is deterministic (pure) across repeated calls', () => {
    const request = toPretrainingRequest(makePretrainingRequest());
    const options = {
      resolvedEvidence: new Map([[EVIDENCE_DIGEST, makeAcceptedEvidence()]]),
      resolvedCandidates: new Map([[CANDIDATE_ID, makeCandidate()]]),
    };
    expect(compilePretrainingRequest(request, options)).toEqual(
      compilePretrainingRequest(request, options),
    );
  });
});

describe('tenant fixture sanity', () => {
  it('uses the fixture tenant', () => {
    expect(TENANT).toBe('acme');
  });
});
