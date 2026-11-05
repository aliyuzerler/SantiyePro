import type { StatusTone } from '@/components/ui/StatusBadge';
import type { TaskPriority, TaskStatus } from '@santiyepro/contracts';

/**
 * Görev durumu/önceliği → rozet tonu eşlemesi (liste ve detay ortak kullanır).
 * Renk tek başına anlam taşımaz; rozetlerde daima Türkçe metin gösterilir (design/03).
 */
export function taskStatusTone(status: TaskStatus): StatusTone {
  switch (status) {
    case 'IN_PROGRESS':
      return 'submitted';
    case 'BLOCKED':
      return 'error';
    case 'DONE':
      return 'approved';
    case 'CANCELLED':
      return 'neutral';
    default:
      return 'draft';
  }
}

export function taskPriorityTone(priority: TaskPriority): StatusTone {
  switch (priority) {
    case 'CRITICAL':
      return 'error';
    case 'HIGH':
      return 'pending';
    case 'LOW':
      return 'neutral';
    default:
      return 'draft';
  }
}

/** ISO datetime → panelde gösterim: YYYY-MM-DD HH:mm (yerel saat). */
export function formatDueDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
