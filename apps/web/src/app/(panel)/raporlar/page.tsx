'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/shell/PageHeader';
import { SectionCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select, TextField } from '@/components/ui/Field';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { useAuth } from '@/lib/auth';
import { ApiError, reportsApi, projectsApi, type PaginatedReportResponse, type ReportFilterParams } from '@/lib/api';
import {
  CLAIM_STATUSES,
  CLAIM_STATUS_LABELS,
  DAILY_REPORT_STATUSES,
  DAILY_REPORT_STATUS_LABELS,
  EXPENSE_STATUSES,
  EXPENSE_STATUS_LABELS,
  REPORT_KEY_LABELS,
  REPORT_PERMISSIONS,
  STOCK_MOVEMENT_TYPES,
  STOCK_MOVEMENT_TYPE_LABELS,
  TASK_STATUS_LABELS,
  permissionsForRoles,
  type ClaimSummaryRow,
  type DailyReportSummaryRow,
  type ExpenseSummaryRow,
  type ProjectDto,
  type ProjectOverviewRow,
  type ReportExportFormat,
  type ReportKey,
  type StockBalanceRow,
  type StockMovementRow,
  type TaskStatusRow,
  type AttendanceReportRow,
} from '@santiyepro/contracts';

/**
 * Raporlar (Faz 10 — gerçek API verisi).
 *
 * Kurallar (prompts/phase-10-development.md, docs/06, docs/08):
 * - Her sekme kendi alt veri iznine göre görünür; export ayrıca report.export ister.
 * - Filtreler ekran ile dışa aktarmada aynı servis yolundan geçer; çıktı asla ayrışmaz.
 * - Sunucu tarafı sayfalama; tarih aralığı verilmezse API son 30 gündür (belgeli varsayılan).
 */
const REPORT_TABS: ReportKey[] = [
  'project-overview',
  'daily-reports',
  'attendance',
  'stock-balance',
  'stock-movements',
  'expense-summary',
  'claim-summary',
  'task-status',
];

