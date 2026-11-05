import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FolderKanban } from 'lucide-react-native';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton';
import { StatusBadge } from '../components/ui/StatusBadge';
import { TextField } from '../components/ui/TextField';
import { useAuth } from '../lib/auth-context';
import { tokenStorage } from '../lib/secure-store';
import { ApiError, projectsApi, type ProjectDto } from '../lib/api';
import {
  PROJECT_STATUS_LABELS,
  permissionsForRoles,
  type ProjectStatus,
} from '@santiyepro/contracts';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { ProjectDetailScreen } from './ProjectDetailScreen';

/** Liste filtresinde sunulan durumlar (arşiv filtreyle görülebilir). */
const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Tümü' },
  { value: 'PLANNING', label: PROJECT_STATUS_LABELS.PLANNING },
  { value: 'ACTIVE', label: PROJECT_STATUS_LABELS.ACTIVE },
  { value: 'ON_HOLD', label: PROJECT_STATUS_LABELS.ON_HOLD },
  { value: 'COMPLETED', label: PROJECT_STATUS_LABELS.COMPLETED },
  { value: 'ARCHIVED', label: PROJECT_STATUS_LABELS.ARCHIVED },
];

function statusTone(status: ProjectStatus): 'approved' | 'pending' | 'submitted' | 'neutral' | 'draft' {
  switch (status) {
    case 'ACTIVE':
      return 'approved';
    case 'ON_HOLD':
      return 'pending';
    case 'COMPLETED':
      return 'submitted';
    case 'ARCHIVED':
      return 'neutral';
    default:
      return 'draft';
  }
}

/**
 * Projeler (Faz 03 — gerçek API verisi):
 * arama, durum filtresi, kart listesi ve (project.edit izni varsa) proje oluşturma.
 * Karta dokununca sekmeli proje detayına gider. Kartta ad, kod, durum, tarih, sorumlu.
 */
