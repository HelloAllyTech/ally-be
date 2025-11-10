import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { UserGroupRepository } from '../user-group.repository';
import { UserGroup } from 'src/authorization/entity/user-group.entity';

describe('UserGroupRepository', () => {
  let repository: UserGroupRepository;
  let mockDataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    // Create mock query builder
    const mockQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
    };

    const mockEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
      createQueryBuilder: jest.fn(() => mockQueryBuilder),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserGroupRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<UserGroupRepository>(UserGroupRepository);
  });

  describe('findOne', () => {
    it('should find one UserGroup', async () => {
      const userGroup = { userId: 1, groupId: 2 } as UserGroup;
      jest.spyOn(repository, 'findOne').mockResolvedValueOnce(userGroup);

      const result = await repository.findOne({ where: { userId: 1 } });

      expect(result).toEqual(userGroup);
    });
  });

  describe('create', () => {
    it('should create a new UserGroup', () => {
      const input = { userId: 1, groupId: 2 };
      const createdEntity = { ...input } as UserGroup;
      jest.spyOn(repository, 'create').mockReturnValueOnce(createdEntity);

      const result = repository.create(input);

      expect(result).toEqual(createdEntity);
    });
  });

  describe('save', () => {
    it('should save a UserGroup', async () => {
      const userGroup = { userId: 1, groupId: 2 } as UserGroup;
      jest.spyOn(repository, 'save').mockResolvedValueOnce(userGroup);

      const result = await repository.save(userGroup);

      expect(result).toEqual(userGroup);
    });
  });

  describe('count', () => {
    it('should count UserGroups', async () => {
      jest.spyOn(repository, 'count').mockResolvedValueOnce(3);

      const result = await repository.count({ where: { userId: 1 } });

      expect(result).toBe(3);
    });
  });

  describe('remove', () => {
    it('should remove a UserGroup', async () => {
      const userGroup = { userId: 1, groupId: 2 } as UserGroup;
      jest.spyOn(repository, 'remove').mockResolvedValue(userGroup);

      await repository.remove(userGroup);

      expect(repository.remove).toHaveBeenCalledWith(userGroup);
    });
  });

  describe('find', () => {
    it('should find multiple UserGroups', async () => {
      const userGroups = [
        { userId: 1, groupId: 2 },
        { userId: 1, groupId: 3 },
      ] as UserGroup[];
      jest.spyOn(repository, 'find').mockResolvedValueOnce(userGroups);

      const result = await repository.find({ where: { userId: 1 } });

      expect(result).toEqual(userGroups);
    });
  });

  describe('getUserGroupsByUserIds', () => {
    it('should find user roles using query builder', async () => {
      const userIds = [1, 2, 3];
      const expectedRoles = [
        { userId: 1, roles: ['ADMIN', 'USER'] },
        { userId: 2, roles: ['USER'] },
        { userId: 3, roles: ['MODERATOR'] },
      ];

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValueOnce(expectedRoles),
      };

      mockDataSource.createQueryBuilder.mockReturnValueOnce(
        mockQueryBuilder as any,
      );

      const result = await repository.getUserGroupsByUserIds(userIds);

      expect(result).toEqual(expectedRoles);
      expect(mockDataSource.createQueryBuilder).toHaveBeenCalledWith(
        UserGroup,
        'ug',
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'groups',
        'g',
        'g.id = ug."groupId"',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'ug."userId" IN (:...userIds)',
        { userIds },
      );
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'ug."userId"',
        'userId',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        'ARRAY_AGG(DISTINCT g.name)',
        'roles',
      );
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('ug."userId"');
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
    });

    it('should return empty array when no roles found', async () => {
      const userIds = [999];
      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValueOnce([]),
      };

      mockDataSource.createQueryBuilder.mockReturnValueOnce(
        mockQueryBuilder as any,
      );

      const result = await repository.getUserGroupsByUserIds(userIds);

      expect(result).toEqual([]);
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
    });
  });
});
