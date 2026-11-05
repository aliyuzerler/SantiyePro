'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/shell/PageHeader';
import { SectionCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select, TextField } from '@/components/ui/Field';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/lib/auth';
import { dailyReportStatusTone } from '@/lib/daily-report-status';
import {
  ApiError,
  dailyReportsApi,
  projectsApi,
  type DailyReportsListResponse,
} from '@/lib/api';
import {
  DAILY_REPORT_STATUSES,
  DAILY_REPORT_STATUS_LABELS,
  permissionsForRoles,
  type DailyReportDto,
} from '@santiyepro/contracts';
import Link from 'next/link';

/**
 * Günlük raporlar (Faz 05 — gerçek API verisi).
 * Liste: dailyreport.view izni + proje kapsamı; oluşturma dailyreport.create,
 * onay/red dailyreport.approve izniyle API'de zorunlu tutulur.
 */
export default function DailyReportsPage() {
  const { user, getToken } = useAuth();
  const token = getToken();

  const canView = permissionsForRoles(user?.roles ?? []).has('dailyreport.view');
  const canCreate = permissionsForRoles(user?.roles ?? []).has('dailyreport.create');

  const [list, setList] = useState<DailyReportsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [projects, setProjects] = useState<Array<{ id: string; code: string; name: string }>>([]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await dailyReportsApi.list(token, {
        page,
        projectId: projectId || undefined,
        status: status || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setList(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Oturumunuz sona erdi. Tekrar giriş yapın.');
      } else {
        setError(err instanceof Error ? err.message : 'Raporlar yüklenemedi');
      }
    } finally {
      setLoading(false);
    }
  }, [token, page, projectId, status, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token) return;
    projectsApi
      .list(token, { sort: 'name', order: 'asc' })
      .then((res) => setProjects(res.data.map((p) => ({ id: p.id, code: p.code, name: p.name }))))
      .catch(() => setProjects([]));
  }, [token]);

  const meta = list?.meta;

  return (
    <AppShell title="Günlük Raporlar">
      <PageHeader
        title="Günlük Raporlar"
        description="Günlük şantiye raporları: taslak oluşturma, gönderim, onay/red akışı, fotoğraf galerisi ve revizyon geçmişi."
        action={
          canCreate && (
            <Link
              href="/gunluk-raporlar/yeni"
              className="inline-flex min-h-9 items-center rounded-input bg-brand-900 px-3 py-1 text-sm font-semibold text-white hover:bg-brand-800"
            >
              + Yeni Rapor
            </Link>
          )
        }
      />

      {canView ? (
        <div className="flex flex-col gap-4">
          {error && <ErrorState message={error} onRetry={() => void load()} />}

          <SectionCard
            title={`Rapor Listesi${meta ? ` (${meta.total})` : ''}`}
            description="Yalnızca erişim kapsamınızdaki projelerin raporları listelenir."
          >
            <div className="grid gap-3 md:grid-cols-4">
              <Select
                label="Proje"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setPage(1);
                }}
                placeholder="Tüm projeler"
                options={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
              />
              <Select
                label="Durum"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                placeholder="Tümü"
                options={DAILY_REPORT_STATUSES.map((s) => ({ value: s, label: DAILY_REPORT_STATUS_LABELS[s] }))}
              />
              <TextField label="Başlangıç" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <TextField label="Bitiş" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            {loading ? (
              <LoadingSkeleton rows={5} />
            ) : list && list.data.length === 0 ? (
              <EmptyState
                title="Görüntülenecek rapor yok"
                description="Erişim kapsamınızda günlük rapor bulunmuyor. Filtreleri temizleyin veya yeni rapor oluşturun."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-secondary">
                      <th scope="col" className="py-2 pr-4">Tarih</th>
                      <th scope="col" className="py-2 pr-4">Proje</th>
                      <th scope="col" className="py-2 pr-4">Şantiye</th>
                      <th scope="col" className="py-2 pr-4">Yapılan İşler</th>
                      <th scope="col" className="py-2 pr-4">Ek</th>
                      <th scope="col" className="py-2 pr-4">Durum</th>
                      <th scope="col" className="py-2">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list?.data.map((r: DailyReportDto & { mediaCount?: number }) => (
                      <tr key={r.id} className="border-b border-border-default/60 last:border-0">
                        <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-brand-900">{r.reportDate}</td>
                        <td className="py-2.5 pr-4 text-text-secondary">{r.projectCode}</td>
                        <td className="py-2.5 pr-4 text-text-secondary">{r.siteName ?? '—'}</td>
                        <td className="py-2.5 max-w-xs truncate pr-4 text-text-primary" title={r.workSummary}>
                          {r.workSummary}
                        </td>
                        <td className="py-2.5 pr-4 text-text-secondary">📷 {r.mediaCount ?? r.media.length}</td>
                        <td className="py-2.5 pr-4">
                          <StatusBadge tone={dailyReportStatusTone(r.status)}>{DAILY_REPORT_STATUS_LABELS[r.status]}</StatusBadge>
                        </td>
                        <td className="py-2.5 whitespace-nowrap">
                          <Link
                            href={`/gunluk-raporlar/${r.id}`}
                            className="inline-flex min-h-9 items-center rounded-input border border-border-default px-3 py-1 text-xs font-semibold text-brand-900 hover:bg-surface-100"
                          >
                            Detay
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <Button variant="secondary" disabled={meta.page <= 1} onClick={() => setPage((v) => v - 1)} className="min-h-9 px-3 py-1 text-xs">
                  Önceki
                </Button>
                <span className="text-xs text-text-secondary">
                  Sayfa {meta.page} / {meta.totalPages}
                </span>
                <Button
                  variant="secondary"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => setPage((v) => v + 1)}
                  className="min-h-9 px-3 py-1 text-xs"
                >
                  Sonraki
                </Button>
              </div>
            )}
          </SectionCard>

          <p className="text-xs leading-5 text-text-secondary">
            Akış: Taslak → Gönderildi → Onaylandı / Reddedildi. Gönderilmiş veya onaylı bir rapor düzenlenirse
            önceki içerik revizyon geçmişinde saklanır. Reddedilen rapor taslağa geri alınabilir.
          </p>
        </div>
      ) : (
        <ErrorState
          title="Yetkisiz erişim"
          message="Bu sayfayı görüntülemek için gerekli izniniz yok (dailyreport.view). Firma yöneticinize başvurun."
        />
      )}
    </AppShell>
  );
}
