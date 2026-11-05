/**
 * Stok hareketi gösterim yardımcıları (Faz 07).
 * Etiketler contracts'tan; renk tonları StatusBadge tone sözlüğüyle eşleşir.
 * Miktar biçimi tr-TR: ondalık ayırıcı virgül, 3 basamağa kadar (API kanonik
 * nokta-ondalık taşır; yuvarlama yoktur, yalnızca gösterim).
 */
import type { StatusTone } from '@/components/ui/StatusBadge';

export const MOVEMENT_TYPE_TONES: Record<string, StatusTone> = {
  IN: 'approved',
  OUT: 'rejected',
  TRANSFER: 'submitted',
  RETURN: 'pending',
  ADJUSTMENT: 'draft',
  REVERSAL: 'neutral',
};

export function movementTypeTone(type: string): StatusTone {
  return MOVEMENT_TYPE_TONES[type] ?? 'neutral';
}

/** Hareketin stoka işareti: giriş +, çıkış −, iade +, ters kayıt orijinale göre. */
export function movementSign(type: string): '+' | '-' | '' {
  if (type === 'OUT') return '-';
  if (type === 'IN' || type === 'RETURN') return '+';
  return '';
}

/** Kanonik ondalık string → tr-TR gösterim ("12.5" → "12,5"; "1000" → "1000"). */
export function formatQuantityTr(value: string): string {
  if (!value) return '0';
  return value.replace('.', ',');
}

/** ISO tarih-saat → kısa tr biçimi ("06 Kas 14:30"). */
export function formatOccurredAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
