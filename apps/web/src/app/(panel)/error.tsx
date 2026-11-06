'use client';

/**
 * Panel segmenti hata sınırı (Faz 11, docs/12: hata ekranları anlaşılır olmalı).
 * Beklenmeyen render hatalarında tüm sayfa yerine zarif bir hata ekranı gösterilir;
 * traceId kullanıcıya iletilir → destek kaydında korelasyon sağlar.
 */
import { useEffect } from 'react';

export default function PanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Konsola teknik detay; kullanıcıya yalnızca anlaşılır metin + digest gösterilir.
    console.error('Panel hatası:', error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-4xl" aria-hidden="true">
        ⚠️
      </div>
      <h2 className="text-lg font-semibold text-gray-900">Beklenmeyen bir hata oluştu</h2>
      <p className="max-w-md text-sm text-gray-600">
        Sayfa görüntülenirken bir sorun oluştu. Tekrar deneyebilirsiniz; sorun sürerse
        hata kodunu destek ekibiyle paylaşın.
      </p>
      {error.digest ? (
        <p className="rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-500">
          Hata kodu: {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Tekrar dene
      </button>
    </div>
  );
}
