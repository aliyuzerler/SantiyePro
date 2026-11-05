import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { tokenStorage } from '../src/lib/secure-store';
import { authApi } from '../src/lib/api';
import { AuthProvider, useAuth } from '../src/lib/auth-context';
import { LoginScreen } from '../src/screens/LoginScreen';
import * as SecureStore from 'expo-secure-store';

/**
 * Faz 02 mobil testleri:
 * 1. Token'lar SecureStore'a yazılır (AsyncStorage/SQLite yasak — docs/07).
 * 2. Login akışı: hata mesajı, başarılı giriş.
 * 3. AuthProvider durum geçişleri.
 */

function mockJson(status: number, body: unknown): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  }) as unknown as typeof global.fetch;
}

afterEach(() => {
  jest.clearAllMocks();
  // getItemAsync default'u null'a dön (clearAllMocks mock'ları sıfırlar)
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
});

describe('tokenStorage (SecureStore)', () => {
  it("token çiftini SecureStore.setItemAsync ile saklar", async () => {
    await tokenStorage.save({ accessToken: 'at-1', refreshToken: 'rt-1' });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('santiyepro.accessToken', 'at-1');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('santiyepro.refreshToken', 'rt-1');
  });

  it('token yoksa null döner; AsyncStorage hiç kullanılmaz', async () => {
    const tokens = await tokenStorage.load();
    expect(tokens).toBeNull();
    // Yapısal kural: projede AsyncStorage bağımlılığı yoktur (docs/07 mobil güvenlik).
    let asyncStorageResolvable = false;
    try {
       
      require.resolve('@react-native-async-storage/async-storage');
      asyncStorageResolvable = true;
    } catch {
      asyncStorageResolvable = false;
    }
    expect(asyncStorageResolvable).toBe(false);
  });

  it('clear SecureStore.deleteItemAsync çağırır', async () => {
    await tokenStorage.clear();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('santiyepro.accessToken');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('santiyepro.refreshToken');
  });
});

describe('authApi.login (mobil)', () => {
  it("başarılı girişte token çifti SecureStore'a yazılır", async () => {
    mockJson(200, {
      accessToken: 'at-2',
      refreshToken: 'rt-2',
      user: { id: 'u1', email: 'a@b.com', fullName: 'A B', status: 'ACTIVE', roles: ['SITE_CHIEF'], createdAt: '2026-01-01T00:00:00.000Z' },
    });
    const result = await authApi.login('a@b.com', 'parola');
    expect(result.user.email).toBe('a@b.com');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('santiyepro.accessToken', 'at-2');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('santiyepro.refreshToken', 'rt-2');
  });

  it('hatalı girişte generic mesaj ApiError olur ve token yazılmaz', async () => {
    mockJson(401, { error: { code: 'UNAUTHORIZED', message: 'E-posta veya parola geçersiz' } });
    await expect(authApi.login('a@b.com', 'yanlis')).rejects.toThrow('E-posta veya parola geçersiz');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});

function Probe() {
  const { user, login, logout } = useAuth();
  return (
    <Text>
      <Text testID="user-state">{user ? `user:${user.email}` : 'none'}</Text>
      <Text onPress={() => void login('a@b.com', 'p')} testID="do-login">
        login
      </Text>
      <Text onPress={() => void logout()} testID="do-logout">
        logout
      </Text>
    </Text>
  );
}

describe('AuthProvider + LoginScreen', () => {
  it('oturum yoksa kullanıcı null durur', async () => {
    mockJson(401, { error: { code: 'UNAUTHORIZED', message: 'x' } });
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('user-state')).toHaveTextContent('none'));
  });

  it('LoginScreen boş gönderimde uyarı gösterir', async () => {
    await render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    await user.press(screen.getByText('Giriş Yap'));
    expect(await screen.findByText('E-posta ve parola gereklidir.')).toBeTruthy();
  });

  it('LoginScreen hatalı girişte API mesajını gösterir', async () => {
    mockJson(401, { error: { code: 'UNAUTHORIZED', message: 'E-posta veya parola geçersiz' } });
    await render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('E-posta'), 'a@b.com');
    await user.type(screen.getByLabelText('Parola'), 'yanlis');
    await user.press(screen.getByText('Giriş Yap'));
    expect(await screen.findByText('E-posta veya parola geçersiz')).toBeTruthy();
  });
});
