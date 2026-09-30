/**
 * POSITIVE walkthrough tests: the full protocol chain, green path.
 */

import { describe, expect, it } from 'vitest';
import { verifyTrajectoryRecord } from '@arena/trajectory';
import { verifyBodyVersion } from '@arena/agent-body';
import {
  SCENARIO,
  receiptDigests,
  runReferenceScenario,
} from './walkthrough.js';

const HEX64 = /^[0-9a-f]{64}$/;

describe('A028 reference walkthrough — the full chain', () => {
  it('walks body → substrate → possession → case → task → run → trajectory → evaluation → verification → compatibility → certification → release → SDK', async () => {
    const receipt = await runReferenceScenario();

    // Body: forged, registered append-only, tamper-verified.
    expect(receipt.bodyBuild.body.versions).toHaveLength(2);
    await expect(verifyBodyVersion(receipt.bodyBuild.evolved.bodyVersion)).resolves.toMatch(HEX64);

    // Possession binds the composition under test.
    expect(receipt.possession.digest).toMatch(HEX64);
    expect(receipt.possession.bodyVersion.digest).toBe(
      receipt.bodyBuild.evolved.bodyVersion.digest,
    );

    // TaskSpec compiled against the case and pinned to the environment.
    expect(receipt.taskSpec.identity.tenant).toBe(SCENARIO.tenant);
    expect(receipt.taskSpec.identity.taskId).toBe(`${SCENARIO.taskIdPrefix}${SCENARIO.caseId}`);
    expect(receipt.compilationRecord.emittedSpecs).toHaveLength(1);

    // Run completed through the A010 lifecycle.
    expect(receipt.runState.status).toBe('completed');
    expect(receipt.runResult.runAddress.evidenceDigests.length).toBeGreaterThanOrEqual(1);

    // Trajectory chain verifies and ends completed.
    await expect(verifyTrajectoryRecord(receipt.trajectory)).resolves.toMatch(HEX64);
    expect(receipt.trajectory.entries).toHaveLength(6);

    // Evaluation: meets criteria with a perfect weighted aggregate.
    expect(receipt.evaluationRecord.aggregate.outcome).toBe('meets-criteria');
    expect(receipt.evaluationRecord.aggregate.score).toBe(1);
    expect(receipt.evaluationRecord.verdicts).toHaveLength(3);

    // Verification: pass with both requirements supported.
    expect(receipt.verificationRecord.outcome).toBe('pass');
    expect(
      receipt.verificationRecord.evidenceSupport.every(
        (support) => support.status === 'present-supported',
      ),
    ).toBe(true);

    // Compatibility: the reference substrate is compatible.
    expect(receipt.compatibilityRecord.verdict).toBe('compatible');

    // Certification: satisfied, CERTIFIED, scoped statement.
    expect(receipt.certificationRecord.verdict).toBe('satisfied');
    expect(receipt.certificationRecord.grantedLevel).toBe('CERTIFIED');
    const statement = receipt.certificationRecord.statement?.text ?? '';
    expect(statement).toContain('software-engineer');
    expect(statement).toContain('reference-reasoner-1');
    expect(statement).toContain('software-engineer-sandbox');
    expect(statement).toContain(SCENARIO.suiteId);

    // Release: registered on the stable channel and published.
    expect(receipt.releaseRecord.channel).toBe('stable');
    expect(receipt.releaseRecord.gate?.strongestGrant).toBe('CERTIFIED');
    expect(receipt.publication.action).toBe('publish');
  });

  it('is byte-deterministic: two full runs produce identical digests', async () => {
    const [a, b] = await Promise.all([runReferenceScenario(), runReferenceScenario()]);
    expect(receiptDigests(a)).toEqual(receiptDigests(b));
  });
});
