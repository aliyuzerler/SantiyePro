import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { colors, radius, touch } from '../../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  /** Erişilebilirlik: buton anlamlı etiketle tanımlanır. */
  accessibilityLabel?: string;
  style?: ViewStyle;
}

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.brand[900] },
  secondary: { backgroundColor: colors.surface[0], borderWidth: 1, borderColor: colors.border.default },
  tertiary: { backgroundColor: 'transparent' },
  destructive: { backgroundColor: colors.semantic.danger },
};

const variantTextColors: Record<ButtonVariant, string> = {
  primary: '#FFFFFF',
  secondary: colors.text.primary,
  tertiary: colors.brand[600],
  destructive: '#FFFFFF',
};

/**
 * Buton — 48dp tercih edilen yükseklik, 44dp minimum dokunma hedefi (design/01).
 * Loading sırasında tekrar dokunma engellenir (rules/02).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={variantTextColors[variant]} /> : null}
      <Text style={[styles.label, { color: variantTextColors[variant] }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.preferred,
    minWidth: touch.min,
    borderRadius: radius.button,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: { fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
});
