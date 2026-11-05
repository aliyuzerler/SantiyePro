import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

/** Web bileşen testleri (jsdom + next/jest). */
const config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/test/**/*.test.ts?(x)'],
};

export default createJestConfig(config);
