import type { ReactNode } from 'react';
import { Button } from './Button';

export interface EmptyStateProps {
  /** Durumu özetleyen başlık — gerçek veri yoksa sahte veri göstermek yerine kullanılır (design/03). */
  title: string;
  description: string;
  /** İsteğe bağlı birincil aksiyon. */
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border-default bg-surface-50 px-6 py-10 text-center">
      <svg aria-hidden className="size-8 text-text-secondary/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M3 9h18M9 21V9" />
      </svg>
      <p className="text-sm font-bold text-text-primary">{title}</p>
      <p className="max-w-sm text-xs leading-5 text-text-secondary">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  /** Tekrar deneme aksiyonu; verilirse buton çizilir. */
  onRetry?: () => void;
}

export function ErrorState({ title = 'Bir sorun oluştu', message, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 rounded-card border border-danger-600/30 bg-[#f9e5e4]/40 px-6 py-10 text-center">
      <svg aria-hidden className="size-8 text-danger-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.2v.3" />
      </svg>
      <p className="text-sm font-bold text-text-primary">{title}</p>
      <p className="max-w-sm text-xs leading-5 text-text-secondary">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="mt-2">
          Tekrar dene
        </Button>
      )}
    </div>
  );
}
