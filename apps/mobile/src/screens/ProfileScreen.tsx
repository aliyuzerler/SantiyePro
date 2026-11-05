import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/ui/Card';
import { colors, spacing, typography } from '../theme/tokens';

const APP_VERSION = '0.1.0';

/**
 * Profil / ayarlar — design/02 bölüm 9.
 * Oturum, parola, bildirim ve senkron kuyruğu ilgili fazlarda eklenir.
 */
export function ProfileScreen() {
  return (
    <View style={styles.screen}>
      <Text style={typography.screenTitle}>Profil</Text>

      <Card style={styles.infoCard}>
        <View style={styles.row}>
          <Text style={typography.body}>Uygulama sürümü</Text>
          <Text style={styles.value}>{APP_VERSION}</Text>
        </View>
        <View style={styles.row}>
          <Text style={typography.body}>Sunucu bağlantısı</Text>
          <Text style={styles.pending}>Faz 02'de eklenecek</Text>
        </View>
        <View style={styles.row}>
          <Text style={typography.body}>Senkronizasyon kuyruğu</Text>
          <Text style={styles.pending}>Faz 09'da eklenecek</Text>
        </View>
        <View style={styles.row}>
          <Text style={typography.body}>Bildirim tercihleri</Text>
          <Text style={styles.pending}>Faz 02+'da eklenecek</Text>
        </View>
      </Card>

      <Text style={typography.secondary}>
        Çıkış yapma ve parola değiştirme işlemleri kimlik modülüyle (Faz 02) birlikte gelir.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing['4'], gap: spacing['3'] },
  infoCard: { gap: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 24,
  },
  value: { fontSize: 15, fontWeight: '700', color: colors.text.primary, fontVariant: ['tabular-nums'] },
  pending: { fontSize: 13, color: colors.text.secondary },
});
