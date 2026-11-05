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

  it('günlük rapor Faz 05 ile aktif; henüz gelmeyen modüller devre dışı ve faz bilgili', async () => {
    const screen = await render(<RecordMenuSheet visible onClose={() => {}} options={RECORD_OPTIONS} />);
    // Faz 05: günlük rapor artık etkin (Faz 05 notu etiketten düşer)
    const daily = screen.getByLabelText('Günlük rapor');
    expect(daily.props.accessibilityState).toMatchObject({ disabled: false });
    const attendance = screen.getByLabelText('Puantaj (Faz 06 ile aktif)');
    expect(attendance.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('kapatma aksiyonu çalışır', async () => {
    const onClose = jest.fn();
    const screen = await render(<RecordMenuSheet visible onClose={onClose} options={RECORD_OPTIONS} />);
    fireEvent.press(screen.getByLabelText('Menüyü kapat'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
