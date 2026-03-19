import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogService } from 'src/audit/service/audit-log.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioTenantService } from '../scenario-tenant.service';
import { ScenarioTenantRepository } from '../../repository/scenario-tenant.repository';
import { ScenarioTenantValidationShared } from '../scenario-tenant-validation-shared';

describe('ScenarioTenantService', () => {
  let service: ScenarioTenantService;
  let scenarioTenantRepository: jest.Mocked<ScenarioTenantRepository>;
  let scenarioTenantValidationUtil: jest.Mocked<ScenarioTenantValidationShared>;

  beforeEach(async () => {
    const mockScenarioTenantRepository = {
      createScenarioTenants: jest.fn(),
      getScenarioTenant: jest.fn(),
      deleteByTenantsIds: jest.fn(),
      deleteByScenarioIds: jest.fn(),
      findOne: jest.fn(),
    };

    const mockScenarioTenantValidationUtil = {
      validateScenarioTenant: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        ScenarioTenantService,
        {
          provide: ScenarioTenantRepository,
          useValue: mockScenarioTenantRepository,
        },
        {
          provide: ScenarioTenantValidationShared,
          useValue: mockScenarioTenantValidationUtil,
        },
      ],
    }).compile();

    service = module.get<ScenarioTenantService>(ScenarioTenantService);
    scenarioTenantRepository = module.get(ScenarioTenantRepository);
    scenarioTenantValidationUtil = module.get(ScenarioTenantValidationShared);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('assignScenariosToTenants', () => {
    it('should assign multiple scenarios to tenant successfully', async () => {
      const tenantId = 'tenant-123';
      const addScenarioTenantDto = {
        scenarioIds: [1, 2, 3],
      };
      const expectedResult = { success: true };

      scenarioTenantValidationUtil.validateScenarioTenant.mockResolvedValue(
        undefined,
      );
      scenarioTenantRepository.getScenarioTenant.mockResolvedValue([]);
      scenarioTenantRepository.createScenarioTenants.mockResolvedValue(
        expectedResult,
      );

      const result = await service.assignScenariosToTenant(
        tenantId,
        addScenarioTenantDto,
      );

      expect(result).toEqual(expectedResult);
      expect(
        scenarioTenantValidationUtil.validateScenarioTenant,
      ).toHaveBeenCalledWith([1, 2, 3], tenantId);
      expect(scenarioTenantRepository.getScenarioTenant).toHaveBeenCalledWith(
        [1, 2, 3],
        tenantId,
      );
      expect(
        scenarioTenantRepository.createScenarioTenants,
      ).toHaveBeenCalledWith([
        { scenarioId: 1, tenantId: 'tenant-123' },
        { scenarioId: 2, tenantId: 'tenant-123' },
        { scenarioId: 3, tenantId: 'tenant-123' },
      ]);
    });

    it('should assign single scenario to tenant successfully', async () => {
      const tenantId = 'tenant-456';
      const addScenarioTenantDto = {
        scenarioIds: [5],
      };
      const expectedResult = { success: true };

      scenarioTenantValidationUtil.validateScenarioTenant.mockResolvedValue(
        undefined,
      );
      scenarioTenantRepository.getScenarioTenant.mockResolvedValue([]);
      scenarioTenantRepository.createScenarioTenants.mockResolvedValue(
        expectedResult,
      );

      const result = await service.assignScenariosToTenant(
        tenantId,
        addScenarioTenantDto,
      );

      expect(result).toEqual(expectedResult);
      expect(
        scenarioTenantRepository.createScenarioTenants,
      ).toHaveBeenCalledWith([{ scenarioId: 5, tenantId: 'tenant-456' }]);
    });

    it('should throw ConflictException when scenario-tenant mapping already exists', async () => {
      const tenantId = 'tenant-789';
      const addScenarioTenantDto = {
        scenarioIds: [1, 2],
      };

      const existingMappings = [
        { scenarioId: 1, tenantId: 'tenant-789' },
        { scenarioId: 2, tenantId: 'tenant-789' },
      ];

      scenarioTenantValidationUtil.validateScenarioTenant.mockResolvedValue(
        undefined,
      );
      scenarioTenantRepository.getScenarioTenant.mockResolvedValue(
        existingMappings as any,
      );

      await expect(
        service.assignScenariosToTenant(tenantId, addScenarioTenantDto),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.assignScenariosToTenant(tenantId, addScenarioTenantDto),
      ).rejects.toThrow('Scenario-tenant mapping is already present');

      expect(
        scenarioTenantRepository.createScenarioTenants,
      ).not.toHaveBeenCalled();
    });

    it('should validate scenarios and tenant before assignment', async () => {
      const tenantId = 'tenant-validation';
      const addScenarioTenantDto = {
        scenarioIds: [10, 20],
      };

      scenarioTenantValidationUtil.validateScenarioTenant.mockResolvedValue(
        undefined,
      );
      scenarioTenantRepository.getScenarioTenant.mockResolvedValue([]);
      scenarioTenantRepository.createScenarioTenants.mockResolvedValue({
        success: true,
      });

      await service.assignScenariosToTenant(tenantId, addScenarioTenantDto);

      expect(
        scenarioTenantValidationUtil.validateScenarioTenant,
      ).toHaveBeenCalledWith([10, 20], tenantId);
      expect(
        scenarioTenantValidationUtil.validateScenarioTenant,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeScenariosFromTenant', () => {
    it('should remove multiple scenarios from tenant successfully', async () => {
      const tenantId = 'tenant-123';
      const deleteScenarioTenantDto = {
        scenarioIds: [1, 2, 3],
      };
      const expectedResult = { success: true };

      const existingMappings = [
        { scenarioId: 1, tenantId: 'tenant-123' },
        { scenarioId: 2, tenantId: 'tenant-123' },
        { scenarioId: 3, tenantId: 'tenant-123' },
      ];

      scenarioTenantValidationUtil.validateScenarioTenant.mockResolvedValue(
        undefined,
      );
      scenarioTenantRepository.getScenarioTenant.mockResolvedValue(
        existingMappings as any,
      );
      scenarioTenantRepository.deleteByScenarioIds.mockResolvedValue(
        expectedResult,
      );

      const result = await service.removeScenariosFromTenant(
        tenantId,
        deleteScenarioTenantDto,
      );

      expect(result).toEqual(expectedResult);
      expect(
        scenarioTenantValidationUtil.validateScenarioTenant,
      ).toHaveBeenCalledWith([1, 2, 3], tenantId);
      expect(scenarioTenantRepository.getScenarioTenant).toHaveBeenCalledWith(
        [1, 2, 3],
        tenantId,
      );
      expect(scenarioTenantRepository.deleteByScenarioIds).toHaveBeenCalledWith(
        [1, 2, 3],
        tenantId,
      );
    });

    it('should remove single scenario from tenant successfully', async () => {
      const tenantId = 'tenant-456';
      const deleteScenarioTenantDto = {
        scenarioIds: [5],
      };
      const expectedResult = { success: true };

      const existingMapping = [{ scenarioId: 5, tenantId: 'tenant-456' }];

      scenarioTenantValidationUtil.validateScenarioTenant.mockResolvedValue(
        undefined,
      );
      scenarioTenantRepository.getScenarioTenant.mockResolvedValue(
        existingMapping as any,
      );
      scenarioTenantRepository.deleteByScenarioIds.mockResolvedValue(
        expectedResult,
      );

      const result = await service.removeScenariosFromTenant(
        tenantId,
        deleteScenarioTenantDto,
      );

      expect(result).toEqual(expectedResult);
      expect(scenarioTenantRepository.deleteByScenarioIds).toHaveBeenCalledWith(
        [5],
        tenantId,
      );
    });

    it('should throw NotFoundException when no scenario-tenant mapping found', async () => {
      const tenantId = 'tenant-789';
      const deleteScenarioTenantDto = {
        scenarioIds: [99, 100],
      };

      scenarioTenantValidationUtil.validateScenarioTenant.mockResolvedValue(
        undefined,
      );
      scenarioTenantRepository.getScenarioTenant.mockResolvedValue([]);

      await expect(
        service.removeScenariosFromTenant(tenantId, deleteScenarioTenantDto),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.removeScenariosFromTenant(tenantId, deleteScenarioTenantDto),
      ).rejects.toThrow('No valid scenario-tenant found');

      expect(
        scenarioTenantRepository.deleteByScenarioIds,
      ).not.toHaveBeenCalled();
    });

    it('should validate scenarios and tenant before removal', async () => {
      const tenantId = 'tenant-validation';
      const deleteScenarioTenantDto = {
        scenarioIds: [10, 20],
      };

      const existingMappings = [
        { scenarioId: 10, tenantId: 'tenant-validation' },
        { scenarioId: 20, tenantId: 'tenant-validation' },
      ];

      scenarioTenantValidationUtil.validateScenarioTenant.mockResolvedValue(
        undefined,
      );
      scenarioTenantRepository.getScenarioTenant.mockResolvedValue(
        existingMappings as any,
      );
      scenarioTenantRepository.deleteByScenarioIds.mockResolvedValue({
        success: true,
      });

      await service.removeScenariosFromTenant(
        tenantId,
        deleteScenarioTenantDto,
      );

      expect(
        scenarioTenantValidationUtil.validateScenarioTenant,
      ).toHaveBeenCalledWith([10, 20], tenantId);
      expect(
        scenarioTenantValidationUtil.validateScenarioTenant,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle validation errors in assignScenariosToTenants', async () => {
      const tenantId = 'tenant-invalid';
      const addScenarioTenantDto = {
        scenarioIds: [999],
      };

      const validationError = new NotFoundException('Scenario not found');
      scenarioTenantValidationUtil.validateScenarioTenant.mockRejectedValue(
        validationError,
      );

      await expect(
        service.assignScenariosToTenant(tenantId, addScenarioTenantDto),
      ).rejects.toThrow(NotFoundException);

      expect(scenarioTenantRepository.getScenarioTenant).not.toHaveBeenCalled();
      expect(
        scenarioTenantRepository.createScenarioTenants,
      ).not.toHaveBeenCalled();
    });

    it('should handle validation errors in removeScenariosFromTenant', async () => {
      const tenantId = 'tenant-invalid';
      const deleteScenarioTenantDto = {
        scenarioIds: [999],
      };

      const validationError = new NotFoundException('Tenant not found');
      scenarioTenantValidationUtil.validateScenarioTenant.mockRejectedValue(
        validationError,
      );

      await expect(
        service.removeScenariosFromTenant(tenantId, deleteScenarioTenantDto),
      ).rejects.toThrow(NotFoundException);

      expect(scenarioTenantRepository.getScenarioTenant).not.toHaveBeenCalled();
      expect(
        scenarioTenantRepository.deleteByScenarioIds,
      ).not.toHaveBeenCalled();
    });
  });

  describe('getScenarioTenant', () => {
    it('should return scenario tenant when found', async () => {
      const tenantId = 'tenant-123';
      const scenarioId = 1;
      const mockScenarioTenant = {
        scenarioId,
        tenantId,
        id: 1,
      };

      scenarioTenantRepository.findOne.mockResolvedValue(
        mockScenarioTenant as any,
      );

      const result = await service.getScenarioTenant(tenantId, scenarioId);

      expect(result).toEqual(mockScenarioTenant);
      expect(scenarioTenantRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId, scenarioId },
      });
    });

    it('should return null when scenario tenant not found', async () => {
      const tenantId = 'tenant-456';
      const scenarioId = 999;

      scenarioTenantRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioTenant(tenantId, scenarioId);

      expect(result).toBeNull();
      expect(scenarioTenantRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId, scenarioId },
      });
    });
  });
});
