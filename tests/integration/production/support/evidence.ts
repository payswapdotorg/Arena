/**
 * tests/integration/production/support/evidence.ts — the P006 evidence
 * capture kit (Work Order P006; issue #158; ADR-P001-02 — the truth
 * lens recorded per observation; spec/post-roadmap-release-gate.md §3
 * — the honest evidence classification).
 *
 * Every transcript this kit writes records:
 *   - the DEPLOYED SOURCE SHA at run time (git rev-parse HEAD — the
 *     evidence bundle never claims a SHA it did not run on);
 *   - the TRANSPORT (public HTTP listener URL + signed webhook
 *     deliveries) and the ENGINE CLASS per proof (embedded real
 *     Postgres via PGlite = AUTOMATED-TEST-ONLY; live Neon through the
 *     real HTTP driver = DEMONSTRATED-LIVE);
 *   - the TRUTH LENS under which observations were made (ADR-P001-02:
 *     the integrated battery operates under the `customer` lens for
 *     tenant-scoped flows — the demo/customer vocabulary is recorded
 *     per observation, never blended);
 *   - FRESH timestamps (nothing historical is rewritten; each run
 *     overwrites only ITS OWN label's transcript).
 */

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The honest evidence classification vocabulary (release-gate §3). */
export type EvidenceClass = 'AUTOMATED-TEST-ONLY' | 'DEMONSTRATED-LIVE';

/** One evidence observation line (machine-checkable, human-readable). */
export interface EvidenceObservation {
  readonly step: string;
  readonly observed: string;
  readonly lens?: 'demo' | 'customer';
}

/** The environment facts a transcript header records. */
export interface EvidenceEnvironment {
  readonly engineClass: 'embedded-postgres' | 'live-neon';
  readonly transport: string;
  readonly baseUrl: string;
  readonly lens: 'demo' | 'customer';
  readonly paymentPosture: string;
}

/** The deployed source SHA at run time (git rev-parse HEAD). */
export function deployedSourceSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'unavailable (not a git worktree)';
  }
}

/** The evidence class for an engine (release-gate §3). */
export function evidenceClassForEngine(engineClass: 'embedded-postgres' | 'live-neon'): EvidenceClass {
  return engineClass === 'live-neon' ? 'DEMONSTRATED-LIVE' : 'AUTOMATED-TEST-ONLY';
}

/** Render the transcript header for one proof run. */
export function transcriptHeader(
  label: string,
  environment: EvidenceEnvironment,
): readonly string[] {
  const capturedAt = new Date().toISOString();
  return [
    `# P006 integrated acceptance — ${label}`,
    '',
    `- captured-at: ${capturedAt} (fresh timestamp — no historical evidence rewritten)`,
    `- deployed-source-sha: ${deployedSourceSha()}`,
    `- engine: ${environment.engineClass} (evidence class ${evidenceClassForEngine(environment.engineClass)})`,
    `- transport: ${environment.transport} — ${environment.baseUrl}`,
    `- truth-lens: ${environment.lens} (ADR-P001-02; recorded per observation, never blended)`,
    `- payment-posture: ${environment.paymentPosture}`,
    '',
    '## Observations',
    '',
  ];
}

/** Render one observation line. */
export function observationLine(observation: EvidenceObservation): string {
  const lens = observation.lens === undefined ? '' : ` [lens:${observation.lens}]`;
  return `- ${observation.step}: ${observation.observed}${lens}`;
}

/** Write one proof's transcript into the evidence bundle directory. */
export async function writeTranscript(
  evidenceDir: string,
  label: string,
  lines: readonly string[],
): Promise<string> {
  await mkdir(evidenceDir, { recursive: true });
  const file = join(evidenceDir, `${label}-transcript.md`);
  await writeFile(file, `${lines.join('\n')}\n`, 'utf-8');
  return file;
}
