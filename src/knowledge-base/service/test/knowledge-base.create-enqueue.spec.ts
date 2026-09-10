import { ExecutionManager } from 'src/common/execution/execution-manager';
import { KbCorpus, KbDocumentSourceType } from '../../enum/knowledge-base.enum';
import { KnowledgeBaseService } from '../knowledge-base.service';

/**
 * What happens to the document row when the ingest queue cannot be reached.
 *
 * This is not a hypothetical branch. The ingest queue was never provisioned in production, so
 * for the knowledge base's entire life every upload 500'd — and, because the row is committed
 * before the message is sent, every attempt ALSO left a document behind at PENDING that no
 * consumer would ever collect. Two of them sat in the character corpus rendering as "Queued"
 * forever, and the only way to notice was to read the table.
 */

const dto = {
  corpus: KbCorpus.CHARACTER_LIBRARY,
  title: 'Designing clients',
  sourceType: KbDocumentSourceType.PASTE,
  text: 'A stance written into backstory can never be earned.',
} as any;

describe('KnowledgeBaseService.create — when enqueueing fails', () => {
  let service: KnowledgeBaseService;
  let documentRepository: any;
  let ingestProducer: { enqueue: jest.Mock };

  beforeEach(() => {
    // create() stamps createdBy from the request context.
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(42 as any);
    documentRepository = {
      create: jest.fn((v: any) => ({ ...v, id: 'doc-1' })),
      save: jest.fn(async (v: any) => v),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    ingestProducer = { enqueue: jest.fn() };
    // Positional order matches the constructor: document, chunk, documentTenant, ingest,
    // ai, s3, config, retrieval, tenant.
    service = new KnowledgeBaseService(
      documentRepository,
      {} as any,
      { replaceForDocument: jest.fn() } as any,
      ingestProducer as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('marks the document FAILED with the real reason instead of leaving it PENDING', async () => {
    ingestProducer.enqueue.mockRejectedValue(
      new Error('The knowledge-base ingest queue is not configured'),
    );

    await expect(service.create(dto)).rejects.toThrow(/not configured/);

    // The row is not left looking like it is about to be processed.
    expect(documentRepository.update).toHaveBeenCalledWith(
      { id: 'doc-1' },
      expect.objectContaining({
        status: 'failed',
        statusMessage: expect.stringContaining(
          'Could not be queued for indexing',
        ),
      }),
    );
  });

  it('still surfaces the error rather than reporting a success', async () => {
    // The admin must not be told the upload worked when nothing will ingest it.
    ingestProducer.enqueue.mockRejectedValue(new Error('boom'));
    await expect(service.create(dto)).rejects.toThrow('boom');
  });

  it('leaves the document alone on the happy path', async () => {
    ingestProducer.enqueue.mockResolvedValue(undefined);

    const result = await service.create(dto);

    expect(documentRepository.update).not.toHaveBeenCalled();
    expect(result.corpus).toBe(KbCorpus.CHARACTER_LIBRARY);
  });
});
