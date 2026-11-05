'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
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
import { formatOccurredAt, formatQuantityTr, movementSign, movementTypeTone } from '@/lib/stock';
import { ApiError, inventoryApi, projectsApi } from '@/lib/api';
import {
  CREATABLE_MOVEMENT_TYPES,
  DEFAULT_MATERIAL_UNITS,
  MOVEMENT_REFERENCE_TYPES,
  MOVEMENT_REFERENCE_TYPE_LABELS,
  STOCK_MOVEMENT_TYPE_LABELS,
  permissionsForRoles,
  type MaterialDto,
  type ProjectDto,
  type StockBalanceDto,
  type StockMovementDto,
  type WarehouseDto,
} from '@santiyepro/contracts';

/**
 * Depo & Malzemeler (Faz 07 — gerçek API verisi).
 *
 * Kurallar (prompts/phase-07-development.md, docs/06):
 * - inventory.view: sayfa erişimi; inventory.move: hareket/depo/malzeme yönetimi.
 * - Hareket append-only: düzenleme/silme yok; düzeltme yalnızca ters kayıt
 *   (gerekçe zorunlu, ConfirmDialog ile).
 * - Transfer: kaynak + hedef depo seçimi; negatif stok sunucuda 409 ile engellenir.
 * - Stok kartı: mevcut bakiye + son güncelleme zamanı + kritik stok uyarısı.
 */
type Tab = 'stock' | 'movements' | 'materials' | 'warehouses';

