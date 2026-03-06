/**
 * Format a prompt code or filename into a readable label.
 * Replaces underscores with spaces and capitalizes each word.
 * E.g. 'default_system_prompt' -> 'Default System Prompt'
 */
export function formatLabel(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/_/g, ' ')
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
