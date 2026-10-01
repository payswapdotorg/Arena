import { defineConfig } from 'vitest/config';

// Component assertions render through `react-dom/server`
// `renderToStaticMarkup` in a plain node environment (no jsdom). The app
// tsconfig keeps `"jsx": "preserve"` for Next.js, so tests explicitly
// compile JSX with the automatic runtime through the oxc transform.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
