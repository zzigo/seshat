export type ThemeMode = 'light' | 'dark';

const LIGHT_PRESETS = new Set([
  'papyrus', 'alabaster', 'ivory', 'sage', 'mist', 'sepia', 'porcelain', 'rose', 'sand', 'high-light',
]);
const DARK_PRESETS = new Set([
  'ink', 'charcoal', 'midnight', 'forest', 'aubergine', 'umber', 'slate', 'navy', 'espresso', 'graphite', 'high-dark',
]);

export const normalizeThemeMode = (value: unknown): ThemeMode => value === 'dark' ? 'dark' : 'light';

export const themePresetForMode = (modeValue: unknown, presetValue: unknown): string => {
  const mode = normalizeThemeMode(modeValue);
  const preset = String(presetValue || '');
  const allowed = mode === 'dark' ? DARK_PRESETS : LIGHT_PRESETS;
  return allowed.has(preset) ? preset : mode === 'dark' ? 'ink' : 'papyrus';
};
