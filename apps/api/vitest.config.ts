import { defineConfig } from 'vitest/config';

/** Birim testleri — src içindeki *.spec.ts */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
