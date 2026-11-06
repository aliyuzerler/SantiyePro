/**
 * Faz 08 — Gider ve hakediş finans matematiği testleri.
 *
 * Test promptu: "Hakediş formülü için bilinen örnekler ve edge case'ler",
 * "Decimal precision/rounding; floating point hatası yok".
 */
import { describe, expect, it } from 'vitest';
import {
  CLAIM_FORMULA_DESCRIPTION,
  computeClaimLine,
  computeClaimTotals,
  expenseTaxAmount,
  formatMoney,
  formatUnitPrice,
  moneyAmountSchema,
  multiplyQtyPrice,
  nonNegativeMoneySchema,
  parseMoney,
  parseUnitPrice,
  progressClaimCreateRequestSchema,
  taxRateSchema,
  unitPriceSchema,
  currencySchema,
} from '../src/finance.js';

describe('para ayrıştırma ve biçimleme', () => {
  it('kanonik para stringlerini yuvarlamasız ayrıştırır', () => {
    expect(parseMoney('1250.50')).toBe(125_050n);
    expect(parseMoney('0.01')).toBe(1n);
    expect(parseMoney('999999999999.99')).toBe(99_999_999_999_999n);
    expect(parseMoney('-12.5')).toBe(-1_250n);
  });

  it('her zaman 2 ondalık biçimler', () => {
    expect(formatMoney(125_050n)).toBe('1250.50');
    expect(formatMoney(1n)).toBe('0.01');
    expect(formatMoney(-1_250n)).toBe('-12.50');
    expect(formatMoney(0n)).toBe('0.00');
  });

  it('birim fiyatı 4 ondalıkta tutar ve budar', () => {
    expect(parseUnitPrice('245.7500')).toBe(2_457_500n);
    expect(formatUnitPrice(2_457_500n)).toBe('245.75');
    expect(formatUnitPrice(10_000_000n)).toBe('1000');
  });
});

describe('şema doğrulamaları', () => {
  it('tutar: 3 ondalık reddedilir, 0 reddedilir', () => {
    expect(moneyAmountSchema.safeParse('10.505').success).toBe(false);
    expect(moneyAmountSchema.safeParse('0').success).toBe(false);
    expect(moneyAmountSchema.safeParse('10.50').success).toBe(true);
  });

  it('kesinti: 0 geçerli, negatif biçim geçersiz', () => {
    expect(nonNegativeMoneySchema.safeParse('0').success).toBe(true);
    expect(nonNegativeMoneySchema.safeParse('-5').success).toBe(false);
  });

  it('birim fiyat: 5 ondalık reddedilir', () => {
    expect(unitPriceSchema.safeParse('1.23456').success).toBe(false);
    expect(unitPriceSchema.safeParse('0').success).toBe(false);
    expect(unitPriceSchema.safeParse('245.7512').success).toBe(true);
  });

  it('vergi oranı: 100 geçerli, 100.01 reddedilir — varsayılan oran YOKTUR', () => {
    expect(taxRateSchema.safeParse('100').success).toBe(true);
    expect(taxRateSchema.safeParse('100.01').success).toBe(false);
    expect(taxRateSchema.safeParse('20').success).toBe(true);
  });

  it('para birimi: 3 büyük harf; küçük harf reddedilir', () => {
    expect(currencySchema.safeParse('try').success).toBe(false);
    expect(currencySchema.safeParse('TRY').success).toBe(true);
    expect(currencySchema.safeParse('TR').success).toBe(false);
  });
});

describe('multiplyQtyPrice — miktar × fiyat, 2 ondalık YARIM YUKARI', () => {
  it('bilinen örnek: 250 × 245.75 = 61437.50', () => {
    expect(multiplyQtyPrice('250', '245.75')).toBe('61437.50');
  });

  it('kuruş sınırı: 0.005 yukarı, 0.004 aşağı (floating point tuzağı yok)', () => {
    expect(multiplyQtyPrice('1', '0.005')).toBe('0.01');
    expect(multiplyQtyPrice('1', '0.0049')).toBe('0.00');
    // 0.1 + 0.2 floating point hatası verir; BigInt vermez:
    expect(multiplyQtyPrice('0.1', '0.3')).toBe('0.03');
    expect(multiplyQtyPrice('1.1', '2.2')).toBe('2.42');
  });

  it('4 ondalıklı fiyatla: 12.345 × 245.7512 = 3033.80 (yarım yukarı)', () => {
    // tam ürün (Decimal HALF_UP referansı): 12.345 × 245.7512 = 3033.7993... → 3033.80
    expect(multiplyQtyPrice('12.345', '245.7512')).toBe('3033.80');
  });

  it('büyük tutarlar kesin kalır', () => {
    // 123456.789 × 1234.5678 = 152413.9... tam: 123456789e-3 * 12345678e-4
    const res = multiplyQtyPrice('123456.789', '1234.5678');
    // Python Decimal HALF_UP referansı: 123456.789 × 1234.5678 = 152415776.3863...
    expect(res).toBe('152415776.39');
  });
});

