import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs: the build works from any sub-path (e.g. GitHub Pages /steelfront/).
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 6144 },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
