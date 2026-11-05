import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, typography } from '../../theme/tokens';

export interface TextFieldProps extends TextInputProps {
  label: string;
  required?: boolean;
  helpText?: string;
  error?: string;
}

/**
 * Etiketli metin girişi — etiket görünür kalır, hata altta metinle gösterilir
 * (design/01 etkileşim durumları, rules/04). Giriş yüksekliği 48dp.
 */
export function TextField({ label, required, helpText, error, style, ...rest }: TextFieldProps) {
  return (
    <View style={styles.wrap}>
      <Text style={typography.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="rgba(92,107,122,0.6)"
        style={[styles.input, error ? styles.inputError : null, style]}
        {...rest}
      />
      {helpText && !error ? <Text style={styles.help}>{helpText}</Text> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  required: { color: colors.semantic.danger },
  input: {
    minHeight: 48,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface[0],
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.text.primary,
  },
  inputError: { borderColor: colors.semantic.danger },
  help: { fontSize: 12, color: colors.text.secondary },
  error: { fontSize: 12, fontWeight: '600', color: colors.semantic.danger },
});
