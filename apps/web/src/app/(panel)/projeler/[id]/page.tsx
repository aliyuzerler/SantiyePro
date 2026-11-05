'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { SectionCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select, TextField } from '@/components/ui/Field';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/lib/auth';
import { projectStatusTone } from '@/lib/project-status';
import { ApiError, projectsApi, usersApi, type UserDto } from '@/lib/api';
import {
  PROJECT_SCOPE_ROLES,
  PROJECT_SCOPE_ROLE_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  SITE_STATUS_LABELS,
  canTransitionProjectStatus,
  permissionsForRoles,
  type ProjectDetailDto,
  type ProjectStatus,
} from '@santiyepro/contracts';

/**
 * Proje detayı (Faz 03).
 * Değiştiricide yanlış projeye kayıt açmayı önlemek için aktif proje bağlamı
 * (kod + ad + durum) sayfa başlığında kalıcı olarak görünür.
 * Bölümler: Genel (bilgi + düzenleme), Şantiyeler, Üyeler.
 */
export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = typeof params?.id === 'string' ? params.id : '';
  const { user, getToken } = useAuth();
  const token = getToken();

  const canEdit = permissionsForRoles(user?.roles ?? []).has('project.edit');

  const [project, setProject] = useState<ProjectDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  // Düzenleme formu
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [form, setForm] = useState({
    name: '',
    clientName: '',
    address: '',
    description: '',
    startDate: '',
    plannedEndDate: '',
    contractAmount: '',
    managerId: '',
  });

  // Şantiye ekleme
  const [siteName, setSiteName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [siteError, setSiteError] = useState<string>();
  const [addingSite, setAddingSite] = useState(false);

  // Üye ekleme / çıkarma
  const [memberUserId, setMemberUserId] = useState('');
  const [memberScopeRole, setMemberScopeRole] = useState('WORKER');
  const [memberError, setMemberError] = useState<string>();
  const [addingMember, setAddingMember] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; fullName: string } | null>(null);

  const load = useCallback(async () => {
    if (!token || !projectId) return;
    setLoading(true);
    setError(undefined);
    try {
      const detail = await projectsApi.get(token, projectId);
      setProject(detail);
      setForm({
        name: detail.name,
        clientName: detail.clientName ?? '',
        address: detail.address ?? '',
        description: detail.description ?? '',
        startDate: detail.startDate ?? '',
        plannedEndDate: detail.plannedEndDate ?? '',
        contractAmount: detail.contractAmount ?? '',
        managerId: detail.manager?.id ?? '',
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError('Proje bulunamadı veya erişim kapsamınızda değil.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Oturumunuz sona erdi. Tekrar giriş yapın.');
      } else {
        setError(err instanceof Error ? err.message : 'Proje yüklenemedi');
      }
    } finally {
      setLoading(false);
    }
  }, [token, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadUsers() {
    if (!token || users.length > 0) return;
    try {
      const res = await usersApi.list(token);
      setUsers(res.data);
    } catch {
      // Kullanıcı listesi yüklenemezse seçim alanı boş kalır; form kullanılabilir.
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!token || !project) return;
    setSaving(true);
    setFormError(undefined);
    try {
      await projectsApi.update(token, project.id, {
        name: form.name.trim(),
        clientName: form.clientName.trim() || null,
        address: form.address.trim() || null,
        description: form.description.trim() || null,
        startDate: form.startDate || null,
        plannedEndDate: form.plannedEndDate || null,
        contractAmount: form.contractAmount.trim() || null,
        managerId: form.managerId || null,
      });
      setEditing(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Proje güncellenemedi');
    } finally {
      setSaving(false);
    }
  }

  async function onStatusChange(next: ProjectStatus) {
    if (!token || !project) return;
    try {
      await projectsApi.update(token, project.id, { status: next });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Durum değiştirilemedi');
    }
  }

  async function onAddSite(e: FormEvent) {
    e.preventDefault();
    if (!token || !project) return;
    setAddingSite(true);
    setSiteError(undefined);
    try {
      await projectsApi.createSite(token, project.id, {
        name: siteName.trim(),
        address: siteAddress.trim() || undefined,
      });
      setSiteName('');
      setSiteAddress('');
      await load();
    } catch (err) {
      setSiteError(err instanceof Error ? err.message : 'Şantiye eklenemedi');
    } finally {
      setAddingSite(false);
    }
  }

  async function onToggleSiteStatus(siteId: string, current: 'ACTIVE' | 'INACTIVE') {
    if (!token || !project) return;
    try {
      await projectsApi.updateSite(token, project.id, siteId, {
        status: current === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Şantiye durumu değiştirilemedi');
    }
  }

  async function onAddMember(e: FormEvent) {
    e.preventDefault();
    if (!token || !project || !memberUserId) return;
    setAddingMember(true);
    setMemberError(undefined);
    try {
      await projectsApi.addMember(token, project.id, { userId: memberUserId, scopeRole: memberScopeRole });
      setMemberUserId('');
      setMemberScopeRole('WORKER');
      await load();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Üye eklenemedi');
    } finally {
      setAddingMember(false);
    }
  }

  async function onChangeMemberRole(memberId: string, scopeRole: string) {
    if (!token || !project) return;
    try {
      await projectsApi.updateMember(token, project.id, memberId, { scopeRole });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Üye rolü değiştirilemedi');
    }
  }

  async function onRemoveMemberConfirm() {
    if (!token || !project || !removeTarget) return;
    try {
      await projectsApi.removeMember(token, project.id, removeTarget.id);
      setRemoveTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Üye çıkarılamadı');
      setRemoveTarget(null);
    }
  }

  // Geçerli durum geçişleri (contracts matrisi)
  const nextStatuses = project
    ? PROJECT_STATUSES.filter((s) => canTransitionProjectStatus(project.status, s))
    : [];

  return (
    <AppShell title="Proje Detayı">
      {/* Aktif proje bağlamı — yanlış projeye kayıt açmayı önler */}
      <div className="mb-4 flex flex-col gap-2 rounded-card border border-border-default bg-brand-900 px-5 py-4 text-white md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/projeler" className="text-xs font-semibold text-white/70 underline-offset-2 hover:underline">
              ← Projeler
            </Link>
            {project && <span className="font-mono text-xs font-bold text-accent-500">{project.code}</span>}
          </div>
          <h2 className="mt-1 text-lg font-bold">{loading ? 'Yükleniyor…' : project?.name}</h2>
        </div>
        {project && (
          <StatusBadge tone={projectStatusTone(project.status)}>{PROJECT_STATUS_LABELS[project.status]}</StatusBadge>
        )}
      </div>

      {error && !loading && <ErrorState message={error} onRetry={() => void load()} />}

      {loading && (
        <div className="flex flex-col gap-4">
          <SectionCard title="Genel">
            <LoadingSkeleton rows={4} />
          </SectionCard>
        </div>
      )}

      {!loading && project && (
        <div className="flex flex-col gap-4">
          {/* ---------- Genel ---------- */}
          <SectionCard
            title="Genel Bilgiler"
            description={`${project.siteCount} şantiye · ${project.memberCount} üye · Sözleşme: ${
              project.contractAmount ? `${project.contractAmount} ${project.currency}` : '—'
            }`}
            action={
              canEdit && project.status !== 'ARCHIVED' && (
                <div className="flex items-center gap-2">
                  <Select
                    label=""
                    aria-label="Durum değiştir"
                    value={project.status}
                    onChange={(e) => void onStatusChange(e.target.value as ProjectStatus)}
                    options={[
                      { value: project.status, label: PROJECT_STATUS_LABELS[project.status] },
                      ...nextStatuses.map((s) => ({ value: s, label: `→ ${PROJECT_STATUS_LABELS[s]}` })),
                    ]}
                    className="min-w-40"
                  />
                  <Button
                    variant={editing ? 'secondary' : 'primary'}
                    onClick={() => setEditing((v) => !v)}
                    className="min-h-9 px-3 py-1 text-xs"
                  >
                    {editing ? 'Vazgeç' : 'Düzenle'}
                  </Button>
                </div>
              )
            }
          >
            {!editing ? (
              <dl className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase text-text-secondary">Proje Adı</dt>
                  <dd className="mt-0.5 font-medium text-text-primary">{project.name}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-text-secondary">İşveren</dt>
                  <dd className="mt-0.5 text-text-primary">{project.clientName ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-text-secondary">Sorumlu</dt>
                  <dd className="mt-0.5 text-text-primary">{project.manager?.fullName ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-text-secondary">Adres</dt>
                  <dd className="mt-0.5 text-text-primary">{project.address ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-text-secondary">Başlangıç</dt>
                  <dd className="mt-0.5 text-text-primary">{project.startDate ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-text-secondary">Planlanan Bitiş</dt>
                  <dd className="mt-0.5 text-text-primary">{project.plannedEndDate ?? '—'}</dd>
                </div>
                {project.description && (
                  <div className="md:col-span-2">
                    <dt className="text-xs font-semibold uppercase text-text-secondary">Açıklama</dt>
                    <dd className="mt-0.5 text-text-primary">{project.description}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <form onSubmit={onSave} className="grid gap-3 md:grid-cols-2">
                <TextField
                  label="Proje Adı"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
                <TextField label="İşveren" value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} />
                <TextField label="Adres" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                <Select
                  label="Sorumlu"
                  value={form.managerId}
                  onChange={(e) => setForm((f) => ({ ...f, managerId: e.target.value }))}
                  placeholder="Seçilmedi"
                  options={users.map((u) => ({ value: u.id, label: `${u.fullName} (${u.email})` }))}
                  onFocus={() => void loadUsers()}
                />
                <TextField
                  label="Başlangıç"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                />
                <TextField
                  label="Planlanan Bitiş"
                  type="date"
                  value={form.plannedEndDate}
                  onChange={(e) => setForm((f) => ({ ...f, plannedEndDate: e.target.value }))}
                />
                <TextField
                  label="Sözleşme Tutarı"
                  inputMode="decimal"
                  value={form.contractAmount}
                  onChange={(e) => setForm((f) => ({ ...f, contractAmount: e.target.value }))}
                />
                <div className="md:col-span-2">
                  {formError && (
                    <p role="alert" className="mb-2 text-xs font-medium text-danger-600">
                      {formError}
                    </p>
                  )}
                  <Button type="submit" loading={saving} loadingLabel="Kaydediliyor…">
                    Kaydet
                  </Button>
                </div>
              </form>
            )}
          </SectionCard>

          {/* ---------- Şantiyeler ---------- */}
          <SectionCard
            title={`Şantiyeler (${project.sites.length})`}
            description="Şantiyeler yalnızca bağlı oldukları projeden yönetilir."
          >
            {project.sites.length === 0 ? (
              <EmptyState
                title="Şantiye yok"
                description="Bu projeye ait şantiye/alan eklenmemiş. Aşağıdaki formla ekleyebilirsiniz."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-secondary">
                      <th scope="col" className="py-2 pr-4">Şantiye</th>
                      <th scope="col" className="py-2 pr-4">Adres</th>
                      <th scope="col" className="py-2 pr-4">Durum</th>
                      {canEdit && <th scope="col" className="py-2">İşlem</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {project.sites.map((s) => (
                      <tr key={s.id} className="border-b border-border-default/60 last:border-0">
                        <td className="py-2.5 pr-4 font-medium text-text-primary">{s.name}</td>
                        <td className="py-2.5 pr-4 text-text-secondary">{s.address ?? '—'}</td>
                        <td className="py-2.5 pr-4">
                          <StatusBadge tone={s.status === 'ACTIVE' ? 'approved' : 'draft'}>
                            {SITE_STATUS_LABELS[s.status]}
                          </StatusBadge>
                        </td>
                        {canEdit && (
                          <td className="py-2.5">
                            <Button
                              variant="secondary"
                              onClick={() => void onToggleSiteStatus(s.id, s.status)}
                              className="min-h-9 px-3 py-1 text-xs"
                            >
                              {s.status === 'ACTIVE' ? 'Pasife Al' : 'Aktifleştir'}
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {canEdit && project.status !== 'ARCHIVED' && (
              <form
                onSubmit={onAddSite}
                className="grid gap-3 border-t border-border-default pt-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
              >
                <TextField
                  label="Şantiye Adı"
                  required
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="Örn. Kazı Alanı"
                />
                <TextField label="Adres / Konum" value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
                <div>
                  {siteError && (
                    <p role="alert" className="mb-2 text-xs font-medium text-danger-600">
                      {siteError}
                    </p>
                  )}
                  <Button type="submit" loading={addingSite} loadingLabel="Ekleniyor…" className="w-full md:w-auto">
                    Şantiye Ekle
                  </Button>
                </div>
              </form>
            )}
          </SectionCard>

          {/* ---------- Üyeler ---------- */}
          <SectionCard
            title={`Proje Üyeleri (${project.members.length})`}
            description="Üyeler kapsam kontrolünde kullanılır; kapsam dışı kullanıcılar bu projeye erişemez."
          >
            {project.members.length === 0 ? (
              <EmptyState
                title="Üye yok"
                description="Projeye üye ekleyin; yalnızca üyeler bu projenin kayıtlarına erişebilir."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-secondary">
                      <th scope="col" className="py-2 pr-4">Ad Soyad</th>
                      <th scope="col" className="py-2 pr-4">E-posta</th>
                      <th scope="col" className="py-2 pr-4">Proje İçi Rol</th>
                      {canEdit && <th scope="col" className="py-2">İşlem</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {project.members.map((m) => (
                      <tr key={m.id} className="border-b border-border-default/60 last:border-0">
                        <td className="py-2.5 pr-4 font-medium text-text-primary">
                          {m.fullName}
                          {m.isManager && (
                            <span className="ml-2 rounded-md bg-accent-100 px-1.5 py-0.5 text-[10px] font-bold text-[#8a6119]">
                              Sorumlu
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-text-secondary">{m.email}</td>
                        <td className="py-2.5 pr-4">
                          {canEdit && project.status !== 'ARCHIVED' ? (
                            <select
                              aria-label={`${m.fullName} proje içi rolü`}
                              className="min-h-9 rounded-input border border-border-default bg-surface-0 px-2 text-sm"
                              value={m.scopeRole}
                              onChange={(e) => void onChangeMemberRole(m.id, e.target.value)}
                            >
                              {PROJECT_SCOPE_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {PROJECT_SCOPE_ROLE_LABELS[r]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            PROJECT_SCOPE_ROLE_LABELS[m.scopeRole]
                          )}
                        </td>
                        {canEdit && (
                          <td className="py-2.5">
                            {project.status !== 'ARCHIVED' && (
                              <Button
                                variant="secondary"
                                onClick={() => setRemoveTarget({ id: m.id, fullName: m.fullName })}
                                className="min-h-9 px-3 py-1 text-xs"
                              >
                                Çıkar
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {canEdit && project.status !== 'ARCHIVED' && (
              <form
                onSubmit={onAddMember}
                className="grid gap-3 border-t border-border-default pt-4 md:grid-cols-[2fr_1fr_auto] md:items-end"
              >
                <Select
                  label="Kullanıcı"
                  value={memberUserId}
                  onChange={(e) => setMemberUserId(e.target.value)}
                  placeholder="Seçin"
                  required
                  options={users.map((u) => ({ value: u.id, label: `${u.fullName} (${u.email})` }))}
                  onFocus={() => void loadUsers()}
                />
                <Select
                  label="Proje İçi Rol"
                  value={memberScopeRole}
                  onChange={(e) => setMemberScopeRole(e.target.value)}
                  options={PROJECT_SCOPE_ROLES.map((r) => ({ value: r, label: PROJECT_SCOPE_ROLE_LABELS[r] }))}
                />
                <div>
                  {memberError && (
                    <p role="alert" className="mb-2 text-xs font-medium text-danger-600">
                      {memberError}
                    </p>
                  )}
                  <Button type="submit" loading={addingMember} loadingLabel="Ekleniyor…" className="w-full md:w-auto">
                    Üye Ekle
                  </Button>
                </div>
              </form>
            )}
          </SectionCard>

          <p className="text-xs leading-5 text-text-secondary">
            Not: Proje arşivlendiğinde bağlı şantiye ve üye kayıtları korunur; arşivlenen proje yalnızca durum
            filtresiyle listelenir. Tüm değişiklikler denetim günlüğüne yazılır.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title="Üyeyi çıkar"
        message={`"${removeTarget?.fullName ?? ''}" bu projeden çıkarılacak. Kapsam dışı kalacağı için proje kayıtlarına erişemez.`}
        confirmLabel="Çıkar"
        destructive
        onConfirm={() => void onRemoveMemberConfirm()}
        onCancel={() => setRemoveTarget(null)}
      />
    </AppShell>
  );
}
