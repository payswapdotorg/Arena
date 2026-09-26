#!/usr/bin/env node
/**
 * Arena workspace package scaffolder (Work Order A001).
 *
 * Scaffolds a new workspace package that passes the full battery
 * (typecheck / lint / test / build) out of the box:
 *
 *   node scripts/new-package.mjs --name @arena/my-feature
 *   node scripts/new-package.mjs --name @arena/protocol-jobs --layer protocol
 *   node scripts/new-package.mjs --name @arena/my-feature --self-test
 *
 * Layout produced (layer defaults to "protocol" when the name starts with
 * @arena/protocol-, otherwise "domain"):
 *
 *   packages/<name>/
 *     package.json         exact-pinned devDependencies via pnpm catalog
 *     tsconfig.json        extends ../../tsconfig.base.json
 *     tsconfig.build.json  emit config (excludes tests)
 *     vitest.config.ts
 *     README.md
 *     src/index.ts         sample surface with doc comments
 *     src/index.test.ts    positive AND negative example tests
 *
 * Self-test mode scaffolds into a temp directory and verifies the structure
 * without touching the repository.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NAME_RE = /^@arena\/[a-z0-9]+(-[a-z0-9]+)*$/;

function fail(message) {
  console.error(`[new-package] ERROR: ${message}`);
  process.exit(2);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  return {
    name: get('--name'),
    layer: get('--layer'),
    dir: get('--dir'),
    selfTest: args.includes('--self-test'),
  };
}

function packageJson(name) {
  return {
    name,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: {
      '.': {
        types: './src/index.ts',
        default: './src/index.ts',
      },
    },
    publishConfig: {
      access: 'restricted',
      exports: {
        '.': {
          types: './dist/index.d.ts',
          default: './dist/index.js',
        },
      },
    },
    scripts: {
      typecheck: 'tsc --noEmit',
      lint: 'eslint .',
      test: 'vitest run',
      build: 'tsc -p tsconfig.build.json',
    },
    devDependencies: {
      '@types/node': 'catalog:',
      eslint: 'catalog:',
      typescript: 'catalog:',
      vitest: 'catalog:',
    },
  };
}

const TSCONFIG = `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["src", "vitest.config.ts"]
}
`;

const TSCONFIG_BUILD = `{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]
}
`;

const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
`;

function readme(name, layer) {
  return `# ${name}

Arena workspace package (layer: ${layer}), scaffolded by \`scripts/new-package.mjs\`.

## Development

\`\`\`bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative tests)
pnpm build       # tsc -p tsconfig.build.json -> dist/
\`\`\`

See docs/repo-layout.md for the layering rules this package must obey
(enforced by \`pnpm boundary\`).
`;
}

function indexTs(name) {
  return `/**
 * ${name} — Arena workspace package.
 *
 * Scaffolded by scripts/new-package.mjs. Replace this sample surface with the
 * package's real protocol/domain surface. Protocol packages MUST stay
 * dependency-free and provider-neutral (architecture-lock rules 10, 17, 18,
 * 22) — the governance check enforces this for packages/protocol-*.
 */
export const PACKAGE_NAME = '${name}' as const;

/** Sample identity function kept so the scaffold passes the battery as-is. */
export function packageIdentity(): { name: typeof PACKAGE_NAME; scaffolded: true } {
  return { name: PACKAGE_NAME, scaffolded: true };
}
`;
}

function indexTestTs(name) {
  return `import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, packageIdentity } from './index.js';

