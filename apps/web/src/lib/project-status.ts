import type { StatusTone } from '@/components/ui/StatusBadge';
import type { ProjectStatus } from '@santiyepro/contracts';

/**
 * Proje durumu → rozet tonu eşlemesi (liste ve detay sayfaları ortak kullanır).
 * Renk tek başına anlam taşımaz; rozetlerde daima Türkçe durum metni gösterilir.
 */
export function projectStatusTone(status: ProjectStatus): StatusTone {
  switch (status) {
    case 'ACTIVE':
      return 'approved';
    case 'ON_HOLD':
      return 'pending';
    case 'COMPLETED':
      return 'submitted';
    case 'ARCHIVED':
      return 'neutral';
    default:
      return 'draft';
  }
}
