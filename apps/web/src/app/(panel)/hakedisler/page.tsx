'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/shell/PageHeader';
import { SectionCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select, TextField, TextArea } from '@/components/ui/Field';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/lib/auth';
import { claimStatusLabel, claimStatusTone, formatDateTr, formatMoneyTr, formatQtyTr } from '@/lib/finance';
import { ApiError, financeApi, projectsApi, type ClaimLineInput, type PaginatedResponse } from '@/lib/api';
import {
  permissionsForRoles,
  type ClaimCalculationDto,
  type ContractItemDto,
  type ProjectDto,
  type ProgressClaimDto,
} from '@santiyepro/contracts';

/**
 * Hakedişler (Faz 08 — gerçek API verisi).
 *
 * Kurallar (prompts/phase-08-development.md, docs/04, docs/06):
 * - claim.prepare: hazırlama + görüntüleme; claim.approve: onay/red.
 * - Dönem tutarı = dönem miktarı × SNAPSHOT birim fiyat; formül açık yazılır.
 * - Onaylı hakediş değiştirilemez (satır/toplam dondurulur); iptal yalnızca
 *   taslak/bekleyen kayıtta, gerekçe ile.
 * - Tutarlar sağa hizalı; para birimi kalem parasıyla açık yazılır.
 */
type Tab = 'claims' | 'items';

interface LineDraft extends ClaimLineInput {
  key: string;
}

