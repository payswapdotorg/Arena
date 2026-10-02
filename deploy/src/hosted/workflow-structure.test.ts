/**
 * B015 workflow-structure test: the authored YAML+schema check for
 * `.github/workflows/deploy-preview.yml` (the deploy automation surface).
 *
 * No YAML parser exists anywhere in the dependency graph (checked: root
 * and standalone manifests + lockfiles), so this check is deliberately
 * TEXT-based against the hand-authored, deterministic file: structural
 * assertions (triggers, jobs, step ordering, pinned action refs, secret
 * references, fail-closed guards). Full schema validation is provided by
 * actionlint in the deploy workflow itself (downloaded at run time);
 * together the two cover structure + schema. Any drift between this file
 * and the workflow fails the deploy battery.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(__dirname, '../../../.github/workflows/deploy-preview.yml');
const WORKFLOW = readFileSync(WORKFLOW_PATH, 'utf8');
const LINES = WORKFLOW.split('\n');

function linesContaining(fragment: string): string[] {
  return LINES.filter((line) => line.includes(fragment));
}

describe('B015 deploy-preview.yml — trigger and posture', () => {
  it('deploys on push to main and supports manual dispatch (no pull_request trigger)', () => {
    expect(WORKFLOW).toContain('on:');
    expect(WORKFLOW).toContain('branches: [main]');
    expect(WORKFLOW).toContain('workflow_dispatch:');
    expect(WORKFLOW).not.toContain('pull_request');
  });

  it('declares least-privilege permissions and a non-cancelling concurrency group', () => {
    expect(WORKFLOW).toContain('permissions:');
    expect(WORKFLOW).toContain('contents: read');
    expect(WORKFLOW).toContain('group: deploy-preview');
    expect(WORKFLOW).toContain('cancel-in-progress: false');
  });
});

describe('B015 deploy-preview.yml — wiring self-test job', () => {
  it('runs the deterministic wiring checks (env contract, dry-run, fail-closed)', () => {
    expect(WORKFLOW).toContain('wiring-selftest:');
    expect(WORKFLOW).toContain('Env-contract presence check (deterministic; no live credentials)');
    expect(WORKFLOW).toContain('vitest run src/hosted/env-contract.test.ts');
    expect(WORKFLOW).toContain('Deploy dry-run (full wiring path against local fakes)');
    expect(WORKFLOW).toContain('vitest run src/hosted/dry-run.integration.test.ts');
    expect(WORKFLOW).toContain('Quota fail-closed tests (exhaustion refuses; no paid fallback)');
    expect(WORKFLOW).toContain('vitest run src/hosted/fail-closed.test.ts src/hosted/quotas.test.ts');
  });

  it('runs the full deploy battery (typecheck / lint / test / build) with frozen lockfiles', () => {
    expect(WORKFLOW).toContain('pnpm install --frozen-lockfile');
    // --ignore-workspace: deploy/ is a standalone pnpm project (A036) next to
    // the workspace; without the flag pnpm installs the workspace root instead.
    expect(WORKFLOW).toContain('pnpm --dir deploy install --frozen-lockfile --ignore-workspace');
    expect(WORKFLOW).toContain('Deploy battery (typecheck / lint / full test / build)');
    expect(WORKFLOW).toContain('pnpm --dir deploy typecheck && pnpm --dir deploy lint && pnpm --dir deploy test && pnpm --dir deploy build');
  });

  it('wires the committed-secret scanner (fail on hit)', () => {
    expect(WORKFLOW).toContain('Secret scan (fail on committed secrets)');
    expect(WORKFLOW).toContain('node deploy/scripts/secret-scan.mjs');
  });

  it('validates the workflow itself (authored structure check + actionlint)', () => {
    expect(WORKFLOW).toContain('Workflow structure check (authored YAML schema check)');
    expect(WORKFLOW).toContain('vitest run src/hosted/workflow-structure.test.ts');
    expect(WORKFLOW).toContain('Workflow lint (actionlint)');
    expect(WORKFLOW).toContain('download-actionlint.bash');
  });
});

describe('B015 deploy-preview.yml — deploy job (fail closed)', () => {
  it('deploys only after the self-test passes, only on push to main', () => {
    expect(WORKFLOW).toContain('deploy-preview:');
    expect(WORKFLOW).toContain('needs: wiring-selftest');
    expect(WORKFLOW).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
  });

  it('fails closed when the CI deploy secrets are absent (TL injects at B019)', () => {
    const guard = linesContaining('Fail closed when deploy secrets are absent');
    expect(guard.length).toBeGreaterThan(0);
    for (const expected of [
      'missing GitHub repository secret: $name',
      'printenv "$name"',
      'VERCEL_TOKEN',
      'VERCEL_ORG_ID',
      'VERCEL_PROJECT_ID',
    ]) {
      expect(WORKFLOW).toContain(expected);
    }
    expect(WORKFLOW).toContain('ops/deployment/provider-setup.md');
  });

  it('references secrets ONLY through the GitHub secrets placeholders of the documented contract', () => {
    const secretRefs = [...WORKFLOW.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)].map(
      (match) => match[1],
    );
    expect(new Set(secretRefs)).toEqual(new Set(['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']));
  });

  it('pins the Vercel CLI to an exact version (frozen dependency discipline)', () => {
    const vercelCalls = linesContaining('vercel@').map((line) => /vercel@(\d+\.\d+\.\d+)/.exec(line)?.[1]);
    expect(vercelCalls.length).toBeGreaterThanOrEqual(3);
    for (const version of vercelCalls) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(version).toBe('62.1.0');
    }
  });

  it('builds prebuilt from apps/web and deploys to the production alias', () => {
    expect(WORKFLOW).toContain('pnpm dlx vercel@62.1.0 pull --yes --environment=production');
    expect(WORKFLOW).toContain('pnpm dlx vercel@62.1.0 build --prod');
    expect(WORKFLOW).toContain('pnpm dlx vercel@62.1.0 deploy --prebuilt --prod');
    expect(WORKFLOW).toContain('working-directory: apps/web');
  });

  it('smoke-checks the deployment URL (fail closed on non-2xx/3xx)', () => {
    expect(WORKFLOW).toContain('Smoke-check the deployment (fail closed on non-2xx/3xx)');
    expect(WORKFLOW).toContain('ops/deployment/rollback.md');
  });
});

describe('B015 deploy-preview.yml — action pinning and discipline', () => {
  it('pins every uses: ref to an exact tag (A001 house rule)', () => {
    const uses = [...WORKFLOW.matchAll(/^\s*uses:\s*(\S+)\s*$/gm)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThanOrEqual(4);
    for (const ref of uses) {
      expect(ref).toMatch(/^[^@]+@(v\d+\.\d+\.\d+|[0-9a-f]{40})$/);
    }
    expect(uses).toContain('actions/checkout@v7.0.1');
    expect(uses).toContain('actions/setup-node@v7.0.0');
  });

  it('uses .nvmrc node and corepack pnpm parity with ci.yml', () => {
    expect(WORKFLOW).toContain('node-version-file: .nvmrc');
    expect(WORKFLOW).toContain('corepack enable');
    expect(WORKFLOW).toContain('node --version && pnpm --version');
  });

  it('never swallows a failure (no continue-on-error anywhere)', () => {
    expect(WORKFLOW).not.toContain('continue-on-error');
  });

  it('bounds every job with a timeout', () => {
    const timeouts = linesContaining('timeout-minutes:');
    expect(timeouts.length).toBeGreaterThanOrEqual(2);
  });
});
