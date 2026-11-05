import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Kart yüzeyi — surface.0, radius 12, 1px kenarlık (tokens.json). */
export function Card({ children, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`rounded-card border border-border-default bg-surface-0 p-5 shadow-[0_2px_8px_rgba(20,38,61,0.025)] ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface SectionCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}

/** Başlıklı bölüm kartı (dashboard panelleri için). */
export function SectionCard({ title, description, action, children }: SectionCardProps) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-border-default bg-surface-0 p-5 shadow-[0_2px_8px_rgba(20,38,61,0.025)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-brand-900">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-text-secondary">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
