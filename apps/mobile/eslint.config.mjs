import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { baseConfig } from '@santiyepro/config/eslint';

export default tseslint.config(
  { ignores: ['node_modules', '.expo', 'coverage', '.expo-shared', 'android', 'ios'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  baseConfig,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['babel.config.js'],
    languageOptions: { globals: { module: 'writable', require: 'writable' } },
  },
);
