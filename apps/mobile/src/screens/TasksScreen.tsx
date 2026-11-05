import { StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '../components/ui/EmptyState';
import { spacing, typography } from '../theme/tokens';

export function TasksScreen() {
  return (
    <View style={styles.screen}>
      <Text style={typography.screenTitle}>Görevler</Text>
      <Text style={typography.secondary}>Bana atananlar / projedekiler filtreleri Faz 04'te eklenecek.</Text>
      <EmptyState
        title="Görev listesi boş"
        description="Görev oluşturma, atama ve durum güncelleme Faz 04'te aktif olacak. Termin geçen görevlerde gecikme işareti görünecek."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing['4'], gap: spacing['3'] },
});
