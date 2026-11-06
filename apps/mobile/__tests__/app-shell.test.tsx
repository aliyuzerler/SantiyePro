import { render, screen } from '@testing-library/react-native';
import { describe, expect, it } from '@jest/globals';
import { NavigationContainer } from '@react-navigation/native';
import App from '../App';
import { RootTabs } from '../src/navigation/RootTabs';
import { SyncProvider } from '../src/lib/sync/sync-context';
import { MemorySyncStorage } from '../src/lib/sync/memory-storage';

/**
 * AppShell smoke testi — Faz 02'den itibaren oturum akışı:
 * Oturum yoksa LoginScreen görünür; oturumlu kabuk için RootTabs doğrudan render edilir.
 * design/02: Ana Sayfa, Projeler, + Kayıt, Görevler, Profil (+ Faz 09 Senkronizasyon).
 */
describe('App (mobil kabuk)', () => {
  it('oturum yoksa giriş ekranı render ediliyor', async () => {
    await render(<App />);

    // Oturum kapalı → LoginScreen
    expect(await screen.findByText('Saha Uygulaması Girişi')).toBeTruthy();
    expect(screen.getByLabelText('E-posta')).toBeTruthy();
    expect(screen.getByLabelText('Parola')).toBeTruthy();
  });

  it('oturumlu kullanıcı için ana sayfa ve alt navigasyon render ediliyor', async () => {
    await render(
      <NavigationContainer>
        <SyncProvider storageOverride={new MemorySyncStorage()}>
          <RootTabs />
        </SyncProvider>
      </NavigationContainer>,
    );

    // Ana sayfa boş durumları dürüst mesajlarla görünür
    expect(await screen.findByText('Atandığım aktif projeler')).toBeTruthy();

    // Alt navigasyon giriş noktaları
    expect(screen.getByLabelText('Ana Sayfa')).toBeTruthy();
    expect(screen.getByLabelText('Projeler')).toBeTruthy();
    expect(screen.getByLabelText('Görevler')).toBeTruthy();
    expect(screen.getByLabelText('Profil')).toBeTruthy();

    // Ortadaki `+ Kayıt` aksiyonu
    expect(screen.getByLabelText('Yeni kayıt ekle')).toBeTruthy();
  });
});
