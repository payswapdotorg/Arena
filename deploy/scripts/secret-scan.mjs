#!/usr/bin/env node
/**
 * Committed-secret scanner (Work Order B015) — the "wired secret scanner
 * check" of the deploy workflow: scans every git-tracked text file for
 * high-confidence credential patterns and FAILS (exit 1) on any hit.
 *
 * Zero dependencies (plain Node ESM) so it runs identically in CI and
 * locally. Posture:
 *   - provider wiring is env-driven with EMPTY placeholders; the committed
 *     template `deploy/env/hosted-preview.env.example` therefore cannot
 *     carry a credential;
 *   - specific high-confidence token formats are scanned across ALL
 *     tracked text files (GitHub PATs, AWS access keys, Slack tokens,
 *     OpenAI-style keys, Google API keys);
 *   - connection strings with embedded credentials and secret-named env
 *     assignments are scanned in env-style files (*.env, .env*, and any
 *     *env*.example) where a non-empty value would be a real leak;
 *     documentation placeholders (<...>, ${{ ... }}, changeme, REPLACE_ME,
 *     dry-run, example, ...) are allowed.
 *
 * ALLOWLIST: four pre-existing hygiene-test fixtures carry deliberately
 * SYNTHETIC token-shaped literals (the classic "sk-" + alphabet-run test
 * datum) that exist to prove the repo's own credential-detection regexes
 * work. They are allowlisted by path + pattern id below — any NEW hit,
 * anywhere (including in those files for other patterns), still fails
 * the scan.
 *
 * Usage: node deploy/scripts/secret-scan.mjs [--help]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

const HELP = `usage: node deploy/scripts/secret-scan.mjs
Scans git-tracked text files for committed secrets. Exits non-zero on any hit.`;

/**
 * Documented exceptions (see header): synthetic credential-shaped literals
 * in pre-existing hygiene-test fixtures, keyed by `path::pattern-id`.
 */
const ALLOWLIST = new Set([
  'apps/web/src/console/console.test.ts::openai-style-key',
  'apps/web/src/workbench/workbench.test.ts::openai-style-key',
  'packages/workbench/src/hygiene.test.ts::openai-style-key',
  'packages/workbench/src/secrets.test.ts::openai-style-key',
]);

/** High-confidence literal token prefixes, scanned in ALL tracked text files. */
const UNIVERSAL_PATTERNS = [
  { id: 'github-classic-pat', pattern: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { id: 'github-fine-grained-pat', pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g },
  { id: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'openai-style-key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
];

/** Credential-shaped connection strings, scanned in env-style files only. */
const ENV_FILE_URL_PATTERNS = [
  {
    id: 'connection-string-with-credentials',
    pattern: /\b(?:postgres|postgresql|redis|rediss|mysql|mssql):\/\/[^\s'"<>@/]+:[^\s'"<>@/]{6,}@/g,
  },
];

/** Secret-named assignments with a non-placeholder value, env-style files only. */
const ENV_FILE_ASSIGNMENT_PATTERN =
  /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|KEY|CREDENTIAL)[A-Z0-9_]*)\s*=\s*(.+)$/;

const PLACEHOLDER_VALUES = new Set([
  '',
  '...',
  'changeme',
  'placeholder',
  'replace_me',
  'todo',
  'example',
  'your-token',
  'your-secret',
]);

function looksLikePlaceholder(value) {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  if (PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return true;
  if (trimmed.startsWith('${{') || trimmed.startsWith('$(')) return true;
  if (/^<[^>]+>$/.test(trimmed)) return true;
  if (/^(?:dry-run|no-credentials|placeholder|example|your-)/i.test(trimmed)) return true;
  return false;
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  '.vercel',
  'actionlint',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md',
  '.txt', '.sql', '.html', '.css', '.scss', '.sh', '.env', '.example', '.gitignore',
  '.prisma', '.xml', '.toml', '.ini', '.cfg', '.conf', '.properties', '.editorconfig',
]);

const MAX_FILE_BYTES = 1024 * 1024;

function trackedFiles() {
  try {
    const stdout = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
    return stdout.split('\n').filter((line) => line.trim() !== '');
  } catch {
    return walkFiles(REPO_ROOT);
  }
}

function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    // Skip vendored/build dirs and any local .env* files (they may hold real
    // local secrets — never read them into scanner output).
    if (SKIP_DIRS.has(entry) || entry.startsWith('.env')) continue;
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      out.push(...walkFiles(path));
    } else {
      out.push(path.slice(REPO_ROOT.length + 1));
    }
  }
  return out;
}

function isEnvStyleFile(path) {
  const base = path.split('/').pop() ?? '';
  return base === '.env' || base.startsWith('.env.') || /(^|[-.])env([-_.]|$)/.test(base);
}

function isTextFile(path) {
  const dot = path.lastIndexOf('.');
  const ext = dot === -1 ? '' : path.slice(dot);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return isEnvStyleFile(path);
}

function scanFile(path) {
  const findings = [];
  let text;
  try {
    if (statSync(join(REPO_ROOT, path)).size > MAX_FILE_BYTES) return findings;
    text = readFileSync(join(REPO_ROOT, path), 'utf8');
  } catch {
    return findings;
  }
  const lines = text.split('\n');
  const envStyle = isEnvStyleFile(path);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    for (const { id, pattern } of UNIVERSAL_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      if (regex.test(line)) {
        if (!ALLOWLIST.has(`${path}::${id}`)) {
          findings.push({ path, line: index + 1, id });
        }
      }
    }
    if (envStyle) {
      for (const { id, pattern } of ENV_FILE_URL_PATTERNS) {
        const regex = new RegExp(pattern.source, pattern.flags);
        if (regex.test(line)) {
          findings.push({ path, line: index + 1, id });
        }
      }
      const assignment = ENV_FILE_ASSIGNMENT_PATTERN.exec(line);
      if (assignment !== null) {
        const value = assignment[2] ?? '';
        if (!looksLikePlaceholder(value)) {
          findings.push({ path, line: index + 1, id: `secret-assignment:${assignment[1]}` });
        }
      }
    }
  }
  return findings;
}

function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const files = trackedFiles();
  const findings = [];
  let scanned = 0;
  for (const file of files) {
    if (!isTextFile(file)) continue;
    scanned += 1;
    findings.push(...scanFile(file));
  }

  if (findings.length > 0) {
    process.stderr.write(
      `secret-scan: FAILED — ${findings.length} committed-secret pattern(s) found (scanned ${scanned} tracked text files):\n`,
    );
    for (const finding of findings) {
      process.stderr.write(`  ${finding.path}:${finding.line}  [${finding.id}]\n`);
    }
    process.stderr.write(
      'Secrets are never committed (B015/FT2.0): rotate the leaked credential, then remove it from git history.\n',
    );
    return 1;
  }
  process.stdout.write(`secret-scan: OK — no committed-secret patterns found (scanned ${scanned} tracked text files)\n`);
  return 0;
}

process.exit(main());
