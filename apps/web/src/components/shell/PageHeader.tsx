import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Sayfaya özgü birincil aksiyon (design/03: başlığın sağında). */
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-2xl font-bold text-brand-900">{title}</h2>
        {description && <p className="mt-1 text-xs text-text-secondary">{description}</p>}
      </div>
      {action}
    </div>
  );
}
