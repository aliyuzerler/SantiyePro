export interface BreadcrumbsProps {
  items: Array<{ label: string; href?: string }>;
}

/** Breadcrumb — topbar altı konum için (design/03 ana iskelet). */
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Sayfa yolu" className="text-xs text-text-secondary">
      <ol className="flex items-center gap-1.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <a href={item.href} className="hover:text-brand-600 hover:underline">
                  {item.label}
                </a>
              ) : (
                <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'font-semibold text-text-primary' : ''}>
                  {item.label}
                </span>
              )}
              {!isLast && <span aria-hidden>›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
