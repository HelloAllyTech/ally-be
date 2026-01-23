import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager, Repository } from 'typeorm';
import { BadgeTenantSharedService } from '../badge-tenant-shared.service';
import { Badge } from '../../entity/badge.entity';
import { BadgeTenant } from '../../entity/badge-tenant.entity';
import {
  BadgeStatus,
  BadgeVisibilityType,
} from '../../constants/badge.constants';

jest.mock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

describe('BadgeTenantSharedService', () => {
  let service: BadgeTenantSharedService;
  let mockEntityManager: jest.Mocked<EntityManager>;
  let mockBadgeRepo: jest.Mocked<Repository<Badge>>;
  let mockBadgeTenantRepo: jest.Mocked<Repository<BadgeTenant>>;

  beforeEach(async () => {
    mockBadgeRepo = {
      find: jest.fn(),
    } as any;

    mockBadgeTenantRepo = {
      insert: jest.fn(),
    } as any;

    mockEntityManager = {
      getRepository: jest.fn((entity) => {
        if (entity === Badge) {
          return mockBadgeRepo;
        }
        if (entity === BadgeTenant) {
          return mockBadgeTenantRepo;
        }
        return {} as any;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [BadgeTenantSharedService],
    }).compile();

    service = module.get<BadgeTenantSharedService>(BadgeTenantSharedService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addPublicBadgesToTenant', () => {
    it('should return false when no public badges exist', async () => {
      const tenantId = 'tenant-123';
      mockBadgeRepo.find.mockResolvedValue([]);

      const result = await service.addPublicBadgesToTenant(
        tenantId,
        mockEntityManager,
      );

      expect(result).toBe(false);
      expect(mockBadgeTenantRepo.insert).not.toHaveBeenCalled();
    });

    it('should query badges with PUBLIC visibility and ACTIVE status', async () => {
      const tenantId = 'tenant-123';
      mockBadgeRepo.find.mockResolvedValue([]);

      await service.addPublicBadgesToTenant(tenantId, mockEntityManager);

      expect(mockBadgeRepo.find).toHaveBeenCalledWith({
        where: {
          visibilityType: BadgeVisibilityType.PUBLIC,
          status: BadgeStatus.ACTIVE,
        },
      });
    });

    it('should create correct badge-tenant mappings and return true', async () => {
      const tenantId = 'tenant-456';
      const publicBadges = [
        { id: 'badge-1', name: 'Badge 1' },
        { id: 'badge-2', name: 'Badge 2' },
        { id: 'badge-3', name: 'Badge 3' },
      ] as Badge[];

      mockBadgeRepo.find.mockResolvedValue(publicBadges);
      mockBadgeTenantRepo.insert.mockResolvedValue({} as any);

      const result = await service.addPublicBadgesToTenant(
        tenantId,
        mockEntityManager,
      );

      expect(result).toBe(true);
      expect(mockBadgeTenantRepo.insert).toHaveBeenCalledWith([
        { badgeId: 'badge-1', tenantId: 'tenant-456' },
        { badgeId: 'badge-2', tenantId: 'tenant-456' },
        { badgeId: 'badge-3', tenantId: 'tenant-456' },
      ]);
    });
  });
});