const nowLocalInput = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export default function InventoryPage() {
  const { user, getToken } = useAuth();
  const token = getToken();

  const canView = permissionsForRoles(user?.roles ?? []).has('inventory.view');
  const canMove = permissionsForRoles(user?.roles ?? []).has('inventory.move');

  const [tab, setTab] = useState<Tab>('stock');

  // Ortak veri: projeler, depolar, malzemeler
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [materials, setMaterials] = useState<MaterialDto[]>([]);
  const [envError, setEnvError] = useState<string>();

  const loadEnv = useCallback(async () => {
    if (!token) return;
    setEnvError(undefined);
    try {
      const [projectsRes, warehousesRes, materialsRes] = await Promise.all([
        projectsApi.list(token, { sort: 'name', order: 'asc', pageSize: 100 }),
        inventoryApi.warehouses(token),
        inventoryApi.materials(token),
      ]);
      setProjects(projectsRes.data);
      setWarehouses(warehousesRes.data);
      setMaterials(materialsRes.data);
    } catch (error) {
      setEnvError(error instanceof ApiError ? error.message : 'Veriler yüklenemedi');
    }
  }, [token]);

  useEffect(() => {
    void loadEnv();
  }, [loadEnv]);

  // ---------- Stok kartları ----------
  const [balances, setBalances] = useState<StockBalanceDto[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [balancesError, setBalancesError] = useState<string>();
  const [balanceWarehouse, setBalanceWarehouse] = useState('');
  const [balanceSearchInput, setBalanceSearchInput] = useState('');
  const [balanceSearch, setBalanceSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  const loadBalances = useCallback(async () => {
    if (!token) return;
    setBalancesLoading(true);
    setBalancesError(undefined);
    try {
      const res = await inventoryApi.balances(token, {
        ...(balanceWarehouse ? { warehouseId: balanceWarehouse } : balanceSearch ? { search: balanceSearch } : {}),
        ...(lowOnly ? { lowStock: 'true' } : {}),
        // Hareket listesi/bakiye sorgusu en az bir filtre ister; doğrudan
        // sayfa açılışında ilk proje ya da ilk depo kullanılır.
        ...(!balanceWarehouse && !balanceSearch && !lowOnly && warehouses[0]
          ? { warehouseId: warehouses[0].id }
          : {}),
      });
      setBalances(res.data);
    } catch (error) {
      setBalancesError(error instanceof ApiError ? error.message : 'Bakiyeler yüklenemedi');
    } finally {
      setBalancesLoading(false);
    }
  }, [token, balanceWarehouse, balanceSearch, lowOnly, warehouses]);

  useEffect(() => {
    if (tab === 'stock') void loadBalances();
  }, [tab, loadBalances]);

  // ---------- Hareketler ----------
  const [movements, setMovements] = useState<StockMovementDto[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(true);
  const [movementsError, setMovementsError] = useState<string>();
  const [movementPage, setMovementPage] = useState(1);
  const [movementTotalPages, setMovementTotalPages] = useState(1);
  const [movementTypeFilter, setMovementTypeFilter] = useState('');
  const [movementWarehouseFilter, setMovementWarehouseFilter] = useState('');
  const [movementMaterialFilter, setMovementMaterialFilter] = useState('');
  const [movementDateFrom, setMovementDateFrom] = useState('');
  const [movementDateTo, setMovementDateTo] = useState('');
  const [reversing, setReversing] = useState<StockMovementDto | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseError, setReverseError] = useState<string>();

  const loadMovements = useCallback(async () => {
    if (!token) return;
    setMovementsLoading(true);
    setMovementsError(undefined);
    try {
      const scopeWarehouse = movementWarehouseFilter || warehouses[0]?.id;
      if (!scopeWarehouse && !movementMaterialFilter) {
        setMovements([]);
        setMovementTotalPages(1);
        return;
      }
      const res = await inventoryApi.movements(token, {
        page: movementPage,
        pageSize: 20,
        ...(scopeWarehouse ? { warehouseId: scopeWarehouse } : {}),
        ...(movementMaterialFilter ? { materialId: movementMaterialFilter } : {}),
        ...(movementTypeFilter ? { type: movementTypeFilter } : {}),
        ...(movementDateFrom ? { dateFrom: movementDateFrom } : {}),
        ...(movementDateTo ? { dateTo: movementDateTo } : {}),
      });
      setMovements(res.data);
      setMovementTotalPages(res.meta.totalPages);
    } catch (error) {
      setMovementsError(error instanceof ApiError ? error.message : 'Hareketler yüklenemedi');
    } finally {
      setMovementsLoading(false);
    }
  }, [token, movementPage, movementWarehouseFilter, movementMaterialFilter, movementTypeFilter, movementDateFrom, movementDateTo, warehouses]);

  useEffect(() => {
    if (tab === 'movements') void loadMovements();
  }, [tab, loadMovements]);

  // ---------- Hareket formu ----------
  const [movementFormOpen, setMovementFormOpen] = useState(false);
  const [mType, setMType] = useState<string>('IN');
  const [mWarehouse, setMWarehouse] = useState('');
  const [mTargetWarehouse, setMTargetWarehouse] = useState('');
  const [mMaterial, setMMaterial] = useState('');
  const [mQuantity, setMQuantity] = useState('');
  const [mUnitCost, setMUnitCost] = useState('');
  const [mReferenceType, setMReferenceType] = useState('');
  const [mNote, setMNote] = useState('');
  const [mOccurredAt, setMOccurredAt] = useState(nowLocalInput());
  const [mError, setMError] = useState<string>();
  const [mBusy, setMBusy] = useState(false);

  const activeWarehouses = useMemo(() => warehouses.filter((w) => w.isActive), [warehouses]);
  const activeMaterials = useMemo(() => materials.filter((m) => m.isActive), [materials]);
  const selectedMaterial = activeMaterials.find((m) => m.id === mMaterial) ?? null;

  const openMovementForm = () => {
    setMType('IN');
    setMWarehouse(activeWarehouses[0]?.id ?? '');
    setMTargetWarehouse('');
    setMMaterial(activeMaterials[0]?.id ?? '');
    setMQuantity('');
    setMUnitCost('');
    setMReferenceType('');
    setMNote('');
    setMOccurredAt(nowLocalInput());
    setMError(undefined);
    setMovementFormOpen(true);
  };

  const refreshAfterWrite = useCallback(async () => {
    await loadEnv();
    if (tab === 'stock') await loadBalances();
    if (tab === 'movements') await loadMovements();
  }, [loadEnv, loadBalances, loadMovements, tab]);

  const submitMovement = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setMBusy(true);
    setMError(undefined);
    try {
      await inventoryApi.createMovement(token, {
        type: mType as 'IN' | 'OUT' | 'TRANSFER' | 'RETURN' | 'ADJUSTMENT',
        materialId: mMaterial,
        warehouseId: mWarehouse,
        ...(mType === 'TRANSFER' ? { targetWarehouseId: mTargetWarehouse } : {}),
        quantity: mQuantity.replace(',', '.'),
        unit: selectedMaterial?.unit,
        ...(mUnitCost ? { unitCost: mUnitCost.replace(',', '.') } : {}),
        ...(mReferenceType ? { referenceType: mReferenceType as 'PURCHASE' | 'DAILY_REPORT' | 'TASK' | 'OTHER' } : {}),
        ...(mNote ? { note: mNote } : {}),
        ...(mOccurredAt ? { occurredAt: new Date(mOccurredAt).toISOString() } : {}),
      });
      setMovementFormOpen(false);
      await refreshAfterWrite();
    } catch (error) {
      setMError(error instanceof ApiError ? error.message : 'Hareket kaydedilemedi');
    } finally {
      setMBusy(false);
    }
  };

  const submitReverse = async () => {
    if (!token || !reversing) return;
    setReverseError(undefined);
    try {
      await inventoryApi.reverseMovement(token, reversing.id, reverseReason);
      setReversing(null);
      setReverseReason('');
      await refreshAfterWrite();
    } catch (error) {
      setReverseError(error instanceof ApiError ? error.message : 'Ters kayıt yapılamadı');
    }
  };

  // ---------- Malzeme formu ----------
  const [materialFormOpen, setMaterialFormOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialDto | null>(null);
  const [matCode, setMatCode] = useState('');
  const [matName, setMatName] = useState('');
  const [matCategory, setMatCategory] = useState('');
  const [matUnit, setMatUnit] = useState('ADET');
  const [matMinStock, setMatMinStock] = useState('');
  const [matError, setMatError] = useState<string>();
  const [matBusy, setMatBusy] = useState(false);

  const openMaterialForm = (material: MaterialDto | null) => {
    setEditingMaterial(material);
    setMatCode(material?.code ?? '');
    setMatName(material?.name ?? '');
    setMatCategory(material?.category ?? '');
    setMatUnit(material?.unit ?? 'ADET');
    setMatMinStock(material?.minStock ?? '');
    setMatError(undefined);
    setMaterialFormOpen(true);
  };

  const submitMaterial = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setMatBusy(true);
    setMatError(undefined);
    try {
      if (editingMaterial) {
        await inventoryApi.updateMaterial(token, editingMaterial.id, {
          ...(matCode !== (editingMaterial.code ?? '') ? { code: matCode || null } : {}),
          ...(matName !== editingMaterial.name ? { name: matName } : {}),
          ...(matCategory !== (editingMaterial.category ?? '') ? { category: matCategory || null } : {}),
          ...(matUnit !== editingMaterial.unit ? { unit: matUnit } : {}),
          ...(matMinStock !== (editingMaterial.minStock ?? '') ? { minStock: matMinStock || null } : {}),
        });
      } else {
        await inventoryApi.createMaterial(token, {
          ...(matCode ? { code: matCode } : {}),
          name: matName,
          ...(matCategory ? { category: matCategory } : {}),
          unit: matUnit,
          ...(matMinStock ? { minStock: matMinStock.replace(',', '.') } : {}),
        });
      }
      setMaterialFormOpen(false);
      await loadEnv();
    } catch (error) {
      setMatError(error instanceof ApiError ? error.message : 'Malzeme kaydedilemedi');
    } finally {
      setMatBusy(false);
    }
  };

  // ---------- Depo formu ----------
  const [warehouseFormOpen, setWarehouseFormOpen] = useState(false);
  const [whProjectId, setWhProjectId] = useState('');
  const [whName, setWhName] = useState('');
  const [whLocation, setWhLocation] = useState('');
  const [whError, setWhError] = useState<string>();
  const [whBusy, setWhBusy] = useState(false);
  const [togglingWarehouse, setTogglingWarehouse] = useState<WarehouseDto | null>(null);

  const submitWarehouse = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setWhBusy(true);
    setWhError(undefined);
    try {
      await inventoryApi.createWarehouse(token, {
        ...(whProjectId ? { projectId: whProjectId } : {}),
        name: whName,
        ...(whLocation ? { location: whLocation } : {}),
      });
      setWarehouseFormOpen(false);
      setWhName('');
      setWhLocation('');
      setWhProjectId('');
      await loadEnv();
    } catch (error) {
      setWhError(error instanceof ApiError ? error.message : 'Depo açılamadı');
    } finally {
      setWhBusy(false);
    }
  };

  const toggleWarehouseActive = async () => {
    if (!token || !togglingWarehouse) return;
    setWhBusy(true);
    try {
      await inventoryApi.updateWarehouse(token, togglingWarehouse.id, { isActive: !togglingWarehouse.isActive });
      setTogglingWarehouse(null);
      await loadEnv();
    } catch (error) {
      setWhError(error instanceof ApiError ? error.message : 'Depo güncellenemedi');
    } finally {
      setWhBusy(false);
    }
  };

  if (!canView) {
    return (
      <AppShell title="Depo & Malzemeler">
        <PageHeader title="Depo & Malzemeler" description="Stok kartları, hareket geçmişi, malzeme ve depo yönetimi" />
        <ErrorState title="Erişim yok" message="Bu sayfayı görüntüleme yetkiniz bulunmuyor (inventory.view gereklidir)." />
      </AppShell>
    );
  }

  return (
    <AppShell title="Depo & Malzemeler">
      <PageHeader
        title="Depo & Malzemeler"
        description="Malzeme kataloğu, depolar, stok hareketleri ve bakiye — hareket kayıtları değiştirilemez, düzeltme ters kayıttır"
        action={
          canMove ? (
            <Button variant="primary" onClick={openMovementForm}>
              + Stok Hareketi
            </Button>
          ) : undefined
        }
      />

      {envError && (
        <div role="alert" className="mb-4 rounded-md border border-danger-600 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {envError}
        </div>
      )}

      <div role="tablist" aria-label="Depo modülü sekmeleri" className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ['stock', 'Stok Kartları'],
            ['movements', 'Hareketler'],
            ['materials', 'Malzemeler'],
            ['warehouses', 'Depolar'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-[44px] rounded-md border px-4 text-sm font-medium ${
              tab === key ? 'border-brand-600 bg-brand-600 text-white' : 'border-border-default bg-surface-0 text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ---------- Stok kartları ---------- */}
      {tab === 'stock' && (
        <SectionCard
          title="Stok Kartları"
          description="Mevcut bakiye, son güncelleme zamanı ve kritik stok uyarısı"
          action={
            <div className="flex flex-wrap items-end gap-2">
              <Select
                label=""
                aria-label="Depo filtresi"
                value={balanceWarehouse}
                onChange={(e) => setBalanceWarehouse(e.target.value)}
                options={activeWarehouses.map((w) => ({ value: w.id, label: w.projectName ? `${w.name} (${w.projectName})` : w.name }))}
                placeholder="Depo seçin"
                className="min-w-[220px]"
              />
              <TextField
                label=""
                aria-label="Malzeme arama"
                placeholder="Malzeme ara"
                value={balanceSearchInput}
                onChange={(e) => setBalanceSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setBalanceSearch(balanceSearchInput);
                }}
                className="min-w-[160px]"
              />
              <Button variant="secondary" onClick={() => setBalanceSearch(balanceSearchInput)}>
                Ara
              </Button>
              <label className="flex min-h-[44px] items-center gap-2 text-sm">
                <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} aria-label="Sadece kritik stok" />
                Kritik stok
              </label>
            </div>
          }
        >
          {balancesLoading ? (
            <LoadingSkeleton rows={5} />
          ) : balancesError ? (
            <ErrorState message={balancesError} onRetry={() => void loadBalances()} />
          ) : balances.length === 0 ? (
            <EmptyState
              title="Stok kartı yok"
              description="Seçili filtrede stok kartı bulunmuyor. Stok hareketi girildiğinde kartlar burada görünür."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="balances-table">
                <thead>
                  <tr className="border-b border-border-default text-left text-text-secondary">
                    <th className="px-3 py-2">Malzeme</th>
                    <th className="px-3 py-2">Depo</th>
                    <th className="px-3 py-2 text-right">Bakiye</th>
                    <th className="px-3 py-2">Min. Stok</th>
                    <th className="px-3 py-2">Son Güncelleme</th>
                    <th className="px-3 py-2">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr
                      key={`${b.materialId}-${b.warehouseId}`}
                      className="border-b border-border-light"
                      data-testid={`balance-row-${b.materialCode ?? b.materialName}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-text-primary">{b.materialName}</div>
                        {b.materialCode && <div className="text-xs text-text-secondary">{b.materialCode}</div>}
                      </td>
                      <td className="px-3 py-2">
                        {b.warehouseName}
                        {b.projectName && <div className="text-xs text-text-secondary">{b.projectName}</div>}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold" data-testid="balance-quantity">
                        {formatQuantityTr(b.quantity)} {b.unit}
                      </td>
                      <td className="px-3 py-2">{b.minStock ? `${formatQuantityTr(b.minStock)} ${b.unit}` : '—'}</td>
                      <td className="px-3 py-2 text-text-secondary">{formatOccurredAt(b.lastMovementAt)}</td>
                      <td className="px-3 py-2">
                        {b.isLow ? <StatusBadge tone="error">Kritik Stok</StatusBadge> : <StatusBadge tone="approved">Yeterli</StatusBadge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* ---------- Hareketler ---------- */}
      {tab === 'movements' && (
        <SectionCard
          title="Hareket Geçmişi"
          description="Append-only kayıtlar — düzenlenemez/silinemez; düzeltme ters kayıt iledir"
          action={
            <div className="flex flex-wrap items-end gap-2">
              <Select
                label=""
                aria-label="Depo filtresi"
                value={movementWarehouseFilter}
                onChange={(e) => {
                  setMovementWarehouseFilter(e.target.value);
                  setMovementPage(1);
                }}
                options={activeWarehouses.map((w) => ({ value: w.id, label: w.name }))}
                placeholder="Depo seçin"
                className="min-w-[180px]"
              />
              <Select
                label=""
                aria-label="Malzeme filtresi"
                value={movementMaterialFilter}
                onChange={(e) => {
                  setMovementMaterialFilter(e.target.value);
                  setMovementPage(1);
                }}
                options={materials.map((m) => ({ value: m.id, label: m.name }))}
                placeholder="Tüm malzemeler"
                className="min-w-[180px]"
              />
              <Select
                label=""
                aria-label="Tip filtresi"
                value={movementTypeFilter}
                onChange={(e) => {
                  setMovementTypeFilter(e.target.value);
                  setMovementPage(1);
                }}
                options={Object.entries(STOCK_MOVEMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
                placeholder="Tüm tipler"
                className="min-w-[140px]"
              />
              <TextField
                label=""
                aria-label="Başlangıç tarihi"
                type="date"
                value={movementDateFrom}
                onChange={(e) => {
                  setMovementDateFrom(e.target.value);
                  setMovementPage(1);
                }}
                className="min-w-[140px]"
              />
              <TextField
                label=""
                aria-label="Bitiş tarihi"
                type="date"
                value={movementDateTo}
                onChange={(e) => {
                  setMovementDateTo(e.target.value);
                  setMovementPage(1);
                }}
                className="min-w-[140px]"
              />
            </div>
          }
        >
          {movementsLoading ? (
            <LoadingSkeleton rows={6} />
          ) : movementsError ? (
            <ErrorState message={movementsError} onRetry={() => void loadMovements()} />
          ) : movements.length === 0 ? (
            <EmptyState title="Hareket yok" description="Seçili filtrede stok hareketi bulunmuyor." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="movements-table">
                  <thead>
                    <tr className="border-b border-border-default text-left text-text-secondary">
                      <th className="px-3 py-2">Tip</th>
                      <th className="px-3 py-2">Malzeme</th>
                      <th className="px-3 py-2 text-right">Miktar</th>
                      <th className="px-3 py-2">Depo</th>
                      <th className="px-3 py-2">Zaman</th>
                      <th className="px-3 py-2">Açıklama</th>
                      <th className="px-3 py-2">Kişi</th>
                      <th className="px-3 py-2">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id} className="border-b border-border-light" data-testid="movement-row">
                        <td className="px-3 py-2">
                          <StatusBadge tone={movementTypeTone(m.type)}>
                            {STOCK_MOVEMENT_TYPE_LABELS[m.type] ?? m.type}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-text-primary">{m.materialName}</div>
                          {m.materialCode && <div className="text-xs text-text-secondary">{m.materialCode}</div>}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {movementSign(m.type) === '-' ? '−' : movementSign(m.type) === '+' ? '+' : ''}
                          {formatQuantityTr(m.quantity)} {m.unit}
                        </td>
                        <td className="px-3 py-2">
                          {m.type === 'TRANSFER' ? `${m.warehouseName} → ${m.targetWarehouseName ?? '?'}` : m.warehouseName}
                        </td>
                        <td className="px-3 py-2 text-text-secondary">{formatOccurredAt(m.occurredAt)}</td>
                        <td className="max-w-[220px] truncate px-3 py-2" title={m.note ?? undefined}>
                          {m.note ?? '—'}
                          {m.reversesMovementId && <span className="ml-1 text-xs text-text-secondary">(ters kayıt)</span>}
                        </td>
                        <td className="px-3 py-2 text-text-secondary">{m.createdBy.fullName}</td>
                        <td className="px-3 py-2">
                          {canMove && m.type !== 'REVERSAL' && !m.reversesMovementId ? (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setReversing(m);
                                setReverseReason('');
                                setReverseError(undefined);
                              }}
                            >
                              Ters Kayıt
                            </Button>
                          ) : (
                            <span className="text-text-secondary">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {movementTotalPages > 1 && (
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-text-secondary">
                    Sayfa {movementPage} / {movementTotalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" disabled={movementPage <= 1} onClick={() => setMovementPage((p) => p - 1)}>
                      Önceki
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={movementPage >= movementTotalPages}
                      onClick={() => setMovementPage((p) => p + 1)}
                    >
                      Sonraki
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </SectionCard>
      )}

      {/* ---------- Malzemeler ---------- */}
      {tab === 'materials' && (
        <SectionCard
          title="Malzeme Kataloğu"
          description="Kurum geneli malzeme kartları — birim ve minimum stok tanımı"
          action={
            canMove ? (
              <Button variant="primary" onClick={() => openMaterialForm(null)}>
                + Malzeme
              </Button>
            ) : undefined
          }
        >
          {materials.length === 0 ? (
            <EmptyState title="Malzeme yok" description="Katalog boş. İlk malzemeyi ekleyin." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="materials-table">
                <thead>
                  <tr className="border-b border-border-default text-left text-text-secondary">
                    <th className="px-3 py-2">Kod</th>
                    <th className="px-3 py-2">Ad</th>
                    <th className="px-3 py-2">Kategori</th>
                    <th className="px-3 py-2">Birim</th>
                    <th className="px-3 py-2 text-right">Min. Stok</th>
                    <th className="px-3 py-2">Durum</th>
                    {canMove && <th className="px-3 py-2">İşlem</th>}
                  </tr>
                </thead>
                <tbody>
                  {materials.map((m) => (
                    <tr key={m.id} className="border-b border-border-light" data-testid="material-row">
                      <td className="px-3 py-2 font-mono text-xs">{m.code ?? '—'}</td>
                      <td className="px-3 py-2 font-medium text-text-primary">{m.name}</td>
                      <td className="px-3 py-2">{m.category ?? '—'}</td>
                      <td className="px-3 py-2">{m.unit}</td>
                      <td className="px-3 py-2 text-right">{m.minStock ? formatQuantityTr(m.minStock) : '—'}</td>
                      <td className="px-3 py-2">
                        {m.isActive ? <StatusBadge tone="approved">Aktif</StatusBadge> : <StatusBadge tone="neutral">Pasif</StatusBadge>}
                      </td>
                      {canMove && (
                        <td className="px-3 py-2">
                          <Button variant="secondary" onClick={() => openMaterialForm(m)}>
                            Düzenle
                          </Button>
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

      {/* ---------- Depolar ---------- */}
      {tab === 'warehouses' && (
        <SectionCard
          title="Depolar"
          description="Kurum merkezi deposu ve proje depoları"
          action={
            canMove ? (
              <Button
                variant="primary"
                onClick={() => {
                  setWhName('');
                  setWhLocation('');
                  setWhProjectId('');
                  setWhError(undefined);
                  setWarehouseFormOpen(true);
                }}
              >
                + Depo
              </Button>
            ) : undefined
          }
        >
          {warehouses.length === 0 ? (
            <EmptyState title="Depo yok" description="Henüz depo açılmamış. Kurum deposu veya proje deposu ekleyin." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="warehouses-table">
                <thead>
                  <tr className="border-b border-border-default text-left text-text-secondary">
                    <th className="px-3 py-2">Depo</th>
                    <th className="px-3 py-2">Kapsam</th>
                    <th className="px-3 py-2">Konum</th>
                    <th className="px-3 py-2">Durum</th>
                    {canMove && <th className="px-3 py-2">İşlem</th>}
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((w) => (
                    <tr key={w.id} className="border-b border-border-light" data-testid="warehouse-row">
                      <td className="px-3 py-2 font-medium text-text-primary">{w.name}</td>
                      <td className="px-3 py-2">{w.projectName ?? 'Kurum Geneli'}</td>
                      <td className="px-3 py-2">{w.location ?? '—'}</td>
                      <td className="px-3 py-2">
                        {w.isActive ? <StatusBadge tone="approved">Aktif</StatusBadge> : <StatusBadge tone="neutral">Pasif</StatusBadge>}
                      </td>
                      {canMove && (
                        <td className="px-3 py-2">
                          <Button variant="secondary" onClick={() => setTogglingWarehouse(w)}>
                            {w.isActive ? 'Pasife Al' : 'Aktifleştir'}
                          </Button>
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

      {/* ---------- Stok hareketi diyaloğu ---------- */}
      {movementFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Stok hareketi">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-surface-0 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-text-primary">Stok Hareketi</h2>
            <form onSubmit={submitMovement} className="grid gap-4">
              <Select
                label="Hareket Tipi"
                required
                value={mType}
                onChange={(e) => {
                  setMType(e.target.value);
                  setMError(undefined);
                }}
                options={CREATABLE_MOVEMENT_TYPES.map((t) => ({ value: t, label: STOCK_MOVEMENT_TYPE_LABELS[t] }))}
              />
              <div className="text-xs text-text-secondary">
                {mType === 'IN' && 'Depoya mal girişi (satın alma, teslim alma).'}
                {mType === 'OUT' && 'Depodan mal çıkışı (sahaya veriliş). Mevcut stoktan fazla çıkış reddedilir.'}
                {mType === 'TRANSFER' && 'Kaynak depodan çıkış + hedef depoya giriş tek işlemde yapılır.'}
                {mType === 'RETURN' && 'Sahadan depoya iade girişi.'}
                {mType === 'ADJUSTMENT' && 'Sayım düzeltmesi: işaretli miktar (+/−). Açıklama zorunludur.'}
              </div>
              <Select
                label="Depo"
                required
                value={mWarehouse}
                onChange={(e) => {
                  setMWarehouse(e.target.value);
                  setMError(undefined);
                }}
                options={activeWarehouses.map((w) => ({ value: w.id, label: w.projectName ? `${w.name} (${w.projectName})` : w.name }))}
                placeholder="Depo seçin"
              />
              {mType === 'TRANSFER' && (
                <Select
                  label="Hedef Depo"
                  required
                  value={mTargetWarehouse}
                  onChange={(e) => {
                    setMTargetWarehouse(e.target.value);
                    setMError(undefined);
                  }}
                  options={activeWarehouses
                    .filter((w) => w.id !== mWarehouse)
                    .map((w) => ({ value: w.id, label: w.projectName ? `${w.name} (${w.projectName})` : w.name }))}
                  placeholder="Hedef depo seçin"
                />
              )}
              <Select
                label="Malzeme"
                required
                value={mMaterial}
                onChange={(e) => {
                  setMMaterial(e.target.value);
                  setMError(undefined);
                }}
                options={activeMaterials.map((m) => ({
                  value: m.id,
                  label: m.code ? `${m.name} (${m.code})` : m.name,
                }))}
                placeholder="Malzeme seçin"
              />
              {selectedMaterial && (
                <div className="text-xs text-text-secondary" data-testid="movement-unit-hint">
                  Malzeme birimi: <strong>{selectedMaterial.unit}</strong>
                  {selectedMaterial.minStock ? ` · Min. stok: ${formatQuantityTr(selectedMaterial.minStock)}` : ''}
                </div>
              )}
              <TextField
                label={`Miktar${selectedMaterial ? ` (${selectedMaterial.unit})` : ''}`}
                required
                inputMode="decimal"
                value={mQuantity}
                onChange={(e) => setMQuantity(e.target.value)}
                placeholder={mType === 'ADJUSTMENT' ? 'örn. -2.5 (eksik) veya 4 (fazla)' : 'örn. 12.5'}
                helpText="En fazla 3 ondalık basamak; daha fazla basamak reddedilir (sessiz yuvarlama yoktur)."
              />
              <TextField
                label="Birim Maliyeti (opsiyonel)"
                inputMode="decimal"
                value={mUnitCost}
                onChange={(e) => setMUnitCost(e.target.value)}
                placeholder="örn. 145.50"
              />
              <Select
                label="Belge Referansı (opsiyonel)"
                value={mReferenceType}
                onChange={(e) => setMReferenceType(e.target.value)}
                options={MOVEMENT_REFERENCE_TYPES.map((t) => ({ value: t, label: MOVEMENT_REFERENCE_TYPE_LABELS[t] }))}
                placeholder="Referans yok"
              />
              <TextField label="Zaman" type="datetime-local" value={mOccurredAt} onChange={(e) => setMOccurredAt(e.target.value)} />
              <TextArea
                label={mType === 'ADJUSTMENT' ? 'Açıklama (zorunlu)' : 'Açıklama (opsiyonel)'}
                rows={2}
                value={mNote}
                onChange={(e) => setMNote(e.target.value)}
                placeholder={mType === 'ADJUSTMENT' ? 'Sayım farkının nedeni' : 'Not'}
              />
              {mError && (
                <div role="alert" className="rounded-md border border-danger-600 bg-danger-50 px-3 py-2 text-sm text-danger-700" data-testid="movement-form-error">
                  {mError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setMovementFormOpen(false)}>
                  Vazgeç
                </Button>
                <Button type="submit" variant="primary" disabled={mBusy}>
                  {mBusy ? 'Kaydediliyor…' : 'Kaydet'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- Malzeme diyaloğu ---------- */}
      {materialFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Malzeme">
          <div className="w-full max-w-md rounded-lg bg-surface-0 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-text-primary">{editingMaterial ? 'Malzemeyi Düzenle' : 'Yeni Malzeme'}</h2>
            <form onSubmit={submitMaterial} className="grid gap-4">
              <TextField label="Kod (opsiyonel)" value={matCode} onChange={(e) => setMatCode(e.target.value)} placeholder="örn. CIM-50" helpText="Kurum içinde benzersiz olmalıdır." />
              <TextField label="Malzeme Adı" required value={matName} onChange={(e) => setMatName(e.target.value)} placeholder="örn. Çimento CEM I 42,5" />
              <TextField label="Kategori (opsiyonel)" value={matCategory} onChange={(e) => setMatCategory(e.target.value)} placeholder="örn. Bağlayıcı" />
              <Select
                label="Birim"
                required
                value={matUnit}
                onChange={(e) => setMatUnit(e.target.value)}
                options={[...new Set([matUnit, ...DEFAULT_MATERIAL_UNITS])].map((u) => ({ value: u, label: u }))}
              />
              <TextField
                label="Minimum Stok (opsiyonel)"
                inputMode="decimal"
                value={matMinStock}
                onChange={(e) => setMatMinStock(e.target.value)}
                placeholder="örn. 10"
                helpText="Bakiye bu değerin altına düştüğünde kart 'Kritik Stok' işaretlenir."
              />
              {matError && (
                <div role="alert" className="rounded-md border border-danger-600 bg-danger-50 px-3 py-2 text-sm text-danger-700" data-testid="material-form-error">
                  {matError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setMaterialFormOpen(false)}>
                  Vazgeç
                </Button>
                <Button type="submit" variant="primary" disabled={matBusy}>
                  {matBusy ? 'Kaydediliyor…' : 'Kaydet'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- Depo diyaloğu ---------- */}
      {warehouseFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Depo">
          <div className="w-full max-w-md rounded-lg bg-surface-0 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-text-primary">Yeni Depo</h2>
            <form onSubmit={submitWarehouse} className="grid gap-4">
              <Select
                label="Kapsam"
                value={whProjectId}
                onChange={(e) => setWhProjectId(e.target.value)}
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                placeholder="Kurum Geneli (merkez depo)"
              />
              <TextField label="Depo Adı" required value={whName} onChange={(e) => setWhName(e.target.value)} placeholder="örn. Merkez Depo" />
              <TextField label="Konum (opsiyonel)" value={whLocation} onChange={(e) => setWhLocation(e.target.value)} placeholder="örn. Şantiye girişi, A blok arkası" />
              {whError && (
                <div role="alert" className="rounded-md border border-danger-600 bg-danger-50 px-3 py-2 text-sm text-danger-700" data-testid="warehouse-form-error">
                  {whError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setWarehouseFormOpen(false)}>
                  Vazgeç
                </Button>
                <Button type="submit" variant="primary" disabled={whBusy}>
                  {whBusy ? 'Açılıyor…' : 'Depo Aç'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- Ters kayıt onayı ---------- */}
      <ConfirmDialog
        open={reversing !== null}
        title="Hareketi Ters Kaydet"
        message={
          reversing
            ? `${STOCK_MOVEMENT_TYPE_LABELS[reversing.type] ?? reversing.type} — ${reversing.materialName} (${formatQuantityTr(reversing.quantity)} ${reversing.unit}) hareketi ters kaydedilecek. Bakiye etkisi geri alınır; orijinal kayıt korunur.`
            : ''
        }
        confirmLabel="Ters Kaydet"
        destructive
        onConfirm={() => void submitReverse()}
        onCancel={() => setReversing(null)}
      >
        <div className="grid gap-2 text-left">
          <TextField
            label="Gerekçe (zorunlu)"
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            placeholder="örn. Yanlış depodan çıkış yapıldı"
          />
          {reverseError && (
            <div role="alert" className="rounded-md border border-danger-600 bg-danger-50 px-3 py-2 text-sm text-danger-700" data-testid="reverse-error">
              {reverseError}
            </div>
          )}
        </div>
      </ConfirmDialog>

      {/* ---------- Depo pasife alma onayı ---------- */}
      <ConfirmDialog
        open={togglingWarehouse !== null}
        title={togglingWarehouse?.isActive ? 'Depoyu Pasife Al' : 'Depoyu Aktifleştir'}
        message={
          togglingWarehouse
            ? togglingWarehouse.isActive
              ? `"${togglingWarehouse.name}" pasife alınacak. Pasif depoya yeni stok hareketi girilemez; geçmiş kayıtlar korunur.`
              : `"${togglingWarehouse.name}" yeniden aktifleştirilecek.`
            : ''
        }
        confirmLabel={togglingWarehouse?.isActive ? 'Pasife Al' : 'Aktifleştir'}
        onConfirm={() => void toggleWarehouseActive()}
        onCancel={() => setTogglingWarehouse(null)}
      />
    </AppShell>
  );
}
