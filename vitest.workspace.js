import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default [
  // Plain Vitest (Node) for pure parsing-logic unit tests
  {
    test: {
      name: 'unit',
      include: ['tests/lib.test.js'],
    },
  },
  // Worker routing tests — no DEV_PASSWORD so auth gate is inactive
  defineWorkersProject({
    test: {
      name: 'worker-routing',
      include: ['tests/worker-routing.test.js'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.test.jsonc' },
        },
      },
    },
  }),
  // Auth gate tests — DEV_PASSWORD set via miniflare bindings
  defineWorkersProject({
    test: {
      name: 'worker-auth',
      include: ['tests/worker-auth.test.js'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.test.jsonc' },
          miniflare: {
            bindings: { DEV_PASSWORD: 'test-password' },
          },
        },
      },
    },
  }),
];
