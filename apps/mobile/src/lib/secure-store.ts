import * as SecureStore from 'expo-secure-store';

/**
 * Token güvenli depolama (docs/07 — mobil güvenlik):
 * - Yalnızca Expo SecureStore kullanılır.
 * - AsyncStorage veya SQLite'a token/parola yazılmaz (yapısal kural; review'da kontrol edilir).
 * - Access + refresh token çifti anahtar bazlı saklanır.
 */
const ACCESS_KEY = 'santiyepro.accessToken';
const REFRESH_KEY = 'santiyepro.refreshToken';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export const tokenStorage = {
  async save(tokens: StoredTokens): Promise<void> {
    await SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken);
    await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
  },

  async load(): Promise<StoredTokens | null> {
    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
    ]);
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  },

  /** Erişim belirteci tek başına gerektiğinde (refresh akışı öncesi kontrol). */
  async loadAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_KEY);
  },

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};
