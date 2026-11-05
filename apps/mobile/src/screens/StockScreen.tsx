import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { TextField } from '../components/ui/TextField';
import { tokenStorage } from '../lib/secure-store';
import { inventoryApi, projectsApi, type MaterialDto, type ProjectDto, type StockBalanceDto, type WarehouseDto } from '../lib/api';
import { generateClientMutationId } from '../lib/offline-media-queue';
import { offlineStockQueue } from '../lib/offline-stock-queue';
import { colors, radius, spacing, typography } from '../theme/tokens';

/**
 * Malzeme hareketi (Faz 07 — mobil depo akışı):
 * depo seçimi, son bilinen stok kartları, giriş/çıkış/iade/düzeltme/transfer.
 *
 * Kurallar (prompts/phase-07-development.md):
 * - Offline cihazdaki stok SON BİLİNEN değerdir ve uyarı olarak gösterilir;
 *   kesin kabul sunucu doğrulamasına bağlıdır (negatif stok sunucuda 409).
 * - clientMutationId ile idempotent: kuyruk tekrarı çift hareket üretmez.
 * - Transfer: kaynak + hedef depo; çift alan yalnızca transferde görünür.
 */

type MovementType = 'IN' | 'OUT' | 'TRANSFER' | 'RETURN' | 'ADJUSTMENT';

const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  IN: 'Giriş',
  OUT: 'Çıkış',
  TRANSFER: 'Transfer',
  RETURN: 'İade',
  ADJUSTMENT: 'Düzeltme',
};

const MOVEMENT_TYPE_HINTS: Record<MovementType, string> = {
  IN: 'Depoya mal girişi',
  OUT: 'Depodan sahayla çıkış',
  TRANSFER: 'Başka depoya aktarım',
  RETURN: 'Sahadan depoya iade',
  ADJUSTMENT: 'Sayım düzeltmesi (±)',
};

