/**
 * Senkronizasyon durum bandı (Faz 09 — docs/09 kullanıcıya gösterilecek durumlar).
 *
 * Durumlar:
 * - Çevrimdışı — veriler bu cihazda saklanıyor.
 * - Senkronizasyon bekliyor — X kayıt.
 * - Senkronize ediliyor.
 * - Güncel — son senkronizasyon zamanı.
 * - Çakışma/hata — çözüm gerektiren kayıt sayısı.
 * Bandıza dokunmak kuyruk ekranını açar (onOpenQueue).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckCircle2, CloudOff, Loader2, TriangleAlert, UploadCloud } from 'lucide-react-native';
import { colors, radius, spacing, typography } from '../theme/tokens';
import type { SyncSnapshot } from '../lib/sync/types';

export interface SyncStatusBannerProps {
  snapshot: SyncSnapshot;
  onPress?: () => void;
}

export function SyncStatusBanner({ snapshot, onPress }: SyncStatusBannerProps) {
  const { online, syncing, pendingCount, conflictCount, rejectedCount, failedCount, lastSyncAt, authExpired } = snapshot;

  let icon = <CheckCircle2 size={14} color={colors.semantic.success} />;
  let text = 'Güncel';
  let tone = styles.ok;
  let label = 'Senkronizasyon durumu: güncel';

  if (!online) {
    icon = <CloudOff size={14} color={colors.semantic.warning} />;
    text = pendingCount > 0 ? `Çevrimdışı — ${pendingCount} kayıt bu cihazda bekliyor` : 'Çevrimdışı — veriler bu cihazda saklanıyor';
    tone = styles.offline;
    label = 'Senkronizasyon durumu: çevrimdışı';
  } else if (syncing) {
    icon = <Loader2 size={14} color={colors.brand[600]} />;
    text = 'Senkronize ediliyor…';
    tone = styles.pending;
    label = 'Senkronizasyon durumu: senkronize ediliyor';
  } else if (authExpired) {
    icon = <TriangleAlert size={14} color={colors.semantic.danger} />;
    text = 'Oturum süresi doldu — kuyruk bekliyor';
    tone = styles.error;
    label = 'Senkronizasyon durumu: oturum gerekli';
  } else if (conflictCount > 0 || rejectedCount > 0 || failedCount > 0) {
    icon = <TriangleAlert size={14} color={colors.semantic.warning} />;
    const parts: string[] = [];
    if (conflictCount > 0) parts.push(`${conflictCount} çakışma`);
    if (rejectedCount > 0) parts.push(`${rejectedCount} reddedilen`);
    if (failedCount > 0) parts.push(`${failedCount} hata`);
    text = `Dikkat — ${parts.join(', ')}`;
    tone = styles.warning;
    label = `Senkronizasyon durumu: ${parts.join(', ')}`;
  } else if (pendingCount > 0) {
    icon = <UploadCloud size={14} color={colors.brand[600]} />;
    text = `Senkronizasyon bekliyor — ${pendingCount} kayıt`;
    tone = styles.pending;
    label = 'Senkronizasyon durumu: bekleyen kayıt var';
  }

  const lastSync = lastSyncAt ? `Son senkron: ${formatClock(lastSyncAt)}` : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.banner, tone]}
      disabled={!onPress}
      testID="sync-status-banner"
    >
      <View style={styles.row}>
        {icon}
        <Text style={styles.text}>{text}</Text>
      </View>
      {lastSync && !syncing ? <Text style={styles.lastSync}>{lastSync}</Text> : null}
    </Pressable>
  );
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.card,
    paddingHorizontal: spacing['4'],
    paddingVertical: spacing['2'],
    gap: 2,
  },
  ok: { backgroundColor: 'rgba(47,133,90,0.10)' },
  offline: { backgroundColor: 'rgba(196,143,29,0.12)' },
  pending: { backgroundColor: 'rgba(31,79,134,0.10)' },
  warning: { backgroundColor: 'rgba(196,143,29,0.16)' },
  error: { backgroundColor: 'rgba(178,58,58,0.12)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing['2'] },
  text: { fontSize: 13, fontWeight: '600', color: colors.text.primary, flexShrink: 1 },
  lastSync: { ...typography.secondary, marginLeft: 26 },
});
