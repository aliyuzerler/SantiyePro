import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ListChecks } from 'lucide-react-native';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton';
import { StatusBadge } from '../components/ui/StatusBadge';
import { tokenStorage } from '../lib/secure-store';
import { ApiError, projectsApi, tasksApi, type ProjectDto, type TaskDto } from '../lib/api';
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskStatus,
} from '@santiyepro/contracts';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { TaskDetailScreen } from './TaskDetailScreen';

function statusTone(status: TaskStatus): 'approved' | 'pending' | 'submitted' | 'neutral' | 'draft' {
  switch (status) {
    case 'IN_PROGRESS':
      return 'submitted';
    case 'BLOCKED':
      return 'draft';
    case 'DONE':
      return 'approved';
    case 'CANCELLED':
      return 'neutral';
    default:
      return 'draft';
  }
}

/** ISO termin → kısa gösterim (YYYY-MM-DD HH:mm, yerel saat). */
function formatDue(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Mode = 'mine' | 'project';

/**
 * Görevler (Faz 04 — gerçek API verisi):
 * "Bana Atananlar" (assigneeId=me) ve "Proje Görevleri" (proje seçimi) sekmeleri,
 * geciken görevlerde gecikme işareti. Karta dokununca görev detay ekranı açılır.
 */
export function TasksScreen() {
  const [mode, setMode] = useState<Mode>('mine');
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);

  const [tasks, setTasks] = useState<TaskDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Proje listesi (Proje Görevleri sekmesi için)
  useEffect(() => {
    void (async () => {
      const token = await tokenStorage.loadAccessToken();
      if (!token) return;
      try {
        const res = await projectsApi.list(token, { sort: 'name', order: 'asc' });
        setProjects(res.data);
      } catch {
        setProjects([]);
      }
    })();
  }, []);

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
        const res = await tasksApi.list(token, {
          assigneeId: mode === 'mine' ? 'me' : undefined,
          projectId: mode === 'project' ? (projectId ?? undefined) : undefined,
          sort: mode === 'mine' ? 'dueAt' : 'createdAt',
          order: mode === 'mine' ? 'asc' : 'desc',
        });
        setTasks(res.data);
        setTotal(res.meta.total);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setError('Oturumunuz sona erdi. Tekrar giriş yapın.');
        } else {
          setError(err instanceof Error ? err.message : 'Görevler yüklenemedi');
        }
      } finally {
        setLoading(false);
      }
    },
    [mode, projectId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }, [load]);

  if (selectedId) {
    return (
      <TaskDetailScreen
        taskId={selectedId}
        onBack={() => {
          setSelectedId(null);
          void load({ silent: true });
        }}
      />
    );
  }

  const emptyTitle = mode === 'mine' ? 'Sana atanan görev yok' : 'Bu projede görev yok';
  const emptyDescription =
    mode === 'mine'
      ? 'Sana atanan bir görev olduğunda burada görünecek. Görev başlatmak ve tamamlamak için görev detayını kullan.'
      : 'Proje seçip görev listesini görüntüleyebilirsin.';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.headerRow}>
        <Text style={typography.screenTitle}>Görevler</Text>
        <Text style={typography.secondary}>{tasks ? `${total} görev` : ''}</Text>
      </View>

      {/* Mod sekmeleri */}
      <View style={styles.segmentRow} accessibilityRole="tablist">
        <Pressable
          accessibilityRole="tab"
          accessibilityLabel="Bana Atananlar"
          accessibilityState={{ selected: mode === 'mine' }}
          onPress={() => {
            setMode('mine');
            setSelectedId(null);
          }}
          style={[styles.segment, mode === 'mine' && styles.segmentActive]}
        >
          <Text style={[styles.segmentText, mode === 'mine' && styles.segmentTextActive]}>Bana Atananlar</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityLabel="Proje Görevleri"
          accessibilityState={{ selected: mode === 'project' }}
          onPress={() => {
            setMode('project');
            setSelectedId(null);
          }}
          style={[styles.segment, mode === 'project' && styles.segmentActive]}
        >
          <Text style={[styles.segmentText, mode === 'project' && styles.segmentTextActive]}>Proje Görevleri</Text>
        </Pressable>
      </View>

      {/* Proje seçimi (Proje Görevleri modu) */}
      {mode === 'project' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {projects.map((p) => {
            const active = projectId === p.id;
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={`Proje filtresi: ${p.name}`}
                accessibilityState={{ selected: active }}
                onPress={() => setProjectId(p.id)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.code}</Text>
              </Pressable>
            );
          })}
          {projects.length === 0 && <Text style={typography.secondary}>Proje bulunamadı.</Text>}
        </ScrollView>
      )}

      {/* Liste durumları */}
      {loading && !tasks ? (
        <LoadingSkeleton rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : tasks && tasks.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <View style={styles.listGap}>
          {tasks?.map((t) => (
            <Card key={t.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t.title} görev detayını aç`}
                onPress={() => setSelectedId(t.id)}
              >
                <View style={styles.cardHead}>
                  <Text style={styles.taskTitle}>{t.title}</Text>
                  <StatusBadge tone={statusTone(t.status)}>{TASK_STATUS_LABELS[t.status]}</StatusBadge>
                </View>
                <Text style={styles.metaText}>
                  {t.projectCode}
                  {t.assignee ? ` · ${t.assignee.fullName}` : ' · Atanmadı'}
                  {' · '}
                  {TASK_PRIORITY_LABELS[t.priority]}
                </Text>
                <View style={styles.dueRow}>
                  <ListChecks size={14} color={colors.brand[600]} />
                  <Text style={styles.metaText}>Termin: {formatDue(t.dueAt)}</Text>
                  {t.overdue && (
                    <View style={styles.overdueBadge}>
                      <Text style={styles.overdueText}>Gecikmiş</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            </Card>
          ))}
        </View>
      )}

      <Text style={styles.note}>
        Görev durumu değişiklikleri geçmişte saklanır; atanan kişi kendi görevini başlatıp tamamlayabilir.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface[50] },
  content: { padding: spacing['4'], gap: spacing['3'] },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  segmentRow: {
    flexDirection: 'row',
    gap: spacing['2'],
    backgroundColor: colors.surface[0],
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: 3,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.input,
  },
  segmentActive: { backgroundColor: colors.brand[900] },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.text.secondary },
  segmentTextActive: { color: '#FFFFFF' },
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
  listGap: { gap: spacing['3'] },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing['2'] },
  taskTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text.primary },
  metaText: { ...typography.secondary, marginTop: 2 },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing['1'] },
  overdueBadge: {
    marginLeft: 6,
    backgroundColor: colors.semantic.danger,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  overdueText: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
  note: { ...typography.secondary, textAlign: 'center', marginTop: spacing['2'] },
});
