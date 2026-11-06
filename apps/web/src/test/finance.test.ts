/**
 * Faz 08 — Gider/hakediş gösterim yardımcısı testleri.
 * Test promptu: "Tutarların web/mobilde doğru biçimlendirilmesi".
 */
import { describe, expect, it } from 'vitest';
import {
  claimStatusLabel,
  claimStatusTone,
  expenseStatusLabel,
  expenseStatusTone,
  formatDateTr,
  formatDateTimeTr,
  formatMoneyTr,
  formatQtyTr,
} from '../lib/finance';

describe('formatMoneyTr — tutarlar tr-TR + para birimi açık', () => {
  it('TRY ile narrow sembol üretir', () => {
    expect(formatMoneyTr('1250.50', 'TRY')).toBe('₺1.250,50');
    expect(formatMoneyTr('0.01', 'TRY')).toBe('₺0,01');
  });

  it('USD ile dolar sembolü kullanır', () => {
    expect(formatMoneyTr('50000', 'USD')).toBe('$50.000,00');
  });

  it('geçersiz girdide ham değeri para birimiyle döner', () => {
    expect(formatMoneyTr('abc', 'TRY')).toBe('abc TRY');
  });
});

describe('durum etiket ve tonları', () => {
  it('gider durumları Türkçe etiketlidir', () => {
    expect(expenseStatusLabel('DRAFT')).toBe('Taslak');
    expect(expenseStatusLabel('PENDING')).toBe('Onay Bekliyor');
    expect(expenseStatusLabel('APPROVED')).toBe('Onaylandı');
    expect(expenseStatusLabel('REJECTED')).toBe('Reddedildi');
  });

  it('gider tonları: taslak gri, bekleyen amber, onay yeşil, red kırmızı', () => {
    expect(expenseStatusTone('DRAFT')).toBe('draft');
    expect(expenseStatusTone('PENDING')).toBe('submitted');
    expect(expenseStatusTone('APPROVED')).toBe('approved');
    expect(expenseStatusTone('REJECTED')).toBe('rejected');
  });

  it('hakediş durumları: iptal nötr tondadır', () => {
    expect(claimStatusLabel('CANCELLED')).toBe('İptal');
    expect(claimStatusTone('CANCELLED')).toBe('neutral');
    expect(claimStatusTone('APPROVED')).toBe('approved');
  });

  it('bilinmeyen durum nötr tona düşer (crash yok)', () => {
    expect(expenseStatusTone('X')).toBe('neutral');
    expect(claimStatusLabel('X')).toBe('X');
  });
});

describe('miktar ve tarih biçimleri', () => {
  it('miktarlar ondalığı virgüle çevirir', () => {
    expect(formatQtyTr('12.5')).toBe('12,5');
    expect(formatQtyTr('200')).toBe('200');
  });

  it('YYYY-MM-DD → kısa Türkçe tarih', () => {
    expect(formatDateTr('2026-01-15')).toBe('15 Oca 2026');
    expect(formatDateTr('2026-11-05')).toBe('5 Kas 2026');
  });

  it('ISO tarih-saat kısa biçime düşer; geçersizse ham kalır', () => {
    expect(formatDateTimeTr('2026-01-05T23:46:00.000Z')).toContain('Oca');
    expect(formatDateTimeTr('not-a-date')).toBe('not-a-date');
  });
});
