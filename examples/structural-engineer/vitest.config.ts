import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const aliases: Record<string, string> = {
  '@arena/protocol-core': '../../packages/protocol-core/src/index.ts',
  '@arena/agent-body': '../../packages/agent-body/src/index.ts',
  '@arena/body-forge': '../../packages/body-forge/src/index.ts',
  '@arena/capability-case': '../../packages/capability-case/src/index.ts',
  '@arena/task-spec': '../../packages/task-spec/src/index.ts',
  '@arena/task-compiler-fabric': '../../services/task-compiler/src/index.ts',
  '@arena/environment-protocol': '../../packages/environment-protocol/src/index.ts',
  '@arena/environment-runtime': '../../packages/environment-runtime/src/index.ts',
  '@arena/environment-runner': '../../services/environment-runner/src/index.ts',
  '@arena/trajectory': '../../packages/trajectory/src/index.ts',
  '@arena/evaluation': '../../packages/evaluation/src/index.ts',
  '@arena/evaluation-fabric': '../../services/evaluation/src/index.ts',
  '@arena/verification': '../../packages/verification/src/index.ts',
  '@arena/verification-fabric': '../../services/verification/src/index.ts',
  '@arena/artifact-protocol': '../../packages/artifact-protocol/src/index.ts',
  '@arena/model-substrate': '../../packages/model-substrate/src/index.ts',
  '@arena/compatibility': '../../packages/compatibility/src/index.ts',
  '@arena/certification': '../../packages/certification/src/index.ts',
  '@arena/certification-fabric': '../../services/certification/src/index.ts',
  '@arena/body-registry': '../../packages/body-registry/src/index.ts',
  '@arena/body-registry-fabric': '../../services/body-registry/src/index.ts',
  '@arena/arena-sdk': '../../packages/arena-sdk/src/index.ts',
  '@arena/api-fabric': '../../services/api/src/index.ts',
  '@arena/body-structural-engineer': '../../bodies/structural-engineer/src/index.ts',
  '@arena/environment-structural-engineer': '../../environments/structural-engineer/src/index.ts',
};

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      Object.entries(aliases).map(([key, value]) => [key, resolve(__dirname, value)]),
    ),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
