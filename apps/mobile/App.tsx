/**
 * ŞantiyePro mobil uygulama — Faz 01: tasarım sistemi ve alt navigasyon kabuğu.
 * Giriş akışı Faz 02'de, kayıt formları Faz 05+ ile eklenir.
 */
import { NavigationContainer, type Theme as NavigationTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootTabs } from './src/navigation/RootTabs';
import { colors } from './src/theme/tokens';

const navigationTheme: NavigationTheme = {
  dark: false,
  colors: {
    primary: colors.brand[900],
    background: colors.surface[50],
    card: colors.surface[0],
    text: colors.text.primary,
    border: colors.border.default,
    notification: colors.semantic.danger,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' },
    medium: { fontFamily: 'System', fontWeight: '500' },
    bold: { fontFamily: 'System', fontWeight: '700' },
    heavy: { fontFamily: 'System', fontWeight: '800' },
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme}>
        <StatusBar style="dark" />
        <RootTabs />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
