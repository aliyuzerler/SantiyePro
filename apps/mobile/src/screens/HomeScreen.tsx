import { StyleSheet, Text, View } from 'react-native';
import { CloudOff, FileText, FolderKanban, ListChecks, Server } from 'lucide-react-native';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { colors, spacing, typography } from '../theme/tokens';

/**
 * Ana sayfa — design/02 akışı:
 * üstte marka/senkron göstergesi, atanmış proje kartları, bugünün görevleri.
 * Faz 01 iskeletinde veri yoktur; dürüst boş durumlar gösterilir.
 */
export function HomeScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>ŞantiyePro</Text>
          <Text style={styles.brandNote}>PROJECT CONTROL</Text>
        </View>
        <View style={styles.syncNote} accessibilityLabel="Senkronizasyon durumu: Faz 09'da eklenecek">
          <CloudOff size={14} color={colors.text.secondary} />
          <Text style={styles.syncText}>Senkron göstergesi Faz 09'da</Text>
        </View>
      </View>

      <Text style={styles.greeting}>Günlük saha operasyonlarınız burada toplanacak.</Text>

      <Card>
        <View style={styles.sectionHead}>
          <FolderKanban size={16} color={colors.brand[600]} />
          <Text style={typography.sectionTitle}>Atandığım projeler</Text>
        </View>
        <EmptyState
          title="Henüz proje atanmadı"
          description="Proje modülü Faz 03'te eklenecek; sonra burada size atanan aktif projeler görünecek."
        />
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
        <Text style={typography.body}>Giriş ve sunucu yapılandırması Faz 02'de eklenecek.</Text>
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
});
