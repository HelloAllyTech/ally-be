import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, Repository } from 'typeorm';
import { UserGroupRepository } from '../user-group.repository';
import { UserGroup } from 'src/common/entities/user-group.entity';
import { getRepositoryToken } from '@nestjs/typeorm';

describe('UserGroupRepository', () => {
  let repository: UserGroupRepository;
  let mockRepo: jest.Mocked<Repository<UserGroup>>;
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserGroupRepository,
        {
          provide: getRepositoryToken(UserGroup),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            count: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryBuilder: jest.fn(() => mockQueryBuilder),
          },
        },
      ],
    }).compile();

    repository = module.get<UserGroupRepository>(UserGroupRepository);
    mockRepo = module.get(getRepositoryToken(UserGroup));
    mockDataSource = module.get(DataSource);
  });

  describe('findOne', () => {
    it('should find one UserGroup', async () => {
      const userGroup = { userId: 1, groupId: 2 } as UserGroup;
      mockRepo.findOne.mockResolvedValueOnce(userGroup);

      const result = await repository.findOne({ userId: 1 });

      expect(result).toEqual(userGroup);
      expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { userId: 1 } });
    });
  });

  describe('create', () => {
    it('should create a new UserGroup', async () => {
      const input = { userId: 1, groupId: 2 };
      const createdEntity = { ...input } as UserGroup;
      mockRepo.create.mockReturnValueOnce(createdEntity);
      mockRepo.save.mockResolvedValueOnce(createdEntity);

      const result = await repository.create(input);

      expect(result).toEqual(createdEntity);
      expect(mockRepo.create).toHaveBeenCalledWith(input);
      expect(mockRepo.save).toHaveBeenCalledWith(createdEntity);
    });
  });

  describe('count', () => {
    it('should count UserGroups', async () => {
      mockRepo.count.mockResolvedValueOnce(3);

      const result = await repository.count({ userId: 1 });

      expect(result).toBe(3);
      expect(mockRepo.count).toHaveBeenCalledWith({ where: { userId: 1 } });
    });
  });

  describe('remove', () => {
    it('should remove a UserGroup', async () => {
      const userGroup = { userId: 1, groupId: 2 } as UserGroup;
      mockRepo.remove.mockResolvedValueOnce(userGroup);

      await repository.remove(userGroup);

      expect(mockRepo.remove).toHaveBeenCalledWith(userGroup);
    });
  });

  describe('findMany', () => {
    it('should find multiple UserGroups', async () => {
      const userGroups = [
        { userId: 1, groupId: 2 },
        { userId: 1, groupId: 3 },
      ] as UserGroup[];
      mockRepo.find.mockResolvedValueOnce(userGroups);

      const result = await repository.findMany({ userId: 1 });

      expect(result).toEqual(userGroups);
      expect(mockRepo.find).toHaveBeenCalledWith({ where: { userId: 1 } });
    });
  });

  describe('findUserRoles', () => {
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

      const result = await repository.findUserRoles(userIds);

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

      const result = await repository.findUserRoles(userIds);

      expect(result).toEqual([]);
      expect(mockQueryBuilder.getRawMany).toHaveBeenCalled();
    });
  });
});
