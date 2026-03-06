/**
 * Extract variable placeholders from prompt template text.
 * Supports:
 * - {var_name} - Python str.format() style (used by ally-ai-learn)
 * - {{var}} - double-brace style
 * - <var> - angle bracket style
 * Returns sorted unique list of variable names.
 */
export function parseVariablesFromPrompt(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const vars = new Set<string>();
  const singleBrace = text.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
  const doubleBrace = text.matchAll(/\{\{(\w+)\}\}/g);
  const angleBracket = text.matchAll(/<(\w+)>/g);
  for (const m of singleBrace) vars.add(m[1]);
  for (const m of doubleBrace) vars.add(m[1]);
  for (const m of angleBracket) vars.add(m[1]);
  return Array.from(vars).sort();
}
