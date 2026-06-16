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

// Legal/consent content (Terms, Privacy, sign-in Terms & Agreement) additionally
// allows hyperlinks (e.g. the crisis-hotline link). Mirrors the allow-lists used
// by the admin rich-text editor and the helpline/web sanitizers.
const LEGAL_SANITIZE_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [...(SANITIZE_CONFIG.allowedTags as string[]), 'a'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  disallowedTagsMode: 'discard',
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      rel: 'noopener noreferrer nofollow',
      target: '_blank',
    }),
  },
};

/**
 * Sanitize legal/consent HTML: safe formatting tags plus hyperlinks with
 * normalized rel/target and a restricted scheme allow-list. Used on write so
 * every consumer (admin pages, web + mobile consent popups) gets safe HTML
 * regardless of which client produced it.
 */
export function sanitizeLegalHtml(html: string): string {
  if (!html) return '';
  return sanitizeHtml(html, LEGAL_SANITIZE_CONFIG);
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
