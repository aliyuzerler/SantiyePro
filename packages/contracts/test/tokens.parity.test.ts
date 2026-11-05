import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { designTokens } from '../src/tokens';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Tasarım token'larının tek kaynağı design/tokens.json'dur. */
describe('design tokens parity', () => {
  it('tokens.ts sabitleri design/tokens.json ile birebir aynıdır', () => {
    const raw = JSON.parse(readFileSync(join(repoRoot, 'design', 'tokens.json'), 'utf8'));
    expect(designTokens).toEqual(raw);
  });
});
