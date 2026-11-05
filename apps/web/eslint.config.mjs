import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import { baseConfig } from '@santiyepro/config/eslint';

export default tseslint.config(
  { ignores: ['.next', 'node_modules', 'dist', 'coverage', 'next-env.d.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  baseConfig,
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
);
