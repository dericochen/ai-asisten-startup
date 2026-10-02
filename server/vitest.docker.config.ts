import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.docker.ts'], testTimeout: 240_000, hookTimeout: 120_000, pool: 'forks', fileParallelism: false } });
