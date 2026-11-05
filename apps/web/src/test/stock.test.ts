/**
 * Faz 07 web testleri — stok gösterim yardımcıları:
 * hareket tipi renk tonları, işaret, tr-TR miktar biçimi, zaman biçimi.
 */
import { describe, expect, it } from 'vitest';
import { formatOccurredAt, formatQuantityTr, movementSign, movementTypeTone } from '../lib/stock';

describe('stock helpers (Faz 07)', () => {
  it('hareket tipi tonları StatusBadge sözlüğüyle eşleşir', () => {
    expect(movementTypeTone('IN')).toBe('approved');
    expect(movementTypeTone('OUT')).toBe('rejected');
    expect(movementTypeTone('TRANSFER')).toBe('submitted');
    expect(movementTypeTone('RETURN')).toBe('pending');
    expect(movementTypeTone('ADJUSTMENT')).toBe('draft');
    expect(movementTypeTone('REVERSAL')).toBe('neutral');
    expect(movementTypeTone('BILINMEYEN')).toBe('neutral');
  });

  it('işaret: çıkış −, giriş/iade +, transfer/düzeltme/ters kayıt işaretsiz', () => {
    expect(movementSign('OUT')).toBe('-');
    expect(movementSign('IN')).toBe('+');
    expect(movementSign('RETURN')).toBe('+');
    expect(movementSign('TRANSFER')).toBe('');
    expect(movementSign('ADJUSTMENT')).toBe('');
    expect(movementSign('REVERSAL')).toBe('');
  });

  it('miktar tr-TR gösterimi: nokta ondalık virgüle çevrilir; yuvarlama yoktur', () => {
    expect(formatQuantityTr('12.5')).toBe('12,5');
    expect(formatQuantityTr('0.025')).toBe('0,025');
    expect(formatQuantityTr('1000')).toBe('1000');
    expect(formatQuantityTr('-3.25')).toBe('-3,25');
    expect(formatQuantityTr('')).toBe('0');
  });

  it('zaman biçimi kısa tr biçimidir; geçersiz girdi olduğu gibi döner', () => {
    expect(formatOccurredAt('2026-11-06T14:30:00.000Z')).toMatch(/\d{2} (Kas|Ara|Oca)/);
    expect(formatOccurredAt('geçersiz')).toBe('geçersiz');
  });
});
