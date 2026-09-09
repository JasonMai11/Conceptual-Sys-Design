import { defineConfig } from 'vitest/config';

// The engine is plain TypeScript with no JSX, so the test runner needs no
// plugins — keeping it separate from vite.config.ts also avoids Vitest's
// bundled Vite clashing with the app's.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