export function StockScreen({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseDto[]>([]);
  const [materials, setMaterials] = useState<MaterialDto[]>([]);
  const [balances, setBalances] = useState<StockBalanceDto[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const [type, setType] = useState<MovementType>('OUT');
  const [targetWarehouseId, setTargetWarehouseId] = useState<string | null>(null);
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void (async () => {
      await offlineStockQueue.hydrate();
      setPendingCount(offlineStockQueue.pendingCount());
      const token = await tokenStorage.loadAccessToken();
      if (!token) return;
      try {
        const [projectRes, warehouseRes, materialRes] = await Promise.all([
          projectsApi.list(token, { sort: 'name', order: 'asc' }),
          inventoryApi.warehouses(token),
          inventoryApi.materials(token, { isActive: 'true' }),
        ]);
        setProjects(projectRes.data);
        setWarehouses(warehouseRes.data.filter((w) => w.isActive));
        setMaterials(materialRes.data);
        setWarehouseId(warehouseRes.data.find((w) => w.isActive)?.id ?? null);
      } catch {
        setProjects([]);
      }
    })();
  }, []);

  const loadBalances = useCallback(async () => {
    if (!warehouseId && !materialId) {
      setBalances([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const token = await tokenStorage.loadAccessToken();
      if (!token) return;
      const res = await inventoryApi.balances(token, {
        ...(warehouseId ? { warehouseId } : {}),
        ...(materialId ? { materialId } : {}),
      });
      setBalances(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stok kartları yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [warehouseId, materialId]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  const selectedMaterial = useMemo(() => materials.find((m) => m.id === materialId) ?? null, [materials, materialId]);
  const lastKnownForMaterial = useMemo(() => {
    if (!materialId) return null;
    return balances.find((b) => b.materialId === materialId) ?? null;
  }, [balances, materialId]);

  const submit = useCallback(async () => {
    if (!materialId || !warehouseId) {
      setFormError('Malzeme ve depo seçin');
      return;
    }
    const trimmed = quantity.trim().replace(',', '.');
    if (!/^-?(0|[1-9]\d{0,11})(\.\d{1,3})?$/.test(trimmed) || Number.parseFloat(trimmed) === 0) {
      setFormError('Geçerli bir miktar girin (en fazla 3 ondalık basamak)');
      return;
    }
    if (type === 'TRANSFER' && (!targetWarehouseId || targetWarehouseId === warehouseId)) {
      setFormError('Transfer için farklı bir hedef depo seçin');
      return;
    }
    if (type === 'ADJUSTMENT' && note.trim().length < 3) {
      setFormError('Düzeltme için açıklama zorunludur');
      return;
    }
    setSaving(true);
    setFormError(undefined);
    setNotice(undefined);
    try {
      const mutationId = generateClientMutationId();
      const material = materials.find((m) => m.id === materialId)!;
      const warehouse = warehouses.find((w) => w.id === warehouseId)!;
      const token = await tokenStorage.loadAccessToken();

      // Kuyruk: çevrimdışı kalsın ya da kayıt hemen gönderilsin, tek yol.
      const result = await offlineStockQueue.enqueue({
        clientMutationId: mutationId,
        type,
        materialId,
        materialName: material.name,
        warehouseId,
        warehouseName: warehouse.name,
        targetWarehouseId: type === 'TRANSFER' ? targetWarehouseId : null,
        quantity: trimmed,
        unit: material.unit,
        note: note.trim() ? note.trim() : null,
      });
      setPendingCount(offlineStockQueue.pendingCount());

      if (result.wasDuplicate) {
        setNotice('Bu hareket kuyrukta zaten bekliyor.');
        setSaving(false);
        return;
      }

      if (result.hadConflict) {
        setNotice('Kuyruktaki bekleyen hareket yeni girdinizle değiştirildi.');
      }

      if (token) {
        const flushed = await offlineStockQueue.flush(async (item): Promise<boolean> => {
          try {
            await inventoryApi.createMovement(token, {
              type: item.type,
              materialId: item.materialId,
              warehouseId: item.warehouseId,
              targetWarehouseId: item.targetWarehouseId,
              quantity: item.quantity,
              unit: item.unit,
              note: item.note ?? undefined,
              clientMutationId: item.clientMutationId,
            });
            return true;
          } catch {
            return false;
          }
        });
        setPendingCount(offlineStockQueue.pendingCount());
        if (flushed.sent === 0) {
          setNotice(
            `Çevrimdışı: hareket kuyruğa alındı (son bilinen stok uyarı niteliğindedir; kesin kabul sunucudadır).`,
          );
        } else {
          setNotice(result.hadConflict ? 'Hareket gönderildi (bekleyen değiştirilmişti).' : 'Hareket kaydedildi.');
          await offlineStockQueue.clearDone();
          setPendingCount(offlineStockQueue.pendingCount());
        }
      } else {
        setNotice(
          `Çevrimdışı: hareket kuyruğa alındı (son bilinen stok uyarı niteliğindedir; kesin kabul sunucudadır).`,
        );
      }

      setQuantity('');
      setNote('');
      await loadBalances();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Hareket kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }, [materialId, warehouseId, quantity, type, targetWarehouseId, note, materials, warehouses, loadBalances]);

  return (
    <View style={styles.root} testID="stock-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Malzeme Hareketi</Text>
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingText}>{pendingCount} bekliyor</Text>
          </View>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel="Kapat" onPress={onClose} style={styles.closeButton}>
          <X size={22} color={colors.brand[900]} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error && <ErrorState message={error} onRetry={() => void loadBalances()} />}

        {/* Depo seçimi */}
        <Card>
          <Text style={styles.cardTitle}>Depo</Text>
          <Text style={styles.cardDesc}>
            {warehouses.length === 0 ? 'Erişilebilir depo yok. Panelde depo tanımlayın.' : 'Hareketin yapılacağı depoyu seçin.'}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {warehouses.map((w) => (
              <Pressable
                key={w.id}
                accessibilityRole="button"
                accessibilityState={{ selected: warehouseId === w.id }}
                onPress={() => setWarehouseId(w.id)}
                style={[styles.chip, warehouseId === w.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, warehouseId === w.id && styles.chipTextActive]}>{w.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Card>

        {/* Son bilinen stok kartları */}
        <Card>
          <Text style={styles.cardTitle}>Stok Kartları</Text>
          <Text style={styles.cardDesc}>
            Değerler son bilinen bakiyedir — uyarı niteliğindedir; kesin kabul sunucu doğrulamasına bağlıdır.
          </Text>
          {loading ? (
            <Text style={styles.cardDesc}>Yükleniyor…</Text>
          ) : balances.length === 0 ? (
            <Text style={styles.cardDesc}>Bu depoda stok kartı yok. Mal girişi yapın.</Text>
          ) : (
            balances.map((b) => (
              <Pressable
                key={`${b.materialId}-${b.warehouseId}`}
                accessibilityRole="button"
                accessibilityState={{ selected: materialId === b.materialId }}
                onPress={() => setMaterialId(b.materialId)}
                style={[styles.stockRow, materialId === b.materialId && styles.stockRowActive]}
                testID={`stock-card-${b.materialName}`}
              >
                <View style={styles.stockInfo}>
                  <Text style={styles.stockName}>{b.materialName}</Text>
                  <Text style={styles.stockMeta}>
                    {b.warehouseName}
                    {b.isLow ? ' · Kritik stok!' : ''}
                  </Text>
                </View>
                <Text style={styles.stockQty}>
                  {b.quantity} {b.unit}
                </Text>
              </Pressable>
            ))
          )}
        </Card>

        {/* Hareket formu */}
        <Card>
          <Text style={styles.cardTitle}>Hareket</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {(Object.keys(MOVEMENT_TYPE_LABELS) as MovementType[]).map((t) => (
              <Pressable
                key={t}
                accessibilityRole="button"
                accessibilityState={{ selected: type === t }}
                onPress={() => {
                  setType(t);
                  setFormError(undefined);
                }}
                style={[styles.chip, type === t && styles.chipActive]}
              >
                <Text style={[styles.chipText, type === t && styles.chipTextActive]}>{MOVEMENT_TYPE_LABELS[t]}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.cardDesc}>{MOVEMENT_TYPE_HINTS[type]}</Text>

          {type === 'TRANSFER' && (
            <>
              <Text style={styles.fieldLabel}>Hedef Depo</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {warehouses
                  .filter((w) => w.id !== warehouseId)
                  .map((w) => (
                    <Pressable
                      key={w.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: targetWarehouseId === w.id }}
                      onPress={() => setTargetWarehouseId(w.id)}
                      style={[styles.chip, targetWarehouseId === w.id && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, targetWarehouseId === w.id && styles.chipTextActive]}>{w.name}</Text>
                    </Pressable>
                  ))}
              </ScrollView>
            </>
          )}

          <Text style={styles.fieldLabel}>Malzeme</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {materials.map((m) => (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityState={{ selected: materialId === m.id }}
                onPress={() => setMaterialId(m.id)}
                style={[styles.chip, materialId === m.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, materialId === m.id && styles.chipTextActive]}>{m.name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <TextField
            label={selectedMaterial ? `Miktar (${selectedMaterial.unit})` : 'Miktar'}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            placeholder={type === 'ADJUSTMENT' ? '-2.5 veya 4' : '12.5'}
          />
          <TextField label="Açıklama" value={note} onChangeText={setNote} placeholder={type === 'ADJUSTMENT' ? 'Sayım farkının nedeni (zorunlu)' : 'Not (opsiyonel)'} />

          {lastKnownForMaterial && (
            <Text style={styles.hintText}>
              Son bilinen stok: {lastKnownForMaterial.quantity} {lastKnownForMaterial.unit} ({lastKnownForMaterial.warehouseName})
            </Text>
          )}

          {notice && (
            <View style={styles.notice} testID="stock-notice">
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          )}
          {formError && (
            <View style={styles.errorBox} testID="stock-form-error">
              <Text style={styles.errorText}>{formError}</Text>
            </View>
          )}

          <Button
            label={saving ? 'Kaydediliyor…' : 'Hareketi Kaydet'}
            onPress={() => void submit()}
            disabled={saving || projects.length === 0}
          />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface[50] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing[6],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    backgroundColor: colors.surface[0],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    gap: spacing[2],
  },
  title: { flex: 1, ...typography.screenTitle, color: colors.brand[900] },
  pendingBadge: {
    backgroundColor: '#f4e9d3',
    borderRadius: radius.input,
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
  },
  pendingText: { fontSize: 11, color: '#8a6119', fontWeight: '600' },
  closeButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  cardTitle: { ...typography.sectionTitle, marginBottom: 2 },
  cardDesc: { color: colors.text.secondary, fontSize: 12, marginBottom: 8 },
  chipRow: { marginBottom: spacing[2] },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface[0],
    marginRight: spacing[2],
  },
  chipActive: { backgroundColor: colors.brand[600], borderColor: colors.brand[600] },
  chipText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  fieldLabel: { ...typography.label, marginTop: spacing[2], marginBottom: 4 },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.button,
    padding: spacing[3],
    marginBottom: spacing[2],
    minHeight: 44,
    backgroundColor: colors.surface[0],
  },
  stockRowActive: { borderColor: colors.brand[600], borderWidth: 2 },
  stockInfo: { flex: 1, paddingRight: spacing[2] },
  stockName: { ...typography.body, fontWeight: '700', color: colors.brand[900] },
  stockMeta: { color: colors.text.secondary, fontSize: 11, marginTop: 2 },
  stockQty: { fontSize: 15, fontWeight: '700', color: colors.brand[900] },
  hintText: { color: colors.text.secondary, fontSize: 11, marginTop: spacing[2] },
  notice: {
    borderRadius: radius.button,
    backgroundColor: '#e8f4ed',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginTop: spacing[2],
  },
  noticeText: { color: colors.semantic.success, fontSize: 12, fontWeight: '600' },
  errorBox: {
    borderRadius: radius.button,
    backgroundColor: '#FDECEC',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginTop: spacing[2],
  },
  errorText: { color: colors.semantic.danger, fontSize: 12, fontWeight: '600' },
});
