/**
 * Faz 07 sözleşme testleri — Depo, malzeme ve stok hareketleri.
 * prompts/phase-07-test.md: birim/miktar validasyonu, IN/OUT/TRANSFER/RETURN/
 * ADJUSTMENT/REVERSAL iş kuralları, ondalık aritmetik ve idempotency şemaları.
 */
import { describe, expect, it } from 'vitest';
import {
  createMovementRequestSchema,
  formatQuantity,
  mergeDeltas,
  movementDeltas,
  negateQuantity,
  normalizeQuantity,
  parseQuantity,
  positiveQuantitySchema,
  reverseDeltas,
  signedQuantitySchema,
  STOCK_MOVEMENT_TYPES,
  unitSchema,
} from '../src/index.js';

describe('Faz 07 — miktar aritmetiği', () => {
  it('parse/format yuvarlama kaybı olmadan 3 basamak ölçekte çalışır', () => {
    expect(parseQuantity('12.345')).toBe(12345n);
    expect(parseQuantity('-12.5')).toBe(-12500n);
    expect(parseQuantity('0.001')).toBe(1n);
    expect(parseQuantity('100')).toBe(100000n);
    expect(formatQuantity(12345n)).toBe('12.345');
    expect(formatQuantity(-12500n)).toBe('-12.5');
    expect(formatQuantity(1000000n)).toBe('1000');
  });

  it('normalizeQuantity sondaki sıfırları budar', () => {
    expect(normalizeQuantity('12.500')).toBe('12.5');
    expect(normalizeQuantity('12.000')).toBe('12');
    expect(normalizeQuantity('0.020')).toBe('0.02');
  });

  it('negateQuantity işareti tersine çevirir', () => {
    expect(negateQuantity('12.5')).toBe('-12.5');
    expect(negateQuantity('-0.025')).toBe('0.025');
  });
});

describe('Faz 07 — miktar şemaları', () => {
  it('pozitif miktar: 4 ondalık basamağı reddeder (sessiz yuvarlama yok)', () => {
    expect(positiveQuantitySchema.safeParse('12.5').success).toBe(true);
    expect(positiveQuantitySchema.safeParse('0.001').success).toBe(true);
    expect(positiveQuantitySchema.safeParse('12.0001').success).toBe(false);
    expect(positiveQuantitySchema.safeParse('0').success).toBe(false);
    expect(positiveQuantitySchema.safeParse('-5').success).toBe(false);
    expect(positiveQuantitySchema.safeParse('abc').success).toBe(false);
  });

  it('işaretli miktar (ADJUSTMENT): sıfır reddedilir, negatif kabul edilir', () => {
    expect(signedQuantitySchema.safeParse('-12.5').success).toBe(true);
    expect(signedQuantitySchema.safeParse('+3').success).toBe(false);
    expect(signedQuantitySchema.safeParse('0').success).toBe(false);
    expect(signedQuantitySchema.safeParse('0.000').success).toBe(false);
    expect(signedQuantitySchema.safeParse('7').success).toBe(true);
  });

  it('birim: serbest ama sınırlı (harf/rakam/nokta, 16 karakter)', () => {
    expect(unitSchema.safeParse('TORBA').success).toBe(true);
    expect(unitSchema.safeParse('m³'.toUpperCase()).success).toBe(false); // ³ harf/rakam değil
    expect(unitSchema.safeParse('ADET #').success).toBe(false);
    expect(unitSchema.safeParse('X'.repeat(17)).success).toBe(false);
  });
});

