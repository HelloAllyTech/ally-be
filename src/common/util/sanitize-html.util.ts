import * as sanitizeHtml from 'sanitize-html';

const SANITIZE_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'strong',
    'em',
    'u',
    's',
    'h1',
    'h2',
    'h3',
    'ul',
    'ol',
    'li',
    'blockquote',
    'hr',
    'br',
  ],
  allowedAttributes: {},
  allowedSchemes: [],
  disallowedTagsMode: 'discard',
};

/**
 * Sanitize an HTML string to allow only safe formatting tags.
 * Strips all dangerous tags (script, img, a, iframe, etc.) and all attributes.
 */
export function sanitizeDescriptionHtml(html: string): string {
  if (!html) return html;
  return sanitizeHtml(html, SANITIZE_CONFIG);
}
