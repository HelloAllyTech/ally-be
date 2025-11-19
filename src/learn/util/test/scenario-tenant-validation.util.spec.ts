import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ScenarioTenantValidationUtil } from '../scenario-tenant-validation.util';
import { TenantsRepository } from 'src/tenant/repository/tenant.repository';
import { ScenariosRepository } from 'src/learn/repository/scenario.repository';
import { In } from 'typeorm';

describe('ScenarioTenantValidationUtil', () => {
  let util: ScenarioTenantValidationUtil;
  let tenantsRepository: jest.Mocked<TenantsRepository>;
  let scenariosRepository: jest.Mocked<ScenariosRepository>;

  const mockTenantId = 'tenant-123';
  const mockScenarioIds = [1, 2, 3];

  const mockTenant = {
    id: 'tenant-123',
    name: 'Test Tenant',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockScenarios = [
    {
      id: 1,
      title: 'Scenario 1',
      description: 'Description 1',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 2,
      title: 'Scenario 2',
      description: 'Description 2',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 3,
      title: 'Scenario 3',
      description: 'Description 3',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  beforeEach(async () => {
    const mockTenantsRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const mockScenariosRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioTenantValidationUtil,
        {
          provide: TenantsRepository,
          useValue: mockTenantsRepository,
        },
        {
          provide: ScenariosRepository,
          useValue: mockScenariosRepository,
        },
      ],
    }).compile();

    util = module.get<ScenarioTenantValidationUtil>(
      ScenarioTenantValidationUtil,
    );
    tenantsRepository = module.get(TenantsRepository);
    scenariosRepository = module.get(ScenariosRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(util).toBeDefined();
    });

    it('should have tenantsRepository injected', () => {
      expect(tenantsRepository).toBeDefined();
    });

    it('should have scenariosRepository injected', () => {
      expect(scenariosRepository).toBeDefined();
    });
  });

  describe('validateScenarioTenant', () => {
    describe('successful validation', () => {
      it('should validate successfully with valid tenant and scenarios', async () => {
        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockResolvedValue(mockScenarios as any);

        await expect(
          util.validateScenarioTenant(mockScenarioIds, mockTenantId),
        ).resolves.toBeUndefined();

        expect(tenantsRepository.findOne).toHaveBeenCalledWith({
          where: { id: mockTenantId },
        });
        expect(scenariosRepository.find).toHaveBeenCalledWith({
          where: { id: In(mockScenarioIds) },
        });
      });

      it('should validate successfully with single scenario', async () => {
        const singleScenarioId = [1];
        const singleScenario = [mockScenarios[0]];

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockResolvedValue(singleScenario as any);

        await expect(
          util.validateScenarioTenant(singleScenarioId, mockTenantId),
        ).resolves.toBeUndefined();

        expect(tenantsRepository.findOne).toHaveBeenCalledWith({
          where: { id: mockTenantId },
        });
        expect(scenariosRepository.find).toHaveBeenCalledWith({
          where: { id: In(singleScenarioId) },
        });
      });

      it('should validate successfully with large number of scenarios', async () => {
        const largeScenarioIds = Array.from({ length: 100 }, (_, i) => i + 1);
        const largeScenarios = largeScenarioIds.map((id) => ({
          id,
          title: `Scenario ${id}`,
          description: `Description ${id}`,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        }));

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockResolvedValue(largeScenarios as any);

        await expect(
          util.validateScenarioTenant(largeScenarioIds, mockTenantId),
        ).resolves.toBeUndefined();
      });
    });

    describe('tenant validation errors', () => {
      it('should throw NotFoundException when tenant does not exist', async () => {
        tenantsRepository.findOne.mockResolvedValue(null);

        await expect(
          util.validateScenarioTenant(mockScenarioIds, mockTenantId),
        ).rejects.toThrow(NotFoundException);

        await expect(
          util.validateScenarioTenant(mockScenarioIds, mockTenantId),
        ).rejects.toThrow('Tenant not found');

        expect(tenantsRepository.findOne).toHaveBeenCalledWith({
          where: { id: mockTenantId },
        });
        expect(scenariosRepository.find).not.toHaveBeenCalled();
      });

      it('should throw NotFoundException for invalid tenant id format', async () => {
        const invalidTenantId = 'invalid-tenant-999';
        tenantsRepository.findOne.mockResolvedValue(null);

        await expect(
          util.validateScenarioTenant(mockScenarioIds, invalidTenantId),
        ).rejects.toThrow(NotFoundException);

        expect(tenantsRepository.findOne).toHaveBeenCalledWith({
          where: { id: invalidTenantId },
        });
      });
    });

    describe('duplicate scenario ids validation', () => {
      it('should throw BadRequestException when scenario ids contain duplicates', async () => {
        const duplicateScenarioIds = [1, 2, 2, 3];

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);

        await expect(
          util.validateScenarioTenant(duplicateScenarioIds, mockTenantId),
        ).rejects.toThrow(BadRequestException);

        await expect(
          util.validateScenarioTenant(duplicateScenarioIds, mockTenantId),
        ).rejects.toThrow('Duplicate scenario ids');

        expect(tenantsRepository.findOne).toHaveBeenCalled();
        expect(scenariosRepository.find).not.toHaveBeenCalled();
      });

      it('should throw BadRequestException with multiple duplicate scenario ids', async () => {
        const duplicateScenarioIds = [1, 1, 2, 2, 3, 3];

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);

        await expect(
          util.validateScenarioTenant(duplicateScenarioIds, mockTenantId),
        ).rejects.toThrow(BadRequestException);

        await expect(
          util.validateScenarioTenant(duplicateScenarioIds, mockTenantId),
        ).rejects.toThrow('Duplicate scenario ids');
      });

      it('should throw BadRequestException when all scenario ids are duplicates', async () => {
        const allDuplicates = [5, 5, 5, 5];

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);

        await expect(
          util.validateScenarioTenant(allDuplicates, mockTenantId),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('scenario existence validation', () => {
      it('should throw NotFoundException when no valid scenarios are found', async () => {
        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockResolvedValue([]);

        await expect(
          util.validateScenarioTenant(mockScenarioIds, mockTenantId),
        ).rejects.toThrow(NotFoundException);

        await expect(
          util.validateScenarioTenant(mockScenarioIds, mockTenantId),
        ).rejects.toThrow('No valid scenarios found');

        expect(scenariosRepository.find).toHaveBeenCalledWith({
          where: { id: In(mockScenarioIds) },
        });
      });

      it('should throw NotFoundException when some scenarios do not exist', async () => {
        const requestedIds = [1, 2, 999];
        const existingScenarios = [mockScenarios[0], mockScenarios[1]];

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockResolvedValue(existingScenarios as any);

        await expect(
          util.validateScenarioTenant(requestedIds, mockTenantId),
        ).rejects.toThrow(NotFoundException);

        await expect(
          util.validateScenarioTenant(requestedIds, mockTenantId),
        ).rejects.toThrow('Scenarios 999 do not exist');
      });

      it('should throw NotFoundException with multiple missing scenario ids', async () => {
        const requestedIds = [1, 2, 998, 999];
        const existingScenarios = [mockScenarios[0], mockScenarios[1]];

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockResolvedValue(existingScenarios as any);

        await expect(
          util.validateScenarioTenant(requestedIds, mockTenantId),
        ).rejects.toThrow(NotFoundException);

        await expect(
          util.validateScenarioTenant(requestedIds, mockTenantId),
        ).rejects.toThrow('Scenarios 998, 999 do not exist');
      });

      it('should throw NotFoundException when all scenarios do not exist', async () => {
        const nonExistentIds = [997, 998, 999];

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockResolvedValue([]);

        await expect(
          util.validateScenarioTenant(nonExistentIds, mockTenantId),
        ).rejects.toThrow(NotFoundException);

        await expect(
          util.validateScenarioTenant(nonExistentIds, mockTenantId),
        ).rejects.toThrow('No valid scenarios found');
      });
    });

    describe('edge cases', () => {
      it('should handle empty scenario ids array', async () => {
        const emptyScenarioIds: number[] = [];

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockResolvedValue([]);

        await expect(
          util.validateScenarioTenant(emptyScenarioIds, mockTenantId),
        ).rejects.toThrow(NotFoundException);

        await expect(
          util.validateScenarioTenant(emptyScenarioIds, mockTenantId),
        ).rejects.toThrow('No valid scenarios found');
      });

      it('should handle scenario ids with zero', async () => {
        const scenarioIdsWithZero = [0, 1, 2];

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockResolvedValue([
          mockScenarios[0],
          mockScenarios[1],
        ] as any);

        await expect(
          util.validateScenarioTenant(scenarioIdsWithZero, mockTenantId),
        ).rejects.toThrow(NotFoundException);

        await expect(
          util.validateScenarioTenant(scenarioIdsWithZero, mockTenantId),
        ).rejects.toThrow('Scenarios 0 do not exist');
      });

      it('should handle negative scenario ids', async () => {
        const negativeScenarioIds = [-1, 1, 2];

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockResolvedValue([
          mockScenarios[0],
          mockScenarios[1],
        ] as any);

        await expect(
          util.validateScenarioTenant(negativeScenarioIds, mockTenantId),
        ).rejects.toThrow(NotFoundException);

        await expect(
          util.validateScenarioTenant(negativeScenarioIds, mockTenantId),
        ).rejects.toThrow('Scenarios -1 do not exist');
      });

      it('should handle scenarios returned in different order', async () => {
        const requestedIds = [3, 1, 2];
        const returnedScenarios = [
          mockScenarios[0],
          mockScenarios[2],
          mockScenarios[1],
        ];

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockResolvedValue(returnedScenarios as any);

        await expect(
          util.validateScenarioTenant(requestedIds, mockTenantId),
        ).resolves.toBeUndefined();
      });
    });

    describe('database errors', () => {
      it('should handle database error when finding tenant', async () => {
        const dbError = new Error('Database connection error');
        tenantsRepository.findOne.mockRejectedValue(dbError);

        await expect(
          util.validateScenarioTenant(mockScenarioIds, mockTenantId),
        ).rejects.toThrow('Database connection error');

        expect(scenariosRepository.find).not.toHaveBeenCalled();
      });

      it('should handle database error when finding scenarios', async () => {
        const dbError = new Error('Database query failed');
        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockRejectedValue(dbError);

        await expect(
          util.validateScenarioTenant(mockScenarioIds, mockTenantId),
        ).rejects.toThrow('Database query failed');

        expect(tenantsRepository.findOne).toHaveBeenCalled();
      });

      it('should handle timeout error', async () => {
        const timeoutError = new Error('Query timeout');
        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockRejectedValue(timeoutError);

        await expect(
          util.validateScenarioTenant(mockScenarioIds, mockTenantId),
        ).rejects.toThrow('Query timeout');
      });
    });

    describe('validation order', () => {
      it('should validate tenant before checking for duplicates', async () => {
        const duplicateScenarioIds = [1, 1, 2];
        tenantsRepository.findOne.mockResolvedValue(null);

        await expect(
          util.validateScenarioTenant(duplicateScenarioIds, mockTenantId),
        ).rejects.toThrow('Tenant not found');

        expect(tenantsRepository.findOne).toHaveBeenCalled();
        expect(scenariosRepository.find).not.toHaveBeenCalled();
      });

      it('should validate duplicates before checking scenario existence', async () => {
        const duplicateScenarioIds = [1, 1, 999];
        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);

        await expect(
          util.validateScenarioTenant(duplicateScenarioIds, mockTenantId),
        ).rejects.toThrow('Duplicate scenario ids');

        expect(tenantsRepository.findOne).toHaveBeenCalled();
        expect(scenariosRepository.find).not.toHaveBeenCalled();
      });
    });

    describe('performance cases', () => {
      it('should handle validation with many scenarios efficiently', async () => {
        const manyScenarioIds = Array.from({ length: 1000 }, (_, i) => i + 1);
        const manyScenarios = manyScenarioIds.map((id) => ({
          id,
          title: `Scenario ${id}`,
          description: `Description ${id}`,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        }));

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);
        scenariosRepository.find.mockResolvedValue(manyScenarios as any);

        await expect(
          util.validateScenarioTenant(manyScenarioIds, mockTenantId),
        ).resolves.toBeUndefined();

        expect(scenariosRepository.find).toHaveBeenCalledWith({
          where: { id: In(manyScenarioIds) },
        });
      });

      it('should efficiently detect duplicates in large arrays', async () => {
        const largeArrayWithDuplicates = [
          ...Array.from({ length: 100 }, (_, i) => i + 1),
          50, // duplicate
        ];

        tenantsRepository.findOne.mockResolvedValue(mockTenant as any);

        await expect(
          util.validateScenarioTenant(largeArrayWithDuplicates, mockTenantId),
        ).rejects.toThrow('Duplicate scenario ids');
      });
    });
  });
});
