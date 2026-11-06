import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';
import { RecordMenuSheet, RECORD_OPTIONS } from '../src/components/RecordMenuSheet';

describe('RecordMenuSheet (+ Kayıt menüsü)', () => {
  it('design/02 kayıt türlerini listeler', async () => {
    const screen = await render(<RecordMenuSheet visible onClose={() => {}} options={RECORD_OPTIONS} />);
    expect(screen.getByText('Günlük rapor')).toBeTruthy();
    expect(screen.getByText('Puantaj')).toBeTruthy();
    expect(screen.getByText('Malzeme hareketi')).toBeTruthy();
    expect(screen.getByText('Gider')).toBeTruthy();
    expect(screen.getByText('Fotoğraf / ilerleme')).toBeTruthy();
  });

  it('günlük rapor ve puantaj aktif; henüz gelmeyen modüller devre dışı ve faz bilgili', async () => {
    const screen = await render(<RecordMenuSheet visible onClose={() => {}} options={RECORD_OPTIONS} />);
    // Faz 05: günlük rapor aktif; Faz 06: puantaj aktif (satır bazlı hızlı işaretleme)
    const daily = screen.getByLabelText('Günlük rapor');
    expect(daily.props.accessibilityState).toMatchObject({ disabled: false });
    // Aktif seçeneklerde faz notu etikete eklenmez (yalnızca devre dışılar bilgi taşır)
    const attendance = screen.getByLabelText('Puantaj');
    expect(attendance.props.accessibilityState).toMatchObject({ disabled: false });
    // Faz 07: malzeme hareketi de aktif (giriş/çıkış/transfer/iade/düzeltme)
    const stock = screen.getByLabelText('Malzeme hareketi');
    expect(stock.props.accessibilityState).toMatchObject({ disabled: false });
    // Faz 08: gider de aktif (hızlı kayıt — çevrimdışı kuyruk); aktif seçenekte etiket yalnızca addır
    const expense = screen.getByLabelText('Gider');
    expect(expense.props.accessibilityState).toMatchObject({ disabled: false });
    // Sonraki fazlar hâlâ devre dışı
    const photo = screen.getByLabelText('Fotoğraf / ilerleme (Faz 05 ile aktif)');
    expect(photo.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('kapatma aksiyonu çalışır', async () => {
    const onClose = jest.fn();
    const screen = await render(<RecordMenuSheet visible onClose={onClose} options={RECORD_OPTIONS} />);
    fireEvent.press(screen.getByLabelText('Menüyü kapat'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
