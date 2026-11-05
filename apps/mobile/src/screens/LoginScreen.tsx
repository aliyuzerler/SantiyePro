import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { colors, gutter, typography } from '../theme/tokens';
import { useAuth } from '../lib/auth-context';

/**
 * Giriş ekranı (Faz 02): e-posta + parola; hatalar erişilebilir Text olarak gösterilir.
 * Token'lar SecureStore'a yazılır (bkz. lib/api.ts → authApi.login).
 */
export function LoginScreen(): ReactNode {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(): Promise<void> {
    if (!email.trim() || !password) {
      setError('E-posta ve parola gereklidir.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Giriş başarısız. Bağlantınızı kontrol edin.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: gutter,
          backgroundColor: colors.surface[50],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 4, marginBottom: 24 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 2, color: colors.accent['500'], textTransform: 'uppercase' }}>
            ŞantiyePro
          </Text>
          <Text style={typography.screenTitle}>Saha Uygulaması Girişi</Text>
          <Text style={typography.secondary}>
            Günlük rapor, puantaj, depo ve gider kayıtları için oturum açın.
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          <TextField
            label="E-posta"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="ornek@firma.com"
          />
          <TextField
            label="Parola"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType="password"
          />
          {error ? (
            <Text accessibilityRole="alert" style={{ fontSize: 12, fontWeight: '600', color: colors.semantic.danger }}>
              {error}
            </Text>
          ) : null}
          <Button label="Giriş Yap" onPress={() => void onSubmit()} loading={submitting} disabled={submitting} />
          <Text style={{ fontSize: 11, color: colors.text.secondary, textAlign: 'center', paddingVertical: 8 }}>
            Oturum bilgileri cihazda SecureStore ile saklanır.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
