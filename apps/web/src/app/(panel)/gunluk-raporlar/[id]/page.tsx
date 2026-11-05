'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/shell/PageHeader';
import { SectionCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TextArea } from '@/components/ui/Field';
import { ReportForm } from '@/components/daily-reports/ReportForm';
import { useAuth } from '@/lib/auth';
import { dailyReportStatusTone } from '@/lib/daily-report-status';
import { ApiError, dailyReportsApi, resolveMediaUrl, type DailyReportDetailDto } from '@/lib/api';
import {
  DAILY_REPORT_STATUS_LABELS,
  nextDailyReportStatuses,
  permissionsForRoles,
} from '@santiyepro/contracts';

/**
 * Günlük rapor detayı (Faz 05):
 * meta, ekip satırları, fotoğraf galerisi (imzalı URL), onay/red/gönderim
 * aksiyonları, düzenleme (revizyon) ve revizyon geçmişi.
 */
export default function DailyReportDetailPage() {
  const params = useParams<{ id: string }>();
  const reportId = params?.id ?? '';
  const { user, getToken } = useAuth();
  const token = getToken();

  const canCreate = permissionsForRoles(user?.roles ?? []).has('dailyreport.create');
  const canApprove = permissionsForRoles(user?.roles ?? []).has('dailyreport.approve');

  const [report, setReport] = useState<DailyReportDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    if (!token || !reportId) return;
    setLoading(true);
    setError(undefined);
    try {
      setReport(await dailyReportsApi.get(token, reportId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rapor yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [token, reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(action: 'submit' | 'approve' | 'reopen') {
    if (!token || !report) return;
    setBusy(true);
    setActionError(undefined);
    try {
      if (action === 'submit') await dailyReportsApi.submit(token, report.id);
      if (action === 'approve') await dailyReportsApi.approve(token, report.id);
      if (action === 'reopen') await dailyReportsApi.reopen(token, report.id);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'İşlem tamamlanamadı');
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    if (!token || !report || rejectReason.trim().length < 3) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await dailyReportsApi.reject(token, report.id, rejectReason.trim());
      setRejectOpen(false);
      setRejectReason('');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Rapor reddedilemedi');
      setRejectOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Günlük Rapor">
        <PageHeader title="Günlük Rapor" description="Yükleniyor…" />
        <LoadingSkeleton rows={8} />
      </AppShell>
    );
  }

  if (error || !report) {
    return (
      <AppShell title="Günlük Rapor">
        <PageHeader title="Günlük Rapor" description="" />
        <ErrorState message={error ?? 'Rapor bulunamadı'} onRetry={() => void load()} />
      </AppShell>
    );
  }

  const transitions = nextDailyReportStatuses(report.status);

  return (
    <AppShell title={`Günlük Rapor ${report.reportDate}`}>
      <PageHeader
        title={`${report.projectCode ?? ''} · ${report.reportDate}`}
        description={`${DAILY_REPORT_STATUS_LABELS[report.status]} · Revizyon ${report.revisionNo} · Oluşturan: ${report.createdBy?.fullName ?? '—'}`}
        action={
          <Link
            href="/gunluk-raporlar"
            className="inline-flex min-h-9 items-center rounded-input border border-border-default px-3 py-1 text-sm font-semibold text-brand-900 hover:bg-surface-100"
          >
            Listeye Dön
          </Link>
        }
      />

      <div className="flex flex-col gap-4">
        <SectionCard title="Rapor Durumu">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone={dailyReportStatusTone(report.status)}>{DAILY_REPORT_STATUS_LABELS[report.status]}</StatusBadge>
            {report.submittedAt && (
              <span className="text-xs text-text-secondary">Gönderim: {report.submittedAt.slice(0, 16).replace('T', ' ')}</span>
            )}
            {report.approvedBy && (
              <span className="text-xs text-text-secondary">
                Onaylayan: {report.approvedBy.fullName}
                {report.approvedAt ? ` · ${report.approvedAt.slice(0, 16).replace('T', ' ')}` : ''}
              </span>
            )}
            {report.rejectedReason && (
              <span className="rounded-card bg-danger-50 px-2 py-1 text-xs font-medium text-danger-700">
                Red gerekçesi: {report.rejectedReason}
              </span>
            )}
          </div>

          {actionError && (
            <p role="alert" className="mt-2 text-xs font-medium text-danger-600">
              {actionError}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {canCreate && transitions.includes('SUBMITTED') && (
              <Button disabled={busy} onClick={() => void runAction('submit')} className="min-h-9 px-3 py-1 text-xs">
                Gönderime Al
              </Button>
            )}
            {canApprove && transitions.includes('APPROVED') && (
              <Button disabled={busy} onClick={() => void runAction('approve')} className="min-h-9 px-3 py-1 text-xs">
                Onayla
              </Button>
            )}
            {canApprove && transitions.includes('REJECTED') && (
              <Button variant="secondary" disabled={busy} onClick={() => setRejectOpen(true)} className="min-h-9 px-3 py-1 text-xs">
                Reddet
              </Button>
            )}
            {canCreate && transitions.includes('DRAFT') && (
              <Button variant="secondary" disabled={busy} onClick={() => void runAction('reopen')} className="min-h-9 px-3 py-1 text-xs">
                Taslağa Geri Al
              </Button>
            )}
            {canCreate && !editing && (
              <Button variant="secondary" disabled={busy} onClick={() => setEditing(true)} className="min-h-9 px-3 py-1 text-xs">
                Düzenle{report.status === 'SUBMITTED' || report.status === 'APPROVED' ? ' (Revizyon Oluşturur)' : ''}
              </Button>
            )}
          </div>
        </SectionCard>

        {editing ? (
          <ReportForm
            report={report}
            onSaved={() => {
              setEditing(false);
              void load();
            }}
          />
        ) : (
          <>
            <SectionCard title="Rapor İçeriği">
              <dl className="grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Hava Durumu</dt>
                  <dd className="text-text-primary">{report.weather ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Rapor Tarihi</dt>
                  <dd className="text-text-primary">{report.reportDate}</dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Yapılan İşler</dt>
                  <dd className="whitespace-pre-line text-text-primary">{report.workSummary}</dd>
                </div>
                {report.workforceSummary && (
                  <div className="md:col-span-2">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Ekip / Personel Özeti</dt>
                    <dd className="whitespace-pre-line text-text-primary">{report.workforceSummary}</dd>
                  </div>
                )}
                {report.equipmentSummary && (
                  <div className="md:col-span-2">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Ekipman ve Makine</dt>
                    <dd className="whitespace-pre-line text-text-primary">{report.equipmentSummary}</dd>
                  </div>
                )}
                {report.issues && (
                  <div className="md:col-span-2">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Sorun / Gecikme</dt>
                    <dd className="whitespace-pre-line text-text-primary">{report.issues}</dd>
                  </div>
                )}
                {report.safetyNotes && (
                  <div className="md:col-span-2">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">İş Güvenliği Notu</dt>
                    <dd className="whitespace-pre-line text-text-primary">{report.safetyNotes}</dd>
                  </div>
                )}
                {report.nextDayPlan && (
                  <div className="md:col-span-2">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Ertesi Gün Planı</dt>
                    <dd className="whitespace-pre-line text-text-primary">{report.nextDayPlan}</dd>
                  </div>
                )}
              </dl>
            </SectionCard>

            {report.workers.length > 0 && (
              <SectionCard title={`Ekip / Personel (${report.workers.length})`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-secondary">
                        <th scope="col" className="py-2 pr-4">Ad</th>
                        <th scope="col" className="py-2 pr-4">Görev</th>
                        <th scope="col" className="py-2 pr-4">Kişi</th>
                        <th scope="col" className="py-2">Saat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.workers.map((w) => (
                        <tr key={w.id} className="border-b border-border-default/60 last:border-0">
                          <td className="py-2 pr-4 font-medium text-text-primary">{w.name}</td>
                          <td className="py-2 pr-4 text-text-secondary">{w.jobTitle ?? '—'}</td>
                          <td className="py-2 pr-4 text-text-secondary">{w.workerCount}</td>
                          <td className="py-2 text-text-secondary">{w.hours}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            )}

            <SectionCard title={`Fotoğraf Galerisi (${report.media.length})`}>
              {report.media.length === 0 ? (
                <p className="text-sm text-text-secondary">Bu rapora fotoğraf/belge eklenmemiş.</p>
              ) : (
                <ul className="flex flex-wrap gap-3">
                  {report.media.map((m) => (
                    <li key={m.id} className="flex flex-col gap-1">
                      {m.mimeType.startsWith('image/') ? (
                        <a href={resolveMediaUrl(m.url)} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={resolveMediaUrl(m.url)}
                            alt={m.originalName}
                            className="h-36 w-48 rounded-card border border-border-default object-cover"
                          />
                        </a>
                      ) : (
                        <a
                          href={resolveMediaUrl(m.url)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-36 w-48 items-center justify-center rounded-card border border-border-default bg-surface-50 text-sm text-brand-900"
                        >
                          📄 {m.originalName}
                        </a>
                      )}
                      <span className="max-w-48 truncate text-xs text-text-secondary" title={m.originalName}>
                        {m.originalName} · {(m.sizeBytes / 1024).toFixed(0)} KB
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title={`Revizyon Geçmişi (${report.revisions.length})`}>
              {report.revisions.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  Bu rapor gönderildikten/onaylandıktan sonra düzenlenmedi; revizyon kaydı yok.
                </p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {report.revisions.map((r) => (
                    <li key={r.id} className="rounded-card border border-border-default bg-surface-50 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-text-primary">Revizyon {r.revisionNo}</span>
                        <span className="text-xs text-text-secondary">
                          {r.changedByFullName} · {r.createdAt.slice(0, 16).replace('T', ' ')} · hash: {r.contentHash.slice(0, 12)}…
                        </span>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-semibold text-brand-900">Önceki içeriği göster</summary>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-text-secondary">
                          {JSON.stringify(r.snapshot, null, 2)}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ol>
              )}
            </SectionCard>
          </>
        )}
      </div>

      {rejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setRejectOpen(false)}>
          <div
            role="dialog"
            aria-label="Raporu reddet"
            className="w-full max-w-md rounded-card border border-border-default bg-surface-0 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-brand-900">Raporu reddet</h2>
            <p className="mt-1 text-xs text-text-secondary">
              Rapor reddedilecek ve şefe gerekçeyle geri dönecek; gerekçe rapor geçmişinde saklanır.
            </p>
            <div className="mt-3">
              <TextArea
                label="Red Gerekçesi"
                required
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                helpText="En az 3 karakter. Örn. 'Hava durumu ve ekip saati bilgisi eksik.'"
              />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRejectOpen(false)} className="min-h-9 px-3 py-1 text-xs">
                Vazgeç
              </Button>
              <Button
                variant="destructive"
                disabled={busy || rejectReason.trim().length < 3}
                onClick={() => void onReject()}
                className="min-h-9 px-3 py-1 text-xs"
              >
                Reddet
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
