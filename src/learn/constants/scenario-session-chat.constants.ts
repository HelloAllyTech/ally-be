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
