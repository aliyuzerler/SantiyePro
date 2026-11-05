import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { baseConfig } from '@santiyepro/config/eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  baseConfig,
);
