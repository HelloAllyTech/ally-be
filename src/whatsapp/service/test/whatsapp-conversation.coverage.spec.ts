import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { KnowledgeBaseService } from '../../../knowledge-base/service/knowledge-base.service';
import { WaContact } from '../../entity/wa-contact.entity';
import { WaConversation } from '../../entity/wa-conversation.entity';
import { WaMessage } from '../../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../../entity/wa-unanswered-question.entity';
import { WaAnalyticsRepository } from '../../repository/wa-analytics.repository';
import { WhatsAppConversationService } from '../whatsapp-conversation.service';

/**
 * Corpus coverage exists so an admin can find dead corpus. Three ways an earlier version of this
 * quietly lied, each pinned here:
 *
 *  - It fetched the first 100 documents and said nothing, so on a larger corpus the never-cited list
 *    was a partial worklist presented as a complete one.
 *  - It built the output from the ACTIVE corpus only, so citations recorded before a document was
 *    archived vanished and the totals stopped reconciling with the message log.
 *  - It dropped citations whose document no longer exists at all, for the same reason.
 */
describe('WhatsAppConversationService.corpusCoverage', () => {
  let service: WhatsAppConversationService;
  let analyticsRepository: { corpusCoverage: jest.Mock };
  let knowledgeBaseService: { list: jest.Mock };

  const noopRepo = () => ({
    findOne: jest.fn(),
    update: jest.fn(),
    find: jest.fn(),
  });

  beforeEach(async () => {
    analyticsRepository = { corpusCoverage: jest.fn().mockResolvedValue([]) };
    knowledgeBaseService = {
      list: jest.fn().mockResolvedValue({ documents: [], count: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppConversationService,
        { provide: getRepositoryToken(WaContact), useValue: noopRepo() },
        { provide: getRepositoryToken(WaConversation), useValue: noopRepo() },
        { provide: getRepositoryToken(WaMessage), useValue: noopRepo() },
        {
          provide: getRepositoryToken(WaUnansweredQuestion),
          useValue: noopRepo(),
        },
        { provide: WaAnalyticsRepository, useValue: analyticsRepository },
        { provide: KnowledgeBaseService, useValue: knowledgeBaseService },
      ],
    }).compile();

    service = module.get(WhatsAppConversationService);
  });

  const doc = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    title: `Document ${id}`,
    chunkCount: 10,
    isArchived: false,
    ...over,
  });

  it('fetches archived documents too', async () => {
    await service.corpusCoverage();

    // Without this, a citation recorded before a document was archived has nothing to attach to.
    expect(knowledgeBaseService.list).toHaveBeenCalledWith(
      expect.objectContaining({ includeArchived: true }),
    );
  });

  it('reports how many documents it could not include', async () => {
    knowledgeBaseService.list.mockResolvedValue({
      documents: [doc('a'), doc('b')],
      count: 640,
    });

    const result = await service.corpusCoverage();

    expect(result.totalDocuments).toBe(640);
    expect(result.omittedDocuments).toBe(638);
  });

  it('reports zero omitted when the whole corpus fits', async () => {
    knowledgeBaseService.list.mockResolvedValue({
      documents: [doc('a'), doc('b')],
      count: 2,
    });

    const result = await service.corpusCoverage();

    expect(result.omittedDocuments).toBe(0);
  });

  it('keeps citations recorded against an archived document', async () => {
    analyticsRepository.corpusCoverage.mockResolvedValue([
      { documentId: 'a', citations: 7 },
    ]);
    knowledgeBaseService.list.mockResolvedValue({
      documents: [doc('a', { isArchived: true })],
      count: 1,
    });

    const result = await service.corpusCoverage();

    expect(result.rows).toEqual([
      expect.objectContaining({
        documentId: 'a',
        citations: 7,
        isArchived: true,
      }),
    ]);
  });

  it('gives a deleted document its own row rather than dropping its citations', async () => {
    analyticsRepository.corpusCoverage.mockResolvedValue([
      { documentId: 'gone', citations: 4 },
      { documentId: 'a', citations: 9 },
    ]);
    knowledgeBaseService.list.mockResolvedValue({
      documents: [doc('a')],
      count: 1,
    });

    const result = await service.corpusCoverage();

    // The totals on this screen have to add up to the totals in wa_messages.
    const total = result.rows.reduce((sum, row) => sum + row.citations, 0);
    expect(total).toBe(13);
    expect(result.rows.map((row) => row.documentId)).toContain('gone');
  });

  it('sorts most-cited first so never-cited documents collect at the bottom', async () => {
    analyticsRepository.corpusCoverage.mockResolvedValue([
      { documentId: 'b', citations: 5 },
    ]);
    knowledgeBaseService.list.mockResolvedValue({
      documents: [doc('a'), doc('b'), doc('c')],
      count: 3,
    });

    const result = await service.corpusCoverage();

    expect(result.rows[0].documentId).toBe('b');
    expect(result.rows.slice(1).every((row) => row.citations === 0)).toBe(true);
  });

  it('counts a document once even when it is both listed and cited', async () => {
    analyticsRepository.corpusCoverage.mockResolvedValue([
      { documentId: 'a', citations: 3 },
    ]);
    knowledgeBaseService.list.mockResolvedValue({
      documents: [doc('a')],
      count: 1,
    });

    const result = await service.corpusCoverage();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].citations).toBe(3);
  });
});
