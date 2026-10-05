/**
 * Number of most-recent messages always sent in full to the LLM.
 * Older messages are either kept as unsummarized overflow or folded
 * into the running summary stored on the chat entity.
 */
export const CHAT_HISTORY_WINDOW_SIZE = 10;

/**
 * When the number of unsummarized messages outside the window reaches
 * this threshold, they are batch-summarized into the running summary.
 */
export const CHAT_SUMMARIZATION_BATCH_THRESHOLD = 10;

/**
 * Most verbatim messages one turn's history can hold: the window, plus an
 * overflow that is summarised as soon as it reaches the batch threshold (so it
 * never exceeds threshold − 1). Passed to AiChatService as its history cap so
 * this already-bounded history reaches the model whole. The running summary
 * rides ahead of it as a pinned system message and is not counted.
 */
export const CHAT_MAX_HISTORY_MESSAGES =
  CHAT_HISTORY_WINDOW_SIZE + CHAT_SUMMARIZATION_BATCH_THRESHOLD - 1;