describe('Faz 07 — hareket bakiye etkileri (movementDeltas)', () => {
  it('IN ve RETURN tek depoya pozitif etki eder', () => {
    for (const type of ['IN', 'RETURN'] as const) {
      expect(movementDeltas({ type, quantity: '10', warehouseId: 'w1' })).toEqual([
        { warehouseId: 'w1', delta: '10' },
      ]);
    }
  });

  it('OUT tek depoya negatif etki eder', () => {
    expect(movementDeltas({ type: 'OUT', quantity: '4.2', warehouseId: 'w1' })).toEqual([
      { warehouseId: 'w1', delta: '-4.2' },
    ]);
  });

  it('ADJUSTMENT işaretli etkiyi korur', () => {
    expect(movementDeltas({ type: 'ADJUSTMENT', quantity: '-3.5', warehouseId: 'w1' })).toEqual([
      { warehouseId: 'w1', delta: '-3.5' },
    ]);
    expect(movementDeltas({ type: 'ADJUSTMENT', quantity: '2', warehouseId: 'w1' })).toEqual([
      { warehouseId: 'w1', delta: '2' },
    ]);
  });

  it('TRANSFER iki tarafı üretir: hedef +q, kaynak −q', () => {
    expect(movementDeltas({ type: 'TRANSFER', quantity: '8', warehouseId: 'w1', targetWarehouseId: 'w2' })).toEqual([
      { warehouseId: 'w2', delta: '8' },
      { warehouseId: 'w1', delta: '-8' },
    ]);
  });

  it('REVERSAL doğrudan hesaplanmaz (servis orijinalden türetir)', () => {
    expect(movementDeltas({ type: 'REVERSAL', quantity: '8', warehouseId: 'w1' })).toEqual([]);
  });

  it('mergeDeltas aynı depoları birleştirir', () => {
    expect(
      mergeDeltas([
        { warehouseId: 'w1', delta: '5' },
        { warehouseId: 'w1', delta: '-3.5' },
        { warehouseId: 'w2', delta: '2' },
      ]),
    ).toEqual([
      { warehouseId: 'w1', delta: '1.5' },
      { warehouseId: 'w2', delta: '2' },
    ]);
  });
});

describe('Faz 07 — ters kayıt etkileri (reverseDeltas)', () => {
  it('OUT ters kaydı depoya geri ekler', () => {
    expect(reverseDeltas({ type: 'OUT', quantity: '4.2', warehouseId: 'w1' })).toEqual([
      { warehouseId: 'w1', delta: '4.2' },
    ]);
  });

  it('TRANSFER ters kaydı yönü değiştirir: hedeften düşer, kaynağa ekler', () => {
    expect(
      reverseDeltas({ type: 'TRANSFER', quantity: '8', warehouseId: 'w1', targetWarehouseId: 'w2' }),
    ).toEqual([
      { warehouseId: 'w2', delta: '-8' },
      { warehouseId: 'w1', delta: '8' },
    ]);
  });

  it('ADJUSTMENT ters kaydı işareti çevirir', () => {
    expect(reverseDeltas({ type: 'ADJUSTMENT', quantity: '-3.5', warehouseId: 'w1' })).toEqual([
      { warehouseId: 'w1', delta: '3.5' },
    ]);
  });
});

describe('Faz 07 — hareket istek şeması', () => {
  const base = { materialId: 'm1', warehouseId: 'w1', quantity: '5' };

  it('geçerli IN isteğini kabul eder', () => {
    const res = createMovementRequestSchema.safeParse({ ...base, type: 'IN' });
    expect(res.success).toBe(true);
  });

  it('TRANSFER hedef deposuz reddedilir; kaynak=hedef reddedilir', () => {
    expect(createMovementRequestSchema.safeParse({ ...base, type: 'TRANSFER' }).success).toBe(false);
    expect(
      createMovementRequestSchema.safeParse({ ...base, type: 'TRANSFER', targetWarehouseId: 'w1' }).success,
    ).toBe(false);
    expect(
      createMovementRequestSchema.safeParse({ ...base, type: 'TRANSFER', targetWarehouseId: 'w2' }).success,
    ).toBe(true);
  });

  it('ADJUSTMENT dışı tip negatif miktarda reddedilir', () => {
    expect(createMovementRequestSchema.safeParse({ ...base, type: 'OUT', quantity: '-5' }).success).toBe(false);
    expect(
      createMovementRequestSchema.safeParse({ ...base, type: 'ADJUSTMENT', quantity: '-5', note: 'Sayım farkı' })
        .success,
    ).toBe(true);
  });

  it('ADJUSTMENT açıklamasız reddedilir (denetlenebilirlik)', () => {
    expect(createMovementRequestSchema.safeParse({ ...base, type: 'ADJUSTMENT' }).success).toBe(false);
    expect(createMovementRequestSchema.safeParse({ ...base, type: 'ADJUSTMENT', note: 'ab' }).success).toBe(false);
    expect(
      createMovementRequestSchema.safeParse({ ...base, type: 'ADJUSTMENT', quantity: '2', note: 'Sayım farkı' })
        .success,
    ).toBe(true);
  });

  it('REVERSAL doğrudan yaratılamaz (tip listesi dışı)', () => {
    expect(STOCK_MOVEMENT_TYPES).toContain('REVERSAL');
    expect(createMovementRequestSchema.safeParse({ ...base, type: 'REVERSAL' }).success).toBe(false);
  });
});
