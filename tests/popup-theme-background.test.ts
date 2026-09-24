import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const popupStyles = readFileSync(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');

describe('popup theme backgrounds', () => {
  it.each([
    { name: 'light', selector: '.theme-shell {', color: '#f1f5f3' },
    { name: 'dark', selector: ".theme-shell[data-appearance='dark'] {", color: '#111923' },
  ])('keeps the $name base color beneath both radial gradients', ({ selector, color }) => {
    const start = popupStyles.indexOf(selector);
    const end = popupStyles.indexOf('\n}', start);
    const themeRule = popupStyles.slice(start, end);

    expect(themeRule).toContain(`background-color: ${color};`);
    expect(themeRule).toContain('background-image:');
    expect(themeRule.match(/radial-gradient\(/g)).toHaveLength(2);
    expect(themeRule).not.toMatch(/\bbackground\s*:/);
  });
});
