/**
 * Gider ve hakediş gösterim yardımcıları (Faz 08).
 * Etiketler contracts'tan; para biçimi tr-TR + para birimi açık.
 * Tutarlar UI'da SAĞA hizalı gösterilir (sayfa sınıflarıyla).
 */
import type { StatusTone } from '@/components/ui/StatusBadge';
import {
  EXPENSE_STATUS_LABELS,
  PROGRESS_CLAIM_STATUS_LABELS,
  type ExpenseStatus,
  type ProgressClaimStatus,
} from '@santiyepro/contracts';

export const EXPENSE_STATUS_TONES: Record<ExpenseStatus, StatusTone> = {
  DRAFT: 'draft',
  PENDING: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

export const CLAIM_STATUS_TONES: Record<ProgressClaimStatus, StatusTone> = {
  DRAFT: 'draft',
  PENDING: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'neutral',
};

export function expenseStatusTone(status: string): StatusTone {
  return EXPENSE_STATUS_TONES[status as ExpenseStatus] ?? 'neutral';
}

export function expenseStatusLabel(status: string): string {
  return EXPENSE_STATUS_LABELS[status as ExpenseStatus] ?? status;
}

export function claimStatusTone(status: string): StatusTone {
  return CLAIM_STATUS_TONES[status as ProgressClaimStatus] ?? 'neutral';
}

export function claimStatusLabel(status: string): string {
  return PROGRESS_CLAIM_STATUS_LABELS[status as ProgressClaimStatus] ?? status;
}

/**
 * Kanonik para string + ISO para birimi → tr-TR gösterim.
 * "1250.50" + TRY → "₺1.250,50" — para birimi AÇIK yazılır (yayına uygun).
 * Geçersiz para biriminde sade sayı döner; API kanonik değeri değiştirmez.
 */
export function formatMoneyTr(amount: string, currency: string): string {
  const numeric = Number.parseFloat(amount);
  if (!Number.isFinite(numeric)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(numeric);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Miktar gösterimi (hakediş satırları): "200" → "200", "12.5" → "12,5". */
export function formatQtyTr(value: string): string {
  if (!value) return '0';
  return value.replace('.', ',');
}

/** ISO tarih → kısa tr biçimi ("05 Kas 23:46"). */
export function formatDateTimeTr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** YYYY-MM-DD → tr kısa tarih ("15 Oca 2026"). */
export function formatDateTr(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [, y, mo, d] = m;
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${Number(d)} ${months[Number(mo) - 1]} ${y}`;
}
