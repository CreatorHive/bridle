import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  // Git and SQLite tests run slow on the Windows CI runner; a real hang still fails.
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'node', testTimeout: 20_000 }
})
