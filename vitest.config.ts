import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('./migrations')

  return {
    test: {
      provide: { migrations },
      coverage: {
        provider: 'istanbul' as const,
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/db/test-helpers.ts'],
        thresholds: {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
      },
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
        },
      },
    },
  }
})