export function ProjectsScreen() {
  const { user } = useAuth();
  const canEdit = permissionsForRoles(user?.roles ?? []).has('project.edit');

  const [projects, setProjects] = useState<ProjectDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Yeni proje formu
  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [plannedEndDate, setPlannedEndDate] = useState('');
  const [contractAmount, setContractAmount] = useState('');
  const [formError, setFormError] = useState<string>();
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const token = await tokenStorage.loadAccessToken();
      if (!token) {
        setError('Oturum bulunamadı. Lütfen tekrar giriş yapın.');
        setLoading(false);
        return;
      }
      if (!opts?.silent) setLoading(true);
      setError(undefined);
      try {
        const res = await projectsApi.list(token, {
          search: search.trim() || undefined,
          status: statusFilter || undefined,
        });
        setProjects(res.data);
        setTotal(res.meta.total);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setError('Oturumunuz sona erdi. Tekrar giriş yapın.');
        } else {
          setError(err instanceof Error ? err.message : 'Projeler yüklenemedi');
        }
      } finally {
        setLoading(false);
      }
    },
    [search, statusFilter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Arama gecikmeli — her tuşta istek atılmaz
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }, [load]);

  if (selectedId) {
    return (
      <ProjectDetailScreen
        projectId={selectedId}
        onBack={() => {
          setSelectedId(null);
          void load({ silent: true });
        }}
      />
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.headerRow}>
        <Text style={typography.screenTitle}>Projeler</Text>
        <Text style={typography.secondary}>{projects ? `${total} proje` : ''}</Text>
      </View>

      {/* Arama */}
      <TextField
        label="Ara"
        placeholder="Kod, proje adı veya işveren"
        value={searchInput}
        onChangeText={setSearchInput}
        accessibilityLabel="Proje ara"
      />

      {/* Durum filtresi */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.value;
          return (
            <Pressable
              key={f.value || 'all'}
              accessibilityRole="button"
              accessibilityLabel={`Durum filtresi: ${f.label}`}
              accessibilityState={{ selected: active }}
              onPress={() => setStatusFilter(f.value)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Yeni proje (project.edit izni) */}
      {canEdit && (
        <Button
          label={showCreate ? 'Formu Kapat' : 'Yeni Proje'}
          variant={showCreate ? 'secondary' : 'primary'}
          onPress={() => {
            setShowCreate((v) => !v);
            setFormError(undefined);
          }}
        />
      )}

      {showCreate && canEdit && (
        <Card>
          <Text style={typography.sectionTitle}>Yeni Proje</Text>
          <View style={styles.formGap}>
            <TextField label="Proje Kodu" required value={code} onChangeText={setCode} helpText="Kurulum içinde benzersiz" />
            <TextField label="Proje Adı" required value={name} onChangeText={setName} />
            <TextField label="Başlangıç (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} />
            <TextField label="Planlanan Bitiş (YYYY-MM-DD)" value={plannedEndDate} onChangeText={setPlannedEndDate} />
            <TextField label="Sözleşme Tutarı" value={contractAmount} onChangeText={setContractAmount} helpText="Örn. 1234567.89" />
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}
            <Button
              label="Proje Oluştur"
              loading={creating}
              onPress={async () => {
                const token = await tokenStorage.loadAccessToken();
                if (!token) return;
                setCreating(true);
                setFormError(undefined);
                try {
                  await projectsApi.create(token, {
                    code: code.trim(),
                    name: name.trim(),
                    startDate: startDate.trim() || undefined,
                    plannedEndDate: plannedEndDate.trim() || undefined,
                    contractAmount: contractAmount.trim() || undefined,
                  });
                  setShowCreate(false);
                  setCode('');
                  setName('');
                  setStartDate('');
                  setPlannedEndDate('');
                  setContractAmount('');
                  await load({ silent: true });
                } catch (err) {
                  setFormError(err instanceof Error ? err.message : 'Proje oluşturulamadı');
                } finally {
                  setCreating(false);
                }
              }}
            />
          </View>
        </Card>
      )}

      {/* Liste durumları */}
      {loading && !projects ? (
        <LoadingSkeleton rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : projects && projects.length === 0 ? (
        <EmptyState
          title="Görüntülenecek proje yok"
          description="Erişim kapsamınızda proje bulunmuyor. Filtreleri temizleyin veya proje üyeliği talep edin."
        />
      ) : (
        <View style={styles.listGap}>
          {projects?.map((p) => (
            <Card key={p.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${p.name} detayını aç`}
                onPress={() => setSelectedId(p.id)}
              >
                <View style={styles.cardHead}>
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.projectCode}>{p.code}</Text>
                    <Text style={styles.projectName}>{p.name}</Text>
                  </View>
                  <StatusBadge tone={statusTone(p.status)}>{PROJECT_STATUS_LABELS[p.status]}</StatusBadge>
                </View>
                <View style={styles.metaRow}>
                  <FolderKanban size={14} color={colors.brand[600]} />
                  <Text style={styles.metaText}>
                    {p.startDate ?? '—'} → {p.plannedEndDate ?? '—'}
                  </Text>
                </View>
                <Text style={styles.metaText}>
                  Sorumlu: {p.manager?.fullName ?? '—'} · Şantiye: {p.siteCount} · Üye: {p.memberCount}
                </Text>
              </Pressable>
            </Card>
          ))}
        </View>
      )}

      <Text style={styles.note}>
        Projeler silinmez; arşivlenir. Bağlı şantiye ve üye kayıtları korunur.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface[50] },
  content: { padding: spacing['4'], gap: spacing['3'] },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  chipRow: { gap: spacing['2'], paddingVertical: 2 },
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface[0],
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.brand[900], borderColor: colors.brand[900] },
  chipText: { fontSize: 12, color: colors.text.primary },
  chipTextActive: { color: '#FFFFFF', fontWeight: '700' },
  formGap: { gap: spacing['3'], marginTop: spacing['2'] },
  formError: { fontSize: 12, fontWeight: '600', color: colors.semantic.danger },
  listGap: { gap: spacing['3'] },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing['2'] },
  cardTitleWrap: { flex: 1, gap: 2 },
  projectCode: { fontSize: 11, fontWeight: '800', color: colors.brand[600], letterSpacing: 0.5 },
  projectName: { fontSize: 15, fontWeight: '700', color: colors.text.primary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing['2'] },
  metaText: { ...typography.secondary, marginTop: 2 },
  note: { ...typography.secondary, textAlign: 'center', marginTop: spacing['2'] },
});
