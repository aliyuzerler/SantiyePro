import { render, screen } from '@testing-library/react-native';
import { describe, expect, it } from '@jest/globals';
import App from '../App';

/**
 * AppShell smoke testi — alt navigasyon 5 ana girişi ve ekranlar.
 * design/02: Ana Sayfa, Projeler, + Kayıt, Görevler, Profil.
 */
describe('App (mobil kabuk)', () => {
  it('ana sayfa ve alt navigasyon render ediliyor', async () => {
    await render(<App />);

    // Ana sayfa boş durumları dürüst mesajlarla görünür
    expect(await screen.findByText('Atandığım projeler')).toBeTruthy();

    // Alt navigasyon giriş noktaları
    expect(screen.getByLabelText('Ana Sayfa')).toBeTruthy();
    expect(screen.getByLabelText('Projeler')).toBeTruthy();
    expect(screen.getByLabelText('Görevler')).toBeTruthy();
    expect(screen.getByLabelText('Profil')).toBeTruthy();

    // Ortadaki `+ Kayıt` aksiyonu
    expect(screen.getByLabelText('Yeni kayıt ekle')).toBeTruthy();
  });
});
