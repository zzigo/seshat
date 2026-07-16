const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
})[character] || character);

/** Render only bibliographic emphasis tags; every other character remains escaped. */
export const safeInlineTitleHtml = (value: unknown): string => escapeHtml(String(value ?? ''))
  .replace(/&lt;(\/?)i&gt;/gi, '<$1em>')
  .replace(/&lt;(\/?)em&gt;/gi, '<$1em>')
  .replace(/&lt;(\/?)b&gt;/gi, '<$1strong>')
  .replace(/&lt;(\/?)strong&gt;/gi, '<$1strong>');

export const setInlineTitle = (element: HTMLElement, value: unknown): void => {
  element.innerHTML = safeInlineTitleHtml(value);
};

export const plainInlineTitle = (value: unknown): string => String(value ?? '').replace(/<\/?(?:i|em|b|strong)>/gi, '');
