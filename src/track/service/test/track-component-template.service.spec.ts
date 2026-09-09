import { BadRequestException, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { TrackComponentTemplateService } from '../track-component-template.service';
import { TrackComponentTemplateRepository } from '../../repository/track-component-template.repository';
import { TrackComponentTemplate } from '../../entity/track-component-template.entity';
import { TrackItemType, VideoSource } from '../../type/track.type';
import {
  AnnotationArtifactKind,
  AnnotationRevealKey,
  AnnotationSwatch,
} from '../../type/annotation.type';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { LoggerService } from '../../../logger/logger.service';

jest.mock('../../../common/execution/execution-manager');
jest.mock('../../../logger/logger.service');

describe('TrackComponentTemplateService', () => {
  let service: TrackComponentTemplateService;

  const now = new Date();

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    listTemplates: jest.fn(),
  };

  const validContentByType: Record<string, Record<string, any>> = {
    [TrackItemType.JOURNAL]: {
      prompts: [{ id: 'p1', prompt: 'How did that call feel?' }],
    },
    [TrackItemType.QUIZ]: {
      settings: { passScore: 70 },
      questions: [
        {
          id: 'q1',
          type: 'mcq_single',
          prompt: 'Pick one',
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          correctOptionIds: ['a'],
        },
      ],
    },
    [TrackItemType.ARTICLE]: { html: '<p>Hello</p>' },
    [TrackItemType.VIDEO]: {
      source: VideoSource.YOUTUBE,
      url: 'https://youtu.be/abc',
    },
    [TrackItemType.ANNOTATED_ARTIFACT]: {
      kind: AnnotationArtifactKind.TRANSCRIPT,
      units: [{ id: 'u1', text: 'Hello there.' }],
      labels: [{ id: 'l1', text: 'Empathy', color: AnnotationSwatch.TEAL }],
      targets: [{ unitId: 'u1', labelId: 'l1' }],
      settings: {
        passScore: 70,
        falsePositivePenalty: 5,
        revealKey: AnnotationRevealKey.AFTER_PASS_OR_LAST_ATTEMPT,
      },
    },
  };

  function makeTemplate(
    overrides: Partial<TrackComponentTemplate> = {},
  ): TrackComponentTemplate {
    return {
      id: 'template-uuid-1',
      type: TrackItemType.ARTICLE,
      title: 'Sample article',
      content: validContentByType[TrackItemType.ARTICLE],
      completionCriteria: undefined,
      createdBy: 100,
      updatedBy: 100,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as TrackComponentTemplate;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue('100');
    (LoggerService.getInstance as jest.Mock).mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    });

    mockRepo.create.mockImplementation((dto) => dto);
    mockRepo.save.mockImplementation((entity) =>
      Promise.resolve({ ...makeTemplate(), ...entity }),
    );

    service = new TrackComponentTemplateService(
      mockRepo as unknown as TrackComponentTemplateRepository,
    );
  });

  describe('create', () => {
    it.each([
      TrackItemType.JOURNAL,
      TrackItemType.QUIZ,
      TrackItemType.ARTICLE,
      TrackItemType.VIDEO,
      TrackItemType.ANNOTATED_ARTIFACT,
    ])('succeeds for %s with valid content', async (type) => {
      const content = validContentByType[type];
      mockRepo.save.mockResolvedValue(
        makeTemplate({ type, title: 'A template', content: content as any }),
      );

      const result = await service.create({
        type,
        title: 'A template',
        content,
      });

      expect(result.type).toBe(type);
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type,
          title: 'A template',
          content,
          createdBy: 100,
          updatedBy: 100,
        }),
      );
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('rejects zero Journal prompts', async () => {
      await expect(
        service.create({
          type: TrackItemType.JOURNAL,
          title: 'Journal',
          content: { prompts: [] },
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Journal component "Journal" must have at least one prompt.',
        ),
      );
    });

    it('rejects zero Quiz questions', async () => {
      await expect(
        service.create({
          type: TrackItemType.QUIZ,
          title: 'Quiz',
          content: { settings: { passScore: 70 }, questions: [] },
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Quiz component "Quiz" must have at least one question.',
        ),
      );
    });

    it('rejects empty Article html', async () => {
      await expect(
        service.create({
          type: TrackItemType.ARTICLE,
          title: 'Article',
          content: { html: '   ' },
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Article component "Article" must have content.',
        ),
      );
    });

    it('rejects Video content missing url/source', async () => {
      await expect(
        service.create({
          type: TrackItemType.VIDEO,
          title: 'Video',
          content: {} as any,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Video component "Video" must have a video URL.',
        ),
      );
    });

    it('rejects Annotation content missing units/labels/targets', async () => {
      await expect(
        service.create({
          type: TrackItemType.ANNOTATED_ARTIFACT,
          title: 'Annotation',
          content: {
            kind: AnnotationArtifactKind.TRANSCRIPT,
            units: [],
            labels: [],
            targets: [],
            settings: {
              passScore: 70,
              falsePositivePenalty: 5,
              revealKey: AnnotationRevealKey.AFTER_PASS_OR_LAST_ATTEMPT,
            },
          },
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Annotation component "Annotation" must have at least one line to annotate.',
        ),
      );
    });

    it.each([TrackItemType.ROLEPLAY, TrackItemType.CASE, TrackItemType.GAME])(
      'rejects %s as an unsupported type',
      async (type) => {
        await expect(
          service.create({
            type,
            title: 'Unsupported',
            content: {} as any,
          }),
        ).rejects.toThrow(BadRequestException);
        expect(mockRepo.create).not.toHaveBeenCalled();
      },
    );

    it('stamps createdBy/updatedBy from ExecutionManager.getUserId', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('42');
      mockRepo.save.mockResolvedValue(
        makeTemplate({ createdBy: 42, updatedBy: 42 }),
      );

      await service.create({
        type: TrackItemType.ARTICLE,
        title: 'Article',
        content: validContentByType[TrackItemType.ARTICLE],
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: 42, updatedBy: 42 }),
      );
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when missing', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.getById('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the template when found', async () => {
      const template = makeTemplate();
      mockRepo.findOne.mockResolvedValue(template);

      await expect(service.getById(template.id)).resolves.toEqual(template);
    });
  });

  describe('update', () => {
    it('404s before writing when the id does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { title: 'New title' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('re-validates content the same way create does', async () => {
      mockRepo.findOne.mockResolvedValue(
        makeTemplate({ type: TrackItemType.ARTICLE }),
      );

      await expect(
        service.update('template-uuid-1', { content: { html: '' } }),
      ).rejects.toThrow(BadRequestException);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('updates only the targeted row and returns a fresh read', async () => {
      const existing = makeTemplate({ id: 'template-uuid-1' });
      mockRepo.findOne
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ ...existing, title: 'Updated title' });

      const result = await service.update('template-uuid-1', {
        title: 'Updated title',
      });

      expect(mockRepo.update).toHaveBeenCalledWith(
        'template-uuid-1',
        expect.objectContaining({ title: 'Updated title', updatedBy: 100 }),
      );
      expect(result.title).toBe('Updated title');
    });
  });

  describe('delete', () => {
    it('404s when the id does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.delete('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes exactly the targeted row', async () => {
      mockRepo.findOne.mockResolvedValue(
        makeTemplate({ id: 'template-uuid-1' }),
      );
      mockRepo.delete.mockResolvedValue({ affected: 1 });

      const result = await service.delete('template-uuid-1');

      expect(mockRepo.delete).toHaveBeenCalledWith('template-uuid-1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('bulkDelete', () => {
    it('rejects an empty id list', async () => {
      await expect(service.bulkDelete([])).rejects.toThrow(BadRequestException);
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes exactly the targeted rows', async () => {
      mockRepo.delete.mockResolvedValue({ affected: 2 });

      const result = await service.bulkDelete(['id-1', 'id-2']);

      expect(mockRepo.delete).toHaveBeenCalledWith({
        id: In(['id-1', 'id-2']),
      });
      expect(result).toEqual({ success: true });
    });

    it('reports failure when nothing was deleted', async () => {
      mockRepo.delete.mockResolvedValue({ affected: 0 });

      const result = await service.bulkDelete(['missing-id']);

      expect(result).toEqual({ success: false });
    });
  });

  describe('list', () => {
    it('passes type filter, search and pagination through to the repository', async () => {
      mockRepo.listTemplates.mockResolvedValue({ items: [], total: 0 });

      await service.list({
        type: TrackItemType.QUIZ,
        search: 'onboarding',
        limit: 10,
        offset: 5,
      });

      expect(mockRepo.listTemplates).toHaveBeenCalledWith({
        type: TrackItemType.QUIZ,
        search: 'onboarding',
        limit: 10,
        offset: 5,
      });
    });

    it('defaults limit/offset when omitted', async () => {
      mockRepo.listTemplates.mockResolvedValue({ items: [], total: 0 });

      await service.list({});

      expect(mockRepo.listTemplates).toHaveBeenCalledWith({
        type: undefined,
        search: undefined,
        limit: 20,
        offset: 0,
      });
    });

    it('returns items and total from the repository', async () => {
      const items = [makeTemplate()];
      mockRepo.listTemplates.mockResolvedValue({ items, total: 1 });

      const result = await service.list();

      expect(result).toEqual({ items, total: 1 });
    });
  });
});
