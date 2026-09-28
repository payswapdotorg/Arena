/**
 * Admission check tests (Work Order A010 gate 5; R30):
 *   - positive: a fitting envelope is admitted, decision is frozen;
 *   - negative: EVERY violation class rejects with the typed
 *     ADMISSION_REJECTED error — cpu / memory / wall-clock over quota,
 *     undeclared egress (host, port, protocol), uncovered mount /
 *     insufficient mount access, undeclared secret injection point;
 *   - negative: malformed environment views / envelopes.
 */

import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import {
  assertAdmissible,
  evaluateAdmission,
  isAdmissionDecision,
} from './admission.js';
import { toEnvironmentAdmissionView } from './isolation-envelope.js';
import { runIsolationEnvelope } from './run-record.js';
import { createRunRecord } from './run-record.js';
import { makeDeclarationInput, makeEnvironmentView } from './test-support.js';

describe('admission check (gate 5)', () => {
  it('admits a fitting isolation envelope (positive)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    const view = toEnvironmentAdmissionView(makeEnvironmentView());
    const decision = evaluateAdmission(view, runIsolationEnvelope(record));
    expect(decision.admitted).toBe(true);
    expect(decision.violations).toEqual([]);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(isAdmissionDecision(decision)).toBe(true);
    expect(() => assertAdmissible(view, runIsolationEnvelope(record))).not.toThrow();
  });

  it('rejects over-quota resource envelopes with typed errors (negative, gate 5)', async () => {
    const cpuRecord = await createRunRecord(makeDeclarationInput({ cpuMillis: 4001 }));
    const memoryRecord = await createRunRecord(makeDeclarationInput({ memoryMiB: 1025 }));
    const wallRecord = await createRunRecord(makeDeclarationInput({ wallClockSeconds: 901 }));

    for (const record of [cpuRecord, memoryRecord, wallRecord]) {
      const view = toEnvironmentAdmissionView(makeEnvironmentView());
      const decision = evaluateAdmission(view, runIsolationEnvelope(record));
      expect(decision.admitted).toBe(false);
      expect(decision.violations.length).toBe(1);
      const error = capture(() =>
        assertAdmissible(view, runIsolationEnvelope(record)),
      );
      expect(error?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.ADMISSION_REJECTED);
      expect(error?.details).toMatchObject({ violations: decision.violations });
    }
  });

  it('rejects least-privilege egress violations (negative, gate 5)', async () => {
    const hostRecord = await createRunRecord(
      makeDeclarationInput({
        networkAllows: [{ host: 'evil.example.org', port: 443, protocol: 'https' }],
      }),
    );
    const portRecord = await createRunRecord(
      makeDeclarationInput({
        networkAllows: [{ host: 'packages.example.org', port: 8443, protocol: 'https' }],
      }),
    );
    const protocolRecord = await createRunRecord(
      makeDeclarationInput({
        networkAllows: [{ host: 'packages.example.org', port: 443, protocol: 'tcp' }],
      }),
    );
    for (const record of [hostRecord, portRecord, protocolRecord]) {
      const view = toEnvironmentAdmissionView(makeEnvironmentView());
      const decision = evaluateAdmission(view, runIsolationEnvelope(record));
      expect(decision.admitted).toBe(false);
      expect(decision.violations[0]).toContain('not an explicit allow');
    }
  });

  it('rejects least-privilege mount violations (negative, gate 5)', async () => {
    const uncoveredRecord = await createRunRecord(
      makeDeclarationInput({
        mounts: [{ mountPath: '/etc', access: 'read-only', source: 'initial-state' }],
      }),
    );
    const writeRecord = await createRunRecord(
      makeDeclarationInput({
        mounts: [{ mountPath: '/evidence', access: 'read-write', source: 'evidence' }],
      }),
    );
    const view = toEnvironmentAdmissionView(makeEnvironmentView());
    const uncovered = evaluateAdmission(view, runIsolationEnvelope(uncoveredRecord));
    expect(uncovered.admitted).toBe(false);
    expect(uncovered.violations[0]).toContain("mount '/etc'");
    const write = evaluateAdmission(view, runIsolationEnvelope(writeRecord));
    expect(write.admitted).toBe(false);
    expect(write.violations[0]).toContain('sufficient access');
  });

  it('rejects undeclared secret injection points (negative, gate 5)', async () => {
    const record = await createRunRecord(
      makeDeclarationInput({
        secretPoints: [
          { secretId: 'unregistered-secret', mountPath: '/run/secrets/registry', mechanism: 'file-mount' },
        ],
      }),
    );
    const view = toEnvironmentAdmissionView(makeEnvironmentView());
    const decision = evaluateAdmission(view, runIsolationEnvelope(record));
    expect(decision.admitted).toBe(false);
    expect(decision.violations[0]).toContain('not a declared injection point');
  });

  it('enumerates MULTIPLE violations at once (positive)', async () => {
    const record = await createRunRecord(
      makeDeclarationInput({
        cpuMillis: 9000,
        networkAllows: [{ host: 'evil.example.org', port: 443, protocol: 'https' }],
      }),
    );
    const view = toEnvironmentAdmissionView(makeEnvironmentView());
    const decision = evaluateAdmission(view, runIsolationEnvelope(record));
    expect(decision.admitted).toBe(false);
    expect(decision.violations.length).toBe(2);
  });

  it('rejects malformed inputs (negative)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    expect(() =>
      evaluateAdmission(null as never, runIsolationEnvelope(record)),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      evaluateAdmission(
        toEnvironmentAdmissionView(makeEnvironmentView()),
        null as never,
      ),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      toEnvironmentAdmissionView({ ...makeEnvironmentView(), timeLimits: { startupSeconds: 0, cleanupGraceSeconds: 30, deadlineBehavior: 'hard-stop' } }),
    ).toThrow(EnvironmentRuntimeError);
    expect(isAdmissionDecision({ admitted: true, violations: ['x'] })).toBe(false);
    expect(isAdmissionDecision({ admitted: false, violations: [] })).toBe(false);
  });
});

function capture(fn: () => unknown): EnvironmentRuntimeError | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvironmentRuntimeError) return error;
  }
  return undefined;
}
