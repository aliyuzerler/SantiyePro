/**
 * ŞantiyePro mobil uygulama — Faz 00 bootable iskelet.
 * Tasarım sistemi ve alt navigasyon kabuğu Faz 01'de eklenir.
 */
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { designTokens } from '@santiyepro/contracts/tokens';

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.brand}>
        <Text style={styles.title}>ŞantiyePro</Text>
        <Text style={styles.subtitle}>PROJECT CONTROL</Text>
      </View>
      <Text style={styles.note}>
        Uygulama kabuğu Faz 01'de eklenmektedir. Bu ekran yalnızca iskelet başlatmasını doğrular.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: designTokens.color.brand[900],
    alignItems: 'center',
    justifyContent: 'center',
    padding: designTokens.spacingPx[4],
  },
  brand: { alignItems: 'center', marginBottom: designTokens.spacingPx[6] },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#AEBDCB', fontSize: 11, letterSpacing: 2, marginTop: 4 },
  note: { color: '#C4D0DC', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
