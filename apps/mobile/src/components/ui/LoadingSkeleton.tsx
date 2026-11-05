import { StyleSheet, View } from 'react-native';
import { colors, radius } from '../../theme/tokens';

export interface LoadingSkeletonProps {
  rows?: number;
}

/** Yüklenme iskeleti — veri gelmeden sahte içerik göstermemek için. */
export function LoadingSkeleton({ rows = 3 }: LoadingSkeletonProps) {
  return (
    <View accessibilityLabel="İçerik yükleniyor" accessibilityLiveRegion="polite" style={styles.wrap}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.row} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  row: {
    height: 40,
    borderRadius: radius.input,
    backgroundColor: colors.surface[100],
    opacity: 0.7,
  },
});
