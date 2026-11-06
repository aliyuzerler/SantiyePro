import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FileText, FolderKanban, ListChecks, Server } from 'lucide-react-native';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { SyncStatusBanner } from '../components/SyncStatusBanner';
import { colors, spacing, typography } from '../theme/tokens';
import { tokenStorage } from '../lib/secure-store';
import { projectsApi, type ProjectDto } from '../lib/api';
import { useSync } from '../lib/sync/sync-context';
import { PROJECT_STATUS_LABELS, type ProjectStatus } from '@santiyepro/contracts';

/**
 * Ana sayfa — design/02 akışı:
 * üstte marka/senkron göstergesi, atanmış aktif proje kartları (gerçek API verisi),
 * bugünün görevleri ve bekleyen raporlar (Faz 04/05'te dolacak).
 * Panel gibi sabit sahte sayılar gösterilmez; veri yoksa dürüst boş durum çıkar.
 */
export function HomeScreen({ onOpenSyncQueue }: { onOpenSyncQueue?: () => void } = {}) {
  const [projects, setProjects] = useState<ProjectDto[] | null>(null);
  const [projectsError, setProjectsError] = useState<string>();
  const { snapshot } = useSync();

  const loadProjects = useCallback(async () => {
    const token = await tokenStorage.loadAccessToken();
    if (!token) {
      setProjectsError('Proje listesi için oturum gerekli.');
      return;
    }
    try {
      const res = await projectsApi.list(token, { status: 'ACTIVE', pageSize: 3 });
      setProjects(res.data);
      setProjectsError(undefined);
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : 'Proje listesi yüklenemedi');
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>ŞantiyePro</Text>
          <Text style={styles.brandNote}>PROJECT CONTROL</Text>
        </View>
        <View style={styles.syncNote}>
          <SyncStatusBanner snapshot={snapshot} onPress={onOpenSyncQueue} />
        </View>
      </View>

      <Text style={styles.greeting}>Günlük saha operasyonlarınız burada toplanacak.</Text>

      <Card>
        <View style={styles.sectionHead}>
          <FolderKanban size={16} color={colors.brand[600]} />
          <Text style={typography.sectionTitle}>Atandığım aktif projeler</Text>
        </View>
        {projectsError ? (
          <Text style={styles.listError}>{projectsError}</Text>
        ) : projects === null ? (
          <Text style={typography.secondary}>Yükleniyor…</Text>
        ) : projects.length === 0 ? (
          <EmptyState
            title="Henüz proje atanmadı"
            description="Üyesi olduğunuz aktif projeler burada görünür. Proje üyeliğiniz için firma yöneticinize başvurun."
          />
        ) : (
          <View style={styles.projectGap}>
            {projects.map((p) => (
              <View key={p.id} style={styles.projectRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectName}>{p.name}</Text>
                  <Text style={typography.secondary}>
                    {p.code} · Sorumlu: {p.manager?.fullName ?? '—'}
                  </Text>
                </View>
                <Text style={styles.projectStatus}>{PROJECT_STATUS_LABELS[p.status as ProjectStatus]}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <View style={styles.sectionHead}>
          <ListChecks size={16} color={colors.brand[600]} />
          <Text style={typography.sectionTitle}>Bugünün görevleri</Text>
        </View>
        <EmptyState
          title="Görev listesi boş"
          description="Görev yönetimi Faz 04'te eklenecek; görevleriniz ve terminleri burada listelenecek."
        />
      </Card>

      <Card>
        <View style={styles.sectionHead}>
          <FileText size={16} color={colors.brand[600]} />
          <Text style={typography.sectionTitle}>Bekleyen raporlar</Text>
        </View>
        <EmptyState
          title="Günlük rapor akışı yok"
          description="Günlük rapor modülü Faz 05'te eklenecek; rapor taslaklarınız ve gönderim durumu burada görünür."
        />
      </Card>

      <Card>
        <View style={styles.sectionHead}>
          <Server size={16} color={colors.brand[600]} />
          <Text style={typography.sectionTitle}>Sunucu bağlantısı</Text>
        </View>
        <Text style={typography.body}>Sunucu yapılandırması profil ekranından yapılır.</Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing['4'], gap: spacing['3'] },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  brand: { fontSize: 20, fontWeight: '800', color: colors.brand[900] },
  brandNote: { fontSize: 10, letterSpacing: 1.5, color: colors.text.secondary },
  syncNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  syncText: { fontSize: 11, color: colors.text.secondary },
  greeting: { ...typography.body, marginBottom: 4 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  projectGap: { gap: 12 },
  projectRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  projectName: { fontSize: 14, fontWeight: '700', color: colors.text.primary },
  projectStatus: { fontSize: 12, fontWeight: '700', color: colors.brand[600] },
  listError: { fontSize: 12, color: colors.text.secondary },
});
