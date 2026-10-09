/**
 * P004 evidence-transcript recorder (tests/hosted-provider-e2e).
 *
 * Live-provider suites record what they actually did — command, UTC
 * timestamp, resource id, result, evidence class — into machine-generated
 * markdown fragments under the directory named by
 * `ARENA_HOSTED_EVIDENCE_OUT`. The fragments are then embedded VERBATIM
 * into `docs/evidence/production/providers/*` (the committed evidence
 * files); nothing is hand-copied.
 *
 * Discipline (release-gate §3 vocabulary):
 *   - every row carries an evidence class: `DEMONSTRATED-LIVE` (real
 *     provider, real credentials, real network round-trip) or
 *     `AUTOMATED-TEST-ONLY` (simulation/unit-level path — never claimed
 *     as live);
 *   - secret VALUES are redacted at capture time: known secret values
 *     (registered from env var names) are replaced with
 *     `<redacted NAME first4…>`;
 *   - when `ARENA_HOSTED_EVIDENCE_OUT` is unset the recorder is a no-op
 *     (the suites still assert behavior; they just do not capture).
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Evidence classes (release-gate §3 vocabulary; no third value exists). */
export type EvidenceClass = 'DEMONSTRATED-LIVE' | 'AUTOMATED-TEST-ONLY';

/** Env var names whose VALUES must never reach a transcript. */
const SECRET_ENV_NAMES: readonly string[] = [
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_REST_TOKEN_ALT',
  'UPSTASH_REDIS_REST_TOKEN_OLD',
  'CLOUDFLARE_ACCOUNT_ID',
  'DATABASE_URL',
  'NEON_CONNECTION_STRING',
  'UPSTASH_MCP_API_KEY',
  'NEON_API_KEY',
  'NEON_API_KEY_ALT',
];

/** value -> replacement (registered at load + on demand). */
const secretReplacements = new Map<string, string>();

function registerSecretValue(name: string, value: string | undefined): void {
  if (value === undefined || value.length < 8) return; // too short to be a secret
  if (secretReplacements.has(value)) return;
  secretReplacements.set(value, `<redacted ${name} ${value.slice(0, 4)}…>`);
}

for (const name of SECRET_ENV_NAMES) {
  registerSecretValue(name, process.env[name]);
}

/** Register an additional secret value at runtime (never logged). */
export function registerSecret(name: string, value: string | undefined): void {
  registerSecretValue(name, value);
}

/** Redact every registered secret value inside a transcript string. */
export function redact(text: string): string {
  let scrubbed = text;
  for (const [value, replacement] of secretReplacements) {
    if (scrubbed.includes(value)) scrubbed = scrubbed.split(value).join(replacement);
  }
  return scrubbed;
}

/** The transcript output directory, or null when capture is disabled. */
export function evidenceOutDir(): string | null {
  const raw = process.env['ARENA_HOSTED_EVIDENCE_OUT'];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : null;
}

/** True when transcripts are being captured. */
export function transcriptEnabled(): boolean {
  return evidenceOutDir() !== null;
}

// Generous but bounded: the zero-credential rows embed the full list of
// removed provider env-var NAMES (~500 chars; names only, never values) —
// the finisher raised this from 400 after the predecessor's capture
// truncated exactly those name lists mid-row.
const MAX_RESULT_LENGTH = 1200;

function truncate(text: string): string {
  return text.length > MAX_RESULT_LENGTH ? `${text.slice(0, MAX_RESULT_LENGTH)}…[truncated]` : text;
}

function isoNow(): string {
  return new Date().toISOString();
}

function ensureFragment(file: string, facet: string): void {
  if (existsSync(file)) return;
  mkdirSync(join(file, '..'), { recursive: true });
  appendFileSync(
    file,
    [
      `<!-- machine-generated transcript fragment (tests/hosted-provider-e2e, facet: ${facet}) -->`,
      `<!-- embed VERBATIM under docs/evidence/production/providers/ -->`,
      `| timestamp (UTC) | step | command | resource | result | class |`,
      `|---|---|---|---|---|---|`,
      '',
    ].join('\n'),
  );
}

/**
 * Append one evidence row to `<out>/<facet>.transcript.md` (the fragment
 * for that facet). No-op without ARENA_HOSTED_EVIDENCE_OUT.
 */
export function recordTranscript(
  facet: string,
  row: {
    readonly step: string;
    readonly command: string;
    readonly resource: string;
    readonly result: string;
    readonly classification: EvidenceClass;
  },
): void {
  const out = evidenceOutDir();
  if (out === null) return;
  const file = join(out, `${facet}.transcript.md`);
  ensureFragment(file, facet);
  appendFileSync(
    file,
    `| ${isoNow()} | ${redact(row.step)} | ${redact(truncate(row.command))} | ${redact(
      truncate(row.resource),
    )} | ${redact(truncate(row.result))} | ${row.classification} |\n`,
  );
}

/**
 * Append a narrative note line to the facet fragment (skip reasons,
 * redacted configuration summaries, honest-limitation notes).
 */
export function recordNote(facet: string, note: string): void {
  const out = evidenceOutDir();
  if (out === null) return;
  const file = join(out, `${facet}.transcript.md`);
  ensureFragment(file, facet);
  appendFileSync(file, `> ${isoNow()} — ${redact(truncate(note))}\n`);
}
