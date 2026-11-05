import type { StatusTone } from '@/components/ui/StatusBadge';
import type { DailyReportStatus } from '@santiyepro/contracts';

/** Günlük rapor durumu → rozet tonu (renk tek başına anlam taşımaz, metin her zaman görünür). */
export function dailyReportStatusTone(status: DailyReportStatus): StatusTone {
  switch (status) {
    case 'SUBMITTED':
      return 'pending';
    case 'APPROVED':
      return 'approved';
    case 'REJECTED':
      return 'error';
    default:
      return 'draft';
  }
}
