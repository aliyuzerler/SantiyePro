import { defineConfig } from 'vitest/config';

/** Birim testleri — src + test içindeki *.spec.ts (e2e hariç) */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/*.spec.ts'],
    exclude: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
  },
});
