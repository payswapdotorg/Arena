/**
 * TrajectoryRecord tests — header + entries + chain head, append-only
 * semantics (appends return NEW frozen records), completion freezing,
 * the pure replay view and full-chain verification. Positive AND
 * negative paths (Work Order A011 gates 4, 11).
 */

import { describe, expect, it } from 'vitest';
import {
  appendTrajectoryEntry,
  createTrajectoryRecord,
  isTrajectoryCompleted,
  isTrajectoryRecord,
  openTrajectory,
  replayTrajectory,
  trajectoryEntryCount,
  trajectoryExportView,
  verifyTrajectoryRecord,
} from './record.js';
import { createTrajectoryHeader } from './header.js';
import { TRAJECTORY_ERROR_CODES } from './errors.js';
import { toTrajectoryTimestamp } from './shared.js';
import type { TrajectoryEntry } from './entry.js';
import type { TrajectoryRecord } from './record.js';
import {
  T0,
  T1,
  T2,
  T3,
  T4,
  T5,
  T6,
  T7,
  makeActionInput,
  makeCompletionInput,
  makeHeaderInput,
  makeMixedSequence,
  makeObservationInput,
} from './test-support.js';

async function buildMixedRecord(): Promise<TrajectoryRecord> {
  let record = await openTrajectory(makeHeaderInput());
  for (const input of makeMixedSequence()) {
    record = await appendTrajectoryEntry(record, input);
  }
  return record;
}

describe('openTrajectory / createTrajectoryRecord', () => {
  it('opens an EMPTY trajectory anchored at the header digest', async () => {
    const header = await createTrajectoryHeader(makeHeaderInput());
    const record = createTrajectoryRecord(header);
    expect(record.header).toBe(header);
    expect(record.entries).toEqual([]);
    expect(record.chainHead).toBe(header.digest);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.entries)).toBe(true);
    expect(isTrajectoryRecord(record)).toBe(true);
    expect(trajectoryEntryCount(record)).toBe(0);
    expect(isTrajectoryCompleted(record)).toBe(false);
  });

  it('openTrajectory validates the header input end to end', async () => {
    const record = await openTrajectory(makeHeaderInput());
    expect(record.header.trajectoryId).toBe('trajectory-000042');
    await expect(openTrajectory(makeHeaderInput({ trajectoryId: 'BAD' }))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_IDENTITY }),
    );
  });
});

describe('appendTrajectoryEntry (positive paths)', () => {
  it('returns NEW frozen records; the input record is never modified', async () => {
    const empty = await openTrajectory(makeHeaderInput());
    const withOne = await appendTrajectoryEntry(empty, makeActionInput(1, T0));
    expect(withOne).not.toBe(empty);
    expect(empty.entries).toHaveLength(0); // original untouched
    expect(withOne.entries).toHaveLength(1);
    expect(trajectoryEntryCount(withOne)).toBe(1);
    const withTwo = await appendTrajectoryEntry(withOne, makeObservationInput(2, T1));
    expect(withTwo).not.toBe(withOne);
    expect(withOne.entries).toHaveLength(1);
    expect(withTwo.entries).toHaveLength(2);
    for (const record of [empty, withOne, withTwo]) {
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.entries)).toBe(true);
      expect(record.entries.every((entry) => Object.isFrozen(entry))).toBe(true);
    }
  });

  it('the chain head follows the last entry; entry 1 anchors at the header', async () => {
    const record = await buildMixedRecord();
    const first = record.entries[0] as TrajectoryEntry;
    const last = record.entries[record.entries.length - 1] as TrajectoryEntry;
    expect(first.prevDigest).toBe(record.header.digest);
    for (let index = 1; index < record.entries.length; index += 1) {
      const entry = record.entries[index] as TrajectoryEntry;
      const previous = record.entries[index - 1] as TrajectoryEntry;
      expect(entry.prevDigest).toBe(previous.stepDigest);
    }
    expect(record.chainHead).toBe(last.stepDigest);
  });

  it('isTrajectoryRecord accepts every intermediate version', async () => {
    let record = await openTrajectory(makeHeaderInput());
    for (const input of makeMixedSequence()) {
      record = await appendTrajectoryEntry(record, input);
      expect(isTrajectoryRecord(record)).toBe(true);
    }
  });
});

