import * as sanitizeHtml from 'sanitize-html';

/**
 * Sanitizer for blog post bodies. Blogs are authored by super-admins in a
 * rich-text editor and rendered publicly, so we allow richer formatting than
 * the generic description sanitizer — including links and (inline) images —
 * while still stripping scripts, event handlers and unsafe schemes.
 */
const BLOG_SANITIZE_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'strong',
    'em',
    'u',
    's',
    'h1',
    'h2',
    'h3',
    'h4',
    'ul',
    'ol',
    'li',
    'blockquote',
    'code',
    'pre',
    'hr',
    'br',
    'a',
    'img',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    img: ['http', 'https'],
  },
  transformTags: {
    // Force safe rel on links that open in a new tab.
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
  disallowedTagsMode: 'discard',
};

export function sanitizeBlogHtml(
  html: string | null | undefined,
): string | null | undefined {
  if (!html) return html;
  return sanitizeHtml(html, BLOG_SANITIZE_CONFIG);
}
