/**
 * The SQS message that drives one document's ingest.
 *
 * Deliberately just an id and an intent — not the document's content. Two reasons: extracted text
 * for a real guideline is far over SQS's 256 KB message limit, and the document row is the system
 * of record, so a message carrying a copy of anything could be acted on after the row changed.
 */
export interface KbIngestMessage {
  documentId: string;
  /**
   * `ingest` is the first pass after upload. `reindex` re-chunks an existing document from its
   * retained rawText, so it never re-parses the original file — which matters because parsing is
   * the slowest and most failure-prone step, and the S3 object may since have been removed.
   */
  action: 'ingest' | 'reindex';
  /**
   * How many times this document has already been retried through the queue. Carried on the
   * message rather than stored on the row so a redelivery cannot be mistaken for a fresh attempt.
   */
  attempt?: number;
}
