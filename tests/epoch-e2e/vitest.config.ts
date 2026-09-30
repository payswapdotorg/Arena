import { fileURLToPath } from 'node:url';

/**
 * The A027 epoch end-to-end battery configuration.
 *
 * tests/epoch-e2e is NOT a pnpm workspace project (the workspace root
 * does not include tests/* — adding it would be a root-manifest edit,
 * which A027 must not make). Instead the battery runs via the
 * examples/epoch-e2e standalone project, which owns vitest:
 *
 *   cd examples/epoch-e2e && pnpm run battery:test
 *     (= vitest run --root ../../tests/epoch-e2e)
 *
 * Workspace package imports resolve through explicit aliases to their
 * TypeScript sources (the same sources the workspace exports map
 * points at), so the battery exercises the REAL protocol code.
 *
 * NOTE: this config deliberately does NOT import 'vitest/config' —
 * tests/epoch-e2e has no node_modules of its own (it is not a workspace
 * project), and vitest loads a plain default-export config just fine.
 */
const here = fileURLToPath(new URL('.', import.meta.url));

export default {
  resolve: {
    alias: {
      '@arena/example-epoch-e2e': `${here}../../examples/epoch-e2e/src/index.ts`,
      '@arena/protocol-core': `${here}../../packages/protocol-core/src/index.ts`,
      '@arena/agent-body': `${here}../../packages/agent-body/src/index.ts`,
      '@arena/model-substrate': `${here}../../packages/model-substrate/src/index.ts`,
      '@arena/capability-graph': `${here}../../packages/capability-graph/src/index.ts`,
      '@arena/capability-case': `${here}../../packages/capability-case/src/index.ts`,
      '@arena/task-spec': `${here}../../packages/task-spec/src/index.ts`,
      '@arena/task-compiler-fabric': `${here}../../services/task-compiler/src/index.ts`,
      '@arena/environment-protocol': `${here}../../packages/environment-protocol/src/index.ts`,
      '@arena/environment-runtime': `${here}../../packages/environment-runtime/src/index.ts`,
      '@arena/environment-runner': `${here}../../services/environment-runner/src/index.ts`,
      '@arena/trajectory': `${here}../../packages/trajectory/src/index.ts`,
      '@arena/evaluation': `${here}../../packages/evaluation/src/index.ts`,
      '@arena/evaluation-fabric': `${here}../../services/evaluation/src/index.ts`,
      '@arena/verification': `${here}../../packages/verification/src/index.ts`,
      '@arena/verification-fabric': `${here}../../services/verification/src/index.ts`,
      '@arena/artifact-protocol': `${here}../../packages/artifact-protocol/src/index.ts`,
      '@arena/compatibility': `${here}../../packages/compatibility/src/index.ts`,
      '@arena/skill-extraction': `${here}../../packages/skill-extraction/src/index.ts`,
      '@arena/skill-extraction-fabric': `${here}../../services/skill-extraction/src/index.ts`,
      '@arena/learning': `${here}../../packages/learning/src/index.ts`,
      '@arena/learning-fabric': `${here}../../services/learning/src/index.ts`,
      '@arena/certification': `${here}../../packages/certification/src/index.ts`,
      '@arena/certification-fabric': `${here}../../services/certification/src/index.ts`,
      '@arena/arena-sdk': `${here}../../packages/arena-sdk/src/index.ts`,
      '@arena/api-fabric': `${here}../../services/api/src/index.ts`,
      '@arena/body-software-engineer': `${here}../../bodies/software-engineer/src/index.ts`,
      '@arena/environment-software-engineer': `${here}../../environments/software-engineer/src/index.ts`,
      '@arena/epoch-adapter': `${here}../../adapters/epoch/src/index.ts`,
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
};
