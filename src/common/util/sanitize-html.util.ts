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

/**
 * Strip HTML tags and decode entities, producing plain narrative text.
 *
 * Use this when the consumer is an LLM or any non-rich-text surface that
 * should not see markup. <script>/<style> bodies are dropped entirely;
 * remaining tags are replaced with whitespace so adjacent block elements
 * (e.g. <p>a</p><p>b</p>) become "a b" rather than "ab". Then sanitize-html
 * is used to decode HTML entities (&amp; -> &, &nbsp; -> space, etc.).
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  const withSpaces = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  const decoded = sanitizeHtml(withSpaces, {
    allowedTags: [],
    allowedAttributes: {},
  });
  return decoded.replace(/\s+/g, ' ').trim();
}
