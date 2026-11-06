import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton';
import { StatusBadge } from '../components/ui/StatusBadge';
import { TextField } from '../components/ui/TextField';
import { tokenStorage } from '../lib/secure-store';
import { ApiError, tasksApi, type TaskDetailDto } from '../lib/api';
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  nextTaskStatuses,
  permissionsForRoles,
  type TaskPriority,
  type TaskStatus,
} from '@santiyepro/contracts';
import { colors, spacing, typography } from '../theme/tokens';
import { useAuth } from '../lib/auth-context';
import { useSyncOptional } from '../lib/sync/sync-context';
import { generateClientMutationId } from '../lib/offline-media-queue';

/**
 * Ağ kaynaklı hata mı? ApiError (sunucu yanıtı) DEĞİLSE bağlantı sorunudur —
 * 4xx doğrulama/yetki hataları kalıcıdır ve kuyruğa alınmaz (docs/09).
 */
function isNetworkFailure(err: unknown): boolean {
  return !(err instanceof ApiError);
}

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

function priorityTone(priority: TaskPriority): 'approved' | 'pending' | 'submitted' | 'neutral' | 'draft' {
  switch (priority) {
    case 'CRITICAL':
      return 'draft';
    case 'HIGH':
      return 'pending';
    case 'LOW':
      return 'neutral';
    default:
      return 'submitted';
  }
}

