import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';
import { Button } from '../src/components/ui/Button';
import { TextField } from '../src/components/ui/TextField';
import { StatusBadge } from '../src/components/ui/StatusBadge';
import { EmptyState } from '../src/components/ui/EmptyState';
import { ErrorState } from '../src/components/ui/ErrorState';
import { Card } from '../src/components/ui/Card';

describe('Button (mobil)', () => {
  it('etiketle render edilir ve dokunulduğunda çalışır', async () => {
    const onPress = jest.fn();
    const screen = await render(<Button label="Taslak Olarak Kaydet" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Taslak Olarak Kaydet' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabled iken dokunma çalışmaz', async () => {
    const onPress = jest.fn();
    const screen = await render(<Button label="Kaydet" onPress={onPress} disabled />);
    fireEvent.press(screen.getByRole('button', { name: 'Kaydet' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('loading durumunda busy işaretlenir ve kilitlenir', async () => {
    const onPress = jest.fn();
    const screen = await render(
      <Button label="Kaydet" onPress={onPress} loading accessibilityLabel="Kaydediliyor" />,
    );
    const btn = screen.getByRole('button', { name: 'Kaydediliyor' });
    expect(btn.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('TextField (mobil)', () => {
  it('etiket ve zorunluluk yıldızı görünür', async () => {
    const screen = await render(<TextField label="Yapılan işler" required placeholder="3. katta…" />);
    expect(screen.getByText(/Yapılan işler/)).toBeTruthy();
    expect(screen.getByText(/\*/)).toBeTruthy();
  });

  it('hata metni gösterilir', async () => {
    const screen = await render(<TextField label="Miktar" error="0'dan büyük bir değer girin" />);
    expect(screen.getByText("0'dan büyük bir değer girin")).toBeTruthy();
  });
});

describe('StatusBadge (mobil)', () => {
  it('metin ve ikon birlikte görünür', async () => {
    const screen = await render(<StatusBadge tone="approved">Onaylandı</StatusBadge>);
    expect(screen.getByText('Onaylandı')).toBeTruthy();
    expect(screen.getByText('✓')).toBeTruthy();
  });
});

describe('EmptyState / ErrorState / Card (mobil)', () => {
  it('EmptyState açıklamalı boş durum gösterir', async () => {
    const screen = await render(
      <EmptyState title="Proje listesi boş" description="Proje modülü Faz 03'te eklenecek." />,
    );
    expect(screen.getByText('Proje listesi boş')).toBeTruthy();
    expect(screen.getByText(/Faz 03'te eklenecek/)).toBeTruthy();
  });

  it('ErrorState retry sunar', async () => {
    const onRetry = jest.fn();
    const screen = await render(<ErrorState message="Sunucuya ulaşılamadı" onRetry={onRetry} />);
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Card çocuk içeriği sarar', async () => {
    const screen = await render(
      <Card>
        <TextField label="Hava durumu" />
      </Card>,
    );
    expect(screen.getByText('Hava durumu')).toBeTruthy();
  });
});