describe('expenseTaxAmount — varsayılan oran yok, yalnızca verilirse hesaplanır', () => {
  it('1000.00 × %20 = 200.00', () => {
    expect(expenseTaxAmount('1000.00', '20')).toBe('200.00');
  });

  it('yarım yukarı: 0.01 × %50 = 0.005 → 0.01', () => {
    expect(expenseTaxAmount('0.01', '50')).toBe('0.01');
  });

  it('KDV benzeri: 8550.25 × %20 = 1710.05', () => {
    expect(expenseTaxAmount('8550.25', '20')).toBe('1710.05');
  });
});

describe('computeClaimLine — hakediş satır formülü', () => {
  it('bilinen örnek: önceki 50, dönem 30, fiyat 10 → kümülatif 80, dönem tutarı 300', () => {
    const line = computeClaimLine({ previousQuantity: '50', periodQuantity: '30', unitPrice: '10' });
    expect(line.cumulativeQuantity).toBe('80');
    expect(line.lineAmount).toBe('300.00');
    expect(line.previousAmount).toBe('500.00');
    expect(line.cumulativeAmount).toBe('800.00');
    expect(line.unitPriceSnapshot).toBe('10');
  });

  it('kuruş yuvarlaması kimliği bozmaz: prev=1, period=0.001, fiyat 0.005', () => {
    // 0.001×0.005=0.000005→0.00; 1×0.005=0.005→0.01; 1.001×0.005=0.005005→0.01
    const line = computeClaimLine({ previousQuantity: '1', periodQuantity: '0.001', unitPrice: '0.005' });
    expect(line.lineAmount).toBe('0.00');
    expect(line.cumulativeAmount).toBe('0.01');
    expect(line.previousAmount).toBe('0.01'); // kimlik: kümülatif − dönem
  });

  it('3 ondalıklı miktar × 4 ondalıklı fiyat: 12.345 × 245.7512', () => {
    const line = computeClaimLine({ previousQuantity: '0', periodQuantity: '12.345', unitPrice: '245.7512' });
    expect(line.lineAmount).toBe('3033.80');
    expect(line.previousAmount).toBe('0.00');
    expect(line.cumulativeAmount).toBe('3033.80');
    expect(line.unitPriceSnapshot).toBe('245.7512');
  });

  it('snapshot fiyatı kanonikleşir: 245.7500 → 245.75', () => {
    const line = computeClaimLine({ previousQuantity: '0', periodQuantity: '1', unitPrice: '245.7500' });
    expect(line.unitPriceSnapshot).toBe('245.75');
    expect(line.lineAmount).toBe('245.75');
  });
});

describe('computeClaimTotals — brüt/kümülatif/net', () => {
  it('iki satır + kesinti: brüt 820, net 770, kümülatif 1320', () => {
    const totals = computeClaimTotals({
      lines: [
        { lineAmount: '300.00', previousAmount: '500.00' },
        { lineAmount: '520.00', previousAmount: '0.00' },
      ],
      deductionTotal: '50.00',
      previousTotal: '500.00',
    });
    expect(totals.grossTotal).toBe('820.00');
    expect(totals.previousTotal).toBe('500.00');
    expect(totals.cumulativeTotal).toBe('1320.00');
    expect(totals.netTotal).toBe('770.00');
  });

  it('kesintisiz: net = brüt', () => {
    const totals = computeClaimTotals({ lines: [{ lineAmount: '0.01', previousAmount: '0.00' }], deductionTotal: '0', previousTotal: '0' });
    expect(totals.netTotal).toBe('0.01');
    expect(totals.grossTotal).toBe('0.01');
  });
});

describe('hakediş oluşturma şeması', () => {
  const base = {
    projectId: 'p1',
    claimNo: 1,
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    lines: [{ contractItemId: 'ci1', previousQuantity: '0', periodQuantity: '10' }],
  };

  it('geçerli istek kabul edilir; deductionTotal varsayılanı 0', () => {
    const parsed = progressClaimCreateRequestSchema.parse(base);
    expect(parsed.deductionTotal).toBe('0');
  });

  it('dönem bitişi başlangıçtan önceyse reddedilir', () => {
    expect(
      progressClaimCreateRequestSchema.safeParse({ ...base, periodEnd: '2025-12-31' }).success,
    ).toBe(false);
  });

  it('satırsız istek reddedilir', () => {
    expect(progressClaimCreateRequestSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
  });

  it('claimNo 0 veya 10000 reddedilir', () => {
    expect(progressClaimCreateRequestSchema.safeParse({ ...base, claimNo: 0 }).success).toBe(false);
    expect(progressClaimCreateRequestSchema.safeParse({ ...base, claimNo: 10000 }).success).toBe(false);
  });
});

describe('formül açıklaması', () => {
  it('UI’daki formül metni snapshot ve onay dondurma kurallarını anlatır', () => {
    expect(CLAIM_FORMULA_DESCRIPTION).toContain('snapshot');
    expect(CLAIM_FORMULA_DESCRIPTION).toContain('dondurulur');
  });
});
