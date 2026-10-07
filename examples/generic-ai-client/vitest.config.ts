import { fileURLToPath } from 'node:url';

/**
 * The C019 generic-ai-client example project is NOT a pnpm workspace
 * project (the workspace root does not include examples/* — adding it
 * would be a root-manifest edit, which C019 must not make; the A027
 * examples/epoch-e2e precedent). Workspace package imports resolve
 * through explicit aliases to their TypeScript sources — the same
 * sources the workspace exports maps point at — so the walkthroughs
 * exercise the REAL protocol code end-to-end.
 */
const here = fileURLToPath(new URL('.', import.meta.url));

const aliases: Record<string, string> = {
  '@arena/protocol-core': '../../packages/protocol-core/src/index.ts',
  '@arena/escalation': '../../packages/escalation/src/index.ts',
  '@arena/escalation-api': '../../services/escalation-api/src/index.ts',
  '@arena/escalation-adapters': '../../adapters/escalation/src/index.ts',
  '@arena/epoch-escalation-adapter': '../../adapters/epoch-escalation/src/index.ts',
  '@arena/expert-session': '../../packages/expert-session/src/index.ts',
  '@arena/intervention': '../../packages/intervention/src/index.ts',
  '@arena/payments': '../../packages/payments/src/index.ts',
  '@arena/payments-service': '../../services/payments/src/index.ts',
  '@arena/developer-platform': '../../packages/developer-platform/src/index.ts',
  '@arena/developer-platform-service': '../../services/developer-platform/src/index.ts',
};

export default {
  resolve: {
    alias: Object.fromEntries(
      Object.entries(aliases).map(([key, value]) => [key, `${here}${value}`]),
    ),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
};
