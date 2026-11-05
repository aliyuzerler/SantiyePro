/**
 * ŞantiyePro mobil uygulama — Faz 02: oturum akışı eklendi.
 * Oturum yoksa LoginScreen, varsa RootTabs gösterilir; token'lar SecureStore'da.
 */
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, type Theme as NavigationTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootTabs } from './src/navigation/RootTabs';
import { LoginScreen } from './src/screens/LoginScreen';
import { AuthProvider, useAuth } from './src/lib/auth-context';
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

function Root() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface[50] }}>
        <ActivityIndicator color={colors.brand[900]} />
      </View>
    );
  }
  return user ? <RootTabs /> : <LoginScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer theme={navigationTheme}>
          <StatusBar style="dark" />
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
