import { defineConfig } from 'vitest/config'


export default defineConfig({
  test: {
    // Integration tests share one Postgres schema, so they must not interleave.
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // The engine is what needs covering; UI and generated clients are not
      // where correctness risk lives in this system.
      include: ['lib/engine/**/*.ts', 'lib/schemas.ts'],
      reporter: ['text-summary'],
    },
  },
  resolve: {
    alias: { '@': import.meta.dirname },
  },
})
