import { AgentStreamRequest, AgentSystemBlock } from '../type/agent-llm.type';

/**
 * The system instruction as one string, for providers with no cache control.
 *
 * Spans are joined with a blank line rather than concatenated, so a boundary
 * that existed for caching does not silently run two paragraphs together.
 */
export const flattenSystem = (system: AgentStreamRequest['system']): string =>
  typeof system === 'string'
    ? system
    : system
        .map((block) => block.text)
        .filter((text) => text.trim().length > 0)
        .join('\n\n');

/** The spans, normalised — a plain string is one uncached span. */
export const systemBlocks = (
  system: AgentStreamRequest['system'],
): AgentSystemBlock[] =>
  typeof system === 'string' ? [{ text: system }] : system;
