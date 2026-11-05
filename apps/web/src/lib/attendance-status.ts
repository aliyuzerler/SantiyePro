/**
 * Puantaj durum gösterim yardımcıları (Faz 06).
 * Etiketler contracts'tan; renk tonları StatusBadge tone sözlüğüyle eşleşir.
 */
import type { StatusTone } from '@/components/ui/StatusBadge';

export const ATTENDANCE_STATUS_TONES: Record<string, StatusTone> = {
  PRESENT: 'approved',
  HALF_DAY: 'pending',
  ABSENT: 'rejected',
  LEAVE: 'submitted',
  SICK: 'draft',
  HOLIDAY: 'neutral',
};

export function attendanceStatusTone(status: string): StatusTone {
  return ATTENDANCE_STATUS_TONES[status] ?? 'neutral';
}

/** Dakika → "8s 30dk" biçimi; null/0 için '—'. */
export function formatWorkedMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}dk`;
  return m === 0 ? `${h}s` : `${h}s ${m}dk`;
}

/** YYYY-MM-DD → "01 Haz 2026" biçimi (tr-TR). */
export function formatWorkDate(workDate: string): string {
  const [y, m, d] = workDate.split('-').map(Number);
  if (!y || !m || !d) return workDate;
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${String(d).padStart(2, '0')} ${months[m - 1]} ${y}`;
}
