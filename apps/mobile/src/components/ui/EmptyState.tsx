import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { colors, radius, typography } from '../../theme/tokens';

export interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Boş durum — sahte veri yerine açıklamalı boşluk (design/02, agents.md).
 * Gerçek veri yokken KPI/kart gösterimi yasaktır.
 */
export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={[styles.wrap, { borderRadius: radius.card }]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border.default,
    backgroundColor: colors.surface[50],
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  title: { fontSize: 15, fontWeight: '700', color: colors.text.primary },
  description: { ...typography.secondary, textAlign: 'center', lineHeight: 18 },
  action: { marginTop: 8 },
});
