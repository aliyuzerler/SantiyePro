/**
 * Mobil test ortamı kurulumu (jest-expo preset'inin üzerine eklenir).
 * - react-native-safe-area-context'in resmi jest mock'u ile SafeAreaProvider
 *   test ortamında çocuklarını sıfır inset ile render eder.
 * - expo-secure-store native modüldür; jest'te in-memory mock kullanılır.
 *   (Kural: token'lar YALNIZCA SecureStore'a yazılır — AsyncStorage kullanılmaz.)
 */
jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-safe-area-context/jest/mock').default;
});

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  getItemAsync: jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// React 19 act() ortamı (RNTL 14 async state güncellemeleri için gerekli)
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Faz 09: expo-sqlite native modüldür; jest'te açılış reddedilir ve SyncProvider
// otomatik olarak bellek içi depoya düşer (testler MemorySyncStorage ile koşar).
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockRejectedValue(new Error('jest ortamında SQLite yok')),
}));

// Faz 09: netinfo native modüldür; jest'te hep bağlı raporlanır.
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }),
    addEventListener: jest.fn().mockReturnValue(jest.fn()),
  },
}));
