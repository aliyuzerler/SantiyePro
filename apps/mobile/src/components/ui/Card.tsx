import { StyleSheet, View, type ViewProps } from 'react-native';
import { colors, radius } from '../../theme/tokens';

export interface CardProps extends ViewProps {
  children: React.ReactNode;
}

/** Kart yüzeyi — surface.0, radius 12, 1px kenarlık. */
export function Card({ children, style, ...rest }: CardProps) {
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface[0],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: 16,
  },
});
