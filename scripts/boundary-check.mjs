#!/usr/bin/env node
/**
 * Arena boundary checker (Work Order A001).
 *
 * Codifies the layer rules of docs/architecture.md §18 ("Layers") and the
 * service rules of spec/service-boundaries.md:
 *
 *   apps
 *     ↓
 *   services
 *     ↓
 *   domain packages (packages/*, except protocol-*)
 *     ↓
 *   protocol packages (packages/protocol-*)
 *     ↓
 *   persistence/infrastructure adapters (adapters/*)
 *
 * Rules (one violation reported per offending import edge):
 *   B1  nothing outside apps/ may import from apps/* — "a package imports
 *       from an app" fails.
 *   B2  a service may not import another service's internals — services
 *       communicate only through versioned contracts (spec/service-boundaries.md).
 *   B3  an adapter may not import another adapter's internals — provider
 *       adapters are isolation boundaries (architecture-lock rule 10).
 *   B4  layer direction: cross-workspace imports may only point downward
 *       through the declared layers. Same-layer composition is allowed only
 *       between domain packages and between protocol packages. Documented
 *       exception: adapters may import protocol and domain packages, because
 *       external provider adapters translate provider semantics INTO Arena
 *       packages (architecture.md §17) — e.g. model adapters implement
 *       protocol interfaces, and the Epoch adapter consumes the SDK.
 *
 * Import extraction is regex-based (no AST) — sufficient for the deliberate
 * import styles used in this repository; documented as a known limitation.
 *
 * Usage:
 *   node scripts/boundary-check.mjs                    # self-test + repo scan
 *   node scripts/boundary-check.mjs --check-only       # repo scan only
 *   node scripts/boundary-check.mjs --self-test-only   # fixtures only
 *   node scripts/boundary-check.mjs --scan-dir DIR     # scan an arbitrary tree
 *
 * Exit codes: 0 = clean, 1 = violations or self-test failure, 2 = usage error.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LAYER_ORDER = { app: 0, service: 1, domain: 2, protocol: 3, adapter: 4 };
const WORKSPACE_ROOTS = ['apps', 'packages', 'services', 'adapters', 'bodies', 'environments'];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
  '.next',
  '.git',
  // Fixture trees deliberately contain violating imports; they are test data,
  // not product code.
  'fixtures',
]);

const IMPORT_PATTERNS = [
  /import\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
  /export\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Determine the workspace a repository-relative file belongs to. */
function workspaceOf(relPath) {
  const segments = relPath.split('/');
  if (segments.length >= 2 && WORKSPACE_ROOTS.includes(segments[0])) {
    return `${segments[0]}/${segments[1]}`;
  }
  return null;
}

/** Layer classification for a workspace directory like "packages/protocol-core". */
function layerOfWorkspace(workspace) {
  const [root, name] = workspace.split('/');
  switch (root) {
    case 'apps':
      return 'app';
    case 'services':
      return 'service';
    case 'adapters':
      return 'adapter';
    case 'packages':
      return name.startsWith('protocol-') ? 'protocol' : 'domain';
    default:
      return null; // bodies/, environments/ are content workspaces, not layered
  }
}

/** Walk a directory collecting source files (repository-relative paths). */
function collectSourceFiles(rootDir, prefix = '') {
  const files = [];
  let entries;
  try {
    entries = readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
    const abs = join(rootDir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(abs, rel));
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot !== -1 && SCAN_EXTENSIONS.has(entry.name.slice(dot))) {
        files.push({ abs, rel });
      }
    }
  }
  return files;
}

