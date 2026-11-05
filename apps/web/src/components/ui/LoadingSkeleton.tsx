export interface LoadingSkeletonProps {
  /** Blok sayısı; dashboard panelleri ve listeler için iskelet çizimi. */
  rows?: number;
  className?: string;
}

/** Yüklenme iskeleti — gerçek veri gelmeden sahte sayı göstermemek için (design/03). */
export function LoadingSkeleton({ rows = 3, className = '' }: LoadingSkeletonProps) {
  return (
    <div className={`flex flex-col gap-3 ${className}`} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-input bg-surface-100"
          // Kaçırma: dekoratif iskelet; ekran okuyucu için aria-busy yeterli.
        />
      ))}
      <span className="sr-only">İçerik yükleniyor…</span>
    </div>
  );
}
