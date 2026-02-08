import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { ConversationalGuardrailsRepository } from '../conversational-guardrails.repository';
import { ConversationalGuardrails } from '../../entity/conversational-guardrails.entity';

describe('ConversationalGuardrailsRepository', () => {
  let repository: ConversationalGuardrailsRepository;
  let mockQueryBuilder: jest.Mocked<SelectQueryBuilder<ConversationalGuardrails>>;
  let mockDataSource: any;

  const mockGuardrail: ConversationalGuardrails = {
    id: 'guardrail-uuid-1',
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
      helperDialogue: 'interrupting',
      actorDialogue: 'Please let me finish',
      active: true,
      createdAt: new Date('2026-01-02'),
      updatedAt: new Date('2026-01-02'),
    } as ConversationalGuardrails,
  ];

  beforeEach(async () => {
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(mockGuardrails),
      getCount: jest.fn().mockResolvedValue(2),
      getOne: jest.fn().mockResolvedValue(mockGuardrail),
    } as unknown as jest.Mocked<SelectQueryBuilder<ConversationalGuardrails>>;

    mockDataSource = {
      createEntityManager: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationalGuardrailsRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<ConversationalGuardrailsRepository>(
      ConversationalGuardrailsRepository,
    );
    
    // Mock createQueryBuilder on the repository instance
    jest.spyOn(repository, 'createQueryBuilder').mockReturnValue(mockQueryBuilder as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(repository).toBeDefined();
    });
  });

  describe('getGuardrails', () => {
    it('should return all guardrails when no options provided', async () => {
      const result = await repository.getGuardrails();

      expect(result).toEqual(mockGuardrails);
      expect(repository.createQueryBuilder).toHaveBeenCalledWith('guardrail');
    });

    it('should apply search filter when search param is provided', async () => {
      await repository.getGuardrails('rude');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'guardrail.helperDialogue ILIKE :search OR guardrail.actorDialogue ILIKE :search',
        { search: '%rude%' },
      );
    });

    it('should apply pagination', async () => {
      await repository.getGuardrails(undefined, { limit: 10, offset: 0 });

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(0);
    });

    it('should apply sorting', async () => {
      await repository.getGuardrails(undefined, { sortBy: 'helperDialogue', order: 'DESC' });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('guardrail.helperDialogue', 'DESC');
    });
  });

  describe('getActiveGuardrails', () => {
    it('should return only active guardrails', async () => {
      await repository.getActiveGuardrails();

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'guardrail.active = :active',
        { active: true },
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });
  });

  describe('getRandomGuardrails', () => {
    it('should return random active guardrails', async () => {
      await repository.getRandomGuardrails(25);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'guardrail.active = :active',
        { active: true },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('RANDOM()');
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(25);
    });
  });

  describe('countGuardrails', () => {
    it('should count total guardrails', async () => {
      const count = await repository.countGuardrails();

      expect(count).toBe(2);
      expect(mockQueryBuilder.getCount).toHaveBeenCalled();
    });

    it('should count with search filter', async () => {
      await repository.countGuardrails('rude');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'guardrail.helperDialogue ILIKE :search OR guardrail.actorDialogue ILIKE :search',
        { search: '%rude%' },
      );
    });
  });
});
