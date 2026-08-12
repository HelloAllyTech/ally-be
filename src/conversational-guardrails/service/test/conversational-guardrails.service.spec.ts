import { Test, TestingModule } from '@nestjs/testing';
import { ConversationalGuardrailsService } from '../conversational-guardrails.service';
import { ConversationalGuardrailsRepository } from '../../repository/conversational-guardrails.repository';
import { ConversationalGuardrails } from '../../entity/conversational-guardrails.entity';

describe('ConversationalGuardrailsService', () => {
  let service: ConversationalGuardrailsService;
  let guardrailsRepository: jest.Mocked<ConversationalGuardrailsRepository>;

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

  beforeEach(async () => {
    const mockGuardrailsRepository = {
      getGuardrails: jest.fn(),
      getSystemGuardrails: jest.fn().mockResolvedValue([]),
      getRandomUserGuardrails: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      delete: jest.fn(),
      countGuardrails: jest.fn(),
      getRandomGuardrails: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationalGuardrailsService,
        {
          provide: ConversationalGuardrailsRepository,
          useValue: mockGuardrailsRepository,
        },
      ],
    }).compile();

    service = module.get<ConversationalGuardrailsService>(
      ConversationalGuardrailsService,
    );
    guardrailsRepository = module.get(ConversationalGuardrailsRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have its dependencies injected', () => {
      expect(guardrailsRepository).toBeDefined();
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

    it('should block disabling a mandatory guardrail', async () => {
      const mandatoryGuardrail = {
        ...mockGuardrail,
        mandatory: true,
      } as ConversationalGuardrails;
      guardrailsRepository.findOne.mockResolvedValue(mandatoryGuardrail);

      await expect(
        service.updateGuardrail('guardrail-uuid-1', { active: false }),
      ).rejects.toThrow(
        'This guardrail is mandatory and cannot be disabled or deleted.',
      );
      expect(guardrailsRepository.save).not.toHaveBeenCalled();
    });

    it('should allow editing the dialogue of a mandatory guardrail', async () => {
      const mandatoryGuardrail = {
        ...mockGuardrail,
        mandatory: true,
      } as ConversationalGuardrails;
      guardrailsRepository.findOne.mockResolvedValue(mandatoryGuardrail);
      guardrailsRepository.save.mockResolvedValue({
        ...mandatoryGuardrail,
        helperDialogue: 'Refined definition',
      });

      const result = await service.updateGuardrail('guardrail-uuid-1', {
        helperDialogue: 'Refined definition',
      });

      expect(result.helperDialogue).toBe('Refined definition');
      expect(guardrailsRepository.save).toHaveBeenCalled();
    });
  });

  describe('getRandomGuardrailsForSession', () => {
    const mockSystemGuardrail = {
      id: 'system-uuid-1',
      name: 'STT Coherence Guard',
      helperDialogue: 'detect gibberish or out-of-context utterances',
      actorDialogue: 'ask the counselor to repeat or rephrase',
      active: true,
      kind: 'SYSTEM',
      mandatory: true,
      detectorType: 'COHERENCE',
    } as unknown as ConversationalGuardrails;

    it('should return items array with correct helperDialogue and actorDialogue shape', async () => {
      guardrailsRepository.getRandomUserGuardrails.mockResolvedValue(
        mockGuardrails,
      );

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

    it('should return prompt string containing user guardrail dialogues', async () => {
      guardrailsRepository.getRandomUserGuardrails.mockResolvedValue(
        mockGuardrails,
      );

      const result = await service.getRandomGuardrailsForSession();

      expect(result.prompt).toContain('Consider the following guardrails');
      expect(result.prompt).toContain(mockGuardrails[0].helperDialogue);
      expect(result.prompt).toContain(mockGuardrails[0].actorDialogue);
    });

    it('should always include system guardrails (first) and exclude them from the prompt block', async () => {
      guardrailsRepository.getSystemGuardrails.mockResolvedValue([
        mockSystemGuardrail,
      ]);
      guardrailsRepository.getRandomUserGuardrails.mockResolvedValue(
        mockGuardrails,
      );

      const result = await service.getRandomGuardrailsForSession();

      // System first, then user — all using their own (untranslated) text.
      expect(result.items).toHaveLength(3);
      expect(result.items[0]).toEqual({
        helperDialogue: mockSystemGuardrail.helperDialogue,
        actorDialogue: mockSystemGuardrail.actorDialogue,
        kind: 'SYSTEM',
        detectorType: 'COHERENCE',
      });
      // System guardrail fires dynamically, so it is not in the static prompt.
      expect(result.prompt).not.toContain(mockSystemGuardrail.helperDialogue);
    });

    it('should return empty prompt string and empty items array when no guardrails exist', async () => {
      const result = await service.getRandomGuardrailsForSession();

      expect(result.prompt).toBe('');
      expect(result.items).toEqual([]);
    });

    it('should skip user guardrail sampling when optGuardrails is false, but still fetch system guardrails', async () => {
      guardrailsRepository.getSystemGuardrails.mockResolvedValue([
        mockSystemGuardrail,
      ]);

      const result = await service.getRandomGuardrailsForSession(
        undefined,
        false,
      );

      expect(
        guardrailsRepository.getRandomUserGuardrails,
      ).not.toHaveBeenCalled();
      expect(result.items).toEqual([
        {
          helperDialogue: mockSystemGuardrail.helperDialogue,
          actorDialogue: mockSystemGuardrail.actorDialogue,
          kind: 'SYSTEM',
          detectorType: 'COHERENCE',
        },
      ]);
    });

    it.each([true, undefined])(
      'should sample user guardrails as normal when optGuardrails is %s',
      async (optGuardrails) => {
        guardrailsRepository.getRandomUserGuardrails.mockResolvedValue(
          mockGuardrails,
        );

        const result = await service.getRandomGuardrailsForSession(
          undefined,
          optGuardrails,
        );

        expect(guardrailsRepository.getRandomUserGuardrails).toHaveBeenCalled();
        expect(result.items).toHaveLength(2);
      },
    );

    it('should exclude the system guardrail only for the scenario-373 latency-test scenario', async () => {
      guardrailsRepository.getSystemGuardrails.mockResolvedValue([
        mockSystemGuardrail,
      ]);

      const excluded = await service.getRandomGuardrailsForSession(373);
      expect(excluded.items).toEqual([]);

      const other = await service.getRandomGuardrailsForSession(374);
      expect(other.items).toHaveLength(1);
    });
  });
});