function formatDue(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Görev detay ekranı (Faz 04):
 * meta, durum geçiş butonları (atanan kişi veya task.edit), kontrol listesi
 * (madde işaretleme), yorumlar (ekleme) ve durum geçmişi. Termin geçmişse
 * gecikme işareti gösterilir.
 */
export function TaskDetailScreen({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const { user } = useAuth();
  const sync = useSyncOptional();
  const [detail, setDetail] = useState<TaskDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  /** Çevrimdışı kuyruğa alınan değişiklik bilgisi — "sunucu onayı bekliyor". */
  const [offlineQueued, setOfflineQueued] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string>();

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
        setDetail(await tasksApi.get(token, taskId));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setError('Oturumunuz sona erdi. Tekrar giriş yapın.');
        } else {
          setError(err instanceof Error ? err.message : 'Görev yüklenemedi');
        }
      } finally {
        setLoading(false);
      }
    },
    [taskId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }, [load]);

  // Yeniden yükleme başarılı olursa "kuyruğa alındı" bilgisi temizlenir (sunucu güncel).
  useEffect(() => {
    if (detail) setOfflineQueued(false);
  }, [detail]);

  async function changeStatus(nextStatus: string) {
    const token = await tokenStorage.loadAccessToken();
    if (!token || !detail) return;
    setBusy(true);
    setError(undefined);
    try {
      await tasksApi.update(token, detail.id, { status: nextStatus });
      await load({ silent: true });
    } catch (err) {
      if (isNetworkFailure(err) && sync) {
        // Çevrimdışı akış (docs/09): durum değişikliği outbox'a yazılır; sunucu
        // onaylanana kadar kuyruk ekranında "sunucu onayı bekliyor" görünür.
        await sync.enqueue('task.update', { taskId: detail.id, status: nextStatus }, generateClientMutationId());
        setError(undefined);
        setOfflineQueued(true);
      } else {
        setError(err instanceof Error ? err.message : 'Durum değiştirilemedi');
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleChecklistItem(index: number) {
    const token = await tokenStorage.loadAccessToken();
    if (!token || !detail) return;
    const nextChecklist = detail.checklist.map((item, i) =>
      i === index ? { ...item, done: !item.done } : item,
    );
    setBusy(true);
    setError(undefined);
    try {
      await tasksApi.update(token, detail.id, { checklist: nextChecklist, version: detail.version });
      await load({ silent: true });
    } catch (err) {
      if (isNetworkFailure(err) && sync) {
        // Checklist değişimi version ile gönderilir: arada sunucuda değiştiyse
        // push 'conflict' döner — otomatik üzerine yazma yoktur (docs/09).
        await sync.enqueue(
          'task.update',
          { taskId: detail.id, checklist: nextChecklist, version: detail.version },
          generateClientMutationId(),
        );
        setError(undefined);
        setOfflineQueued(true);
      } else {
        setError(err instanceof Error ? err.message : 'Kontrol listesi güncellenemedi');
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    const token = await tokenStorage.loadAccessToken();
    if (!token || !detail || !comment.trim()) return;
    setBusy(true);
    setCommentError(undefined);
    const body = comment.trim();
    try {
      await tasksApi.addComment(token, detail.id, body);
      setComment('');
      await load({ silent: true });
    } catch (err) {
      if (isNetworkFailure(err) && sync) {
        // Yorum append-only'dir; kuyruktan tekrar gönderim clientMutationId
        // ile tek kayıt oluşturur (test senaryosu 3).
        await sync.enqueue('task.comment', { taskId: detail.id, body }, generateClientMutationId());
        setComment('');
        setOfflineQueued(true);
      } else {
        setCommentError(err instanceof Error ? err.message : 'Yorum eklenemedi');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading && !detail) {
    return (
      <View style={styles.screen}>
        <View style={styles.headerRow}>
          <BackButton onPress={onBack} />
        </View>
        <LoadingSkeleton rows={6} />
      </View>
    );
  }

  if (error && !detail) {
    return (
      <View style={styles.screen}>
        <View style={styles.headerRow}>
          <BackButton onPress={onBack} />
        </View>
        <ErrorState message={error} onRetry={() => void load()} />
      </View>
    );
  }

  if (!detail) return null;

  const isAssignee = detail.assigneeId === user?.id;
  const canEdit = permissionsForRoles(user?.roles ?? []).has('task.edit');
  const transitions = nextTaskStatuses(detail.status);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.headerRow}>
        <BackButton onPress={onBack} />
      </View>

      <Text style={typography.screenTitle}>{detail.title}</Text>
      <Text style={typography.secondary}>
        {detail.projectCode}
        {detail.siteName ? ` · ${detail.siteName}` : ''}
        {detail.assignee ? ` · ${detail.assignee.fullName}` : ' · Atanmadı'}
      </Text>
      {offlineQueued ? (
        <Text style={styles.offlineNote} accessibilityLabel="Değişiklik kuyruğa alındı">
          Çevrimdışı: değişiklik kuyruğa alındı — sunucu onayı bekliyor.
        </Text>
      ) : null}

      <View style={styles.badgeRow}>
        <StatusBadge tone={statusTone(detail.status)}>{TASK_STATUS_LABELS[detail.status]}</StatusBadge>
        <StatusBadge tone={priorityTone(detail.priority)}>{TASK_PRIORITY_LABELS[detail.priority]}</StatusBadge>
        {detail.overdue && (
          <View style={styles.overdueBadge}>
            <Text style={styles.overdueText}>Gecikmiş</Text>
          </View>
        )}
      </View>

      <Text style={typography.secondary}>Termin: {formatDue(detail.dueAt)}</Text>

      {detail.description ? (
        <Card>
          <Text style={styles.bodyText}>{detail.description}</Text>
        </Card>
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => void load({ silent: true })} /> : null}
      {/* Durum değiştirme — atanan kişi veya task.edit yetkilisi */}
      {transitions.length > 0 && (isAssignee || canEdit) && (
        <View>
          <Text style={typography.sectionTitle}>Durumu Değiştir</Text>
          <View style={styles.buttonRow}>
            {transitions.map((s) => (
              <Button
                key={s}
                label={TASK_STATUS_LABELS[s]}
                variant={s === 'CANCELLED' ? 'secondary' : 'primary'}
                disabled={busy}
                onPress={() => void changeStatus(s)}
              />
            ))}
          </View>
        </View>
      )}

      {/* Kontrol listesi */}
      {detail.checklist.length > 0 && (
        <View>
          <Text style={typography.sectionTitle}>
            Kontrol Listesi ({detail.checklist.filter((c) => c.done).length}/{detail.checklist.length})
          </Text>
          <Card>
            {detail.checklist.map((item, index) => (
              <Pressable
                key={item.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done }}
                accessibilityLabel={`Kontrol: ${item.label}`}
                disabled={busy}
                onPress={() => void toggleChecklistItem(index)}
                style={styles.checkRow}
              >
                <View style={[styles.checkbox, item.done && styles.checkboxDone]}>
                  {item.done ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <Text style={[styles.checkLabel, item.done && styles.checkLabelDone]}>{item.label}</Text>
              </Pressable>
            ))}
          </Card>
        </View>
      )}

      {/* Yorumlar */}
      <View>
        <Text style={typography.sectionTitle}>Yorumlar ({detail.comments.length})</Text>
        <View style={styles.listGap}>
          {detail.comments.map((c) => (
            <Card key={c.id}>
              <Text style={styles.bodyText}>{c.body}</Text>
              <Text style={styles.commentMeta}>
                {c.userFullName} · {formatDue(c.createdAt)}
              </Text>
            </Card>
          ))}
          {detail.comments.length === 0 && (
            <Text style={typography.secondary}>Henüz yorum yok. İlk saha notunu ekle.</Text>
          )}
        </View>
        <View style={styles.commentForm}>
          <TextField
            label="Yorum Ekle"
            value={comment}
            onChangeText={setComment}
            placeholder="Saha notu…"
            accessibilityLabel="Yorum metni"
          />
          {commentError ? <Text style={styles.errorText}>{commentError}</Text> : null}
          <Button label="Yorum Gönder" disabled={busy || !comment.trim()} onPress={() => void submitComment()} />
        </View>
      </View>

      {/* Durum geçmişi */}
      <View>
        <Text style={typography.sectionTitle}>Durum Geçmişi</Text>
        <Card>
          {detail.statusHistory.map((h) => (
            <Text key={h.id} style={styles.historyRow}>
              {h.fromStatus ? `${TASK_STATUS_LABELS[h.fromStatus]} → ` : 'Oluşturma: '}
              <Text style={styles.historyStrong}>{TASK_STATUS_LABELS[h.toStatus]}</Text>
              {' · '}
              {h.changedByFullName} · {formatDue(h.changedAt)}
            </Text>
          ))}
        </Card>
      </View>
    </ScrollView>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Geri"
      onPress={onPress}
      style={styles.backButton}
    >
      <ArrowLeft size={20} color={colors.brand[900]} />
      <Text style={styles.backText}>Görevler</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface[50] },
  content: { padding: spacing['4'], gap: spacing['3'] },
  headerRow: { marginBottom: spacing['1'] },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: spacing['1'], minHeight: 44, alignSelf: 'flex-start' },
  backText: { fontSize: 13, fontWeight: '600', color: colors.brand[900] },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing['2'], flexWrap: 'wrap' },
  bodyText: { fontSize: 14, color: colors.text.primary, lineHeight: 20 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing['2'] },
  listGap: { gap: spacing['2'] },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing['2'], minHeight: 44 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: colors.brand[900], borderColor: colors.brand[900] },
  checkMark: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  checkLabel: { flex: 1, fontSize: 14, color: colors.text.primary },
  checkLabelDone: { textDecorationLine: 'line-through', color: colors.text.secondary },
  commentMeta: { ...typography.secondary, marginTop: spacing['1'] },
  commentForm: { gap: spacing['2'], marginTop: spacing['2'] },
  errorText: { fontSize: 12, fontWeight: '600', color: colors.semantic.danger },
  offlineNote: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.semantic.warning,
    backgroundColor: 'rgba(196,143,29,0.12)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 6,
  },
  historyRow: { fontSize: 12, color: colors.text.secondary, paddingVertical: 2 },
  historyStrong: { fontWeight: '700', color: colors.text.primary },
  overdueBadge: {
    backgroundColor: colors.semantic.danger,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  overdueText: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
});
