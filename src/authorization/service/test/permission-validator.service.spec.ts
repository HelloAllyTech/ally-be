import { Test, TestingModule } from '@nestjs/testing';
import { PermissionValidator } from '../permission-validator.service';
import { PermissionsService } from '../permissions.service';

describe('PermissionValidator', () => {
  let service: PermissionValidator;
  let permissionsService: jest.Mocked<PermissionsService>;

  const mockUserId = 1;
  const mockUserPermissions = ['read:user', 'write:user', 'delete:user'];

  beforeEach(async () => {
    const mockPermissionsService = {
      getUserPermissions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionValidator,
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
      ],
    }).compile();

    service = module.get<PermissionValidator>(PermissionValidator);
    permissionsService = module.get(PermissionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validatePermissions', () => {
    // Negative cases first
    it('should return true when userId is not provided', async () => {
      const result = await service.validatePermissions(0, ['read:user'], 'AND');

      expect(result).toBe(true);
      expect(permissionsService.getUserPermissions).not.toHaveBeenCalled();
    });

    it('should return true when permissions array is empty', async () => {
      const result = await service.validatePermissions(mockUserId, [], 'AND');

      expect(result).toBe(true);
      expect(permissionsService.getUserPermissions).not.toHaveBeenCalled();
    });

    it('should return false when AND operation and user lacks some permissions', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(
        mockUserPermissions,
      );

      const result = await service.validatePermissions(
        mockUserId,
        ['read:user', 'admin:user'],
        'AND',
      );

      expect(result).toBe(false);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(
        mockUserId,
      );
    });

    it('should return false when OR operation and user has no matching permissions', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(
        mockUserPermissions,
      );

      const result = await service.validatePermissions(
        mockUserId,
        ['admin:user', 'super:user'],
        'OR',
      );

      expect(result).toBe(false);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(
        mockUserId,
      );
    });

    // Positive cases
    it('should return true when AND operation and user has all permissions', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(
        mockUserPermissions,
      );

      const result = await service.validatePermissions(
        mockUserId,
        ['read:user', 'write:user'],
        'AND',
      );

      expect(result).toBe(true);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(
        mockUserId,
      );
    });

    it('should return true when OR operation and user has at least one permission', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(
        mockUserPermissions,
      );

      const result = await service.validatePermissions(
        mockUserId,
        ['read:user', 'admin:user'],
        'OR',
      );

      expect(result).toBe(true);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(
        mockUserId,
      );
    });
  });
});
