/**
 * Tasarım token'ları — tek kaynak: design/tokens.json.
 * Bu modül token değerlerini TypeScript'e taşır; parity testi
 * (test/tokens.parity.test.ts) bu sabitlerin design/tokens.json ile
 * birebir aynı olduğunu doğrular. Değişiklik yalnızca tokens.json
 * üzerinden yapılır.
 */

export const colorTokens = {
  brand: { 900: '#14263D', 800: '#1D3553', 600: '#2E5B83' },
  accent: { 500: '#D99A2B', 100: '#FFF3D9' },
  surface: { 0: '#FFFFFF', 50: '#F5F7FA', 100: '#E9EEF3' },
  border: { default: '#D8E0E8' },
  text: { primary: '#172433', secondary: '#5C6B7A' },
  semantic: {
    success: '#21845B',
    warning: '#B7791F',
    danger: '#C2413A',
    info: '#2C6EAA',
  },
} as const;

export const typographyTokens = {
  fontFamily: 'Inter',
  fallback: ['Roboto', 'SF Pro', 'sans-serif'],
  webBodyPx: 15,
  mobileBodySp: 15,
} as const;

export const spacingPx = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;

export const radiusPx = { input: 8, button: 8, card: 12, dialog: 14 } as const;

export const controlTokens = {
  webInputHeightPx: 42,
  mobileMinTouchTargetDp: 44,
  mobilePreferredTouchTargetDp: 48,
} as const;

export const layoutTokens = {
  webSidebarWidthPx: 248,
  mobileScreenGutterPx: 16,
  tabletScreenGutterPx: 24,
} as const;

export type DesignTokens = {
  color: typeof colorTokens;
  typography: typeof typographyTokens;
  spacingPx: typeof spacingPx;
  radiusPx: typeof radiusPx;
  control: typeof controlTokens;
  layout: typeof layoutTokens;
};

export const designTokens: DesignTokens = {
  color: colorTokens,
  typography: typographyTokens,
  spacingPx,
  radiusPx,
  control: controlTokens,
  layout: layoutTokens,
};
