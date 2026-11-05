'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
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
import { projectStatusTone } from '@/lib/project-status';
import { ApiError, projectsApi, usersApi, type ProjectsListResponse, type UserDto } from '@/lib/api';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  permissionsForRoles,
  type ProjectDto,
} from '@santiyepro/contracts';

function formatDateRange(p: ProjectDto): string {
  if (!p.startDate && !p.plannedEndDate) return '—';
  const start = p.startDate ?? '?';
  const end = p.plannedEndDate ?? '?';
  return `${start} → ${end}`;
}

/**
 * Projeler (Faz 03 — gerçek API verisi).
 * Liste: project.view izni + kapsam (yalnızca üye olunan projeler);
 * oluşturma/arşivleme: project.edit izni (API'de PermissionsGuard + üyelik ile zorunlu).
 */
export default function ProjectsPage() {
  const { user, getToken } = useAuth();
  const token = getToken();

  const canView = permissionsForRoles(user?.roles ?? []).has('project.view');
  const canEdit = permissionsForRoles(user?.roles ?? []).has('project.edit');

  const [list, setList] = useState<ProjectsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  // Filtreler
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<'createdAt' | 'name' | 'code'>('createdAt');
  const [page, setPage] = useState(1);

  // Yeni proje formu
  const [showForm, setShowForm] = useState(false);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [formError, setFormError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [plannedEndDate, setPlannedEndDate] = useState('');
  const [contractAmount, setContractAmount] = useState('');
  const [managerId, setManagerId] = useState('');

  // Arşiv onayı
  const [archiveTarget, setArchiveTarget] = useState<ProjectDto | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await projectsApi.list(token, {
        page,
        search: search || undefined,
        status: status || undefined,
        sort,
        order: 'asc',
      });
      setList(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Oturumunuz sona erdi. Tekrar giriş yapın.');
      } else {
        setError(err instanceof Error ? err.message : 'Projeler yüklenemedi');
      }
    } finally {
      setLoading(false);
    }
  }, [token, page, search, status, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  // Arama gecikmeli (her tuşta istek atılmaz)
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  async function openCreateForm() {
    setShowForm((v) => !v);
    setFormError(undefined);
    if (!showForm && token && users.length === 0) {
      try {
        const res = await usersApi.list(token);
        setUsers(res.data);
      } catch {
        // Sorumlu listesi yüklenemezse form sorumlusuz kullanılabilir.
      }
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setCreating(true);
    setFormError(undefined);
    try {
      await projectsApi.create(token, {
        code: code.trim(),
        name: name.trim(),
        clientName: clientName.trim() || undefined,
        startDate: startDate || undefined,
        plannedEndDate: plannedEndDate || undefined,
        contractAmount: contractAmount.trim() || undefined,
        managerId: managerId || undefined,
      });
      setShowForm(false);
      setCode('');
      setName('');
      setClientName('');
      setStartDate('');
      setPlannedEndDate('');
      setContractAmount('');
      setManagerId('');
      setPage(1);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Proje oluşturulamadı');
    } finally {
      setCreating(false);
    }
  }

  async function onArchiveConfirm() {
    if (!token || !archiveTarget) return;
    try {
      await projectsApi.update(token, archiveTarget.id, { status: 'ARCHIVED' });
      setArchiveTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Proje arşivlenemedi');
      setArchiveTarget(null);
    }
  }

  const meta = list?.meta;

  return (
    <AppShell title="Projeler">
      <PageHeader
        title="Projeler"
        description="Şantiyelerinizi yönetin: proje oluşturma, durum yönetimi, sorumlu atama ve üye yönetimi."
      />

      {canView ? (
        <div className="flex flex-col gap-4">
          {error && <ErrorState message={error} onRetry={() => void load()} />}

          <SectionCard
            title={`Proje Listesi${meta ? ` (${meta.total})` : ''}`}
            description="Yalnızca erişim kapsamınızdaki projeler listelenir. Arşivlenenler durum filtresiyle görünür."
            action={
              canEdit && (
                <Button variant={showForm ? 'secondary' : 'primary'} onClick={() => void openCreateForm()} leading={showForm ? undefined : '+'}>
                  {showForm ? 'Vazgeç' : 'Yeni Proje'}
                </Button>
              )
            }
          >
            {/* Filtre satırı */}
            <div className="grid gap-3 md:grid-cols-3">
              <TextField
                label="Ara"
                placeholder="Kod, proje adı veya işveren"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <Select
                label="Durum"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'Tümü (arşiv hariç)' },
                  ...PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] })),
                ]}
              />
              <Select
                label="Sırala"
                value={sort}
                onChange={(e) => setSort(e.target.value as 'createdAt' | 'name' | 'code')}
                options={[
                  { value: 'createdAt', label: 'Oluşturma tarihi' },
                  { value: 'name', label: 'Proje adı' },
                  { value: 'code', label: 'Proje kodu' },
                ]}
              />
            </div>

            {showForm && canEdit && (
              <form onSubmit={onCreate} className="grid gap-3 rounded-card border border-border-default bg-surface-50 p-4 md:grid-cols-2">
                <TextField
                  label="Proje Kodu"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  helpText="Kurulum içinde benzersiz; harf, rakam, nokta, alt çizgi ve tire."
                />
                <TextField label="Proje Adı" required value={name} onChange={(e) => setName(e.target.value)} />
                <TextField label="İşveren" value={clientName} onChange={(e) => setClientName(e.target.value)} />
                <Select
                  label="Sorumlu"
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                  placeholder="Seçilmedi"
                  options={users.map((u) => ({ value: u.id, label: `${u.fullName} (${u.email})` }))}
                />
                <TextField label="Başlangıç" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <TextField
                  label="Planlanan Bitiş"
                  type="date"
                  value={plannedEndDate}
                  onChange={(e) => setPlannedEndDate(e.target.value)}
                />
                <TextField
                  label="Sözleşme Tutarı"
                  inputMode="decimal"
                  value={contractAmount}
                  onChange={(e) => setContractAmount(e.target.value)}
                  helpText="Örn. 1234567.89 — TRY cinsinden."
                />
                <div className="md:col-span-2">
                  {formError && (
                    <p role="alert" className="mb-2 text-xs font-medium text-danger-600">
                      {formError}
                    </p>
                  )}
                  <Button type="submit" loading={creating} loadingLabel="Oluşturuluyor…">
                    Proje Oluştur
                  </Button>
                </div>
              </form>
            )}

            {loading ? (
              <LoadingSkeleton rows={5} />
            ) : list && list.data.length === 0 ? (
              <EmptyState
                title="Görüntülenecek proje yok"
                description="Erişim kapsamınızda proje bulunmuyor. Proje oluşturun veya firma yöneticinizden proje üyeliği talep edin."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-secondary">
                      <th scope="col" className="py-2 pr-4">Kod</th>
                      <th scope="col" className="py-2 pr-4">Proje Adı</th>
                      <th scope="col" className="py-2 pr-4">Sorumlu</th>
                      <th scope="col" className="py-2 pr-4">Başlangıç / Bitiş</th>
                      <th scope="col" className="py-2 pr-4">Durum</th>
                      <th scope="col" className="py-2 pr-4">Şantiye</th>
                      <th scope="col" className="py-2 pr-4">Üye</th>
                      <th scope="col" className="py-2">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list?.data.map((p) => (
                      <tr key={p.id} className="border-b border-border-default/60 last:border-0">
                        <td className="py-2.5 pr-4 font-mono text-xs font-bold text-brand-900">{p.code}</td>
                        <td className="py-2.5 pr-4 font-medium text-text-primary">{p.name}</td>
                        <td className="py-2.5 pr-4 text-text-secondary">{p.manager?.fullName ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-text-secondary">{formatDateRange(p)}</td>
                        <td className="py-2.5 pr-4">
                          <StatusBadge tone={projectStatusTone(p.status)}>{PROJECT_STATUS_LABELS[p.status]}</StatusBadge>
                        </td>
                        <td className="py-2.5 pr-4 text-text-secondary">{p.siteCount}</td>
                        <td className="py-2.5 pr-4 text-text-secondary">{p.memberCount}</td>
                        <td className="py-2.5 whitespace-nowrap">
                          <Link
                            href={`/projeler/${p.id}`}
                            className="mr-2 min-h-9 inline-flex items-center rounded-input border border-border-default px-3 py-1 text-xs font-semibold text-brand-900 hover:bg-surface-100"
                          >
                            Detay
                          </Link>
                          {canEdit && p.status !== 'ARCHIVED' && (
                            <Button
                              variant="secondary"
                              onClick={() => setArchiveTarget(p)}
                              className="min-h-9 px-3 py-1 text-xs"
                            >
                              Arşivle
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sayfalama */}
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
            Güvenlik: Proje kodu kurulum içinde benzersizdir. Projeler silinmez; arşivlenir ve bağlı kayıtlar
            korunur. Kapsam dışındaki projelere erişim API tarafında 404 ile engellenir (docs/06).
          </p>
        </div>
      ) : (
        <ErrorState
          title="Yetkisiz erişim"
          message="Bu sayfayı görüntülemek için gerekli izniniz yok (project.view). Firma yöneticinize başvurun."
        />
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        title="Projeyi arşivle"
        message={`"${archiveTarget?.name ?? ''}" projesi arşivlenecek. Proje silinmez; bağlı şantiye ve üye kayıtları korunur. Arşivlenen proje yalnızca durum filtresiyle listelenir.`}
        confirmLabel="Arşivle"
        destructive
        onConfirm={() => void onArchiveConfirm()}
        onCancel={() => setArchiveTarget(null)}
      />
    </AppShell>
  );
}
