import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { UserGroupRepository } from '../user-group.repository';
import { UserGroup } from 'src/common/entities/user-group.entity';
import { getRepositoryToken } from '@nestjs/typeorm';

describe('UserGroupRepository', () => {
  let repository: UserGroupRepository;
  let mockRepo: jest.Mocked<Repository<UserGroup>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserGroupRepository,
        {
          provide: getRepositoryToken(UserGroup),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            count: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    repository = module.get<UserGroupRepository>(UserGroupRepository);
    mockRepo = module.get(getRepositoryToken(UserGroup));
  });

  it('should find one UserGroup', async () => {
    const userGroup = { userId: 1, groupId: 2 } as UserGroup;
    mockRepo.findOne.mockResolvedValueOnce(userGroup);
    const result = await repository.findOne({ userId: 1 });
    expect(result).toEqual(userGroup);
    expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { userId: 1 } });
  });

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

  it('should count UserGroups', async () => {
    mockRepo.count.mockResolvedValueOnce(3);
    const result = await repository.count({ userId: 1 });
    expect(result).toBe(3);
    expect(mockRepo.count).toHaveBeenCalledWith({ where: { userId: 1 } });
  });

  it('should remove a UserGroup', async () => {
    const userGroup = { userId: 1, groupId: 2 } as UserGroup;
    mockRepo.remove.mockResolvedValueOnce(userGroup);
    await repository.remove(userGroup);
    expect(mockRepo.remove).toHaveBeenCalledWith(userGroup);
  });
});