describe('appendTrajectoryEntry (negative paths)', () => {
  it('append-after-complete is REJECTED (gate 4 negative test)', async () => {
    const record = await buildMixedRecord(); // ends with a completion entry
    expect(isTrajectoryCompleted(record)).toBe(true);
    await expect(appendTrajectoryEntry(record, makeActionInput(8, T7))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.ALREADY_COMPLETED }),
    );
    await expect(
      appendTrajectoryEntry(record, makeCompletionInput(8, T7)),
    ).rejects.toThrowError(/frozen/);
  });

  it('sequence gaps and regressions are rejected at the record boundary', async () => {
    const record = await openTrajectory(makeHeaderInput());
    await expect(appendTrajectoryEntry(record, makeActionInput(2, T0))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.SEQUENCE_GAP }),
    );
    const withOne = await appendTrajectoryEntry(record, makeActionInput(1, T0));
    await expect(appendTrajectoryEntry(withOne, makeActionInput(1, T1))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.SEQUENCE_REGRESSION }),
    );
  });

  it('timestamp regressions are rejected at the record boundary', async () => {
    const record = await openTrajectory(makeHeaderInput());
    const withOne = await appendTrajectoryEntry(record, makeActionInput(1, T2));
    await expect(appendTrajectoryEntry(withOne, makeActionInput(2, T1))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.TIMESTAMP_REGRESSION }),
    );
  });

  it('rejects a structurally invalid record input', async () => {
    await expect(
      appendTrajectoryEntry(null as never, makeActionInput(1, T0)),
    ).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_RECORD }),
    );
  });
});

describe('replayTrajectory (gate 4 — pure replay view)', () => {
  it('returns the ordered entry stream exactly as appended', async () => {
    const record = await buildMixedRecord();
    const stream = replayTrajectory(record);
    expect(stream).toHaveLength(7);
    expect(stream.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(stream.map((entry) => entry.kind)).toEqual([
      'action',
      'observation',
      'error',
      'action',
      'checkpoint',
      'observation',
      'completion',
    ]);
    expect(stream.map((entry) => entry.occurredAt)).toEqual([T0, T1, T2, T3, T4, T5, T6]);
    expect(stream).toBe(record.entries); // zero-copy pure projection
  });

  it('replaying an empty trajectory yields the empty stream', async () => {
    const record = await openTrajectory(makeHeaderInput());
    expect(replayTrajectory(record)).toEqual([]);
  });

  it('replay rejects structurally invalid records', () => {
    expect(() => replayTrajectory('nope' as never)).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_RECORD }),
    );
  });
});

