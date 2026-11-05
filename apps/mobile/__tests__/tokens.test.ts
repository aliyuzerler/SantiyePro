import { describe, expect, it } from '@jest/globals';
import { colors, touch, radius, spacing } from '../src/theme/tokens';
import { designTokens } from '@santiyepro/contracts/tokens';

describe('Mobil tasarım token köprüsü', () => {
  it('contracts/design tokens.json değerlerini birebir taşır', () => {
    expect(colors).toBe(designTokens.color);
    expect(spacing).toBe(designTokens.spacingPx);
    expect(radius).toBe(designTokens.radiusPx);
    expect(touch).toEqual({
      min: designTokens.control.mobileMinTouchTargetDp,
      preferred: designTokens.control.mobilePreferredTouchTargetDp,
    });
  });

  it('dokunma hedefleri kurallara uygundur (min 44, tercih 48)', () => {
    expect(touch.min).toBeGreaterThanOrEqual(44);
    expect(touch.preferred).toBeGreaterThanOrEqual(touch.min);
  });

  it('marka ve vurgu renkleri preview.html referansıyla aynıdır', () => {
    expect(colors.brand[900]).toBe('#14263D');
    expect(colors.accent[500]).toBe('#D99A2B');
  });
});
