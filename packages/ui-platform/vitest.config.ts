import { defineConfig } from 'vitest/config';

// Component assertions render through `react-dom/server`
// `renderToStaticMarkup` in a plain node environment (no jsdom). JSX in
// test files compiles with the automatic runtime, taken from this
// package's tsconfig (`"jsx": "react-jsx"`), which the vite/oxc transform
// applies per file.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