describe('verifyTrajectoryRecord (full-chain verification)', () => {
  it('verifies the whole mixed record and returns the chain head', async () => {
    const record = await buildMixedRecord();
    await expect(verifyTrajectoryRecord(record)).resolves.toBe(record.chainHead);
    await expect(verifyTrajectoryRecord(record, record.chainHead)).resolves.toBe(
      record.chainHead,
    );
  });

  it('verifies every intermediate version (append-only history is checkable)', async () => {
    let record = await openTrajectory(makeHeaderInput());
    for (const input of makeMixedSequence()) {
      record = await appendTrajectoryEntry(record, input);
      await expect(verifyTrajectoryRecord(record)).resolves.toBe(record.chainHead);
    }
  });

  it("throws TAMPERED when a historical entry's payload is forged", async () => {
    const record = await buildMixedRecord();
    const forgedEntry = {
      ...(record.entries[0] as TrajectoryEntry),
      payload: { actionId: 'malicious-action', input: null },
    } as TrajectoryEntry;
    const tampered: TrajectoryRecord = {
      header: record.header,
      entries: Object.freeze([forgedEntry, ...record.entries.slice(1)]),
      chainHead: record.chainHead,
    };
    await expect(verifyTrajectoryRecord(tampered)).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.TAMPERED }),
    );
  });

  it('throws TAMPERED when the declared chain head is forged', async () => {
    const record = await buildMixedRecord();
    const tampered: TrajectoryRecord = { ...record, chainHead: 'f'.repeat(64) as never };
    await expect(verifyTrajectoryRecord(tampered)).rejects.toThrowError(
      /chain head mismatch/,
    );
    await expect(verifyTrajectoryRecord(record, 'e'.repeat(64))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.TAMPERED }),
    );
  });

  it('throws TAMPERED when the header digest is forged', async () => {
    const record = await buildMixedRecord();
    const tampered: TrajectoryRecord = {
      ...record,
      header: { ...record.header, digest: 'a'.repeat(64) as never },
    };
    await expect(verifyTrajectoryRecord(tampered)).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.TAMPERED }),
    );
  });

  it('detects contiguity / monotonicity / finality breaks inside a record', async () => {
    const record = await buildMixedRecord();
    // Drop entry 4 (gap):
    const gapped: TrajectoryRecord = {
      header: record.header,
      entries: Object.freeze(
        record.entries.filter((entry) => entry.sequence !== 4),
      ),
      chainHead: record.chainHead,
    };
    await expect(verifyTrajectoryRecord(gapped)).rejects.toThrowError(/contiguity broken/);
    // Entry appended after the completion entry (chain-consistent, so only
    // the finality rule can catch it):
    const last = record.entries[record.entries.length - 1] as TrajectoryEntry;
    const { createTrajectoryEntry } = await import('./entry.js');
    const extra = await createTrajectoryEntry(
      {
        anchorDigest: last.stepDigest,
        lastSequence: 7,
        lastOccurredAt: toTrajectoryTimestamp(T6, 'record test'),
        completed: false, // pretend the completion wasn't terminal
      },
      makeActionInput(8, T7),
    );
    const afterCompletion: TrajectoryRecord = {
      header: record.header,
      entries: Object.freeze([...record.entries, extra]),
      chainHead: extra.stepDigest,
    };
    await expect(verifyTrajectoryRecord(afterCompletion)).rejects.toThrowError(
      /following the completion entry/,
    );
    await expect(verifyTrajectoryRecord('nope' as never)).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_RECORD }),
    );
  });
});

describe('trajectoryExportView (requirement R24)', () => {
  it('exports the header plus the ordered entries (frozen)', async () => {
    const record = await buildMixedRecord();
    const exported = trajectoryExportView(record);
    expect(Object.keys(exported).sort()).toEqual(['entries', 'header']);
    expect(exported.header).toBe(record.header);
    expect(exported.entries).toBe(record.entries);
    expect(Object.isFrozen(exported)).toBe(true);
    expect(() => trajectoryExportView('nope' as never)).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_RECORD }),
    );
  });
});

describe('deep-freeze semantics (gate 10 — no mutation API)', () => {
  it('mutating any part of a record throws in strict mode', async () => {
    const record = await buildMixedRecord();
    expect(() => {
      (record as unknown as { chainHead: string }).chainHead = 'f'.repeat(64);
    }).toThrowError(TypeError);
    expect(() => {
      (record.entries as unknown as unknown[]).push(record.entries[0]);
    }).toThrowError(TypeError);
    expect(() => {
      (record.entries[0] as unknown as { sequence: number }).sequence = 99;
    }).toThrowError(TypeError);
    expect(() => {
      (record.header as unknown as { trajectoryId: string }).trajectoryId = 'hacked';
    }).toThrowError(TypeError);
  });
});