/** Read workspace package names -> workspace dirs from a tree. */
function readWorkspaceNames(rootDir) {
  const names = new Map();
  for (const root of WORKSPACE_ROOTS) {
    let entries;
    try {
      entries = readdirSync(join(rootDir, root), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(rootDir, root, entry.name, 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (typeof pkg.name === 'string') {
          names.set(pkg.name, `${root}/${entry.name}`);
        }
      } catch {
        /* workspace without a readable package.json is skipped */
      }
    }
  }
  return names;
}

/** Resolve an import specifier to a target workspace (or null if internal/external). */
function resolveImport(specifier, fromRel, workspaceNames) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const resolved = resolve(dirname(fromRel), specifier);
    const relFromRoot = relative('.', resolved).split('\\').join('/');
    if (relFromRoot.startsWith('..')) return { kind: 'outside-repo' };
    const targetWorkspace = workspaceOf(relFromRoot);
    if (!targetWorkspace) return { kind: 'unmapped-path' };
    return { kind: 'workspace', workspace: targetWorkspace };
  }
  // Bare specifier: longest workspace-name prefix wins (supports subpath imports).
  for (const [name, dir] of workspaceNames) {
    if (specifier === name || specifier.startsWith(`${name}/`)) {
      return { kind: 'workspace', workspace: dir };
    }
  }
  return { kind: 'external' };
}

/** Evaluate one cross-workspace edge; returns a violation object or null. */
function evaluateEdge({ fromFile, importer, target, spec }) {
  const importerLayer = layerOfWorkspace(importer);
  const targetLayer = layerOfWorkspace(target);

  // B1: nothing imports apps.
  if (targetLayer === 'app') {
    return { rule: 'B1', fromFile, importer, target, spec,
      message: `no workspace may import an app (${importer} -> ${target}); apps sit at the top of the layer stack` };
  }
  // B2: services never import other services' internals.
  if (importerLayer === 'service' && targetLayer === 'service') {
    return { rule: 'B2', fromFile, importer, target, spec,
      message: `service ${importer} imports service ${target}; services communicate only through versioned contracts (spec/service-boundaries.md)` };
  }
  // B3: adapters never import other adapters' internals.
  if (importerLayer === 'adapter' && targetLayer === 'adapter') {
    return { rule: 'B3', fromFile, importer, target, spec,
      message: `adapter ${importer} imports adapter ${target}; provider adapters are isolation boundaries and never import each other` };
  }
  if (importerLayer === null || targetLayer === null) {
    return null; // content workspaces (bodies/, environments/): only B1 applies
  }
  const fromOrder = LAYER_ORDER[importerLayer];
  const toOrder = LAYER_ORDER[targetLayer];

  // Documented exception: adapters implement/consume protocol and domain
  // packages (architecture.md §17 — provider semantics enter via adapters).
  if (importerLayer === 'adapter' && (targetLayer === 'protocol' || targetLayer === 'domain')) {
    return null;
  }

  if (fromOrder < toOrder) {
    return null; // strictly downward: allowed
  }
  if (fromOrder === toOrder) {
    const sameLayerAllowed =
      (importerLayer === 'domain' && targetLayer === 'domain') ||
      (importerLayer === 'protocol' && targetLayer === 'protocol');
    if (sameLayerAllowed) return null;
    return { rule: 'B4', fromFile, importer, target, spec,
      message: `same-layer cross-workspace import is not an approved composition edge (${importer} -> ${target})` };
  }
  return { rule: 'B4', fromFile, importer, target, spec,
    message: `layer direction violation: ${importer} (${importerLayer}) imports ${target} (${targetLayer}) — dependencies may only flow downward (docs/architecture.md §18)` };
}