export default function ProgressClaimsPage() {
  const { user, getToken } = useAuth();
  const token = getToken() ?? '';

  const canView = permissionsForRoles(user?.roles ?? []).has('claim.prepare');
  const canApprove = permissionsForRoles(user?.roles ?? []).has('claim.approve');

  const [tab, setTab] = useState<Tab>('claims');
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectId, setProjectId] = useState('');
  const [claims, setClaims] = useState<PaginatedResponse<ProgressClaimDto> | null>(null);
  const [items, setItems] = useState<ContractItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  // Yeni hakediş diyaloğu
  const [dialogOpen, setDialogOpen] = useState(false);
  const [claimNo, setClaimNo] = useState('1');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [deduction, setDeduction] = useState('0');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  // Hesap önizlemesi + işlem hedefleri
  const [calculation, setCalculation] = useState<ClaimCalculationDto | null>(null);
  const [calcClaimNo, setCalcClaimNo] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ProgressClaimDto | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelTarget, setCancelTarget] = useState<ProgressClaimDto | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProgressClaimDto | null>(null);

  // Yeni sözleşme kalemi diyaloğu
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [itemForm, setItemForm] = useState({ code: '', description: '', unit: 'M2', contractQuantity: '', unitPrice: '' });
  const [itemFormError, setItemFormError] = useState<string>();

  /** Eski yanıt yarışına karşı istek sırası: yalnızca en son istek durumu yazar. */
  const seqRef = useRef(0);

  const reload = useCallback(async () => {
    if (!token) return;
    // Proje listesi seçimden bağımsız yüklenir (kullanıcı proje seçebilsin).
    const prjRes = await projectsApi.list(token, { sort: 'name', order: 'asc', pageSize: 100 });
    setProjects(prjRes.data);

    if (!projectId) {
      setClaims(null);
      setItems([]);
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    setError(undefined);
    try {
      const [claimRes, itemRes] = await Promise.all([
        financeApi.listClaims(token, projectId),
        financeApi.listContractItems(token, projectId, { pageSize: 100 }),
      ]);
      if (seq !== seqRef.current) return;
      setClaims(claimRes);
      setItems(itemRes.data);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(e instanceof ApiError ? e.message : 'Hakediş listesi yüklenemedi');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [token, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const nextClaimNo = useMemo(() => {
    if (!claims?.data.length) return 1;
    return Math.max(...claims.data.map((c) => c.claimNo)) + 1;
  }, [claims]);

  const openClaimDialog = () => {
    setClaimNo(String(nextClaimNo));
    setPeriodStart('');
    setPeriodEnd('');
    setNotes('');
    setDeduction('0');
    setLines([{ key: crypto.randomUUID(), contractItemId: '', previousQuantity: '0', periodQuantity: '' }]);
    setFormError(undefined);
    setDialogOpen(true);
  };

  const submitClaimForm = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(undefined);
    const validLines = lines.filter((l) => l.contractItemId && l.periodQuantity);
    if (!claimNo || !periodStart || !periodEnd || validLines.length === 0) {
      setFormError('Dönem ve en az bir satır (kalem + dönem miktarı) zorunludur');
      return;
    }
    if (periodEnd < periodStart) {
      setFormError('Dönem bitişi başlangıçtan önce olamaz');
      return;
    }
    setSaving(true);
    try {
      await financeApi.createClaim(token, {
        projectId,
        claimNo: Number(claimNo),
        periodStart,
        periodEnd,
        notes: notes || undefined,
        deductionTotal: deduction || '0',
        lines: validLines.map(({ contractItemId, previousQuantity, periodQuantity: q }) => ({
          contractItemId,
          previousQuantity: previousQuantity || '0',
          periodQuantity: q,
        })),
      });
      setDialogOpen(false);
      setNotice('Hakediş taslak olarak oluşturuldu');
      await reload();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Hakediş oluşturulamadı');
    } finally {
      setSaving(false);
    }
  };

  const showCalculation = async (claim: ProgressClaimDto) => {
    setError(undefined);
    try {
      const res = await financeApi.calculateClaim(token, claim.id);
      setCalculation(res);
      setCalcClaimNo(claim.claimNo);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Hesaplama alınamadı');
    }
  };

  const submitItemForm = async (event: FormEvent) => {
    event.preventDefault();
    setItemFormError(undefined);
    if (!itemForm.description || !itemForm.contractQuantity || !itemForm.unitPrice) {
      setItemFormError('Açıklama, sözleşme miktarı ve birim fiyat zorunludur');
      return;
    }
    setSaving(true);
    try {
      await financeApi.createContractItem(token, {
        projectId,
        code: itemForm.code || undefined,
        description: itemForm.description,
        unit: itemForm.unit,
        contractQuantity: itemForm.contractQuantity,
        unitPrice: itemForm.unitPrice,
      });
      setItemDialogOpen(false);
      setItemForm({ code: '', description: '', unit: 'M2', contractQuantity: '', unitPrice: '' });
      setNotice('Sözleşme kalemi eklendi');
      await reload();
    } catch (e) {
      setItemFormError(e instanceof ApiError ? e.message : 'Kalem eklenemedi');
    } finally {
      setSaving(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setError(undefined);
    try {
      await fn();
      setNotice(message);
      setCalculation(null);
      setCalcClaimNo(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'İşlem tamamlanamadı');
    }
  };

  if (!canView) {
    return (
      <AppShell title="Hakedişler">
        <PageHeader title="Hakedişler" description="Sözleşme kalemleri ve dönemsel hakedişler" />
        <ErrorState title="Erişim yok" message="Bu sayfa claim.prepare izni gerektirir." />
      </AppShell>
    );
  }

  return (
    <AppShell title="Hakedişler">
      <PageHeader
        title="Hakedişler"
        description="Sözleşme kalemleri, dönemsel miktar/tutar akışı, kesinti ve net tutar"
        action={undefined}
      />
      {notice ? (
        <p role="status" data-testid="claim-notice" className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}
      {error ? <ErrorState message={error} onRetry={() => void reload()} /> : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-64">
          <Select
            label="Proje"
            id="hakedis-proje"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            options={[{ value: '', label: 'Seçin' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </div>
      </div>

      <div className="mb-4 flex gap-2" role="tablist" aria-label="Hakediş bölümleri">
        {(
          [
            ['claims', 'Hakedişler'],
            ['items', 'Sözleşme Kalemleri'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              tab === key ? 'bg-brand-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!projectId ? (
        <EmptyState title="Proje seçin" description="Hakedişler proje kapsamında listelenir." />
      ) : loading ? (
        <LoadingSkeleton rows={5} />
      ) : tab === 'claims' ? (
        <SectionCard
          title="Dönemsel hakedişler"
          description="Net tutar = brüt − kesinti; onaylı kayıtlar değişmez"
          action={
            <Button variant="primary" onClick={openClaimDialog}>
              + Yeni Hakediş
            </Button>
          }
        >
          {!claims || claims.data.length === 0 ? (
            <EmptyState title="Hakediş yok" description="Bu proje için hakediş girilmemiş." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="claims-table">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="py-2 pr-3 font-medium">No</th>
                    <th className="py-2 pr-3 font-medium">Dönem</th>
                    <th className="py-2 pr-3 text-right font-medium">Önceki</th>
                    <th className="py-2 pr-3 text-right font-medium">Brüt</th>
                    <th className="py-2 pr-3 text-right font-medium">Kesinti</th>
                    <th className="py-2 pr-3 text-right font-medium">Net</th>
                    <th className="py-2 pr-3 font-medium">Durum</th>
                    <th className="py-2 font-medium">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.data.map((claim) => (
                    <tr key={claim.id} className="border-b last:border-0" data-testid={`claim-row-${claim.claimNo}`}>
                      <td className="py-2 pr-3 font-semibold">#{claim.claimNo}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatDateTr(claim.periodStart)} – {formatDateTr(claim.periodEnd)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatMoneyTr(claim.previousTotal, 'TRY')}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatMoneyTr(claim.grossTotal, 'TRY')}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatMoneyTr(claim.deductionTotal, 'TRY')}</td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatMoneyTr(claim.netTotal, 'TRY')}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge tone={claimStatusTone(claim.status)}>{claimStatusLabel(claim.status)}</StatusBadge>
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          <Button variant="secondary" onClick={() => void showCalculation(claim)}>
                            Önizle
                          </Button>
                          {claim.status === 'DRAFT' ? (
                            <>
                              <Button
                                variant="primary"
                                onClick={() => void act(() => financeApi.submitClaim(token, claim.id), 'Hakediş onaya gönderildi')}
                              >
                                Gönder
                              </Button>
                              <Button variant="tertiary" onClick={() => setDeleteTarget(claim)}>
                                Sil
                              </Button>
                            </>
                          ) : null}
                          {claim.status === 'PENDING' && canApprove ? (
                            <>
                              <Button variant="primary" onClick={() => void act(() => financeApi.approveClaim(token, claim.id), 'Hakediş onaylandı')}>
                                Onayla
                              </Button>
                              <Button variant="destructive" onClick={() => setRejectTarget(claim)}>
                                Reddet
                              </Button>
                            </>
                          ) : null}
                          {claim.status === 'DRAFT' || claim.status === 'PENDING' ? (
                            <Button variant="tertiary" onClick={() => setCancelTarget(claim)}>
                              İptal
                            </Button>
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
      ) : (
        <SectionCard
          title="Sözleşme kalemleri"
          description="Fiyat değişikliği yalnızca yeni hakedişleri etkiler (snapshot)"
          action={
            <Button variant="primary" onClick={() => setItemDialogOpen(true)}>
              + Kalem Ekle
            </Button>
          }
        >
          {items.length === 0 ? (
            <EmptyState title="Kalem yok" description="Bu projeye henüz sözleşme kalemi eklenmemiş." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="py-2 pr-3 font-medium">Kod</th>
                    <th className="py-2 pr-3 font-medium">Açıklama</th>
                    <th className="py-2 pr-3 font-medium">Birim</th>
                    <th className="py-2 pr-3 text-right font-medium">Sözleşme Miktarı</th>
                    <th className="py-2 pr-3 text-right font-medium">Birim Fiyatı</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">{item.code ?? '—'}</td>
                      <td className="py-2 pr-3">{item.description}</td>
                      <td className="py-2 pr-3">{item.unit}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatQtyTr(item.contractQuantity)}</td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatMoneyTr(item.unitPrice, item.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Hesap önizlemesi paneli */}
      {calculation ? (
        <div data-testid="claim-calculation">
        <SectionCard
          title={calcClaimNo ? `Hesap Önizlemesi — #${calcClaimNo}` : 'Hesap Önizlemesi'}
          description={calculation.recalculated ? 'Taslak değerlerden yeniden hesaplandı' : 'Saklanan (donmuş) değerler gösteriliyor'}
        >
          <p className="mb-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">{calculation.formulaDescription}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="py-2 pr-3 font-medium">Kalem</th>
                  <th className="py-2 pr-3 font-medium">Birim</th>
                  <th className="py-2 pr-3 text-right font-medium">Önceki</th>
                  <th className="py-2 pr-3 text-right font-medium">Dönem</th>
                  <th className="py-2 pr-3 text-right font-medium">Kümülatif</th>
                  <th className="py-2 pr-3 text-right font-medium">Birim Fiyat (snapshot)</th>
                  <th className="py-2 pr-3 text-right font-medium">Dönem Tutarı</th>
                </tr>
              </thead>
              <tbody>
                {calculation.lines.map((line) => (
                  <tr key={line.id || line.contractItemId} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      {line.code ? <span className="font-medium">{line.code}</span> : null} {line.description}
                      {line.isOver ? <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Sözleşme aşımı</span> : null}
                    </td>
                    <td className="py-2 pr-3">{line.unit}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatQtyTr(line.previousQuantity)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatQtyTr(line.periodQuantity)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatQtyTr(line.cumulativeQuantity)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMoneyTr(line.unitPriceSnapshot, 'TRY')}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatMoneyTr(line.lineAmount, 'TRY')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-semibold">
                  <td className="py-2 pr-3" colSpan={6}>
                    Brüt toplam
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatMoneyTr(calculation.totals.grossTotal, 'TRY')}</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3" colSpan={6}>
                    Kesintiler
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">−{formatMoneyTr(calculation.totals.deductionTotal, 'TRY')}</td>
                </tr>
                <tr className="font-bold">
                  <td className="py-2 pr-3" colSpan={6}>
                    NET TUTAR
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatMoneyTr(calculation.totals.netTotal, 'TRY')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="tertiary"
              onClick={() => {
                setCalculation(null);
                setCalcClaimNo(null);
              }}
            >
              Kapat
            </Button>
          </div>
        </SectionCard>
        </div>
      ) : null}

      {/* Yeni hakediş diyaloğu */}
      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Yeni hakediş">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-1 text-lg font-semibold">Yeni Hakediş</h2>
            <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Formül: Dönem tutarı = dönem miktarı × birim fiyat (snapshot). Önceki miktar, bu kalemdeki son hakedişin kümülatifiyle uyumlu olmalıdır.
            </p>
            <form onSubmit={submitClaimForm} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <TextField label="Hakediş No" id="claim-no" required inputMode="numeric" value={claimNo} onChange={(e) => setClaimNo(e.target.value)} />
                <TextField label="Dönem Başlangıcı" id="claim-start" required type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                <TextField label="Dönem Bitişi" id="claim-end" required type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
              {lines.map((line, index) => (
                <div key={line.key} className="grid grid-cols-[1fr_auto] items-end gap-3 rounded-lg border border-slate-200 p-3">
                  <div className="grid grid-cols-3 gap-3">
                    <Select
                      label={`Kalem ${index + 1}`}
                      id={`line-item-${index}`}
                      value={line.contractItemId}
                      onChange={(e) => setLines(lines.map((l) => (l.key === line.key ? { ...l, contractItemId: e.target.value } : l)))}
                      options={[
                        { value: '', label: 'Seçin' },
                        ...items.map((i) => ({ value: i.id, label: `${i.code ? `${i.code} — ` : ''}${i.description}` })),
                      ]}
                    />
                    <TextField
                      label="Önceki Miktar"
                      aria-label={`Önceki miktar ${index + 1}`}
                      id={`line-prev-${index}`}
                      inputMode="decimal"
                      value={line.previousQuantity}
                      onChange={(e) => setLines(lines.map((l) => (l.key === line.key ? { ...l, previousQuantity: e.target.value } : l)))}
                    />
                    <TextField
                      label="Dönem Miktarı"
                      aria-label={`Dönem miktarı ${index + 1}`}
                      id={`line-period-${index}`}
                      required
                      inputMode="decimal"
                      value={line.periodQuantity}
                      onChange={(e) => setLines(lines.map((l) => (l.key === line.key ? { ...l, periodQuantity: e.target.value } : l)))}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="tertiary"
                    onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
                    aria-label={`Satır ${index + 1} kaldır`}
                  >
                    Kaldır
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setLines([...lines, { key: crypto.randomUUID(), contractItemId: '', previousQuantity: '0', periodQuantity: '' }])}
              >
                + Satır Ekle
              </Button>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Kesinti Toplamı"
                  id="claim-deduction"
                  inputMode="decimal"
                  value={deduction}
                  onChange={(e) => setDeduction(e.target.value)}
                  helpText="Brütü aşamaz; 0 geçerli"
                />
                <TextArea
                  label="Not"
                  id="claim-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              {formError ? (<p className="text-sm text-rose-600" data-testid="claim-form-error">{formError}</p>) : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="tertiary" onClick={() => setDialogOpen(false)}>
                  Vazgeç
                </Button>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Kaydediliyor…' : 'Taslak Oluştur'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Yeni sözleşme kalemi diyaloğu */}
      {itemDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Yeni sözleşme kalemi">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold">Yeni Sözleşme Kalemi</h2>
            <form onSubmit={submitItemForm} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Kalem Kodu" id="item-code" value={itemForm.code} onChange={(e) => setItemForm({ ...itemForm, code: e.target.value })} helpText="Opsiyonel; proje içinde benzersiz" />
                <TextField label="Birim" id="item-unit" required value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value.toUpperCase() })} />
              </div>
              <TextField label="Açıklama" id="item-desc" required value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Sözleşme Miktarı"
                  id="item-qty"
                  required
                  inputMode="decimal"
                  value={itemForm.contractQuantity}
                  onChange={(e) => setItemForm({ ...itemForm, contractQuantity: e.target.value })}
                  helpText="En fazla 3 ondalık"
                />
                <TextField
                  label="Birim Fiyatı"
                  id="item-price"
                  required
                  inputMode="decimal"
                  value={itemForm.unitPrice}
                  onChange={(e) => setItemForm({ ...itemForm, unitPrice: e.target.value })}
                  helpText="En fazla 4 ondalık"
                />
              </div>
              {itemFormError ? <p className="text-sm text-rose-600">{itemFormError}</p> : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="tertiary" onClick={() => setItemDialogOpen(false)}>
                  Vazgeç
                </Button>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Kaydediliyor…' : 'Kalem Ekle'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Red gerekçesi */}
      <ConfirmDialog
        open={Boolean(rejectTarget)}
        title="Hakedişi reddet"
        message={rejectTarget ? `#${rejectTarget.claimNo} — red gerekçesi girin (en az 3 karakter):` : ''}
        confirmLabel="Reddet"
        destructive
        onConfirm={() => {
          if (rejectTarget && rejectReason.trim().length >= 3) {
            void act(() => financeApi.rejectClaim(token, rejectTarget.id, rejectReason.trim()), 'Hakediş reddedildi');
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

      {/* İptal gerekçesi */}
      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="Hakedişi iptal et"
        message={cancelTarget ? `#${cancelTarget.claimNo} — iptal gerekçesi girin (en az 3 karakter). Onaylı hakediş iptal edilemez; düzeltme yeni hakedişle yapılır.` : ''}
        confirmLabel="İptal Et"
        destructive
        onConfirm={() => {
          if (cancelTarget && cancelReason.trim().length >= 3) {
            void act(() => financeApi.cancelClaim(token, cancelTarget.id, cancelReason.trim()), 'Hakediş iptal edildi');
          }
          setCancelTarget(null);
          setCancelReason('');
        }}
        onCancel={() => {
          setCancelTarget(null);
          setCancelReason('');
        }}
      >
        {cancelTarget ? (
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="İptal gerekçesi"
            aria-label="İptal gerekçesi"
          />
        ) : null}
      </ConfirmDialog>

      {/* Taslak silme onayı */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Taslak hakedişi sil"
        message={deleteTarget ? `#${deleteTarget.claimNo} (${formatMoneyTr(deleteTarget.netTotal, 'TRY')}) silinsin mi?` : ''}
        confirmLabel="Sil"
        destructive
        onConfirm={() => {
          if (deleteTarget) void act(() => financeApi.deleteClaim(token, deleteTarget.id), 'Taslak hakediş silindi');
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}
