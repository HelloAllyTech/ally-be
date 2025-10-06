import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { ScenarioService } from '../scenario.service';
import { Scenarios } from '../../entity/scenarios.entity';
import { ScenarioStatus } from '../../enum/scenario.status.enum';
import { CreateScenariosDto } from '../../dto/create-scenarios.dto';
import { UpdateScenarioDto } from '../../dto/update-scenario.dto';

describe('ScenarioService', () => {
  let service: ScenarioService;
  let repository: jest.Mocked<Repository<Scenarios>>;

  const mockScenario: Scenarios = {
    id: 1,
    title: 'Test Scenario',
    scenario: 'Test scenario content',
    description: 'Test description',
    coverImageUrl: 'https://example.com/cover.jpg',
    status: ScenarioStatus.ACTIVE,
    prompt: 'You are a counselor helping a client with anxiety',
    metadata: {
      difficulty: 'intermediate',
      tags: ['anxiety', 'counseling'],
      duration: 30,
      objectives: ['active listening', 'empathy building'],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCreateScenariosDto: CreateScenariosDto = {
    scenarios: [
      {
        title: 'New Scenario',
        scenario: 'New scenario content',
        description: 'New description',
        coverImageUrl: 'https://example.com/new-cover.jpg',
        status: 'ACTIVE',
        prompt: 'You are a counselor helping a client with depression',
        metadata: {
          difficulty: 'beginner',
          tags: ['depression', 'support'],
          duration: 20,
          objectives: ['building rapport', 'identifying triggers'],
        },
      },
    ],
  };

  const mockUpdateScenarioDto: UpdateScenarioDto = {
    title: 'Updated Scenario',
    prompt: 'Updated prompt for counselor guidance',
    metadata: {
      difficulty: 'advanced',
      tags: ['trauma', 'PTSD'],
      duration: 45,
      objectives: ['trauma-informed care', 'safety planning'],
    },
  };

  beforeEach(async () => {
    const mockRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioService,
        {
          provide: getRepositoryToken(Scenarios),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<ScenarioService>(ScenarioService);
    repository = module.get(getRepositoryToken(Scenarios));
  });

  describe('getScenarios', () => {
    it('should return array of scenarios', async () => {
      const mockScenarios = [mockScenario];
      repository.find.mockResolvedValue(mockScenarios);

      const result = await service.getScenarios();

      expect(result).toEqual(mockScenarios);
      expect(repository.find).toHaveBeenCalledWith({
        select: [
          'id',
          'title',
          'scenario',
          'description',
          'coverImageUrl',
          'status',
        ],
        order: { createdAt: 'DESC', id: 'DESC' },
      });
    });
  });

  describe('getScenario', () => {
    it('should throw NotFoundException when scenario is not found', async () => {
      const scenarioId = 999;
      repository.findOne.mockResolvedValue(null);

      await expect(service.getScenario(scenarioId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getScenario(scenarioId)).rejects.toThrow(
        'Scenario not found',
      );
    });

    it('should return scenario by id', async () => {
      const scenarioId = 1;
      repository.findOne.mockResolvedValue(mockScenario);

      const result = await service.getScenario(scenarioId);

      expect(result).toEqual(mockScenario);
      expect(repository.findOne).toHaveBeenCalledWith({
        select: [
          'id',
          'title',
          'scenario',
          'description',
          'coverImageUrl',
          'status',
        ],
        where: { id: scenarioId },
      });
    });

    it('should return scenario by id using EntityManager', async () => {
      const scenarioId = 1;
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(mockScenario),
        }),
      } as unknown as EntityManager;

      const result = await service.getScenario(scenarioId, mockEntityManager);

      expect(result).toEqual(mockScenario);
      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(Scenarios);
    });
  });

  describe('createScenarios', () => {
    it('should create and return scenarios', async () => {
      const createdScenarios = [mockScenario];
      repository.create.mockReturnValue(createdScenarios as any);
      repository.save.mockResolvedValue(createdScenarios as any);

      const result = await service.createScenarios(mockCreateScenariosDto);

      expect(result).toEqual(createdScenarios);
      expect(repository.create).toHaveBeenCalledWith(
        mockCreateScenariosDto.scenarios,
      );
      expect(repository.save).toHaveBeenCalledWith(createdScenarios);
    });
  });

  describe('updateScenario', () => {
    it('should throw NotFoundException when scenario to update is not found', async () => {
      const scenarioId = 999;
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.updateScenario(scenarioId, mockUpdateScenarioDto),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateScenario(scenarioId, mockUpdateScenarioDto),
      ).rejects.toThrow('Scenario not found');
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: scenarioId },
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should update scenario and return true when affected > 0', async () => {
      const scenarioId = 1;
      repository.findOne.mockResolvedValue(mockScenario);
      repository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: {},
      });

      const result = await service.updateScenario(
        scenarioId,
        mockUpdateScenarioDto,
      );

      expect(result).toBe(true);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: scenarioId },
      });
      expect(repository.update).toHaveBeenCalledWith(
        scenarioId,
        mockUpdateScenarioDto,
      );
    });

    it('should update scenario and return false when affected = 0', async () => {
      const scenarioId = 1;
      repository.findOne.mockResolvedValue(mockScenario);
      repository.update.mockResolvedValue({
        affected: 0,
        generatedMaps: [],
        raw: {},
      });

      const result = await service.updateScenario(
        scenarioId,
        mockUpdateScenarioDto,
      );

      expect(result).toBe(false);
      expect(repository.update).toHaveBeenCalledWith(
        scenarioId,
        mockUpdateScenarioDto,
      );
    });
  });
});
