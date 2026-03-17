import { Test, TestingModule } from '@nestjs/testing';
import { ConversationalGuardrailsService } from '../conversational-guardrails.service';
import { ConversationalGuardrailsRepository } from '../../repository/conversational-guardrails.repository';
import { ConversationalGuardrailsTranslationsRepository } from '../../repository/conversational-guardrails-translations.repository';
import { ConversationalGuardrailsTranslationService } from '../conversational-guardrails-translation.service';
import { ConversationalGuardrails } from '../../entity/conversational-guardrails.entity';
import { ConversationalGuardrailsTranslations } from '../../entity/conversational-guardrails-translations.entity';

describe('ConversationalGuardrailsService', () => {
  let service: ConversationalGuardrailsService;
  let guardrailsRepository: jest.Mocked<ConversationalGuardrailsRepository>;
  let translationsRepository: jest.Mocked<ConversationalGuardrailsTranslationsRepository>;

  const mockGuardrail: ConversationalGuardrails = {
    id: 'guardrail-uuid-1',
    name: 'Guardrail 1',
    helperDialogue: 'rude',
    actorDialogue: 'Please be respectful',
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as ConversationalGuardrails;

  const mockGuardrails: ConversationalGuardrails[] = [
    mockGuardrail,
    {
      id: 'guardrail-uuid-2',
      name: 'Guardrail 2',
      helperDialogue: 'interrupting',
      actorDialogue: 'Please let me finish',
      active: true,
      createdAt: new Date('2026-01-02'),
      updatedAt: new Date('2026-01-02'),
    } as ConversationalGuardrails,
  ];

  const mockTranslation: ConversationalGuardrailsTranslations = {
    id: 'translation-uuid-1',
    guardrailId: 'guardrail-uuid-1',
    languageId: 2,
    helperDialogue: 'grosero',
    actorDialogue: 'Por favor sea respetuoso',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as ConversationalGuardrailsTranslations;

  beforeEach(async () => {
    const mockGuardrailsRepository = {
      getGuardrails: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      delete: jest.fn(),
      countGuardrails: jest.fn(),
      getRandomGuardrails: jest.fn(),
    };

    const mockTranslationsRepository = {
      getTranslationsByGuardrailId: jest.fn(),
      getTranslationsForGuardrails: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
      delete: jest.fn(),
    };

    const mockTranslationService = {
      createUpdateGuardrailTranslations: jest.fn().mockResolvedValue(undefined),
      getGuardrailsWithTranslations: jest.fn(),
      persistGuardrailTranslations: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationalGuardrailsService,
        {
          provide: ConversationalGuardrailsRepository,
          useValue: mockGuardrailsRepository,
        },
        {
          provide: ConversationalGuardrailsTranslationsRepository,
          useValue: mockTranslationsRepository,
        },
        {
          provide: ConversationalGuardrailsTranslationService,
          useValue: mockTranslationService,
        },
      ],
    }).compile();

    service = module.get<ConversationalGuardrailsService>(
      ConversationalGuardrailsService,
    );
    guardrailsRepository = module.get(ConversationalGuardrailsRepository);
    translationsRepository = module.get(
      ConversationalGuardrailsTranslationsRepository,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have all dependencies injected', () => {
      expect(guardrailsRepository).toBeDefined();
      expect(translationsRepository).toBeDefined();
    });
  });

  describe('getGuardrails', () => {
    it('should return paginated guardrails', async () => {
      const mockResult = mockGuardrails;
      guardrailsRepository.getGuardrails.mockResolvedValue(mockResult);

      const result = await service.getGuardrails('search', {
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual(mockResult);
      expect(guardrailsRepository.getGuardrails).toHaveBeenCalledWith(
        'search',
        {
          limit: 10,
          offset: 0,
        },
      );
    });

    it('should return empty array when no guardrails exist', async () => {
      guardrailsRepository.getGuardrails.mockResolvedValue([]);

      const result = await service.getGuardrails();

      expect(result).toEqual([]);
    });
  });

  describe('getGuardrailById', () => {
    it('should return guardrail by id', async () => {
      guardrailsRepository.findOne.mockResolvedValue(mockGuardrail);

      const result = await service.getGuardrailById('guardrail-uuid-1');

      expect(result).toEqual(mockGuardrail);
    });

    it('should throw NotFoundException when guardrail not found', async () => {
      guardrailsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getGuardrailById('non-existent-id'),
      ).rejects.toThrow();
    });
  });

  describe('createGuardrail', () => {
    it('should create a new guardrail', async () => {
      const createDto = {
        name: 'New Guardrail',
        helperDialogue: 'New helper',
        actorDialogue: 'New actor response',
        active: true,
      };
      guardrailsRepository.create.mockReturnValue({
        ...mockGuardrail,
        ...createDto,
      });
      guardrailsRepository.save.mockResolvedValue({
        ...mockGuardrail,
        ...createDto,
      });

      const result = await service.createGuardrail(createDto);

      expect(result.name).toBe('New Guardrail');
      expect(result.helperDialogue).toBe('New helper');
      expect(guardrailsRepository.create).toHaveBeenCalledWith(createDto);
      expect(guardrailsRepository.save).toHaveBeenCalled();
    });
  });

  describe('updateGuardrail', () => {
    it('should update an existing guardrail', async () => {
      const updateDto = {
        helperDialogue: 'Updated helper',
      };
      guardrailsRepository.findOne.mockResolvedValue(mockGuardrail);
      guardrailsRepository.save.mockResolvedValue({
        ...mockGuardrail,
        ...updateDto,
      });

      const result = await service.updateGuardrail(
        'guardrail-uuid-1',
        updateDto,
      );

      expect(result.helperDialogue).toBe('Updated helper');
      expect(guardrailsRepository.save).toHaveBeenCalled();
    });
  });

  describe('Translation methods', () => {
    describe('getTranslationsByGuardrailId', () => {
      it('should return translations for a guardrail', async () => {
        translationsRepository.getTranslationsByGuardrailId.mockResolvedValue([
          mockTranslation,
        ]);

        const result =
          await service.getTranslationsByGuardrailId('guardrail-uuid-1');

        expect(result).toEqual([mockTranslation]);
        expect(
          translationsRepository.getTranslationsByGuardrailId,
        ).toHaveBeenCalledWith('guardrail-uuid-1');
      });
    });

    describe('createTranslation', () => {
      it('should create a translation for a guardrail', async () => {
        const createDto = {
          guardrailId: 'guardrail-uuid-1',
          languageId: 2,
          helperDialogue: 'grosero',
          actorDialogue: 'Por favor sea respetuoso',
        };

        // Mock getGuardrailById check
        guardrailsRepository.findOne.mockResolvedValue(mockGuardrail);

        translationsRepository.create.mockReturnValue(mockTranslation);
        translationsRepository.save.mockResolvedValue(mockTranslation);

        const result = await service.createTranslation(createDto);

        expect(result).toEqual(mockTranslation);
        expect(translationsRepository.create).toHaveBeenCalledWith(createDto);
      });
    });
  });

  describe('getRandomGuardrailsForSession', () => {
    it('should return items array with correct helperDialogue and actorDialogue shape', async () => {
      guardrailsRepository.getGuardrails.mockResolvedValue(mockGuardrails);

      const result = await service.getRandomGuardrailsForSession();

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        helperDialogue: mockGuardrails[0].helperDialogue,
        actorDialogue: mockGuardrails[0].actorDialogue,
      });
      expect(result.items[1]).toEqual({
        helperDialogue: mockGuardrails[1].helperDialogue,
        actorDialogue: mockGuardrails[1].actorDialogue,
      });
    });

    it('should return prompt string containing guardrail dialogues', async () => {
      guardrailsRepository.getGuardrails.mockResolvedValue(mockGuardrails);

      const result = await service.getRandomGuardrailsForSession();

      expect(result.prompt).toContain('Consider the following guardrails');
      expect(result.prompt).toContain(mockGuardrails[0].helperDialogue);
      expect(result.prompt).toContain(mockGuardrails[0].actorDialogue);
    });

    it('should use translations for non-English sessions', async () => {
      guardrailsRepository.getGuardrails.mockResolvedValue(mockGuardrails);
      translationsRepository.getTranslationsForGuardrails.mockResolvedValue([
        mockTranslation,
      ]);

      const result = await service.getRandomGuardrailsForSession(2);

      // use expect.objectContaining since translation object has extra fields
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          helperDialogue: mockTranslation.helperDialogue,
          actorDialogue: mockTranslation.actorDialogue,
        }),
      );
      expect(
        translationsRepository.getTranslationsForGuardrails,
      ).toHaveBeenCalledWith(['guardrail-uuid-1', 'guardrail-uuid-2'], 2);
    });

    it('should return empty prompt string and empty items array when no guardrails exist', async () => {
      guardrailsRepository.getGuardrails.mockResolvedValue([]);

      const result = await service.getRandomGuardrailsForSession();

      expect(result.prompt).toBe('');
      expect(result.items).toEqual([]);
    });

  });
});
