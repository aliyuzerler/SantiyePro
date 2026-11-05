import { StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '../components/ui/EmptyState';
import { spacing, typography } from '../theme/tokens';

export function ProjectsScreen() {
  return (
    <View style={styles.screen}>
      <Text style={typography.screenTitle}>Projeler</Text>
      <Text style={typography.secondary}>Arama, durum filtresi ve kart listesi Faz 03'te eklenecek.</Text>
      <EmptyState
        title="Proje listesi boş"
        description="Proje oluşturma ve atama Faz 03'te aktif olacak. Kartlarda proje adı, kodu, durumu ve sorumlu görünecek."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing['4'], gap: spacing['3'] },
});
