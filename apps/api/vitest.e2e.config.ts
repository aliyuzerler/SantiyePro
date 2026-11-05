import { defineConfig } from 'vitest/config';

/** E2E testleri — test/ altındaki *.e2e-spec.ts */
export default defineConfig({
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
