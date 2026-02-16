import { Test, TestingModule } from '@nestjs/testing';
import { CaseTenantService } from '../case-tenant.service';
import { CaseTenantRepository } from '../../repository/case-tenant.repository';
import { CaseTenantValidationShared } from '../case-tenant-validation-shared';

describe('CaseTenantService', () => {
  let service: CaseTenantService;
  let caseTenantRepository: jest.Mocked<CaseTenantRepository>;
  let caseTenantValidationShared: jest.Mocked<CaseTenantValidationShared>;

  beforeEach(async () => {
    const mockCaseTenantRepo = {
      findOne: jest.fn(),
      getCaseTenant: jest.fn(),
      createCaseTenants: jest.fn(),
      deleteByCaseIds: jest.fn(),
    };

    const mockCaseTenantValidationShared = {
      validateCaseTenant: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaseTenantService,
        { provide: CaseTenantRepository, useValue: mockCaseTenantRepo },
        {
          provide: CaseTenantValidationShared,
          useValue: mockCaseTenantValidationShared,
        },
      ],
    }).compile();

    service = module.get<CaseTenantService>(CaseTenantService);
    caseTenantRepository = module.get(CaseTenantRepository);
    caseTenantValidationShared = module.get(CaseTenantValidationShared);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('assignCasesToTenant', () => {
    it('should assign cases to tenant successfully', async () => {
      caseTenantValidationShared.validateCaseTenant.mockResolvedValue(
        undefined,
      );
      caseTenantRepository.getCaseTenant.mockResolvedValue([]);
      caseTenantRepository.createCaseTenants.mockResolvedValue({
        success: true,
      });

      const result = await service.assignCasesToTenant(
        '40000000-0000-0000-0000-000000000001',
        {
          caseIds: [
            '10000000-0000-0000-0000-000000000001',
            '10000000-0000-0000-0000-000000000002',
          ],
        },
      );

      expect(result).toEqual({ success: true });
      expect(caseTenantRepository.createCaseTenants).toHaveBeenCalled();
    });
  });

  describe('removeCasesFromTenant', () => {
    it('should remove cases from tenant successfully', async () => {
      caseTenantValidationShared.validateCaseTenant.mockResolvedValue(
        undefined,
      );
      caseTenantRepository.getCaseTenant.mockResolvedValue([
        { id: '50000000-0000-0000-0000-000000000001' },
      ] as any);
      caseTenantRepository.deleteByCaseIds.mockResolvedValue({
        success: true,
      });

      const result = await service.removeCasesFromTenant(
        '40000000-0000-0000-0000-000000000001',
        { caseIds: ['10000000-0000-0000-0000-000000000001'] },
      );

      expect(result).toEqual({ success: true });
      expect(caseTenantRepository.deleteByCaseIds).toHaveBeenCalled();
    });
  });

  describe('getCaseTenant', () => {
    it('should return case tenant mapping', async () => {
      const mockMapping = {
        id: '50000000-0000-0000-0000-000000000001',
        tenantId: '40000000-0000-0000-0000-000000000001',
        caseId: '10000000-0000-0000-0000-000000000001',
      };
      caseTenantRepository.findOne.mockResolvedValue(mockMapping as any);

      const result = await service.getCaseTenant(
        '40000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001',
      );

      expect(result).toEqual(mockMapping);
    });
  });
});
