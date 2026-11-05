import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { colors, radius } from '../../theme/tokens';

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

/** Hata durumu — role=alert benzeri canlı bölge ile duyurulur. */
export function ErrorState({ title = 'Bir sorun oluştu', message, onRetry }: ErrorStateProps) {
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.wrap, { borderRadius: radius.card }]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? <Button label="Tekrar dene" onPress={onRetry} variant="secondary" style={styles.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(194,65,58,0.3)',
    backgroundColor: 'rgba(249,229,228,0.4)',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  title: { fontSize: 15, fontWeight: '700', color: colors.text.primary },
  message: { fontSize: 12, color: colors.text.secondary, textAlign: 'center', lineHeight: 18 },
  action: { marginTop: 8 },
});
