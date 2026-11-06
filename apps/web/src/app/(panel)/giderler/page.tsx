'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
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
import { expenseStatusLabel, expenseStatusTone, formatDateTimeTr, formatDateTr, formatMoneyTr } from '@/lib/finance';
import { ApiError, financeApi, projectsApi, type PaginatedResponse, type SaveExpenseInput } from '@/lib/api';
import {
  DEFAULT_CURRENCIES,
  EXPENSE_STATUSES,
  EXPENSE_STATUS_LABELS,
  permissionsForRoles,
  type ExpenseCategoryDto,
  type ExpenseDto,
  type ProjectDto,
} from '@santiyepro/contracts';

/**
 * Giderler (Faz 08 — gerçek API verisi).
 *
 * Kurallar (prompts/phase-08-development.md, docs/06):
 * - expense.create: sayfa erişimi + oluşturma/düzenleme/gönderme.
 * - expense.approve: onay/red (firma yöneticisi, muhasebe).
 * - Tutarlar SAĞA hizalı, para birimi açık; taslak/onay durumu rozetle belirgin.
 * - Vergi oranı opsiyoneldir: boş bırakılırsa hiçbir varsayılan oran eklenmez.
 */
export default function ExpensesPage() {
  const { user, getToken } = useAuth();
  const token = getToken() ?? '';

  const canView = permissionsForRoles(user?.roles ?? []).has('expense.create');
  const canApprove = permissionsForRoles(user?.roles ?? []).has('expense.approve');

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [categories, setCategories] = useState<ExpenseCategoryDto[]>([]);
  const [expenses, setExpenses] = useState<PaginatedResponse<ExpenseDto> | null>(null);

  const [filterProject, setFilterProject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  // Yeni gider diyaloğu
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<SaveExpenseInput & { taxRate: string; vendorName: string }>({
    projectId: '',
    categoryId: '',
    vendorName: '',
    description: '',
    amount: '',
    currency: 'TRY',
    taxRate: '',
    expenseDate: new Date().toISOString().slice(0, 10),
  });
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  // Red diyaloğu
  const [rejectTarget, setRejectTarget] = useState<ExpenseDto | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ExpenseDto | null>(null);

  /** Eski yanıt yarışına karşı istek sırası: yalnızca en son istek durumu yazar. */
  const seqRef = useRef(0);

  const reload = useCallback(async () => {
    if (!token) return;
    const seq = ++seqRef.current;
    setError(undefined);
    try {
      // Kategori ve proje listesi her zaman yüklenir (form için)
      const [catRes, prjRes] = await Promise.all([
        financeApi.listCategories(token, { isActive: 'true' }),
        projectsApi.list(token, { sort: 'name', order: 'asc', pageSize: 100 }),
      ]);
      if (seq !== seqRef.current) return;
      setCategories(catRes.data);
      setProjects(prjRes.data);

      // Gider listesi en az bir filtre ister (finans verisi koruması, docs/08):
      // filtre yoksa istek hiç atılmaz, kullanıcıya bilgi gösterilir.
      if (!filterProject && !filterStatus) {
        setExpenses(null);
        return;
      }
      const listRes = await financeApi.listExpenses(token, {
        ...(filterProject ? { projectId: filterProject } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
      });
      if (seq !== seqRef.current) return;
      setExpenses(listRes);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(e instanceof ApiError ? e.message : 'Gider listesi yüklenemedi');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [token, filterProject, filterStatus]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(undefined);
    if (!form.projectId || !form.categoryId || !form.description || !form.amount) {
      setFormError('Proje, kategori, açıklama ve tutar zorunludur');
      return;
    }
    setSaving(true);
    try {
      await financeApi.createExpense(token, {
        ...form,
        vendorName: form.vendorName || undefined,
        taxRate: form.taxRate ? form.taxRate : null,
      });
      setDialogOpen(false);
      setNotice('Gider taslak olarak kaydedildi');
      setForm({ ...form, description: '', amount: '', taxRate: '', vendorName: '' });
      await reload();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Gider kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setError(undefined);
    try {
      await fn();
      setNotice(message);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'İşlem tamamlanamadı');
    }
  };

  if (!canView) {
    return (
      <AppShell title="Giderler">
        <PageHeader title="Giderler" description="Gider kayıtları ve onay akışı" />
        <ErrorState title="Erişim yok" message="Bu sayfa expense.create izni gerektirir." />
      </AppShell>
    );
  }

  return (
    <AppShell title="Giderler">
      <PageHeader
        title="Giderler"
        description="Proje giderleri — taslak, onay bekleyen, onaylanan ve reddedilen kayıtlar"
        action={undefined}
      />
      {notice ? (
        <p role="status" data-testid="expense-notice" className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}
      {error ? <ErrorState message={error} onRetry={() => void reload()} /> : null}

      <SectionCard
        title="Gider kayıtları"
        description="Tutarlar sağa hizalı ve para birimi açıktır"
        action={
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            + Yeni Gider
          </Button>
        }
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-52">
            <Select
              label="Proje"
              id="gider-proje-filtre"
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              options={[
                { value: '', label: 'Tümü (durumla birlikte kullanın)' },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>
          <div className="min-w-44">
            <Select
              label="Durum"
              id="gider-durum-filtre"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              options={[
                { value: '', label: 'Tümü' },
                ...EXPENSE_STATUSES.map((st) => ({ value: st, label: EXPENSE_STATUS_LABELS[st] })),
              ]}
            />
          </div>
          <Button variant="secondary" onClick={() => void reload()}>
            Filtrele
          </Button>
        </div>

        {loading ? (
          <LoadingSkeleton rows={5} />
        ) : !expenses || expenses.data.length === 0 ? (
          <EmptyState title="Kayıt yok" description="Bu filtreyle eşleşen gider bulunmuyor." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="expenses-table">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="py-2 pr-3 font-medium">Tarih</th>
                  <th className="py-2 pr-3 font-medium">Kategori</th>
                  <th className="py-2 pr-3 font-medium">Tedarikçi / Açıklama</th>
                  <th className="py-2 pr-3 font-medium">Proje</th>
                  <th className="py-2 pr-3 text-right font-medium">Tutar</th>
                  <th className="py-2 pr-3 text-right font-medium">Vergi</th>
                  <th className="py-2 pr-3 font-medium">Durum</th>
                  <th className="py-2 font-medium">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {expenses.data.map((exp) => (
                  <tr key={exp.id} className="border-b last:border-0" data-testid={`expense-row-${exp.id}`}>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDateTr(exp.expenseDate)}</td>
                    <td className="py-2 pr-3">{exp.categoryName}</td>
                    <td className="py-2 pr-3">
                      {exp.vendorName ? <span className="font-medium">{exp.vendorName}</span> : null}
                      <span className="block text-slate-500">{exp.description}</span>
                    </td>
                    <td className="py-2 pr-3">{exp.projectName}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                      {formatMoneyTr(exp.amount, exp.currency)}
                      {exp.totalWithTax ? (
                        <span className="block text-xs font-normal text-slate-500">
                          vergi dahil {formatMoneyTr(exp.totalWithTax, exp.currency)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {exp.taxRate ? `%${exp.taxRate.replace('.', ',')}` : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge tone={expenseStatusTone(exp.status)}>{expenseStatusLabel(exp.status)}</StatusBadge>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {exp.status === 'DRAFT' ? (
                          <>
                            <Button
                              variant="secondary"
                              onClick={() =>
                                void act(
                                  () => financeApi.submitExpense(token, exp.id),
                                  'Gider onaya gönderildi',
                                )
                              }
                            >
                              Gönder
                            </Button>
                            <Button variant="tertiary" onClick={() => setDeleteTarget(exp)}>
                              Sil
                            </Button>
                          </>
                        ) : null}
                        {exp.status === 'PENDING' && canApprove ? (
                          <>
                            <Button
                              variant="primary"
                              onClick={() =>
                                void act(() => financeApi.approveExpense(token, exp.id), 'Gider onaylandı')
                              }
                            >
                              Onayla
                            </Button>
                            <Button variant="destructive" onClick={() => setRejectTarget(exp)}>
                              Reddet
                            </Button>
                          </>
                        ) : null}
                        {exp.status === 'APPROVED' ? (
                          <span className="text-xs text-slate-500">
                            {exp.approvedBy ? `${exp.approvedBy.fullName} • ${formatDateTimeTr(exp.approvedAt ?? '')}` : ''}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Yeni gider diyaloğu */}
      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Yeni gider">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold">Yeni Gider</h2>
            <form onSubmit={submitForm} className="space-y-3">
              <Select
                label="Proje"
                id="gider-proje"
                required
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                options={[
                  { value: '', label: 'Seçin' },
                  ...projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              <Select
                label="Kategori"
                id="gider-kategori"
                required
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                options={[
                  { value: '', label: 'Seçin' },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
              <TextField
                label="Tedarikçi"
                id="gider-tedarikci"
                value={form.vendorName}
                onChange={(e) => setForm({ ...form, vendorName: e.target.value })}
                helpText="Opsiyonel"
              />
              <TextField
                label="Açıklama"
                id="gider-aciklama"
                required
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Tutar"
                  id="gider-tutar"
                  required
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  helpText="En fazla 2 ondalık, örn. 1250.50"
                />
                <Select
                  label="Para birimi"
                  id="gider-parabirimi"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  options={DEFAULT_CURRENCIES.map((c) => ({ value: c, label: c }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Vergi oranı (%)"
                  id="gider-vergi"
                  inputMode="decimal"
                  value={form.taxRate}
                  onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
                  helpText="Opsiyonel — boş bırakılırsa vergi hesaplanmaz"
                />
                <TextField
                  label="Gider tarihi"
                  id="gider-tarih"
                  required
                  type="date"
                  value={form.expenseDate}
                  onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                />
              </div>
              {formError ? (<p className="text-sm text-rose-600" data-testid="expense-form-error">{formError}</p>) : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="tertiary" onClick={() => setDialogOpen(false)}>
                  Vazgeç
                </Button>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Kaydediliyor…' : 'Taslak Kaydet'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Red gerekçesi diyaloğu */}
      <ConfirmDialog
        open={Boolean(rejectTarget)}
        title="Gideri reddet"
        message={rejectTarget ? `${rejectTarget.description} — red gerekçesi girin (en az 3 karakter):` : ''}
        confirmLabel="Reddet"
        cancelLabel="Vazgeç"
        destructive
        onConfirm={() => {
          if (rejectTarget && rejectReason.trim().length >= 3) {
            void act(() => financeApi.rejectExpense(token, rejectTarget.id, rejectReason.trim()), 'Gider reddedildi');
          }
          setRejectTarget(null);
          setRejectReason('');
        }}
        onCancel={() => {
          setRejectTarget(null);
          setRejectReason('');
        }}
      >
        {rejectTarget ? (
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Red gerekçesi"
            aria-label="Red gerekçesi"
          />
        ) : null}
      </ConfirmDialog>

      {/* Taslak silme onayı */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Taslak gideri sil"
        message={deleteTarget ? `${deleteTarget.description} (${formatMoneyTr(deleteTarget.amount, deleteTarget.currency)}) silinsin mi?` : ''}
        confirmLabel="Sil"
        cancelLabel="Vazgeç"
        destructive
        onConfirm={() => {
          if (deleteTarget) void act(() => financeApi.deleteExpense(token, deleteTarget.id), 'Taslak gider silindi');
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}
