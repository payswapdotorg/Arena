import type { NextConfig } from 'next';

/**
 * Arena web host configuration (Work Order B001).
 *
 * - default output (Vercel-compatible);
 * - `@arena/ui-platform` is consumed from its TypeScript source through the
 *   workspace symlink, so it is transpiled with the app;
 * - workspace TypeScript sources use NodeNext-style import specifiers
 *   (`./X.js` for a `X.ts`/`X.tsx` on disk — the house convention every
 *   other package follows). webpack does not apply that TypeScript
 *   extension substitution on its own, so `resolve.extensionAlias` teaches
 *   it the mapping (the documented approach for tsc NodeNext projects
 *   bundled through webpack);
 * - ESLint is NOT run during `next build` — the verification battery runs
 *   `pnpm lint` as its own step with the house flat config
 *   (apps/web/eslint.config.mjs; eslint-config-next is intentionally not
 *   used, per the frozen dependency policy).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@arena/ui-platform'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
