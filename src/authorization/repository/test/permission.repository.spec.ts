import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from 'src/common/entities/permission.entity';
import { PermissionRepository } from '../permission.repository';

describe('PermissionRepository', () => {
  let permissionRepository: PermissionRepository;
  let mockRepository: Partial<Repository<Permission>>;

  beforeEach(async () => {
    // Create mock repository with all methods
    mockRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionRepository,
        {
          provide: getRepositoryToken(Permission),
          useValue: mockRepository,
        },
      ],
    }).compile();

    permissionRepository =
      module.get<PermissionRepository>(PermissionRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPermissionByName', () => {
    it('should return a permission when found', async () => {
      const mockPermission: Permission = {
        name: 'delete:permission',
        createdAt: new Date(),
        updatedAt: new Date(),
        id: 0,
      };

      (mockRepository.findOne as jest.Mock).mockResolvedValue(mockPermission);

      const result =
        await permissionRepository.getPermissionByName('delete:permission');

      expect(result).toEqual(mockPermission);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { name: 'delete:permission' },
      });
      expect(mockRepository.findOne).toHaveBeenCalledTimes(1);
    });

    it('should return null when permission not found', async () => {
      (mockRepository.findOne as jest.Mock).mockResolvedValue(null);

      const result = await permissionRepository.getPermissionByName(
        'nonexistent:permission',
      );

      expect(result).toBeNull();
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { name: 'nonexistent:permission' },
      });
    });

    it('should handle database errors', async () => {
      const error = new Error('Database connection error');
      (mockRepository.findOne as jest.Mock).mockRejectedValue(error);

      await expect(
        permissionRepository.getPermissionByName('test:permission'),
      ).rejects.toThrow('Database connection error');
    });
  });

  describe('createPermission', () => {
    it('should create and save a new permission', async () => {
      const mockPermission: Permission = {
        name: 'edit:permission',
        createdAt: new Date(),
        updatedAt: new Date(),
        id: 0,
      };

      (mockRepository.create as jest.Mock).mockReturnValue(mockPermission);
      (mockRepository.save as jest.Mock).mockResolvedValue(mockPermission);

      const result =
        await permissionRepository.createPermission('edit:permission');

      expect(result).toEqual(mockPermission);
      expect(mockRepository.create).toHaveBeenCalledWith({
        name: 'edit:permission',
      });
      expect(mockRepository.save).toHaveBeenCalledWith(mockPermission);
    });

    it('should handle save errors', async () => {
      const mockPermission: Permission = {
        name: 'edit:permission',
        createdAt: new Date(),
        updatedAt: new Date(),
        id: 0,
      };

      (mockRepository.create as jest.Mock).mockReturnValue(mockPermission);
      (mockRepository.save as jest.Mock).mockRejectedValue(
        new Error('Save failed'),
      );

      await expect(
        permissionRepository.createPermission('edit:permission'),
      ).rejects.toThrow('Save failed');
    });
  });

  describe('deletePermissionById', () => {
    it('should delete a permission by id', async () => {
      const deleteResult = { affected: 1, raw: [] };

      (mockRepository.delete as jest.Mock).mockResolvedValue(deleteResult);

      const result = await permissionRepository.deletePermissionById(1);

      expect(result).toEqual(deleteResult);
      expect(mockRepository.delete).toHaveBeenCalledWith(1);
      expect(mockRepository.delete).toHaveBeenCalledTimes(1);
    });

    it('should return result when permission does not exist', async () => {
      const deleteResult = { affected: 0, raw: [] };

      (mockRepository.delete as jest.Mock).mockResolvedValue(deleteResult);

      const result = await permissionRepository.deletePermissionById(999);

      expect(result.affected).toBe(0);
      expect(mockRepository.delete).toHaveBeenCalledWith(999);
    });

    it('should handle delete errors', async () => {
      (mockRepository.delete as jest.Mock).mockRejectedValue(
        new Error('Delete failed'),
      );

      await expect(
        permissionRepository.deletePermissionById(1),
      ).rejects.toThrow('Delete failed');
    });
  });

  describe('repository initialization', () => {
    it('should be defined', () => {
      expect(permissionRepository).toBeDefined();
    });

    it('should have all required methods', () => {
      expect(permissionRepository.getPermissionByName).toBeDefined();
      expect(permissionRepository.createPermission).toBeDefined();
      expect(permissionRepository.deletePermissionById).toBeDefined();
    });
  });
});
