import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { TextField } from '../components/ui/TextField';
import { tokenStorage } from '../lib/secure-store';
import { financeApi, projectsApi, type ExpenseCategoryDto, type ProjectDto } from '../lib/api';
import { generateClientMutationId } from '../lib/offline-media-queue';
import { offlineExpenseQueue } from '../lib/offline-expense-queue';
import { colors, radius, spacing, typography } from '../theme/tokens';

/**
 * Hızlı gider kaydı (Faz 08 — mobil, docs/09 çevrimdışı kuyruk).
 *
 * Kurallar (prompts/phase-08-development.md):
 * - Gider append-only/işlem bazlıdır; çevrimdışıyken kuyruğa alınır,
 *   clientMutationId ile idempotent gönderilir (duplicate gider oluşmaz).
 * - Vergi oranı OPSİYONELDİR: boş bırakılırsa sunucuda hiçbir varsayılan
 *   oran uydurulmaz.
 * - Kesin kabul sunucu doğrulamasına bağlıdır: kuyruktaki kayıt sunucu
 *   reddinde 'done' sayılır ve hata not edilir (tekrar gönderilmez).
 */
export function ExpenseScreen({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [categories, setCategories] = useState<ExpenseCategoryDto[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('TRY');
  const [taxRate, setTaxRate] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [pendingCount, setPendingCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      await offlineExpenseQueue.hydrate();
      setPendingCount(offlineExpenseQueue.pendingCount());
      const token = await tokenStorage.loadAccessToken();
      if (!token) return;
      const [projectRes, categoryRes] = await Promise.all([
        projectsApi.list(token, { sort: 'name', order: 'asc' }),
        financeApi.listCategories(token),
      ]);
      setProjects(projectRes.data);
      setCategories(categoryRes.data.filter((c) => c.isActive));
      setProjectId(projectRes.data[0]?.id ?? null);
      setCategoryId(categoryRes.data.find((c) => c.isActive)?.id ?? null);
    } catch {
      setError('Gider formu verileri yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setFormError(undefined);
    setNotice(undefined);
    const trimmedAmount = amount.trim().replace(',', '.');
    if (!projectId || !categoryId) {
      setFormError('Proje ve kategori seçilmelidir');
      return;
    }
    if (description.trim().length < 3) {
      setFormError('Açıklama en az 3 karakter olmalıdır');
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(trimmedAmount) || Number.parseFloat(trimmedAmount) <= 0) {
      setFormError('Tutar 2 ondalıktan fazla olamaz (örn. 1250.50)');
      return;
    }
    if (taxRate.trim() && !/^\d{1,3}(\.\d{1,2})?$/.test(taxRate.trim())) {
      setFormError('Vergi oranı 0–100 arası bir sayı olmalıdır');
      return;
    }
    setSaving(true);
    try {
      const project = projects.find((p) => p.id === projectId);
      const category = categories.find((c) => c.id === categoryId);
      const result = await offlineExpenseQueue.enqueue({
        clientMutationId: generateClientMutationId(),
        projectId,
        projectName: project?.name ?? '',
        categoryId,
        categoryName: category?.name ?? '',
        vendorName: vendorName.trim() ? vendorName.trim() : null,
        description: description.trim(),
        amount: trimmedAmount,
        currency,
        taxRate: taxRate.trim() ? taxRate.trim() : null,
        expenseDate,
      });
      setPendingCount(offlineExpenseQueue.pendingCount());

      if (result.wasDuplicate) {
        setNotice('Bu kayıt kuyrukta zaten bekliyor.');
        setSaving(false);
        return;
      }

      const token = await tokenStorage.loadAccessToken();
      if (token) {
        const flushed = await offlineExpenseQueue.flush(async (item) => {
          try {
            await financeApi.createExpense(token, {
              projectId: item.projectId,
              categoryId: item.categoryId,
              vendorName: item.vendorName ?? undefined,
              description: item.description,
              amount: item.amount,
              currency: item.currency,
              taxRate: item.taxRate,
              expenseDate: item.expenseDate,
              clientMutationId: item.clientMutationId,
            });
            return { ok: true };
          } catch (err) {
            // 4xx sunucu kararı kesindir (permanent) — kayıt tekrar gönderilmez.
            const message = err instanceof Error ? err.message : 'Sunucu kaydı kabul etmedi';
            const permanent = typeof (err as { status?: number }).status === 'number' && (err as { status: number }).status >= 400 && (err as { status: number }).status < 500;
            return { ok: false, permanent, error: message };
          }
        });
        setPendingCount(offlineExpenseQueue.pendingCount());
        if (flushed.sent > 0) {
          setNotice('Gider kaydedildi.');
          await offlineExpenseQueue.clearDone();
        } else {
          setNotice('Çevrimdışı: gider kuyruğa alındı (kesin kabul sunucu doğrulamasına bağlıdır).');
        }
        setPendingCount(offlineExpenseQueue.pendingCount());
      } else {
        setNotice('Çevrimdışı: gider kuyruğa alındı (kesin kabul sunucu doğrulamasına bağlıdır).');
      }

      setDescription('');
      setAmount('');
      setTaxRate('');
      setVendorName('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gider kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Hızlı Gider Kaydı</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Kapat" onPress={onClose} style={styles.closeButton}>
          <X size={22} color={colors.brand[900]} />
        </Pressable>
      </View>

      {pendingCount > 0 ? (
        <Text accessibilityLabel="Bekleyen gider sayısı" style={styles.pending}>
          {pendingCount} gider kuyrukta bekliyor (çevrimdışı)
        </Text>
      ) : null}

      {notice ? (
        <Text accessibilityLiveRegion="polite" role="status" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {loading ? (
        <Text style={styles.loading}>Yükleniyor…</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card>
            <Text style={typography.label}>Proje</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              {projects.map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Proje ${p.name}`}
                  accessibilityState={{ selected: projectId === p.id }}
                  onPress={() => setProjectId(p.id)}
                  style={[styles.chip, projectId === p.id && styles.chipActive]}
                >
                  <Text style={[styles.chipText, projectId === p.id && styles.chipTextActive]}>{p.name}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={[typography.label, styles.sectionLabel]}>Kategori</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              {categories.map((c) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Kategori ${c.name}`}
                  accessibilityState={{ selected: categoryId === c.id }}
                  onPress={() => setCategoryId(c.id)}
                  style={[styles.chip, categoryId === c.id && styles.chipActive]}
                >
                  <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <TextField
              label="Tedarikçi"
              placeholder="Opsiyonel"
              value={vendorName}
              onChangeText={setVendorName}
            />
            <TextField
              label="Açıklama"
              required
              placeholder="Neye yapıldı?"
              value={description}
              onChangeText={setDescription}
            />
            <View style={styles.row}>
              <View style={styles.half}>
                <TextField
                  label="Tutar"
                  required
                  placeholder="1250.50"
                  keyboardType="decimal-pad"
                  value={amount}
                  onChangeText={setAmount}
                />
              </View>
              <View style={styles.half}>
                <Text style={typography.label}>Para Birimi</Text>
                <View style={styles.currencyRow}>
                  {['TRY', 'USD', 'EUR'].map((c) => (
                    <Pressable
                      key={c}
                      accessibilityRole="button"
                      accessibilityLabel={`Para birimi ${c}`}
                      accessibilityState={{ selected: currency === c }}
                      onPress={() => setCurrency(c)}
                      style={[styles.chip, styles.currencyChip, currency === c && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, currency === c && styles.chipTextActive]}>{c}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.half}>
                <TextField
                  label="Vergi Oranı (%)"
                  placeholder="Opsiyonel"
                  keyboardType="decimal-pad"
                  value={taxRate}
                  onChangeText={setTaxRate}
                />
              </View>
              <View style={styles.half}>
                <TextField label="Gider Tarihi" required value={expenseDate} onChangeText={setExpenseDate} />
              </View>
            </View>

            {formError ? (
              <Text accessibilityLiveRegion="polite" style={styles.formError}>
                {formError}
              </Text>
            ) : null}

            <Button label={saving ? 'Kaydediliyor…' : 'Gider Kaydet'} onPress={() => void save()} disabled={saving} />
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface[0] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
    paddingBottom: spacing[2],
  },
  title: { ...typography.screenTitle, color: colors.brand[900] },
  closeButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
  },
  pending: {
    ...typography.body,
    color: colors.semantic.warning,
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  notice: {
    ...typography.body,
    color: colors.semantic.success,
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  loading: { ...typography.secondary, paddingHorizontal: spacing[4] },
  content: { padding: spacing[4], gap: spacing[3] },
  sectionLabel: { marginTop: spacing[3] },
  chipRow: { marginTop: spacing[1] },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing[3],
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[2],
  },
  chipActive: { backgroundColor: colors.brand[900], borderColor: colors.brand[900] },
  chipText: { ...typography.body },
  chipTextActive: { color: colors.surface[0] },
  row: { flexDirection: 'row', gap: spacing[3] },
  half: { flex: 1 },
  currencyRow: { flexDirection: 'row', gap: spacing[2] },
  currencyChip: { minHeight: 44, paddingHorizontal: spacing[3] },
  formError: { ...typography.body, color: colors.semantic.danger, marginTop: spacing[2] },
});