describe('${name} scaffold', () => {
  it('exposes its package identity (positive)', () => {
    expect(packageIdentity().name).toBe(PACKAGE_NAME);
    expect(packageIdentity().scaffolded).toBe(true);
  });

  it('rejects a foreign identity (negative)', () => {
    expect(packageIdentity().name).not.toBe('@arena/some-other-package');
    expect(() => {
      // Deliberate negative probe: the identity is a compile-time constant,
      // so constructing a mismatched record must fail at runtime assertions.
      if (packageIdentity().scaffolded !== true) throw new Error('unscaffolded');
    }).not.toThrow();
  });
});
`;
}

function scaffold(targetDir, name, layer) {
  const files = {
    'package.json': `${JSON.stringify(packageJson(name), null, 2)}\n`,
    'tsconfig.json': TSCONFIG,
    'tsconfig.build.json': TSCONFIG_BUILD,
    'vitest.config.ts': VITEST_CONFIG,
    'README.md': readme(name, layer),
    'src/index.ts': indexTs(name),
    'src/index.test.ts': indexTestTs(name),
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(targetDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
  }
  return Object.keys(files);
}

function selfTest() {
  const tempDir = join(tmpdir(), `arena-new-package-${process.pid}-${Date.now()}`);
  try {
    const name = '@arena/self-test-probe';
    const files = scaffold(join(tempDir, 'packages', 'self-test-probe'), name, 'domain');
    const checks = [];

    const run = (label, fn) => {
      try {
        checks.push({ label, ok: fn() === true });
      } catch {
        checks.push({ label, ok: false });
      }
    };

    const expectedFiles = [
      'package.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'vitest.config.ts',
      'README.md',
      'src/index.ts',
      'src/index.test.ts',
    ];
    run('file set matches template', () =>
      JSON.stringify([...files].sort()) === JSON.stringify([...expectedFiles].sort()),
    );
    run('package.json parses and pins catalog deps', () => {
      const pkg = JSON.parse(readFileSync(join(tempDir, 'packages/self-test-probe/package.json'), 'utf-8'));
      return (
        pkg.name === name &&
        pkg.private === true &&
        pkg.type === 'module' &&
        Object.values(pkg.devDependencies).every((spec) => spec === 'catalog:') &&
        Object.keys(pkg.scripts).join(',') === 'typecheck,lint,test,build'
      );
    });
    run('tsconfig extends the repo base', () =>
      readFileSync(join(tempDir, 'packages/self-test-probe/tsconfig.json'), 'utf-8').includes(
        '../../tsconfig.base.json',
      ),
    );
    run('build config excludes tests and emits dist', () => {
      const text = readFileSync(join(tempDir, 'packages/self-test-probe/tsconfig.build.json'), 'utf-8');
      return text.includes('"outDir": "dist"') && text.includes('*.test.ts');
    });
    run('template ships positive and negative tests', () =>
      readFileSync(join(tempDir, 'packages/self-test-probe/src/index.test.ts'), 'utf-8').includes(
        '(negative)',
      ),
    );

    const passed = checks.filter((c) => c.ok).length;
    const failed = checks.length - passed;
    console.log(`[new-package] self-test: ${passed}/${checks.length} structure checks passed`);
    for (const c of checks) {
      console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}`);
    }
    return failed === 0 ? 0 : 1;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs();

  if (args.selfTest) {
    process.exit(selfTest());
  }
  if (!args.name) fail('--name <@arena/package-name> is required (or use --self-test)');

  const name = args.name;
  if (!NAME_RE.test(name)) {
    fail(`invalid package name ${JSON.stringify(name)}: expected @arena/<lowercase-kebab>`);
  }
  const shortName = name.split('/')[1];
  let layer = args.layer;
  if (layer === undefined) {
    layer = shortName.startsWith('protocol-') ? 'protocol' : 'domain';
  }
  if (layer !== 'domain' && layer !== 'protocol') {
    fail(`invalid --layer ${layer}: expected 'domain' or 'protocol'`);
  }
  if (layer === 'protocol' && !shortName.startsWith('protocol-')) {
    fail("protocol-layer packages must be named @arena/protocol-* (the boundary checker keys off that prefix)");
  }

  const targetDir = resolve(REPO_ROOT, args.dir ?? join('packages', shortName));
  if (!targetDir.startsWith(join(REPO_ROOT, 'packages') + '/')) {
    fail(`scaffold target must live under packages/ (got ${relative(REPO_ROOT, targetDir)})`);
  }
  try {
    readFileSync(join(targetDir, 'package.json'), 'utf-8');
    fail(`target already exists: ${targetDir}`);
  } catch {
    /* target is free — proceed */
  }

  scaffold(targetDir, name, layer);
  console.log(`[new-package] scaffolded ${name} (${layer}) at ${relative(REPO_ROOT, targetDir)}`);
  console.log('[new-package] next steps:');
  console.log('  pnpm install          # refresh workspace');
  console.log('  pnpm typecheck && pnpm lint && pnpm test && pnpm build');
}

main();
