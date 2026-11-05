import { StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../../theme/tokens';

export type StatusTone = 'draft' | 'submitted' | 'approved' | 'rejected' | 'pending' | 'error' | 'neutral';

export interface StatusBadgeProps {
  tone: StatusTone;
  children: string;
}

/** Durum renkleri — token'lardan türetilmiş açık zemin + koyu metin (web ile aynı semantik). */
const toneStyles: Record<StatusTone, { bg: string; fg: string; icon: string }> = {
  draft: { bg: colors.surface[100], fg: colors.text.secondary, icon: '○' },
  submitted: { bg: '#E3EEF8', fg: colors.semantic.info, icon: '↑' },
  approved: { bg: '#E8F4ED', fg: colors.semantic.success, icon: '✓' },
  rejected: { bg: '#F9E5E4', fg: colors.semantic.danger, icon: '✕' },
  pending: { bg: colors.accent[100], fg: '#8A6119', icon: '◷' },
  error: { bg: '#F9E5E4', fg: colors.semantic.danger, icon: '!' },
  neutral: { bg: colors.surface[100], fg: colors.text.secondary, icon: '•' },
};

/** Durum rozeti — renk + metin + ikon (renk tek başına durum anlatmaz). */
export function StatusBadge({ tone, children }: StatusBadgeProps) {
  const t = toneStyles[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.icon, { color: t.fg }]}>
        {t.icon}
      </Text>
      <Text style={[styles.text, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.input - 2,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  icon: { fontSize: 10, lineHeight: 12 },
  text: { fontSize: 12, fontWeight: '700' },
});
