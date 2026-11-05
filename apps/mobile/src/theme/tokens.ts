/**
 * Mobil tasarım token'ları — türetilmiş tek kaynak: design/tokens.json.
 * Değerler @santiyepro/contracts üzerinden alınır; yerelde kopya tutulmaz.
 */
import { designTokens } from '@santiyepro/contracts/tokens';

export const colors = designTokens.color;

export const spacing = designTokens.spacingPx;

export const radius = designTokens.radiusPx;

/** Dokunma hedefleri — en az 44dp, tercih edilen 48dp (design/01). */
export const touch = {
  min: designTokens.control.mobileMinTouchTargetDp,
  preferred: designTokens.control.mobilePreferredTouchTargetDp,
};

/** Ekran kenar boşluğu: telefon 16, tablet 24 (tokens.json layout). */
export const gutter = designTokens.layout.mobileScreenGutterPx;

export const font = {
  family: designTokens.typography.fontFamily,
  body: designTokens.typography.mobileBodySp,
};

/** Tipografi ölçeği — design/01 mobil kuralları (gövde 14–16, kritik veri 16+). */
export const typography = {
  screenTitle: { fontSize: 19, fontWeight: '700' as const, color: colors.text.primary },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: colors.brand[900] },
  body: { fontSize: 15, color: colors.text.primary },
  secondary: { fontSize: 12, color: colors.text.secondary },
  label: { fontSize: 11, fontWeight: '700' as const, color: '#526476' },
};
