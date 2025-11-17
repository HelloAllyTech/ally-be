import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { GroupRepository } from '../group.repository';
import { Group } from 'src/authorization/entity/group.entity';

describe('GroupRepository', () => {
  let repository: GroupRepository;
  let dataSource: jest.Mocked<DataSource>;

  const mockQueryBuilder = {
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  beforeEach(async () => {
    const mockEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    dataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupRepository,
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    repository = module.get<GroupRepository>(GroupRepository);
    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockReturnValue(mockQueryBuilder as any);
  });

  it('should call findOne and return a group', async () => {
    const group = { id: 1 } as Group;
    jest.spyOn(repository, 'findOne').mockResolvedValueOnce(group);

    const result = await repository.findOne({ where: { id: 1 } });
    expect(result).toBe(group);
  });

  it('should return groups associated with a user', async () => {
    const groups = [{ id: 1 }] as Group[];
    mockQueryBuilder.getMany.mockResolvedValueOnce(groups);

    const result = await repository.findUserRoleByUserId(1);
    expect(result).toBe(groups);
    expect(mockQueryBuilder.leftJoin).toHaveBeenCalled();
    expect(mockQueryBuilder.where).toHaveBeenCalledWith('ug.userId = :userId', {
      userId: 1,
    });
  });
});
