// Combining diacritical marks range (U+0300–U+036F), stripped after NFKD.
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Build a URL-friendly slug from arbitrary text: lowercase, non-alphanumerics
 * collapsed to single hyphens, trimmed of leading/trailing hyphens.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 255);
}
