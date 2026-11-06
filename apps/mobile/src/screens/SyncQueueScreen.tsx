/**
 * Senkronizasyon kuyruğu ekranı (Faz 09 — docs/09 sync queue ekranı).
 *
 * Gösterir: bekleyen, gönderilen (tamamlanan), hata/çakışma/reddedilen kayıtlar
 * ve son başarılı senkron zamanı. Hata kaydı açıklamasıyla görünür; kullanıcı
 * güvenli retry yapabilir (sayaç sıfırlanır, kayıt yeniden gönderilir — sunucu
 * clientMutationId ile çift kayıt üretmez). Tamamlananlar temizlenebilir;
 * hatalı kayıtlar asla sessizce silinmez (docs/09, test senaryosu 10).
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CheckCircle2, CloudUpload, RotateCcw } from 'lucide-react-native';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { colors, gutter, spacing, typography } from '../theme/tokens';
import { useSync } from '../lib/sync/sync-context';
import type { OutboxItem, OutboxStatus } from '../lib/sync/types';

const STATUS_LABELS: Record<OutboxStatus, string> = {
  pending: 'Bekliyor',
  sending: 'Gönderiliyor',
  done: 'Gönderildi',
  failed: 'Hata — deneme hakkı bitti',
  rejected: 'Reddedildi',
  conflict: 'Çakışma',
};

const TYPE_LABELS: Record<string, string> = {
  'attendance.mark': 'Puantaj işaretleme',
  'task.update': 'Görev güncelleme',
  'task.comment': 'Görev yorumu',
  'dailyReport.upsertDraft': 'Günlük rapor taslağı',
  'expense.create': 'Gider kaydı',
  'stock.movement': 'Stok hareketi',
};

export function SyncQueueScreen({ onClose }: { onClose: () => void }) {
  const { snapshot, listOutbox, retry, retryAll, clearDone, syncNow } = useSync();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setItems(await listOutbox());
  }, [listOutbox]);

  // Snapshot değiştikçe (senkron ilerledikçe) liste tazelenir.
  useEffect(() => {
    void refresh();
  }, [refresh, snapshot.pendingCount, snapshot.doneCount, snapshot.conflictCount, snapshot.rejectedCount]);

  const onRetry = async (id: string) => {
    setBusy(true);
    try {
      await retry(id);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onRetryAll = async () => {
    setBusy(true);
    try {
      await retryAll();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onClearDone = async () => {
    setBusy(true);
    try {
      await clearDone();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onManualSync = async () => {
    setBusy(true);
    try {
      await syncNow();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const actionable = items.filter((i) => i.status === 'failed' || i.status === 'rejected' || i.status === 'conflict');

  return (
    <View style={styles.screen} testID="sync-queue-screen">
      <View style={styles.header}>
        <CloudUpload size={20} color={colors.brand[900]} />
        <Text style={typography.screenTitle}>Senkronizasyon</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Kapat" onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>Kapat</Text>
        </Pressable>
      </View>

      <View style={styles.summaryRow}>
        <SummaryChip label="Bekleyen" value={snapshot.pendingCount} tone={styles.chipPending} />
        <SummaryChip label="Gönderilen" value={snapshot.doneCount} tone={styles.chipDone} />
        <SummaryChip
          label="Çakışma/Hata"
          value={snapshot.conflictCount + snapshot.rejectedCount + snapshot.failedCount}
          tone={styles.chipError}
        />
      </View>
      <Text style={styles.lastSync}>
        {snapshot.lastSyncAt ? `Son başarılı senkron: ${formatDateTime(snapshot.lastSyncAt)}` : 'Henüz senkronizasyon yapılmadı'}
      </Text>
      {snapshot.lastError ? <Text style={styles.lastError}>{snapshot.lastError}</Text> : null}

      <View style={styles.actions}>
        <Button label="Şimdi senkronize et" onPress={onManualSync} loading={busy || snapshot.syncing} style={styles.actionButton} />
        {actionable.length > 0 ? (
          <Button
            label={`Hatalıları yeniden dene (${actionable.length})`}
            variant="secondary"
            onPress={onRetryAll}
            disabled={busy}
            style={styles.actionButton}
          />
        ) : null}
        {snapshot.doneCount > 0 ? (
          <Button label="Gönderilenleri temizle" variant="tertiary" onPress={onClearDone} disabled={busy} style={styles.actionButton} />
        ) : null}
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {items.length === 0 ? (
          <EmptyState
            title="Kuyruk boş"
            description="Çevrimdışı oluşturduğunuz kayıtlar burada listelenir ve bağlantı geldiğinde sunucuya gönderilir."
          />
        ) : (
          items.map((item) => (
            <QueueRow key={item.clientMutationId} item={item} onRetry={() => onRetry(item.clientMutationId)} busy={busy} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function QueueRow({ item, onRetry, busy }: { item: OutboxItem; onRetry: () => void; busy: boolean }) {
  const isProblem = item.status === 'failed' || item.status === 'rejected' || item.status === 'conflict';
  const isDone = item.status === 'done';
  return (
    <Card style={styles.rowCard}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>{TYPE_LABELS[item.type] ?? item.type}</Text>
        <View style={[styles.badge, isDone ? styles.badgeDone : isProblem ? styles.badgeError : styles.badgePending]}>
          <Text
            style={[styles.badgeText, isDone ? styles.badgeTextDone : isProblem ? styles.badgeTextError : styles.badgeTextPending]}
          >
            {STATUS_LABELS[item.status]}
          </Text>
        </View>
      </View>
      <Text style={styles.rowMeta}>
        {formatDateTime(item.createdAt)} · deneme {item.attemptCount}
      </Text>
      {item.lastError ? (
        <Text style={styles.rowError} numberOfLines={3}>
          {item.lastError}
        </Text>
      ) : null}
      {item.status === 'pending' && item.nextAttemptAt ? (
        <Text style={styles.rowMeta}>Yeniden deneme: {formatDateTime(new Date(item.nextAttemptAt).toISOString())}</Text>
      ) : null}
      {isProblem ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Yeniden dene" onPress={onRetry} disabled={busy} style={styles.retryButton}>
          <RotateCcw size={14} color={colors.brand[600]} />
          <Text style={styles.retryText}>Güvenli yeniden dene</Text>
        </Pressable>
      ) : null}
      {isDone ? (
        <View style={styles.doneRow}>
          <CheckCircle2 size={14} color={colors.semantic.success} />
          <Text style={styles.doneText}>Sunucu onayladı</Text>
        </View>
      ) : null}
    </Card>
  );
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone: object }) {
  return (
    <View style={[styles.chip, tone]}>
      <Text style={styles.chipValue}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mo}. ${hh}:${mm}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface[50], padding: gutter },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing['2'], paddingTop: spacing['5'], paddingBottom: spacing['4'] },
  close: { marginLeft: 'auto', color: colors.brand[600], fontWeight: '600' },
  summaryRow: { flexDirection: 'row', gap: spacing['2'] },
  chip: { flex: 1, borderRadius: 10, padding: spacing['2'], alignItems: 'center' },
  chipPending: { backgroundColor: 'rgba(31,79,134,0.10)' },
  chipDone: { backgroundColor: 'rgba(47,133,90,0.10)' },
  chipError: { backgroundColor: 'rgba(178,58,58,0.10)' },
  chipValue: { fontSize: 20, fontWeight: '700', color: colors.text.primary },
  chipLabel: { ...typography.secondary, marginTop: 2 },
  lastSync: { ...typography.secondary, marginTop: spacing['2'] },
  lastError: { color: colors.semantic.danger, fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing['2'], marginTop: spacing['4'] },
  actionButton: { flexGrow: 1 },
  list: { marginTop: spacing['4'], flex: 1 },
  listContent: { paddingBottom: spacing['6'], gap: spacing['2'] },
  rowCard: { gap: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'center' },
  rowTitle: { ...typography.body, fontWeight: '600', flexShrink: 1 },
  badge: { marginLeft: 'auto', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeDone: { backgroundColor: 'rgba(47,133,90,0.12)' },
  badgePending: { backgroundColor: 'rgba(31,79,134,0.10)' },
  badgeError: { backgroundColor: 'rgba(178,58,58,0.12)' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  badgeTextDone: { color: colors.semantic.success },
  badgeTextPending: { color: colors.brand[600] },
  badgeTextError: { color: colors.semantic.danger },
  rowMeta: { ...typography.secondary },
  rowError: { color: colors.semantic.danger, fontSize: 12, marginTop: 2 },
  retryButton: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  retryText: { color: colors.brand[600], fontWeight: '600', fontSize: 13 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  doneText: { color: colors.semantic.success, fontSize: 12, fontWeight: '600' },
});
