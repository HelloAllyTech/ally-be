/**
 * Redacts emails and phone numbers out of free-text pulled from PostHog and
 * caps its length, mirroring `UxSignalDetectorService.scrubExample` exactly —
 * that scrub exists because exception messages and event properties can
 * carry interpolated user content (an email in a validation error, a phone
 * number in a support form's stack trace), and this text goes on to sit in
 * `bug_findings.description`, an LLM prompt, and an admin-facing drawer.
 * Duplicated rather than imported: the source is a private method on a
 * detector service in an unrelated module, and this two-line regex is cheaper
 * to keep in sync by inspection than to export across a module boundary for.
 */
export function redactPii(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\+?\d[\d\s()-]{7,}\d/g, '[phone]')
    .slice(0, 300);
}