/** Scan a tree for boundary violations. */
function scanTree(rootDir) {
  const root = resolve(rootDir);
  const workspaceNames = readWorkspaceNames(root);
  const violations = [];
  for (const file of collectSourceFiles(root)) {
    const importer = workspaceOf(file.rel);
    if (!importer) continue; // scripts/, docs/, examples/ are not workspace code
    const text = readFileSync(file.abs, 'utf-8');
    const lines = text.split('\n');
    for (const [lineNo, line] of lines.entries()) {
      if (!/(import|require)/.test(line)) continue;
      for (const pattern of IMPORT_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line)) !== null) {
          const spec = match[1];
          if (spec.startsWith('node:')) continue;
          const resolved = resolveImport(spec, file.rel, workspaceNames);
          if (resolved.kind !== 'workspace') continue;
          if (resolved.workspace === importer) continue; // intra-workspace
          const violation = evaluateEdge({
            fromFile: `${file.rel}:${lineNo + 1}`,
            importer,
            target: resolved.workspace,
            spec,
          });
          if (violation) violations.push(violation);
        }
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Self-test: deliberate violation fixtures MUST fail; clean fixtures MUST pass.
// ---------------------------------------------------------------------------

function selfTest() {
  const casesDir = join(REPO_ROOT, 'scripts', 'fixtures', 'boundary', 'cases');
  const results = [];
  let entries;
  try {
    entries = readdirSync(casesDir, { withFileTypes: true });
  } catch {
    console.error('[boundary] self-test: fixtures directory missing');
    return { passed: 0, failed: 1 };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const caseDir = join(casesDir, entry.name);
    let expected;
    try {
      expected = JSON.parse(readFileSync(join(caseDir, 'expected.json'), 'utf-8'));
    } catch {
      results.push({ name: entry.name, ok: false, detail: 'missing/broken expected.json' });
      continue;
    }
    const violations = scanTree(caseDir);
    const ruleIds = new Set(violations.map((v) => v.rule));
    let ok;
    if (expected.expectClean) {
      ok = violations.length === 0;
    } else {
      ok =
        Array.isArray(expected.expectRules) &&
        expected.expectRules.length > 0 &&
        expected.expectRules.every((rule) => ruleIds.has(rule));
    }
    results.push({
      name: entry.name,
      ok,
      detail: ok ? '' : `violations=${JSON.stringify(violations.map((v) => v.rule))}`,
    });
  }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`[boundary] self-test: ${passed}/${results.length} fixtures behaved as expected`);
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
  }
  return { passed, failed };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const flags = {
    checkOnly: args.includes('--check-only'),
    selfTestOnly: args.includes('--self-test-only'),
    scanDir: args.includes('--scan-dir') ? args[args.indexOf('--scan-dir') + 1] : null,
  };
  if (args.some((a) => a.startsWith('-') && !Object.values(flags).includes(a) && a !== '--check-only' && a !== '--self-test-only' && a !== '--scan-dir')) {
    console.error(`unknown flag: ${args.find((a) => a.startsWith('-'))}`);
    process.exit(2);
  }

  let exitCode = 0;

  if (flags.scanDir) {
    const violations = scanTree(flags.scanDir);
    if (violations.length > 0) {
      console.log(`[boundary] scan of ${flags.scanDir}: ${violations.length} violation(s)`);
      for (const v of violations) {
        console.log(`  [${v.rule}] ${v.fromFile}: ${v.message} (import: ${v.spec})`);
      }
      process.exit(1);
    }
    console.log(`[boundary] scan of ${flags.scanDir}: clean`);
    process.exit(0);
  }

  if (!flags.checkOnly) {
    const { failed } = selfTest();
    if (failed > 0) {
      console.error(
        `[boundary] SELF-TEST FAILURE: ${failed} fixture(s) did not behave as expected — checks are not trustworthy`,
      );
      exitCode = 1;
    }
  }

  if (!flags.selfTestOnly && exitCode === 0) {
    const violations = scanTree(REPO_ROOT);
    if (violations.length > 0) {
      console.log(`[boundary] check: ${violations.length} violation(s)`);
      for (const v of violations) {
        console.log(`  [${v.rule}] ${v.fromFile}: ${v.message} (import: ${v.spec})`);
      }
      exitCode = 1;
    } else {
      console.log('[boundary] check: clean (layer rules B1-B4 hold across all workspaces)');
    }
  }

  if (exitCode === 0) console.log('[boundary] OK');
  process.exit(exitCode);
}

main();
