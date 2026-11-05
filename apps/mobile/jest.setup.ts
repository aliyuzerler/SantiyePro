/**
 * Mobil test ortamı kurulumu (jest-expo preset'inin üzerine eklenir).
 * react-native-safe-area-context'in resmi jest mock'u ile SafeAreaProvider
 * test ortamında çocuklarını sıfır inset ile render eder.
 */
jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-safe-area-context/jest/mock').default;
});
