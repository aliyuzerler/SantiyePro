'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/shell/PageHeader';
import { SectionCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select, TextField } from '@/components/ui/Field';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/lib/auth';
import { formatDueDate, taskPriorityTone, taskStatusTone } from '@/lib/task-status';
import { ApiError, projectsApi, tasksApi, type ProjectDto, type TaskDetailDto, type TasksListResponse } from '@/lib/api';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  nextTaskStatuses,
  permissionsForRoles,
  type TaskDto,
} from '@santiyepro/contracts';

/**
 * Görevler (Faz 04 — gerçek API verisi).
 * Liste: task.view izni + proje kapsamı (API'de zorunlu);
 * oluşturma/düzenleme: task.edit, atama: task.assign (servis katmanında ayrıca denetlenir).
 * Detay drawer: durum geçişleri, kontrol listesi, yorumlar ve durum geçmişi.
 */
export default function TasksPage() {
  const { user, getToken } = useAuth();
  const token = getToken();

  const canView = permissionsForRoles(user?.roles ?? []).has('task.view');
  const canEdit = permissionsForRoles(user?.roles ?? []).has('task.edit');
  const canAssign = permissionsForRoles(user?.roles ?? []).has('task.assign');

  const [list, setList] = useState<TasksListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  // Filtreler
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sort, setSort] = useState<'createdAt' | 'dueAt' | 'priority' | 'title'>('createdAt');
  const [page, setPage] = useState(1);
  const [projects, setProjects] = useState<ProjectDto[]>([]);

  // Yeni görev formu
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [fTitle, setFTitle] = useState('');
  const [fProject, setFProject] = useState('');
  const [fPriority, setFPriority] = useState('MEDIUM');
  const [fAssignee, setFAssignee] = useState('');
  const [fDueAt, setFDueAt] = useState('');
  const [fDescription, setFDescription] = useState('');
  const [assigneeOptions, setAssigneeOptions] = useState<Array<{ id: string; fullName: string }>>([]);

  // Detay drawer
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();
  const [commentDraft, setCommentDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await tasksApi.list(token, {
        page,
        search: search || undefined,
        projectId: projectId || undefined,
        status: status || undefined,
        priority: priority || undefined,
        overdue: overdueOnly || undefined,
        sort,
        order: sort === 'dueAt' ? 'asc' : 'desc',
      });
      setList(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Oturumunuz sona erdi. Tekrar giriş yapın.');
      } else {
        setError(err instanceof Error ? err.message : 'Görevler yüklenemedi');
      }
    } finally {
      setLoading(false);
    }
  }, [token, page, search, projectId, status, priority, overdueOnly, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  // Proje filtresi seçenekleri (kapsamdaki projeler)
  useEffect(() => {
    if (!token) return;
    projectsApi
      .list(token, { sort: 'name', order: 'asc' })
      .then((res) => setProjects(res.data))
      .catch(() => setProjects([]));
  }, [token]);

  // Arama gecikmeli
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadDetail = useCallback(
    async (id: string) => {
      if (!token) return;
      setDetailLoading(true);
      setDetailError(undefined);
      try {
        setDetail(await tasksApi.get(token, id));
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : 'Görev yüklenemedi');
      } finally {
        setDetailLoading(false);
      }
    },
    [token],
  );

  function openDetail(id: string) {
    setDetailId(id);
    setDetail(null);
    setCommentDraft('');
    void loadDetail(id);
  }

  function closeDetail() {
    setDetailId(null);
    setDetail(null);
    setDetailError(undefined);
  }

  // Formda proje seçilince atama seçenekleri = proje üyeleri (kural: üye olmayana atama yok)
  async function onFormProjectChange(nextProjectId: string) {
    setFProject(nextProjectId);
    setFAssignee('');
    setAssigneeOptions([]);
    if (nextProjectId && token) {
      try {
        const detail = await projectsApi.get(token, nextProjectId);
        setAssigneeOptions(detail.members.map((m) => ({ id: m.userId, fullName: m.fullName })));
      } catch {
        setAssigneeOptions([]);
      }
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setCreating(true);
    setFormError(undefined);
    try {
      await tasksApi.create(token, {
        projectId: fProject,
        title: fTitle.trim(),
        description: fDescription.trim() || undefined,
        priority: fPriority,
        assigneeId: fAssignee || undefined,
        dueAt: fDueAt ? new Date(fDueAt).toISOString() : undefined,
      });
      setShowForm(false);
      setFTitle('');
      setFProject('');
      setFPriority('MEDIUM');
      setFAssignee('');
      setFDueAt('');
      setFDescription('');
      setAssigneeOptions([]);
      setPage(1);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Görev oluşturulamadı');
    } finally {
      setCreating(false);
    }
  }

  async function changeStatus(task: TaskDto, nextStatus: string) {
    if (!token) return;
    setBusy(true);
    try {
      await tasksApi.update(token, task.id, { status: nextStatus });
      await load();
      if (detailId === task.id) await loadDetail(task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Durum değiştirilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function toggleChecklistItem(itemIndex: number) {
    if (!token || !detail) return;
    const nextChecklist = detail.checklist.map((item, i) =>
      i === itemIndex ? { ...item, done: !item.done } : item,
    );
    setBusy(true);
    try {
      await tasksApi.update(token, detail.id, { checklist: nextChecklist, version: detail.version });
      await loadDetail(detail.id);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Kontrol listesi güncellenemedi');
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    if (!token || !detail || !commentDraft.trim()) return;
    setBusy(true);
    try {
      await tasksApi.addComment(token, detail.id, commentDraft.trim());
      setCommentDraft('');
      await loadDetail(detail.id);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Yorum eklenemedi');
    } finally {
      setBusy(false);
    }
  }

  const meta = list?.meta;

  return (
    <AppShell title="Görevler">
      <PageHeader
        title="Görevler"
        description="Görev oluşturma, atama, öncelik, termin, kontrol listesi, yorumlar ve durum geçmişi."
      />

      {canView ? (
        <div className="flex flex-col gap-4">
          {error && <ErrorState message={error} onRetry={() => void load()} />}

          <SectionCard
            title={`Görev Listesi${meta ? ` (${meta.total})` : ''}`}
            description="Yalnızca erişim kapsamınızdaki projelerin görevleri listelenir."
            action={
              canEdit && (
                <Button variant={showForm ? 'secondary' : 'primary'} onClick={() => setShowForm((v) => !v)} leading={showForm ? undefined : '+'}>
                  {showForm ? 'Vazgeç' : 'Yeni Görev'}
                </Button>
              )
            }
          >
            {/* Filtre satırı */}
            <div className="grid gap-3 md:grid-cols-4">
              <TextField
                label="Ara"
                placeholder="Görev başlığı"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
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
                options={TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))}
              />
              <Select
                label="Öncelik"
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value);
                  setPage(1);
                }}
                placeholder="Tümü"
                options={TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))}
              />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={overdueOnly}
                  onChange={(e) => {
                    setOverdueOnly(e.target.checked);
                    setPage(1);
                  }}
                  className="h-4 w-4"
                />
                Sadece geciken görevler
              </label>
              <div className="w-44">
                <Select
                  label="Sırala"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as 'createdAt' | 'dueAt' | 'priority' | 'title')}
                  options={[
                    { value: 'createdAt', label: 'Oluşturma tarihi' },
                    { value: 'dueAt', label: 'Termin (yakın önce)' },
                    { value: 'priority', label: 'Öncelik' },
                    { value: 'title', label: 'Başlık' },
                  ]}
                />
              </div>
            </div>

            {showForm && canEdit && (
              <form onSubmit={onCreate} className="grid gap-3 rounded-card border border-border-default bg-surface-50 p-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <TextField
                    label="Görev Başlığı"
                    required
                    value={fTitle}
                    onChange={(e) => setFTitle(e.target.value)}
                    helpText="En az 3 karakter. Örn. 'Zemin kat beton döküm planı'."
                  />
                </div>
                <Select
                  label="Proje"
                  required
                  value={fProject}
                  onChange={(e) => void onFormProjectChange(e.target.value)}
                  placeholder="Proje seçin"
                  options={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                />
                <Select
                  label="Öncelik"
                  value={fPriority}
                  onChange={(e) => setFPriority(e.target.value)}
                  options={TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))}
                />
                <Select
                  label="Atanan Kişi"
                  value={fAssignee}
                  onChange={(e) => setFAssignee(e.target.value)}
                  placeholder={canAssign ? 'Seçilmedi' : 'Atama yetkiniz yok'}
                  disabled={!canAssign}
                  options={assigneeOptions.map((u) => ({ value: u.id, label: u.fullName }))}
                />
                <TextField
                  label="Termin"
                  type="datetime-local"
                  value={fDueAt}
                  onChange={(e) => setFDueAt(e.target.value)}
                />
                <div className="md:col-span-2">
                  <TextField
                    label="Açıklama"
                    value={fDescription}
                    onChange={(e) => setFDescription(e.target.value)}
                  />
                </div>
                <div className="md:col-span-2">
                  {formError && (
                    <p role="alert" className="mb-2 text-xs font-medium text-danger-600">
                      {formError}
                    </p>
                  )}
                  <Button type="submit" disabled={!fProject} loading={creating} loadingLabel="Oluşturuluyor…">
                    Görev Oluştur
                  </Button>
                </div>
              </form>
            )}

            {loading ? (
              <LoadingSkeleton rows={5} />
            ) : list && list.data.length === 0 ? (
              <EmptyState
                title="Görüntülenecek görev yok"
                description="Erişim kapsamınızda görev bulunmuyor. Filtreleri temizleyin veya yeni görev oluşturun."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default text-left text-xs uppercase tracking-wide text-text-secondary">
                      <th scope="col" className="py-2 pr-4">Görev</th>
                      <th scope="col" className="py-2 pr-4">Proje</th>
                      <th scope="col" className="py-2 pr-4">Atanan</th>
                      <th scope="col" className="py-2 pr-4">Öncelik</th>
                      <th scope="col" className="py-2 pr-4">Termin</th>
                      <th scope="col" className="py-2 pr-4">Durum</th>
                      <th scope="col" className="py-2">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list?.data.map((t) => (
                      <tr key={t.id} className="border-b border-border-default/60 last:border-0">
                        <td className="py-2.5 pr-4 font-medium text-text-primary">
                          {t.title}
                          {t.overdue && (
                            <span className="ml-2 inline-block rounded-full bg-danger-50 px-2 py-0.5 text-xs font-bold text-danger-700">
                              Gecikmiş
                            </span>
                          )}
                          {t.commentCount > 0 && (
                            <span className="ml-2 text-xs text-text-secondary">💬 {t.commentCount}</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-text-secondary">{t.projectCode}</td>
                        <td className="py-2.5 pr-4 text-text-secondary">{t.assignee?.fullName ?? '—'}</td>
                        <td className="py-2.5 pr-4">
                          <StatusBadge tone={taskPriorityTone(t.priority)}>{TASK_PRIORITY_LABELS[t.priority]}</StatusBadge>
                        </td>
                        <td className="py-2.5 pr-4 text-text-secondary">{formatDueDate(t.dueAt)}</td>
                        <td className="py-2.5 pr-4">
                          <StatusBadge tone={taskStatusTone(t.status)}>{TASK_STATUS_LABELS[t.status]}</StatusBadge>
                        </td>
                        <td className="py-2.5 whitespace-nowrap">
                          <Button variant="secondary" onClick={() => openDetail(t.id)} className="min-h-9 px-3 py-1 text-xs">
                            Detay
                          </Button>
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
            Güvenlik: Görevler yalnızca erişim kapsamınızdaki projelerde görüntülenir; kapsam dışı görevler API
            tarafından 404 ile gizlenir (IDOR koruması). Atanan kişi kendi görevinin durumunu değiştirebilir.
          </p>
        </div>
      ) : (
        <ErrorState
          title="Yetkisiz erişim"
          message="Bu sayfayı görüntülemek için gerekli izniniz yok (task.view). Firma yöneticinize başvurun."
        />
      )}

      {/* Detay drawer */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={closeDetail}>
          <aside
            role="dialog"
            aria-label="Görev detayı"
            className="h-full w-full max-w-xl overflow-y-auto bg-surface-0 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading && <LoadingSkeleton rows={6} />}
            {detailError && <ErrorState message={detailError} onRetry={() => void loadDetail(detailId)} />}
            {!detailLoading && !detailError && detail && (
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-brand-900">{detail.title}</h2>
                    <p className="mt-1 text-xs text-text-secondary">
                      {detail.projectCode} · {detail.projectName}
                      {detail.siteName ? ` · ${detail.siteName}` : ''}
                    </p>
                  </div>
                  <Button variant="secondary" onClick={closeDetail} className="min-h-9 px-3 py-1 text-xs">
                    Kapat
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={taskStatusTone(detail.status)}>{TASK_STATUS_LABELS[detail.status]}</StatusBadge>
                  <StatusBadge tone={taskPriorityTone(detail.priority)}>{TASK_PRIORITY_LABELS[detail.priority]}</StatusBadge>
                  {detail.overdue && (
                    <span className="rounded-full bg-danger-50 px-2 py-0.5 text-xs font-bold text-danger-700">Gecikmiş</span>
                  )}
                  <span className="text-xs text-text-secondary">
                    Atanan: {detail.assignee?.fullName ?? '—'} · Termin: {formatDueDate(detail.dueAt)}
                  </span>
                </div>

                {detail.description && (
                  <p className="rounded-card border border-border-default bg-surface-50 p-3 text-sm text-text-primary">
                    {detail.description}
                  </p>
                )}

                {/* Durum geçişleri — atanan kişi veya task.edit yetkilisi */}
                {(canEdit || detail.assigneeId === user?.id) && nextTaskStatuses(detail.status).length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-text-primary">Durum Değiştir</h3>
                    <div className="flex flex-wrap gap-2">
                      {nextTaskStatuses(detail.status).map((s) => (
                        <Button
                          key={s}
                          variant={s === 'CANCELLED' ? 'secondary' : 'primary'}
                          disabled={busy}
                          onClick={() => void changeStatus(detail, s)}
                          className="min-h-9 px-3 py-1 text-xs"
                        >
                          {TASK_STATUS_LABELS[s]}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Kontrol listesi */}
                {detail.checklist.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-text-primary">
                      Kontrol Listesi ({detail.checklist.filter((c) => c.done).length}/{detail.checklist.length})
                    </h3>
                    <ul className="flex flex-col gap-1">
                      {detail.checklist.map((item, i) => (
                        <li key={item.id}>
                          <label className="flex items-center gap-2 text-sm text-text-primary">
                            <input
                              type="checkbox"
                              checked={item.done}
                              disabled={busy || !(canEdit || detail.assigneeId === user?.id)}
                              onChange={() => void toggleChecklistItem(i)}
                              className="h-4 w-4"
                            />
                            <span className={item.done ? 'line-through text-text-secondary' : ''}>{item.label}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Yorumlar */}
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-text-primary">Yorumlar ({detail.comments.length})</h3>
                  <ul className="flex flex-col gap-2">
                    {detail.comments.map((c) => (
                      <li key={c.id} className="rounded-card border border-border-default bg-surface-50 p-3 text-sm">
                        <p className="text-text-primary">{c.body}</p>
                        <p className="mt-1 text-xs text-text-secondary">
                          {c.userFullName} · {formatDueDate(c.createdAt)}
                        </p>
                      </li>
                    ))}
                    {detail.comments.length === 0 && <li className="text-xs text-text-secondary">Henüz yorum yok.</li>}
                  </ul>
                  <div className="mt-2 flex flex-col gap-2">
                    <TextField
                      label="Yorum Ekle"
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder="Saha notu…"
                    />
                    <Button onClick={() => void submitComment()} disabled={busy || !commentDraft.trim()} className="min-h-9 self-start px-3 py-1 text-xs">
                      Yorum Gönder
                    </Button>
                  </div>
                </div>

                {/* Durum geçmişi */}
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-text-primary">Durum Geçmişi</h3>
                  <ol className="flex flex-col gap-1 text-xs text-text-secondary">
                    {detail.statusHistory.map((h) => (
                      <li key={h.id}>
                        {h.fromStatus ? `${TASK_STATUS_LABELS[h.fromStatus]} → ` : 'Oluşturma: '}
                        <span className="font-semibold text-text-primary">{TASK_STATUS_LABELS[h.toStatus]}</span>
                        {' · '}
                        {h.changedByFullName} · {formatDueDate(h.changedAt)}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </AppShell>
  );
}