/** Sekme başına durum filtresi seçenekleri; undefined → durum filtresi yok. */
const STATUS_OPTIONS: Partial<Record<ReportKey, Array<{ value: string; label: string }>>> = {
  'daily-reports': DAILY_REPORT_STATUSES.map((s) => ({ value: s, label: DAILY_REPORT_STATUS_LABELS[s] })),
  'expense-summary': EXPENSE_STATUSES.map((s) => ({ value: s, label: EXPENSE_STATUS_LABELS[s] })),
  'claim-summary': CLAIM_STATUSES.map((s) => ({ value: s, label: CLAIM_STATUS_LABELS[s] })),
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000 - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function money(value: string | null, currency: string | null): string {
  if (value === null) return '—';
  const n = Number(value);
  return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ' ' + currency : ''}`;
}

function trDate(iso: string): string {
  return iso.slice(0, 10).split('-').reverse().join('.');
}

function trDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' });
}

const STATUS_TONES: Record<string, StatusTone> = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'neutral',
  TODO: 'neutral',
  IN_PROGRESS: 'submitted',
  BLOCKED: 'error',
  DONE: 'approved',
};

export default function ReportsPage() {
  const { user, getToken } = useAuth();
  const token = getToken() ?? '';

  const perms = useMemo(() => permissionsForRoles(user?.roles ?? []), [user?.roles]);
  const canExport = perms.has('report.export');
  const visibleTabs = REPORT_TABS.filter((key) => perms.has(REPORT_PERMISSIONS[key]));

  const [activeKey, setActiveKey] = useState<ReportKey>('project-overview');
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [report, setReport] = useState<PaginatedReportResponse<never> | null>(null);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState(isoDaysAgo(29));
  const [dateTo, setDateTo] = useState(isoDaysAgo(0));
  const [filterProject, setFilterProject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [belowMinOnly, setBelowMinOnly] = useState('');
  const [movementType, setMovementType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [exporting, setExporting] = useState<ReportExportFormat | null>(null);

  const seqRef = useRef(0);

  /** Sekme değişince filtre sıfırlaması — filtreler rapora özgüdür. */
  const switchTab = (key: ReportKey) => {
    setActiveKey(key);
    setPage(1);
    setFilterStatus('');
    setBelowMinOnly('');
    setMovementType('');
    setReport(null);
  };

  const filters: ReportFilterParams = useMemo(
    () => ({
      dateFrom,
      dateTo,
      projectId: filterProject || undefined,
      status: filterStatus || undefined,
      page,
      pageSize: 15,
    }),
    [dateFrom, dateTo, filterProject, filterStatus, page],
  );

  const reload = useCallback(async () => {
    if (!token || !perms.has(REPORT_PERMISSIONS[activeKey])) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(undefined);
    try {
      let res: PaginatedReportResponse<never>;
      switch (activeKey) {
        case 'project-overview':
          res = (await reportsApi.overview(token, filters)) as PaginatedReportResponse<never>;
          break;
        case 'daily-reports':
          res = (await reportsApi.dailyReports(token, filters)) as PaginatedReportResponse<never>;
          break;
        case 'attendance':
          res = (await reportsApi.attendance(token, filters)) as PaginatedReportResponse<never>;
          break;
        case 'stock-balance':
          res = (await reportsApi.stockBalance(token, {
            ...filters,
            belowMin: belowMinOnly || undefined,
          } as ReportFilterParams)) as PaginatedReportResponse<never>;
          break;
        case 'stock-movements':
          res = (await reportsApi.stockMovements(token, {
            ...filters,
            type: movementType || undefined,
          } as ReportFilterParams)) as PaginatedReportResponse<never>;
          break;
        case 'expense-summary':
          res = (await reportsApi.expenseSummary(token, filters)) as PaginatedReportResponse<never>;
          break;
        case 'claim-summary':
          res = (await reportsApi.claimSummary(token, filters)) as PaginatedReportResponse<never>;
          break;
        case 'task-status':
          res = (await reportsApi.taskStatus(token, filters)) as PaginatedReportResponse<never>;
          break;
      }
      if (seq !== seqRef.current) return;
      setReport(res);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(e instanceof ApiError ? e.message : 'Rapor yüklenemedi');
      setReport(null);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [token, activeKey, filters, belowMinOnly, movementType, perms]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!token) return;
    projectsApi
      .list(token, { pageSize: 100, sort: 'name', order: 'asc' })
      .then((res) => setProjects(res.data))
      .catch(() => setProjects([]));
  }, [token]);

  const runExport = async (format: ReportExportFormat) => {
    if (!token || !canExport) return;
    setExporting(format);
    setNotice(undefined);
    setError(undefined);
    try {
      const params = {
        dateFrom: ['stock-balance', 'project-overview', 'task-status'].includes(activeKey) ? undefined : dateFrom,
        dateTo: ['stock-balance', 'project-overview', 'task-status'].includes(activeKey) ? undefined : dateTo,
        projectId: filterProject || undefined,
        status: filterStatus || undefined,
      };
      const result = await reportsApi.exportReport(token, activeKey, format, params);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`${result.filename} indirildi · ${result.rowCount.toLocaleString('tr-TR')} satır · denetim kaydı: ${result.auditLogId || 'yazılamadı'}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Dışa aktarma başarısız');
    } finally {
      setExporting(null);
    }
  };

  const statusOptions = STATUS_OPTIONS[activeKey];
  const isStockTab = activeKey === 'stock-balance' || activeKey === 'stock-movements';
  const hasDateFilter = !['project-overview', 'task-status', 'stock-balance'].includes(activeKey);
  const meta = report?.meta;
  const rows: unknown[] = report?.data ?? [];

  return (
    <AppShell title="Raporlar">
      <PageHeader
        title="Raporlar"
        description="Gerçek veriden üretilen raporlar; PDF (Türkçe karakter destekli) ve XLSX (gerçek hücre tipleri) çıktısı her dışa aktarmada denetim günlüğüne yazılır."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" loading={exporting === 'xlsx'} disabled={!canExport || loading} onClick={() => void runExport('xlsx')}>
              XLSX indir
            </Button>
            <Button variant="secondary" loading={exporting === 'pdf'} disabled={!canExport || loading} onClick={() => void runExport('pdf')}>
              PDF indir
            </Button>
          </div>
        }
      />

      {!canExport && (
        <p className="mb-4 rounded-card border border-border-default bg-surface-50 px-4 py-3 text-xs text-text-secondary">
          Dışa aktarma izniniz yok (report.export); raporları görüntüleyebilirsiniz.
        </p>
      )}

      {/* Sekmeler */}
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Rapor seçimi">
        {visibleTabs.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeKey === key}
            onClick={() => switchTab(key)}
            className={`rounded-full border px-4 py-2 text-xs font-bold transition-colors ${
              activeKey === key
                ? 'border-brand-900 bg-brand-900 text-white'
                : 'border-border-default bg-surface-0 text-text-secondary hover:border-brand-700 hover:text-brand-900'
            }`}
          >
            {REPORT_KEY_LABELS[key]}
          </button>
        ))}
      </div>

      {/* Filtreler */}
      <div className="mb-4">
        <SectionCard title="Filtreler" description="Ekran ile dışa aktarma aynı filtreleri kullanır.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {hasDateFilter && (
            <>
              <TextField label="Başlangıç" type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
              <TextField label="Bitiş" type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
            </>
          )}
          <Select
            label="Proje"
            options={[{ value: '', label: 'Tümü (yetki kapsamım)' }, ...projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))]}
            value={filterProject}
            onChange={(e) => { setFilterProject(e.target.value); setPage(1); }}
          />
          {statusOptions && (
            <Select
              label="Durum"
              options={[{ value: '', label: 'Tümü' }, ...statusOptions]}
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            />
          )}
          {activeKey === 'attendance' && (
            <TextField
              label="Kayıt durumu"
              helpText="Örn. PRESENT, ABSENT veya kurum tanımlı durum"
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            />
          )}
          {activeKey === 'stock-balance' && (
            <Select
              label="Kritik stok"
              options={[
                { value: '', label: 'Tüm kartlar' },
                { value: 'true', label: 'Yalnız kritik altı' },
                { value: 'false', label: 'Yalnız yeterli' },
              ]}
              value={belowMinOnly}
              onChange={(e) => { setBelowMinOnly(e.target.value); setPage(1); }}
            />
          )}
          {activeKey === 'stock-movements' && (
            <Select
              label="Hareket tipi"
              options={[{ value: '', label: 'Tümü' }, ...STOCK_MOVEMENT_TYPES.map((t) => ({ value: t, label: STOCK_MOVEMENT_TYPE_LABELS[t] }))]}
              value={movementType}
              onChange={(e) => { setMovementType(e.target.value); setPage(1); }}
            />
          )}
        </div>
      </SectionCard>
      </div>

      {notice && (
        <p role="status" className="mb-4 rounded-card border border-success-600/30 bg-[#e7f3ec] px-4 py-3 text-xs text-brand-900">
          {notice}
        </p>
      )}

      {/* Tablo */}
      <SectionCard
        title={REPORT_KEY_LABELS[activeKey]}
        description={meta ? `Sayfa ${meta.page}/${meta.totalPages || 1} · Toplam ${meta.total.toLocaleString('tr-TR')} satır` : undefined}
        action={
          <div className="flex gap-2">
            <Button variant="tertiary" disabled={!meta || meta.page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              ← Önceki
            </Button>
            <Button variant="tertiary" disabled={!meta || meta.page >= meta.totalPages || loading} onClick={() => setPage((p) => p + 1)}>
              Sonraki →
            </Button>
          </div>
        }
      >
        {error && <ErrorState title="Rapor yüklenemedi" message={error} onRetry={() => void reload()} />}
        {!error && loading && <LoadingSkeleton rows={6} />}
        {!error && !loading && rows.length === 0 && (
          <EmptyState
            title="Kayıt bulunamadı"
            description="Seçili filtrelerde veri yok. Tarih aralığını genişletin veya proje filtresini temizleyin."
          />
        )}
        {!error && !loading && rows.length > 0 && isStockTab && activeKey === 'stock-balance' && (
          <StockBalanceTable rows={rows as StockBalanceRow[]} />
        )}
        {!error && !loading && rows.length > 0 && activeKey === 'stock-movements' && (
          <StockMovementTable rows={rows as StockMovementRow[]} />
        )}
        {!error && !loading && rows.length > 0 && activeKey === 'project-overview' && (
          <OverviewTable rows={rows as ProjectOverviewRow[]} />
        )}
        {!error && !loading && rows.length > 0 && activeKey === 'daily-reports' && (
          <DailyReportTable rows={rows as DailyReportSummaryRow[]} />
        )}
        {!error && !loading && rows.length > 0 && activeKey === 'attendance' && (
          <AttendanceTable rows={rows as AttendanceReportRow[]} />
        )}
        {!error && !loading && rows.length > 0 && activeKey === 'expense-summary' && (
          <ExpenseTable rows={rows as ExpenseSummaryRow[]} />
        )}
        {!error && !loading && rows.length > 0 && activeKey === 'claim-summary' && (
          <ClaimTable rows={rows as ClaimSummaryRow[]} />
        )}
        {!error && !loading && rows.length > 0 && activeKey === 'task-status' && <TaskTable rows={rows as TaskStatusRow[]} />}
      </SectionCard>
    </AppShell>
  );
}

