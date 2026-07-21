import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PromptTranslationRepository } from '../prompt-translation.repository';
import {
  PromptTranslation,
  PromptTranslationStatus,
} from '../../entity/prompt-translation.entity';

describe('PromptTranslationRepository', () => {
  let repository: PromptTranslationRepository;

  const mockPromptId = '123e4567-e89b-12d3-a456-426614174000';
  const mockLanguageId = 7;

  const mockTranslation: PromptTranslation = {
    id: '223e4567-e89b-12d3-a456-426614174001',
    promptId: mockPromptId,
    languageId: mockLanguageId,
    promptVersionId: '323e4567-e89b-12d3-a456-426614174002',
    translatedPrompt: 'अनुवादित टेम्पलेट {name}',
    sourceHash: 'abc123',
    status: PromptTranslationStatus.READY,
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    translationPromptVersion: '1',
    error: undefined,
    createdAt: new Date('2026-07-20'),
    updatedAt: new Date('2026-07-20'),
  };

  beforeEach(async () => {
    const mockDataSource = { createEntityManager: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptTranslationRepository,
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    repository = module.get<PromptTranslationRepository>(
      PromptTranslationRepository,
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('findByPromptAndLanguage', () => {
    it('queries the single live row by (promptId, languageId)', async () => {
      const findOne = jest
        .spyOn(repository, 'findOne')
        .mockResolvedValue(mockTranslation);

      const result = await repository.findByPromptAndLanguage(
        mockPromptId,
        mockLanguageId,
      );

      expect(result).toEqual(mockTranslation);
      expect(findOne).toHaveBeenCalledWith({
        where: { promptId: mockPromptId, languageId: mockLanguageId },
      });
    });

    it('returns null when no translation exists', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      const result = await repository.findByPromptAndLanguage(
        mockPromptId,
        mockLanguageId,
      );

      expect(result).toBeNull();
    });
  });

  describe('findAllForPrompt', () => {
    it('lists all languages for a prompt ordered by languageId', async () => {
      const find = jest
        .spyOn(repository, 'find')
        .mockResolvedValue([mockTranslation]);

      const result = await repository.findAllForPrompt(mockPromptId);

      expect(result).toEqual([mockTranslation]);
      expect(find).toHaveBeenCalledWith({
        where: { promptId: mockPromptId },
        order: { languageId: 'ASC' },
      });
    });
  });

  describe('upsertTranslation', () => {
    it('upserts on the (promptId, languageId) conflict key', async () => {
      const upsert = jest
        .spyOn(repository, 'upsert')
        .mockResolvedValue({} as any);

      await repository.upsertTranslation({
        promptId: mockPromptId,
        languageId: mockLanguageId,
        sourceHash: 'abc123',
        status: PromptTranslationStatus.READY,
        translatedPrompt: 'अनुवादित टेम्पलेट {name}',
      });

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          promptId: mockPromptId,
          languageId: mockLanguageId,
          sourceHash: 'abc123',
          status: PromptTranslationStatus.READY,
        }),
        expect.objectContaining({
          conflictPaths: ['promptId', 'languageId'],
        }),
      );
    });
  });

  describe('markStatus', () => {
    it('updates status and error for the row', async () => {
      const update = jest
        .spyOn(repository, 'update')
        .mockResolvedValue({} as any);

      await repository.markStatus(
        mockPromptId,
        mockLanguageId,
        PromptTranslationStatus.FAILED,
        'gemini timeout',
      );

      expect(update).toHaveBeenCalledWith(
        { promptId: mockPromptId, languageId: mockLanguageId },
        { status: PromptTranslationStatus.FAILED, error: 'gemini timeout' },
      );
    });
  });
});
