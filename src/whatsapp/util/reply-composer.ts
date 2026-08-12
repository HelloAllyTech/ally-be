import { KnowledgeCitation } from 'src/ai/dto/knowledge.dto';

export interface ComposeReplyInput {
  intent: 'answer' | 'decline' | 'clarify';
  answer: string;
  declineText: string;
  citations: KnowledgeCitation[];
  maxAnswerChars: number;
  maxReplyChars: number;
  maxCitations: number;
}

/**
 * Turn an agent result into the exact text sent over WhatsApp.
 *
 * Composed HERE rather than by the model, on purpose. The model is told not to write out its sources
 * precisely so that the source lines are rendered from the VALIDATED citation objects — a model
 * writing its own source list can name a document it did not use, and there is no way to check that
 * after the fact. Here, every line comes from a resolved chunk id.
 *
 * Everything is plain text. WhatsApp renders only *bold* and _italic_; markdown headings, links and
 * tables arrive as literal punctuation, which reads as a broken message.
 *
 * The 1600-character ceiling is the portable one (Twilio's limit, below Meta's 4096). Composing to
 * the smaller of the two is what keeps the provider seam honest — an answer that only fits on Meta
 * would silently truncate the day a BSP is swapped in.
 */
export function composeReply(input: ComposeReplyInput): string {
  const {
    intent,
    answer,
    declineText,
    citations,
    maxAnswerChars,
    maxReplyChars,
    maxCitations,
  } = input;

  // A decline uses the configured wording rather than the model's, so the admin controls exactly how
  // "I don't have that" sounds to a worker. A clarify uses the model's question — the whole point of
  // it is that it is specific to what was asked.
  const bodyText =
    intent === 'decline' ? declineText : answer.trim() || declineText;

  const body = truncateAtSentence(bodyText, maxAnswerChars);

  // Sources only accompany a real answer. Attaching them to a decline or a clarifying question would
  // imply the reply was grounded in them.
  if (intent !== 'answer' || !citations?.length) {
    return body.slice(0, maxReplyChars);
  }

  const lines = renderCitations(citations, maxCitations);
  if (!lines.length) return body.slice(0, maxReplyChars);

  const blockLength = (count: number): number =>
    `\n\nSources:\n${lines.slice(0, count).join('\n')}`.length;

  // Drop whole source LINES to fit, never split one. A half-rendered citation ("WHO mhGAP Interven")
  // is worse than one fewer citation: it still looks like a real reference but cannot be looked up.
  let kept = lines.length;
  while (kept > 0 && body.length + blockLength(kept) > maxReplyChars) {
    kept -= 1;
  }

  if (kept === 0) {
    // Nothing fits: send the answer alone rather than a dangling "Sources:" header with nothing
    // under it.
    return truncateAtSentence(body, maxReplyChars);
  }

  return `${body}\n\nSources:\n${lines.slice(0, kept).join('\n')}`;
}

/**
 * One line per cited passage: title, then page or section.
 *
 * Deduplicated by document + location, because two chunks from the same page are one source to a
 * reader and repeating it looks like padding.
 */
function renderCitations(
  citations: KnowledgeCitation[],
  maxCitations: number,
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const citation of citations) {
    const parts: string[] = [];
    const title = (citation.document_title || '').trim();
    if (title) parts.push(title);

    if (citation.page_from) {
      parts.push(
        citation.page_to && citation.page_to !== citation.page_from
          ? `pp. ${citation.page_from}-${citation.page_to}`
          : `p. ${citation.page_from}`,
      );
    } else if (citation.section_path) {
      // Section is the fallback locator for every format except PDF, which is most of the corpus.
      parts.push(citation.section_path);
    }

    if (!parts.length) continue;

    const line = `— ${parts.join(', ')}`;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);

    if (lines.length >= maxCitations) break;
  }

  return lines;
}

/**
 * Trim to a length, preferring the last sentence boundary.
 *
 * Cutting mid-sentence in a clinical answer is worse than cutting a sentence early: a truncated
 * qualification ("do not escalate unless") can invert the meaning of what survives.
 */
function truncateAtSentence(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;

  const window = trimmed.slice(0, limit);
  const lastBoundary = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
    window.lastIndexOf('\n'),
  );

  // Only honour a boundary in the last third; otherwise a single long opening sentence would cut the
  // answer down to almost nothing.
  if (lastBoundary > limit * 0.6) {
    return `${window.slice(0, lastBoundary + 1).trim()}…`;
  }
  return `${window.trim()}…`;
}
