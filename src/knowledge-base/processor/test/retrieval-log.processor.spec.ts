import { RetrievalLogProcessor } from '../retrieval-log.processor';

/**
 * This processor is a trust boundary: the payload crosses a service, so what it claims is
 * validated rather than believed. The test that matters most is the privacy default — a sender
 * that omits `query_sensitive` must not cause a health worker's question to be rendered in an
 * admin panel.
 */
describe('RetrievalLogProcessor', () => {
  let record: jest.Mock;
  let processor: RetrievalLogProcessor;

  const message = (over: Record<string, unknown> = {}) => ({
    message_type: 'retrieval_log',
    data: {
      retrieval_log: {
        corpus: 'whatsapp_qa',
        consumer: 'whatsapp_bot',
        query: 'how do I support someone refusing medication?',
        min_similarity: 0.35,
        decline_similarity: 0.5,
        disposition: 'answered',
        requested_limit: 8,
        returned_count: 3,
        latency_ms: 412,
        query_language: 'ta',
        passages: [
          { chunk_id: 'c1', document_id: 'd1', rank: 1, similarity: 0.62 },
          { chunk_id: 'c2', document_id: 'd1', rank: 2, similarity: 0.41 },
        ],
        ...over,
      },
    },
  });

  beforeEach(() => {
    record = jest.fn().mockResolvedValue('ret-1');
    processor = new RetrievalLogProcessor({ record } as never);
  });

  it('answers to its own message type', () => {
    expect(processor.getEventType()).toBe('retrieval_log');
  });

  it('treats a missing sensitivity flag as sensitive', async () => {
    // The safe reading of silence. Getting this backwards puts a worker's question on a
    // screen; getting it "wrong" the other way withholds one string.
    await processor.process(message({ query_sensitive: undefined }) as never);
    expect(record.mock.calls[0][0].querySensitive).toBe(true);
  });

  it('honours an explicit false, for an operator-authored query', async () => {
    await processor.process(
      message({ consumer: 'admin_preview', query_sensitive: false }) as never,
    );
    expect(record.mock.calls[0][0].querySensitive).toBe(false);
  });

  it('persists both thresholds and the disposition', async () => {
    await processor.process(message() as never);
    const [retrieval] = record.mock.calls[0];
    expect(retrieval.minSimilarity).toBe(0.35);
    expect(retrieval.declineSimilarity).toBe(0.5);
    expect(retrieval.disposition).toBe('answered');
  });

  it('records a refusal as its own disposition', async () => {
    // The outcome the worker experienced. A retrieval that returned six passages and was
    // refused on all of them looks healthy in every other count.
    await processor.process(
      message({
        disposition: 'declined_below_threshold',
        returned_count: 0,
      }) as never,
    );
    const [retrieval] = record.mock.calls[0];
    expect(retrieval.disposition).toBe('declined_below_threshold');
    expect(retrieval.returnedCount).toBe(0);
  });

  it('rejects an unknown corpus rather than inventing one', async () => {
    await processor.process(message({ corpus: 'made_up' }) as never);
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects an unknown consumer', async () => {
    await processor.process(message({ consumer: 'somebody_else' }) as never);
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects an empty query, which nothing could be calibrated from', async () => {
    await processor.process(message({ query: '   ' }) as never);
    expect(record).not.toHaveBeenCalled();
  });

  it('drops an unknown disposition instead of storing a bad label', async () => {
    await processor.process(
      message({ disposition: 'sort-of-answered' }) as never,
    );
    expect(record.mock.calls[0][0].disposition).toBeNull();
  });

  it('coerces numbers that arrive as strings', async () => {
    await processor.process(
      message({
        min_similarity: '0.42',
        returned_count: '2',
        latency_ms: '99',
      }) as never,
    );
    const [retrieval] = record.mock.calls[0];
    expect(retrieval.minSimilarity).toBe(0.42);
    expect(retrieval.returnedCount).toBe(2);
    expect(retrieval.latencyMs).toBe(99);
  });

  it('caps how many passages one message can write', async () => {
    const passages = Array.from({ length: 200 }, (_, i) => ({
      chunk_id: `c${i}`,
      document_id: 'd1',
      rank: i + 1,
      similarity: 0.4,
    }));
    await processor.process(message({ passages }) as never);
    expect(record.mock.calls[0][1].length).toBe(60);
  });

  it('skips a passage with no ids', async () => {
    await processor.process(
      message({
        passages: [{ similarity: 0.5 }, { chunk_id: 'c1', document_id: 'd1' }],
      }) as never,
    );
    expect(record.mock.calls[0][1]).toHaveLength(1);
  });

  it('leaves the second pass NULL, not zero', async () => {
    // No top-up ran. Zero would mean it ran and found nothing, which is a different corpus.
    await processor.process(message() as never);
    expect(record.mock.calls[0][0].secondPassHits).toBeNull();
  });

  it('never throws when the write fails', async () => {
    // A retry-storm on this queue would cost far more than a missing analytics row.
    record.mockRejectedValue(new Error('db down'));
    await expect(
      processor.process(message() as never),
    ).resolves.toBeUndefined();
  });
});
