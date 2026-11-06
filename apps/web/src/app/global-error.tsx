'use client';

/**
 * Kök hata sınırı (Faz 11): layout dahil çöktüğünde devreye girer.
 * HTML ve body etiketlerini kendisi sağlar; traceId/digest destek korelasyonu için gösterilir.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="tr">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#f9fafb' }}>
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '2rem',
            textAlign: 'center',
          }}
        >
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#111827' }}>
            Uygulama yüklenemedi
          </h2>
          <p style={{ maxWidth: '28rem', fontSize: '0.875rem', color: '#4b5563' }}>
            Beklenmeyen bir sunucu hatası oluştu. Sayfayı yenileyin; sorun sürerse
            hata kodunu destek ekibiyle paylaşın.
          </p>
          {error.digest ? (
            <p style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#6b7280' }}>
              Hata kodu: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              borderRadius: '0.5rem',
              background: '#2563eb',
              color: '#ffffff',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Tekrar dene
          </button>
        </div>
      </body>
    </html>
  );
}
