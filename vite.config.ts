import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 6144 },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
