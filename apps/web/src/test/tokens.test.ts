import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { colorTokens } from '@santiyepro/contracts/tokens';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** globals.css @theme içindeki renk değişkenlerini ayrıştırır. */
function parseThemeColors(css: string): Record<string, string> {
  const start = css.indexOf('@theme {');
  const themeBlock = start >= 0 ? css.slice(start) : '';
  const colors: Record<string, string> = {};
  const re = /--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(themeBlock)) !== null) {
    colors[match[1] ?? ''] = (match[2] ?? '').toLowerCase();
  }
  return colors;
}

describe('Web tasarım token uyumu (design/tokens.json ↔ globals.css)', () => {
  const css = readFileSync(join(repoRoot, 'apps', 'web', 'src', 'app', 'globals.css'), 'utf8');
  const theme = parseThemeColors(css);

  it('brand renkleri eşleşiyor', () => {
    expect(theme['brand-900']).toBe(colorTokens.brand[900].toLowerCase());
    expect(theme['brand-800']).toBe(colorTokens.brand[800].toLowerCase());
    expect(theme['brand-600']).toBe(colorTokens.brand[600].toLowerCase());
  });

  it('accent ve surface renkleri eşleşiyor', () => {
    expect(theme['accent-500']).toBe(colorTokens.accent[500].toLowerCase());
    expect(theme['accent-100']).toBe(colorTokens.accent[100].toLowerCase());
    expect(theme['surface-0']).toBe(colorTokens.surface[0].toLowerCase());
    expect(theme['surface-50']).toBe(colorTokens.surface[50].toLowerCase());
    expect(theme['surface-100']).toBe(colorTokens.surface[100].toLowerCase());
  });

  it('border ve metin renkleri eşleşiyor', () => {
    expect(theme['border-default']).toBe(colorTokens.border.default.toLowerCase());
    expect(theme['text-primary']).toBe(colorTokens.text.primary.toLowerCase());
    expect(theme['text-secondary']).toBe(colorTokens.text.secondary.toLowerCase());
  });

  it('semantic renkler eşleşiyor', () => {
    expect(theme['success-600']).toBe(colorTokens.semantic.success.toLowerCase());
    expect(theme['warning-600']).toBe(colorTokens.semantic.warning.toLowerCase());
    expect(theme['danger-600']).toBe(colorTokens.semantic.danger.toLowerCase());
    expect(theme['info-600']).toBe(colorTokens.semantic.info.toLowerCase());
  });
});
