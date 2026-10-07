/**
 * Program + pre-training + requalification + performance domain tests
 * (Work Order C004): seeded ordering, gap-derivation, explicit states,
 * proposal-not-write boundaries and expiry transitions.
 */

import { describe, expect, it } from 'vitest';
import { createCalibrationProgram } from './program.js';
import { calibrationProgramView } from './program.js';
import {
  buildQualificationUpdateProposal,
  completePreTrainingAssignment,
  derivePreTrainingTrack,
} from './pretraining.js';
import {
  createRequalificationProposal,
  deriveRequalificationProposal,
  REQUALIFICATION_TRIGGERS,
} from './requalification.js';
import { buildDemonstratedPerformance } from './performance.js';
import { consumeCalibrationAsAuthorization } from './verdict.js';
import { EXPERT_CALIBRATION_ERROR_CODES, ExpertCalibrationError } from './errors.js';
import {
  buildPreTrainingTrack,
  CAPABILITY_REF,
  EXPERT_1,
  PROGRAM_INPUT,
  T0,
  T1,
  T2,
  T3,
  TENANT_A,
  TENANT_B,
  buildProgram,
} from './test-support.js';

describe('CalibrationProgram', () => {
  it('is content-addressed and deterministic under probe permutation (seeded ordering)', async () => {
    const first = await buildProgram();
    const secondInput = {
      ...PROGRAM_INPUT,
      probes: [...PROGRAM_INPUT.probes].reverse(),
    };
    const second = await createCalibrationProgram(secondInput);
    expect(second.digest).toBe(first.digest);
    expect(first.probes).toHaveLength(1);
    expect(first.driftPolicy.minimumSample).toBe(3);
    expect(first.requalificationPolicy.triggers).toEqual([...REQUALIFICATION_TRIGGERS]);
  });

  it('rejects an empty probe composition and duplicate probes', async () => {
    await expect(
      createCalibrationProgram({ ...PROGRAM_INPUT, probes: [] }),
    ).rejects.toThrow(ExpertCalibrationError);
    const duplicated = {
      ...PROGRAM_INPUT,
      probes: [...PROGRAM_INPUT.probes, { ...PROGRAM_INPUT.probes[0]! }],
    };
    await expect(createCalibrationProgram(duplicated)).rejects.toThrow(ExpertCalibrationError);
  });

  it('pins evaluator/verifier criteria with declared minimum evidence (EV1.0 discipline)', async () => {
    const program = await buildProgram();
    const probe = program.probes[0]!;
    expect(probe.evaluator.criteriaDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(probe.verifier.minimumEvidence).toEqual({
      evidenceKind: 'work-product-ref',
      minimumCount: 2,
    });
  });

  it('round-trips through the digest-free view', async () => {
    const program = await buildProgram();
    const view = calibrationProgramView(program);
    expect(view.programId).toBe(program.programId);
    expect('digest' in view).toBe(false);
  });
});

describe('derivePreTrainingTrack', () => {
  it('derives gap-filling assignments from the C003 intake gap-list (deterministic order)', async () => {
    const track = await buildPreTrainingTrack([
      { reason: 'evidence-missing', itemId: 'item-ev-1', routingInput: 'evidence' },
      { reason: 'capability-unanswered', itemId: 'item-cap-1', routingInput: 'capability' },
    ]);
    expect(track.state).toBe('not-yet-started');
    expect(track.assignments.map((entry) => entry.focus)).toEqual([
      'capability',
      'evidence',
    ]);
    expect(track.assignments[0]!.workbenchTask.taskKind).toBe('calibration-pre-training');
    expect(track.assignments[0]!.workbenchTask.route).toContain('/workbench/pre-training/');
    expect(track.derivedFromGapDigests).toHaveLength(2);
  });

  it('fails closed on non-trainable gap reasons (declaration-shaped gaps resume the interview)', async () => {
    const error = await derivePreTrainingTrack(
      [{ reason: 'locale-missing', itemId: 'item-locale', routingInput: 'locale' }],
      {
        trackId: 'pretrain-track-x',
        tenant: TENANT_A,
        expertId: EXPERT_1,
        intakeSessionId: 'intake-session-1',
        derivedAt: T1,
      },
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ExpertCalibrationError);
    expect((error as ExpertCalibrationError).code).toBe(
      EXPERT_CALIBRATION_ERROR_CODES.INVALID_TRACK,
    );
  });

  it('tracks explicit pre-trained / not-yet state through completion (immutable appends)', async () => {
    const track = await buildPreTrainingTrack();
    const inProgress = completePreTrainingAssignment(track, 'assign-capability-item-cap-1', {
      tenant: TENANT_A,
      expertId: EXPERT_1,
      completedAt: T2,
    });
    expect(inProgress.state).toBe('in-progress');
    expect(track.state).toBe('not-yet-started'); // the source track is never mutated
    const done = completePreTrainingAssignment(inProgress, 'assign-evidence-item-ev-1', {
      tenant: TENANT_A,
      expertId: EXPERT_1,
      completedAt: T3,
    });
    expect(done.state).toBe('pre-trained');
    expect(done.assignments.every((entry) => entry.state === 'pre-trained')).toBe(true);
  });

  it('fails closed on cross-tenant completion and double completion', async () => {
    const track = await buildPreTrainingTrack();
    expect(() =>
      completePreTrainingAssignment(track, 'assign-capability-item-cap-1', {
        tenant: TENANT_B,
        expertId: EXPERT_1,
        completedAt: T2,
      }),
    ).toThrow(ExpertCalibrationError);
    const once = completePreTrainingAssignment(track, 'assign-capability-item-cap-1', {
      tenant: TENANT_A,
      expertId: EXPERT_1,
      completedAt: T2,
    });
    expect(() =>
      completePreTrainingAssignment(once, 'assign-capability-item-cap-1', {
        tenant: TENANT_A,
        expertId: EXPERT_1,
        completedAt: T3,
      }),
    ).toThrow(ExpertCalibrationError);
  });
});

describe('buildQualificationUpdateProposal (proposal, never a write)', () => {
  it('builds the A007 claim-candidate proposal ONLY from a fully pre-trained track', async () => {
    const track = await buildPreTrainingTrack();
    // Not-yet track → the proposal boundary fails closed.
    const error = await buildQualificationUpdateProposal(track, {
      capability: { ...CAPABILITY_REF },
      evidence: ['f'.repeat(64)],
      proposedAt: T3,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ExpertCalibrationError);
    expect((error as ExpertCalibrationError).code).toBe(
      EXPERT_CALIBRATION_ERROR_CODES.LIFECYCLE_CONFLICT,
    );

    const completed = completePreTrainingAssignment(
      completePreTrainingAssignment(track, 'assign-capability-item-cap-1', {
        tenant: TENANT_A,
        expertId: EXPERT_1,
        completedAt: T2,
      }),
      'assign-evidence-item-ev-1',
      { tenant: TENANT_A, expertId: EXPERT_1, completedAt: T3 },
    );
    const proposal = await buildQualificationUpdateProposal(completed, {
      capability: { ...CAPABILITY_REF },
      evidence: ['f'.repeat(64), '1'.repeat(64)],
      proposedAt: T3,
    });
    expect(proposal.kind).toBe('pre-training-completed');
    expect(proposal.trackDigest).toBe(completed.digest);
    expect(proposal.evidence).toHaveLength(2);
    expect(proposal.tenant).toBe(TENANT_A);
  });

  it('rejects an evidence-free proposal (A007 discipline: no evidence, no claim)', async () => {
    const track = await buildPreTrainingTrack();
    const completed = completePreTrainingAssignment(
      completePreTrainingAssignment(track, 'assign-capability-item-cap-1', {
        tenant: TENANT_A,
        expertId: EXPERT_1,
        completedAt: T2,
      }),
      'assign-evidence-item-ev-1',
      { tenant: TENANT_A, expertId: EXPERT_1, completedAt: T3 },
    );
    await expect(
      buildQualificationUpdateProposal(completed, {
        capability: { ...CAPABILITY_REF },
        evidence: [],
        proposedAt: T3,
      }),
    ).rejects.toThrow(ExpertCalibrationError);
  });
});

describe('deriveRequalificationProposal (expiry transitions)', () => {
  const qualification = {
    validFrom: T0,
    validUntil: '2026-10-10T00:00:00.000Z',
    priorRecordDigest: 'a'.repeat(64),
  };

  it('time-window-elapsed proposes the EXPIRED transition and fails while still in force', () => {
    const proposal = deriveRequalificationProposal({
      tenant: TENANT_A,
      expertId: EXPERT_1,
      capability: { ...CAPABILITY_REF },
      qualification,
      trigger: 'time-window-elapsed',
      proposedAt: '2026-10-11T00:00:00.000Z',
    });
    expect(proposal.proposedStatus).toBe('expired');
    expect(proposal.priorRecordDigest).toBe('a'.repeat(64));
    expect(proposal.verdictDigest).toBeNull();
    // Still in force → fail closed (nothing has decayed).
    expect(() =>
      deriveRequalificationProposal({
        tenant: TENANT_A,
        expertId: EXPERT_1,
        capability: { ...CAPABILITY_REF },
        qualification,
        trigger: 'time-window-elapsed',
        proposedAt: T1,
      }),
    ).toThrow(ExpertCalibrationError);
  });

  it('drift-verdict proposes REVOKED for misjudgement and STALE for decay (history auditable)', () => {
    const revoked = deriveRequalificationProposal({
      tenant: TENANT_A,
      expertId: EXPERT_1,
      capability: { ...CAPABILITY_REF },
      qualification,
      trigger: 'drift-verdict',
      driftVerdict: 'overconfident',
      verdictDigest: 'f'.repeat(64),
      proposedAt: T2,
    });
    expect(revoked.proposedStatus).toBe('revoked');
    expect(revoked.verdictDigest).toBe('f'.repeat(64));
    const stale = deriveRequalificationProposal({
      tenant: TENANT_A,
      expertId: EXPERT_1,
      capability: { ...CAPABILITY_REF },
      qualification,
      trigger: 'drift-verdict',
      driftVerdict: 'insufficient-sample',
      verdictDigest: 'f'.repeat(64),
      proposedAt: T2,
    });
    expect(stale.proposedStatus).toBe('stale');
  });

  it('domain-pack-change proposes EXPIRED; dispute-raised proposes STALE', () => {
    const packChange = deriveRequalificationProposal({
      tenant: TENANT_A,
      expertId: EXPERT_1,
      capability: { ...CAPABILITY_REF },
      qualification,
      trigger: 'domain-pack-change',
      proposedAt: T2,
    });
    expect(packChange.proposedStatus).toBe('expired');
    const dispute = deriveRequalificationProposal({
      tenant: TENANT_A,
      expertId: EXPERT_1,
      capability: { ...CAPABILITY_REF },
      qualification,
      trigger: 'dispute-raised',
      proposedAt: T2,
    });
    expect(dispute.proposedStatus).toBe('stale');
  });

  it('content-addresses proposals (same input ⇒ same digest)', async () => {
    const view = deriveRequalificationProposal({
      tenant: TENANT_A,
      expertId: EXPERT_1,
      capability: { ...CAPABILITY_REF },
      qualification,
      trigger: 'dispute-raised',
      proposedAt: T2,
    });
    const first = await createRequalificationProposal(view);
    const second = await createRequalificationProposal(
      deriveRequalificationProposal({
        tenant: TENANT_A,
        expertId: EXPERT_1,
        capability: { ...CAPABILITY_REF },
        qualification,
        trigger: 'dispute-raised',
        proposedAt: T2,
      }),
    );
    expect(first.digest).toBe(second.digest);
  });
});

describe('buildDemonstratedPerformance (the C002 routing read port)', () => {
  it('projects the typed verdict + in-force flag; expiry forces inForce false (bypass defense)', async () => {
    const inForce = await buildDemonstratedPerformance({
      tenant: TENANT_A,
      expertId: EXPERT_1,
      capability: { ...CAPABILITY_REF },
      programDigest: 'a'.repeat(64),
      verdict: 'calibrated',
      verdictDigest: 'f'.repeat(64),
      freshSampleCount: 5,
      totalSampleCount: 7,
      lastObservedAt: T2,
      qualification: { validFrom: T0, validUntil: '2026-10-10T00:00:00.000Z' },
      asOf: T1,
    });
    expect(inForce.inForce).toBe(true);
    expect(inForce.verdict).toBe('calibrated');

    const expired = await buildDemonstratedPerformance({
      tenant: TENANT_A,
      expertId: EXPERT_1,
      capability: { ...CAPABILITY_REF },
      programDigest: 'a'.repeat(64),
      verdict: 'calibrated',
      verdictDigest: 'f'.repeat(64),
      freshSampleCount: 5,
      totalSampleCount: 7,
      lastObservedAt: T2,
      qualification: { validFrom: T0, validUntil: '2026-10-10T00:00:00.000Z' },
      asOf: '2026-10-11T00:00:00.000Z',
    });
    expect(expired.inForce).toBe(false);
  });
});

describe('consumeCalibrationAsAuthorization (masquerade defense)', () => {
  it('fails closed for ANY calibration output consumed as authorization', async () => {
    expect(() => consumeCalibrationAsAuthorization({ verdict: 'calibrated' }, 'routing')).toThrow(
      ExpertCalibrationError,
    );
    const program = await buildProgram();
    expect(() => consumeCalibrationAsAuthorization(program, 'routing')).toThrow(
      ExpertCalibrationError,
    );
    try {
      consumeCalibrationAsAuthorization({ verdict: 'overconfident' }, 'authorization-check');
      expect.unreachable('consumeCalibrationAsAuthorization must never return');
    } catch (error) {
      expect((error as ExpertCalibrationError).code).toBe(
        EXPERT_CALIBRATION_ERROR_CODES.MASQUERADE_REJECTED,
      );
    }
  });
});
