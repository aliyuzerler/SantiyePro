'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/shell/PageHeader';
import { SectionCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select, TextField } from '@/components/ui/Field';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/lib/auth';
import { attendanceStatusTone, formatWorkedMinutes, formatWorkDate } from '@/lib/attendance-status';
import { ApiError, attendanceApi, personnelApi, projectsApi, type PersonnelDto, type ProjectDto } from '@/lib/api';
import {
  BULK_ATTENDANCE_ACTION_LABELS,
  DEFAULT_ATTENDANCE_STATUSES,
  DEFAULT_ATTENDANCE_STATUS_LABELS,
  DEFAULT_SHIFT_KEYS,
  DEFAULT_SHIFT_KEY_LABELS,
  PERSONNEL_STATUS_LABELS,
  permissionsForRoles,
  type AttendanceRecordDto,
  type BulkAttendancePreviewResponse,
} from '@santiyepro/contracts';

/**
 * Personel & Puantaj (Faz 06 — gerçek API verisi).
 *
 * Kurallar (prompts/phase-06-development.md, docs/06):
 * - attendance.view: sayfa erişimi; attendance.edit: işaretleme/personel düzenleme.
 * - Puantaj tablosu proje + tarih + vardiya başına günlük sayfa; her satır
 *   (personel, proje, tarih, vardiya) için tek kayıt — duplicate API'de 409.
 * - Toplu işaretleme iki adımlı: Önizle (yazma yok) → Onayla (confirm: true).
 * - GPS yok: konum alanı hiçbir akışta istenmez (docs/07).
 */
type Tab = 'sheet' | 'personnel';

interface SheetRow {
  personnel: PersonnelDto;
  record: AttendanceRecordDto | null;
  draftStatus: string;
  draftNote: string;
  selected: boolean;
}

const todayWorkDate = () => new Date().toISOString().slice(0, 10);

