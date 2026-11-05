// Ortak ESLint taban yapılandırması (ESLint 9 flat config).
// Her uygulama kendi config'inde bu tabanı geniştirir.
export const baseConfig = {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    'eqeqeq': ['error', 'always'],
    'prefer-const': 'error',
    'no-var': 'error',
    'no-implicit-globals': 'error',
  },
};