// ---------- Tablo bileşenleri (her rapor kendi kolonlarıyla) ----------

const TH = ({ children, right = false }: { children: ReactNode; right?: boolean }) => (
  <th scope="col" className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-text-secondary ${right ? 'text-right' : 'text-left'}`}>
    {children}
  </th>
);
const TD = ({ children, right = false }: { children: ReactNode; right?: boolean }) => (
  <td className={`whitespace-nowrap px-3 py-2 text-xs text-text-primary ${right ? 'text-right tabular-nums' : 'text-left'}`}>{children}</td>
);

function StockBalanceTable({ rows }: { rows: StockBalanceRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr className="border-b border-border-default">
            <TH>Malzeme</TH><TH>Kod</TH><TH>Depo</TH><TH>Birim</TH>
            <TH right>Miktar</TH><TH right>Min. Stok</TH><TH>Kritik</TH><TH>Son Hareket</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.materialId}-${row.warehouseId}`} className={`border-b border-border-default/50 ${row.belowMin ? 'bg-[#fdf3f2]' : ''}`}>
              <TD>{row.materialName}</TD>
              <TD>{row.materialCode ?? '—'}</TD>
              <TD>{row.warehouseName}</TD>
              <TD>{row.unit}</TD>
              <TD right>{Number(row.quantity).toLocaleString('tr-TR', { maximumFractionDigits: 3 })}</TD>
              <TD right>{row.minStock === null ? '—' : Number(row.minStock).toLocaleString('tr-TR', { maximumFractionDigits: 3 })}</TD>
              <TD>{row.belowMin ? <StatusBadge tone="error">Kritik</StatusBadge> : <span className="text-xs text-text-secondary">—</span>}</TD>
              <TD>{trDateTime(row.lastMovementAt)}</TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockMovementTable({ rows }: { rows: StockMovementRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse">
        <thead>
          <tr className="border-b border-border-default">
            <TH>Tarih</TH><TH>Tip</TH><TH>Malzeme</TH><TH>Depo</TH><TH>Hedef</TH><TH right>Miktar</TH><TH>Not</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border-default/50">
              <TD>{trDateTime(row.occurredAt)}</TD>
              <TD>
                <StatusBadge tone={row.type === 'REVERSAL' ? 'error' : row.type === 'IN' || row.type === 'RETURN' ? 'approved' : 'neutral'}>
                  {STOCK_MOVEMENT_TYPE_LABELS[row.type as keyof typeof STOCK_MOVEMENT_TYPE_LABELS] ?? row.type}
                </StatusBadge>
              </TD>
              <TD>{row.materialName}{row.materialCode ? ` (${row.materialCode})` : ''}</TD>
              <TD>{row.warehouseName}</TD>
              <TD>{row.targetWarehouseName ?? '—'}</TD>
              <TD right>{Number(row.quantity).toLocaleString('tr-TR', { maximumFractionDigits: 3 })} {row.unit}</TD>
              <TD right>
                <span className="block max-w-[220px] truncate">{row.note ?? '—'}</span>
              </TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OverviewTable({ rows }: { rows: ProjectOverviewRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse">
        <thead>
          <tr className="border-b border-border-default">
            <TH>Proje</TH><TH>Durum</TH>
            <TH right>Görev</TH><TH right>Aktif</TH><TH right>Geciken</TH>
            <TH right>Günlük Rapor</TH><TH right>Onaylı</TH><TH right>Bekleyen</TH>
            <TH right>Puantaj</TH><TH right>Stok Hareket</TH>
            <TH right>Onaylı Gider</TH><TH right>Onaylı Hakediş (Net)</TH><TH>Son Hareket</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.projectId} className="border-b border-border-default/50">
              <TD><strong className="font-bold">{row.projectCode}</strong> — {row.projectName}</TD>
              <TD><StatusBadge tone={row.projectStatus === 'ACTIVE' ? 'approved' : 'neutral'}>{row.projectStatus}</StatusBadge></TD>
              <TD right>{row.taskTotal}</TD>
              <TD right>{row.taskActive}</TD>
              <TD right>{row.taskOverdue > 0 ? <span className="font-bold text-danger-600">{row.taskOverdue}</span> : 0}</TD>
              <TD right>{row.dailyReportTotal}</TD>
              <TD right>{row.dailyReportApproved}</TD>
              <TD right>{row.dailyReportSubmitted}</TD>
              <TD right>{row.attendanceRecordCount}</TD>
              <TD right>{row.stockMovementCount}</TD>
              <TD right>
                {row.expenseMixedCurrency ? <span title="Birden fazla para birimi — toplam uydurulmaz">₺₺$ (karışık)</span> : money(row.expenseApprovedTotal, row.expenseCurrency)}
              </TD>
              <TD right>{money(row.claimApprovedNetTotal, null)}</TD>
              <TD>{trDateTime(row.lastActivityAt)}</TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyReportTable({ rows }: { rows: DailyReportSummaryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse">
        <thead>
          <tr className="border-b border-border-default">
            <TH>Tarih</TH><TH>Proje</TH><TH right>Toplam</TH><TH right>Taslak</TH><TH right>Gönderildi</TH><TH right>Onaylı</TH><TH right>Reddedildi</TH><TH right>Revizyon</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.projectId}-${row.reportDate}`} className="border-b border-border-default/50">
              <TD>{trDate(row.reportDate)}</TD>
              <TD>{row.projectName}</TD>
              <TD right>{row.total}</TD>
              <TD right>{row.draft}</TD>
              <TD right>{row.submitted}</TD>
              <TD right>{row.approved}</TD>
              <TD right>{row.rejected}</TD>
              <TD right>{row.revisionTotal}</TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AttendanceTable({ rows }: { rows: AttendanceReportRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse">
        <thead>
          <tr className="border-b border-border-default">
            <TH>Tarih</TH><TH>Proje</TH><TH right>Kayıt</TH><TH right>Çalışma (saat)</TH><TH>Durum Dağılımı</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.projectId}-${row.workDate}`} className="border-b border-border-default/50">
              <TD>{trDate(row.workDate)}</TD>
              <TD>{row.projectName}</TD>
              <TD right>{row.recordCount}</TD>
              <TD right>{(row.workedMinutesTotal / 60).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</TD>
              <TD>
                <div className="flex flex-wrap gap-1">
                  {row.statusBreakdown.map((s) => (
                    <StatusBadge key={s.status} tone={STATUS_TONES[s.status] ?? 'neutral'}>
                      {`${s.status}: ${s.count}`}
                    </StatusBadge>
                  ))}
                </div>
              </TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpenseTable({ rows }: { rows: ExpenseSummaryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr className="border-b border-border-default">
            <TH>Kategori</TH><TH>Para</TH>
            <TH right>Taslak</TH><TH right>Bekleyen</TH><TH right>Onaylı</TH><TH right>Reddedilen</TH><TH right>Genel Toplam</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.categoryId}-${row.currency}`} className="border-b border-border-default/50">
              <TD>{row.categoryName}</TD>
              <TD>{row.currency}</TD>
              <TD right>{money(row.draftTotal, null)}</TD>
              <TD right>{money(row.pendingTotal, null)}</TD>
              <TD right>{money(row.approvedTotal, null)}</TD>
              <TD right>{money(row.rejectedTotal, null)}</TD>
              <TD right><strong className="font-bold">{money(row.grandTotal, row.currency)}</strong></TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClaimTable({ rows }: { rows: ClaimSummaryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse">
        <thead>
          <tr className="border-b border-border-default">
            <TH>Proje</TH><TH right>No</TH><TH>Dönem</TH><TH>Durum</TH>
            <TH right>Brüt</TH><TH right>Kesinti</TH><TH right>Net</TH><TH right>Kümülatif</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.claimId} className="border-b border-border-default/50">
              <TD>{row.projectName}</TD>
              <TD right>{row.claimNo}</TD>
              <TD>{trDate(row.periodStart)} – {trDate(row.periodEnd)}</TD>
              <TD><StatusBadge tone={STATUS_TONES[row.status] ?? 'neutral'}>{CLAIM_STATUS_LABELS[row.status as keyof typeof CLAIM_STATUS_LABELS] ?? row.status}</StatusBadge></TD>
              <TD right>{money(row.grossTotal, row.currency)}</TD>
              <TD right>{money(row.deductionTotal, null)}</TD>
              <TD right><strong className="font-bold">{money(row.netTotal, null)}</strong></TD>
              <TD right>{money(row.cumulativeTotal, null)}</TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskTable({ rows }: { rows: TaskStatusRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr className="border-b border-border-default">
            <TH>Proje</TH>
            {Object.values(TASK_STATUS_LABELS).map((label) => <TH key={label} right>{label}</TH>)}
            <TH right>Geciken</TH><TH right>Yaklaşan (7 gün)</TH><TH right>Toplam</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.projectId} className="border-b border-border-default/50">
              <TD>{row.projectName}</TD>
              <TD right>{row.todo}</TD>
              <TD right>{row.inProgress}</TD>
              <TD right>{row.blocked}</TD>
              <TD right>{row.done}</TD>
              <TD right>{row.cancelled}</TD>
              <TD right>{row.overdue > 0 ? <span className="font-bold text-danger-600">{row.overdue}</span> : 0}</TD>
              <TD right>{row.dueSoon}</TD>
              <TD right><strong className="font-bold">{row.total}</strong></TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
