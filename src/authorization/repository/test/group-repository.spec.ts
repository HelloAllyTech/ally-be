import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GroupRepository } from '../group.repository';
import { Group } from 'src/common/entities/group.entity';

describe('GroupRepository', () => {
  let repository: GroupRepository;

  const mockRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockQueryBuilder = {
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupRepository,
        {
          provide: getRepositoryToken(Group),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get<GroupRepository>(GroupRepository);
    mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
  });

  it('should call findOne and return a group', async () => {
    const group = { id: 1 } as Group;
    mockRepo.findOne.mockResolvedValueOnce(group);

    const result = await repository.findOne({ id: 1 });
    expect(result).toBe(group);
  });

  it('should return groups associated with a user', async () => {
    const groups = [{ id: 1 }] as Group[];
    (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce(groups);

    const result = await repository.findUserRoleByUserId(1);
    expect(result).toBe(groups);
  });
});