export default function AttendancePage() {
  const { user, getToken } = useAuth();
  const token = getToken();

  const canView = permissionsForRoles(user?.roles ?? []).has('attendance.view');
  const canEdit = permissionsForRoles(user?.roles ?? []).has('attendance.edit');

  const [tab, setTab] = useState<Tab>('sheet');

  // Ortak: projeler + geçerli durumlar
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [statusLabels, setStatusLabels] = useState<Record<string, string>>(DEFAULT_ATTENDANCE_STATUS_LABELS);
  const [statuses, setStatuses] = useState<string[]>([...DEFAULT_ATTENDANCE_STATUSES]);

  // Puantaj tablosu durumu
  const [projectId, setProjectId] = useState('');
  const [workDate, setWorkDate] = useState(todayWorkDate());
  const [shiftKey, setShiftKey] = useState<string>('GUNDUZ');
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [sheetLoading, setSheetLoading] = useState(true);
  const [sheetError, setSheetError] = useState<string>();
  const [savingRow, setSavingRow] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState('PRESENT');
  const [bulkPreview, setBulkPreview] = useState<BulkAttendancePreviewResponse | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [summary, setSummary] = useState<{
    totalRecords: number;
    uniquePersonnelCount: number;
    totalWorkedMinutes: number;
    byStatus: Record<string, number>;
  } | null>(null);

  // Personel sekmesi durumu
  const [personnel, setPersonnel] = useState<PersonnelDto[]>([]);
  const [personnelLoading, setPersonnelLoading] = useState(true);
  const [personnelError, setPersonnelError] = useState<string>();
  const [personnelSearchInput, setPersonnelSearchInput] = useState('');
  const [personnelSearch, setPersonnelSearch] = useState('');
  const [personnelStatus, setPersonnelStatus] = useState('');
  const [showPersonnelForm, setShowPersonnelForm] = useState(false);
  const [editingPersonnel, setEditingPersonnel] = useState<PersonnelDto | null>(null);
  const [formError, setFormError] = useState<string>();
  const [formBusy, setFormBusy] = useState(false);
  const [fCode, setFCode] = useState('');
  const [fName, setFName] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [fTitle, setFTitle] = useState('');
  const [fCompany, setFCompany] = useState('');
  const [deactivating, setDeactivating] = useState<PersonnelDto | null>(null);

  // Ortam yüklemesi: projeler + kurum durumları
  useEffect(() => {
    if (!token) return;
    projectsApi
      .list(token, { sort: 'name', order: 'asc', pageSize: 100 })
      .then((res) => setProjects(res.data))
      .catch(() => setProjects([]));
    attendanceApi
      .statuses(token)
      .then((res) => {
        setStatuses(res.statuses);
        setStatusLabels(res.labels);
      })
      .catch(() => undefined);
  }, [token]);

  // Puantaj sayfası: aktif personel + mevcut kayıtlar
  const loadSheet = useCallback(async () => {
    if (!token) return;
    setSheetLoading(true);
    setSheetError(undefined);
    try {
      const people = await personnelApi.list(token, { status: 'ACTIVE', page: 1 });
      let records: AttendanceRecordDto[] = [];
      if (projectId) {
        const res = await attendanceApi.list(token, { projectId, workDate, shiftKey });
        records = res.data;
      }
      const byPersonnel = new Map(records.map((r) => [r.personnelId, r]));
      setRows(
        people.data.map((p) => {
          const record = byPersonnel.get(p.id) ?? null;
          return { personnel: p, record, draftStatus: record?.status ?? '', draftNote: record?.note ?? '', selected: false };
        }),
      );
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : 'Puantaj sayfası yüklenemedi');
    } finally {
      setSheetLoading(false);
    }
  }, [token, projectId, workDate, shiftKey]);

  useEffect(() => {
    void loadSheet();
  }, [loadSheet]);

  // Özet: seçilen ay
  useEffect(() => {
    if (!token || !projectId) {
      setSummary(null);
      return;
    }
    const month = workDate.slice(0, 7);
    const from = `${month}-01`;
    const [y = 0, m = 0] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    attendanceApi
      .summary(token, projectId, from, `${month}-${String(lastDay).padStart(2, '0')}`)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [token, projectId, workDate]);

  // Personel listesi
  const loadPersonnel = useCallback(async () => {
    if (!token) return;
    setPersonnelLoading(true);
    setPersonnelError(undefined);
    try {
      const res = await personnelApi.list(token, {
        search: personnelSearch || undefined,
        status: personnelStatus || undefined,
      });
      setPersonnel(res.data);
    } catch (err) {
      setPersonnelError(err instanceof Error ? err.message : 'Personel listesi yüklenemedi');
    } finally {
      setPersonnelLoading(false);
    }
  }, [token, personnelSearch, personnelStatus]);

  useEffect(() => {
    void loadPersonnel();
  }, [loadPersonnel]);

  // Arama gecikmeli
  useEffect(() => {
    const t = setTimeout(() => setPersonnelSearch(personnelSearchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [personnelSearchInput]);

  // ---------- Satır işaretleme ----------

  async function saveRow(row: SheetRow, status: string) {
    if (!token || !projectId) return;
    setSavingRow(row.personnel.id);
    try {
      if (row.record) {
        await attendanceApi.update(token, row.record.id, {
          status,
          note: row.draftNote.trim() || null,
        });
      } else {
        await attendanceApi.create(token, {
          projectId,
          personnelId: row.personnel.id,
          workDate,
          shiftKey,
          status,
          note: row.draftNote.trim() || null,
        });
      }
      await loadSheet();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSheetError('Bu personel için bu gün ve vardiyada kayıt zaten var — sayfa yenilendi.');
        await loadSheet();
      } else {
        setSheetError(err instanceof Error ? err.message : 'İşaretleme kaydedilemedi');
      }
    } finally {
      setSavingRow(null);
    }
  }

  function setDraft(personnelId: string, status: string) {
    setRows((prev) => prev.map((r) => (r.personnel.id === personnelId ? { ...r, draftStatus: status } : r)));
  }

  // ---------- Toplu işaretleme (önizleme + onay) ----------

  const selectedIds = useMemo(() => rows.filter((r) => r.selected).map((r) => r.personnel.id), [rows]);

  async function runPreview() {
    if (!token || !projectId || selectedIds.length === 0) return;
    setBulkBusy(true);
    setSheetError(undefined);
    try {
      const preview = await attendanceApi.bulkPreview(token, {
        projectId,
        workDate,
        shiftKey,
        status: bulkStatus,
        personnelIds: selectedIds,
      });
      setBulkPreview(preview);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : 'Önizleme alınamadı');
    } finally {
      setBulkBusy(false);
    }
  }

  async function confirmBulk() {
    if (!token || !projectId || !bulkPreview) return;
    setBulkBusy(true);
    try {
      await attendanceApi.bulkConfirm(token, {
        projectId,
        workDate,
        shiftKey,
        status: bulkStatus,
        personnelIds: bulkPreview.entries.map((e) => e.personnelId),
        confirm: true,
      });
      setBulkPreview(null);
      setRows((prev) => prev.map((r) => ({ ...r, selected: false })));
      await loadSheet();
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : 'Toplu işaretleme uygulanamadı');
    } finally {
      setBulkBusy(false);
    }
  }

  // ---------- Personel formu ----------

  function openNewPersonnel() {
    setEditingPersonnel(null);
    setFCode('');
    setFName('');
    setFPhone('');
    setFTitle('');
    setFCompany('');
    setFormError(undefined);
    setShowPersonnelForm(true);
  }

  function openEditPersonnel(p: PersonnelDto) {
    setEditingPersonnel(p);
    setFCode(p.employeeCode ?? '');
    setFName(p.fullName);
    setFPhone(p.phone ?? '');
    setFTitle(p.jobTitle ?? '');
    setFCompany(p.companyOrSubcontractor ?? '');
    setFormError(undefined);
    setShowPersonnelForm(true);
  }

  async function submitPersonnel(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setFormBusy(true);
    setFormError(undefined);
    try {
      if (editingPersonnel) {
        await personnelApi.update(token, editingPersonnel.id, {
          employeeCode: fCode.trim() || null,
          fullName: fName.trim(),
          phone: fPhone.trim() || null,
          jobTitle: fTitle.trim() || null,
          companyOrSubcontractor: fCompany.trim() || null,
        });
      } else {
        await personnelApi.create(token, {
          employeeCode: fCode.trim() || undefined,
          fullName: fName.trim(),
          phone: fPhone.trim() || undefined,
          jobTitle: fTitle.trim() || undefined,
          companyOrSubcontractor: fCompany.trim() || undefined,
        });
      }
      setShowPersonnelForm(false);
      await loadPersonnel();
      await loadSheet();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Personel kaydedilemedi');
    } finally {
      setFormBusy(false);
    }
  }

  async function deactivatePersonnel() {
    if (!token || !deactivating) return;
    setFormBusy(true);
    try {
      await personnelApi.update(token, deactivating.id, { status: 'PASSIVE' });
      setDeactivating(null);
      await loadPersonnel();
      await loadSheet();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Personel pasife alınamadı');
    } finally {
      setFormBusy(false);
    }
  }

  if (!canView) {
    return (
      <AppShell title="Personel & Puantaj">
        <ErrorState
          title="Yetkisiz erişim"
          message="Bu sayfayı görüntülemek için gerekli izniniz yok (attendance.view). Firma yöneticinize başvurun."
        />
      </AppShell>
    );
  }

  const personnelForm = showPersonnelForm && canEdit && (
    <form onSubmit={submitPersonnel} className="grid gap-3 rounded-card border border-border-default bg-surface-50 p-4 md:grid-cols-2">
      <TextField label="Ad Soyad" required value={fName} onChange={(e) => setFName(e.target.value)} helpText="En az 3 karakter." />
      <TextField label="Sicil No" value={fCode} onChange={(e) => setFCode(e.target.value)} helpText="Benzersiz; boş bırakılabilir." />
      <TextField label="İş Unvanı" value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="Kalıp Ustası" />
      <TextField label="Firma / Taşeron" value={fCompany} onChange={(e) => setFCompany(e.target.value)} placeholder="Kendi kadro / taşeron adı" />
      <TextField label="Telefon" value={fPhone} onChange={(e) => setFPhone(e.target.value)} placeholder="05xx…" />
      <div className="md:col-span-2">
        {formError && (
          <p role="alert" className="mb-2 text-xs font-medium text-danger-600">
            {formError}
          </p>
        )}
        <Button type="submit" loading={formBusy} loadingLabel="Kaydediliyor…">
          {editingPersonnel ? 'Değişiklikleri Kaydet' : 'Personel Ekle'}
        </Button>
      </div>
    </form>
  );

  return (
    <AppShell title="Personel & Puantaj">
      <PageHeader
        title="Personel & Puantaj"
        description="Personel kayıtları, günlük devam durumu, giriş-çıkış saatleri ve toplu işaretleme."
      />

      <div className="flex flex-col gap-4">
        {/* Sekme seçici */}
        <div role="tablist" aria-label="Puantaj bölümleri" className="flex gap-2">
          <Button
            variant={tab === 'sheet' ? 'primary' : 'secondary'}
            onClick={() => setTab('sheet')}
            aria-selected={tab === 'sheet'}
            role="tab"
            className="min-h-9 px-4 py-1.5 text-sm"
          >
            Günlük Puantaj
          </Button>
          <Button
            variant={tab === 'personnel' ? 'primary' : 'secondary'}
            onClick={() => setTab('personnel')}
            aria-selected={tab === 'personnel'}
            role="tab"
            className="min-h-9 px-4 py-1.5 text-sm"
          >
            Personel Kayıtları
          </Button>
        </div>

        {sheetError && <ErrorState message={sheetError} onRetry={() => void loadSheet()} />}

        {/* ---------- Günlük puantaj tablosu ---------- */}
        {tab === 'sheet' && (
          <SectionCard
            title="Günlük Puantaj Sayfası"
            description="Her personel/proje/tarih/vardiya için tek kayıt tutulur; aynı gün ikinci vardiya ayrı satırdır."
          >
            <div className="grid gap-3 md:grid-cols-3">
              <Select
                label="Proje"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="Proje seçin"
                options={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
              />
              <TextField label="Puantaj Günü" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
              <Select
                label="Vardiya"
                value={shiftKey}
                onChange={(e) => setShiftKey(e.target.value)}
                options={DEFAULT_SHIFT_KEYS.map((k) => ({ value: k, label: DEFAULT_SHIFT_KEY_LABELS[k] }))}
              />
            </div>

            {/* Toplu işaretleme çubuğu */}
            {canEdit && (
              <div className="flex flex-wrap items-end gap-3 rounded-card border border-border-default bg-surface-50 p-3">
                <div className="w-48">
                  <Select
                    label="Toplu durum"
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}
                    options={statuses.map((s) => ({ value: s, label: statusLabels[s] ?? s }))}
                  />
                </div>
                <span className="pb-2 text-xs text-text-secondary">
                  {selectedIds.length} kişi seçildi
                </span>
                <Button
                  variant="secondary"
                  disabled={selectedIds.length === 0 || !projectId || bulkBusy}
                  onClick={() => void runPreview()}
                  className="min-h-9 px-3 py-1 text-xs"
                >
                  {bulkBusy ? 'Hesaplanıyor…' : 'Önizle'}
                </Button>
                <span className="pb-2 text-xs text-text-secondary">
                  Önizlemeden sonra onay istenir; pasif ve zaten kayıtlı kişiler atlanır.
                </span>
              </div>
            )}

            {/* Özet kartı */}
            {summary && (
              <div className="flex flex-wrap gap-3 text-xs text-text-secondary">
                <span className="rounded-md bg-surface-100 px-2 py-1">Bu ay: {summary.totalRecords} kayıt</span>
                <span className="rounded-md bg-surface-100 px-2 py-1">{summary.uniquePersonnelCount} kişi</span>
                <span className="rounded-md bg-surface-100 px-2 py-1">
                  Toplam {formatWorkedMinutes(summary.totalWorkedMinutes)}
                </span>
                {Object.entries(summary.byStatus).map(([s, count]) => (
                  <span key={s} className="rounded-md bg-surface-100 px-2 py-1">
                    {statusLabels[s] ?? s}: {count}
                  </span>
                ))}
              </div>
            )}

            {!projectId ? (
              <EmptyState
                title="Proje seçilmedi"
                description="Puantaj sayfasını görmek için bir proje seçin; yalnızca erişim kapsamınızdaki projeler listelenir."
              />
            ) : sheetLoading ? (
              <LoadingSkeleton rows={6} />
            ) : rows.length === 0 ? (
              <EmptyState
                title="Aktif personel yok"
                description="Personel Kayıtları sekmesinden personel ekleyin; pasif personel puantaj sayfasında görünmez."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-secondary">
                      {canEdit && <th scope="col" className="py-2 pr-2">Seç</th>}
                      <th scope="col" className="py-2 pr-4">Personel</th>
                      <th scope="col" className="py-2 pr-4">Devam Durumu</th>
                      <th scope="col" className="py-2 pr-4">Giriş / Çıkış</th>
                      <th scope="col" className="py-2 pr-4">Süre</th>
                      <th scope="col" className="py-2">Not</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.personnel.id} className="border-b border-border-default/60 last:border-0">
                        {canEdit && (
                          <td className="py-2.5 pr-2 align-top">
                            <input
                              type="checkbox"
                              aria-label={`${row.personnel.fullName} seç`}
                              checked={row.selected}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((r) =>
                                    r.personnel.id === row.personnel.id ? { ...r, selected: e.target.checked } : r,
                                  ),
                                )
                              }
                              className="h-4 w-4"
                            />
                          </td>
                        )}
                        <td className="py-2.5 pr-4">
                          <div className="font-medium text-text-primary">{row.personnel.fullName}</div>
                          {row.personnel.employeeCode && (
                            <div className="text-xs text-text-secondary">Sicil: {row.personnel.employeeCode}</div>
                          )}
                        </td>
                        <td className="py-2.5 pr-4">
                          {canEdit ? (
                            <div className="flex flex-wrap gap-1" role="group" aria-label={`${row.personnel.fullName} devam durumu`}>
                              {statuses.map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  disabled={savingRow === row.personnel.id}
                                  onClick={() => {
                                    setDraft(row.personnel.id, s);
                                    void saveRow({ ...row, draftStatus: s }, s);
                                  }}
                                  className={`min-h-9 rounded-md border px-2 py-1 text-xs font-semibold transition-colors ${
                                    row.draftStatus === s
                                      ? 'border-brand-700 bg-brand-700 text-white'
                                      : 'border-border-default bg-surface-0 text-text-secondary hover:bg-surface-100'
                                  }`}
                                >
                                  {statusLabels[s] ?? s}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <StatusBadge tone={attendanceStatusTone(row.draftStatus || '—')}>
                              {statusLabels[row.draftStatus] ?? row.draftStatus ?? 'İşaretlenmedi'}
                            </StatusBadge>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-text-secondary">
                          {row.record?.checkInAt
                            ? `${row.record.checkInAt.slice(11, 16)} – ${row.record.checkOutAt?.slice(11, 16) ?? '…'}`
                            : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-text-secondary">
                          {formatWorkedMinutes(row.record?.workedMinutes)}
                        </td>
                        <td className="py-2.5 text-xs text-text-secondary">{row.record?.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs leading-5 text-text-secondary">
              Güvenlik: Puantaj yalnızca erişim kapsamınızdaki projelerde görüntülenir ve düzenlenir; kapsam dışı
              projeler API tarafından 404 ile gizlenir (IDOR koruması). Konum (GPS) toplanmaz; varsayılan kapalıdır.
            </p>
          </SectionCard>
        )}

        {/* ---------- Personel kayıtları ---------- */}
        {tab === 'personnel' && (
          <SectionCard
            title={`Personel Kayıtları`}
            description="Kurum genelindeki işçi ve taşeron kadrosu; pasife alınan personelin geçmişi korunur."
            action={
              canEdit && (
                <Button variant={showPersonnelForm ? 'secondary' : 'primary'} onClick={() => (showPersonnelForm ? setShowPersonnelForm(false) : openNewPersonnel())}>
                  {showPersonnelForm ? 'Vazgeç' : 'Yeni Personel'}
                </Button>
              )
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                label="Ara"
                placeholder="Ad soyad veya sicil"
                value={personnelSearchInput}
                onChange={(e) => setPersonnelSearchInput(e.target.value)}
              />
              <Select
                label="Durum"
                value={personnelStatus}
                onChange={(e) => setPersonnelStatus(e.target.value)}
                placeholder="Tümü"
                options={[
                  { value: 'ACTIVE', label: 'Aktif' },
                  { value: 'PASSIVE', label: 'Pasif' },
                ]}
              />
            </div>

            {personnelForm}

            {personnelError && <ErrorState message={personnelError} onRetry={() => void loadPersonnel()} />}

            {personnelLoading ? (
              <LoadingSkeleton rows={5} />
            ) : personnel.length === 0 ? (
              <EmptyState
                title="Personel kaydı yok"
                description="Henüz personel eklenmemiş. Yeni Personel düğmesiyle ilk kaydı oluşturun."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-secondary">
                      <th scope="col" className="py-2 pr-4">Ad Soyad</th>
                      <th scope="col" className="py-2 pr-4">Sicil</th>
                      <th scope="col" className="py-2 pr-4">Unvan</th>
                      <th scope="col" className="py-2 pr-4">Firma / Taşeron</th>
                      <th scope="col" className="py-2 pr-4">Telefon</th>
                      <th scope="col" className="py-2 pr-4">Puantaj Kaydı</th>
                      <th scope="col" className="py-2 pr-4">Durum</th>
                      {canEdit && <th scope="col" className="py-2">İşlem</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {personnel.map((p) => (
                      <tr key={p.id} className="border-b border-border-default/60 last:border-0">
                        <td className="py-2.5 pr-4 font-medium text-text-primary">{p.fullName}</td>
                        <td className="py-2.5 pr-4 text-text-secondary">{p.employeeCode ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-text-secondary">{p.jobTitle ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-text-secondary">{p.companyOrSubcontractor ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-text-secondary">{p.phone ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-text-secondary">{p.attendanceRecordCount}</td>
                        <td className="py-2.5 pr-4">
                          <StatusBadge tone={p.status === 'ACTIVE' ? 'approved' : 'neutral'}>
                            {PERSONNEL_STATUS_LABELS[p.status]}
                          </StatusBadge>
                        </td>
                        {canEdit && (
                          <td className="py-2.5 whitespace-nowrap">
                            <div className="flex gap-2">
                              <Button variant="secondary" onClick={() => openEditPersonnel(p)} className="min-h-9 px-3 py-1 text-xs">
                                Düzenle
                              </Button>
                              {p.status === 'ACTIVE' && (
                                <Button
                                  variant="secondary"
                                  onClick={() => setDeactivating(p)}
                                  className="min-h-9 px-3 py-1 text-xs"
                                >
                                  Pasife Al
                                </Button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        )}
      </div>

      {/* Toplu işaretleme önizleme + onay diyaloğu */}
      <ConfirmDialog
        open={bulkPreview !== null}
        title="Toplu İşaretleme Önizlemesi"
        message={`${formatWorkDate(workDate)} · ${DEFAULT_SHIFT_KEY_LABELS[shiftKey as 'GUNDUZ' | 'GECE'] ?? shiftKey} vardiyası için "${statusLabels[bulkStatus] ?? bulkStatus}" uygulanacak.`}
        confirmLabel="Onayla ve Uygula"
        onConfirm={() => void confirmBulk()}
        onCancel={() => setBulkPreview(null)}
      >
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-left text-xs">
          {bulkPreview?.entries.map((entry) => (
            <li key={`${entry.personnelId}-${entry.action}`} className="flex items-center justify-between gap-2 rounded-md bg-surface-50 px-2 py-1.5">
              <span className="font-medium text-text-primary">{entry.personnelName}</span>
              <span className="text-text-secondary">
                {BULK_ATTENDANCE_ACTION_LABELS[entry.action]} — {entry.detail}
              </span>
            </li>
          ))}
          {bulkPreview && (
            <li className="pt-1 text-text-secondary">
              {bulkPreview.createCount} yeni kayıt · {bulkPreview.updateCount} güncelleme · {bulkPreview.skipCount} atlama
            </li>
          )}
        </ul>
      </ConfirmDialog>

      {/* Pasife alma onayı */}
      <ConfirmDialog
        open={deactivating !== null}
        title="Personeli Pasife Al"
        message={`${deactivating?.fullName ?? ''} pasife alınacak; puantaj geçmişi korunur ancak yeni kayıt girilemez.`}
        confirmLabel="Pasife Al"
        destructive
        onConfirm={() => void deactivatePersonnel()}
        onCancel={() => setDeactivating(null)}
      />
    </AppShell>
  );
}
