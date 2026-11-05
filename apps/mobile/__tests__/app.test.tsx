import { render } from '@testing-library/react-native';
import { describe, expect, it } from '@jest/globals';
import App from '../App';

describe('App (oturum akışı)', () => {
  it('oturum yoksa giriş ekranı çökmeden render ediliyor', async () => {
    const screen = await render(<App />);
    expect(screen.getByText('ŞantiyePro')).toBeTruthy();
    expect(screen.getByText('Saha Uygulaması Girişi')).toBeTruthy();
  });
});
