export type StatusTone = 'draft' | 'submitted' | 'approved' | 'rejected' | 'pending' | 'error' | 'neutral';

export interface StatusBadgeProps {
  tone: StatusTone;
  /** Kısa durum metni — renk tek başına durum anlatmaz (design/01). */
  children: string;
}

const toneStyles: Record<StatusTone, string> = {
  draft: 'bg-surface-100 text-text-secondary',
  submitted: 'bg-[#e3eef8] text-info-600',
  approved: 'bg-[#e8f4ed] text-success-600',
  rejected: 'bg-[#f9e5e4] text-danger-600',
  pending: 'bg-accent-100 text-[#8a6119]',
  error: 'bg-[#f9e5e4] text-danger-600',
  neutral: 'bg-surface-100 text-text-secondary',
};

const toneIcons: Record<StatusTone, string> = {
  draft: '○',
  submitted: '↑',
  approved: '✓',
  rejected: '✕',
  pending: '◷',
  error: '!',
  neutral: '•',
};

/** Durum rozeti — metin + ikon birlikte (renk körlüğü güvenliği, design/04). */
export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold ${toneStyles[tone]}`}
    >
      <span aria-hidden className="text-[10px] leading-none">
        {toneIcons[tone]}
      </span>
      {children}
    </span>
  );
}
