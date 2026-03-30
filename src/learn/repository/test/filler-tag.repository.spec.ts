import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { FillerTagRepository } from '../filler-tag.repository';
import { SortOrder } from 'src/common/type/common.type';

describe('FillerTagRepository', () => {
  let repository: FillerTagRepository;
  let mockDataSource: { createEntityManager: jest.Mock };
  let queryBuilder: {
    where: jest.Mock;
    orderBy: jest.Mock;
    offset: jest.Mock;
    limit: jest.Mock;
    getManyAndCount: jest.Mock;
  };

  beforeEach(async () => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FillerTagRepository,
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    repository = module.get(FillerTagRepository);
    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockReturnValue(queryBuilder as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('applies offset 0 and limit when explicitly provided', async () => {
    await repository.getFillerTags(undefined, {
      offset: 0,
      limit: 20,
      order: SortOrder.DESC,
    });

    expect(queryBuilder.offset).toHaveBeenCalledWith(0);
    expect(queryBuilder.limit).toHaveBeenCalledWith(20);
  });

  it('does not call offset or limit when options omit them', async () => {
    await repository.getFillerTags(undefined, {
      order: SortOrder.ASC,
    });

    expect(queryBuilder.offset).not.toHaveBeenCalled();
    expect(queryBuilder.limit).not.toHaveBeenCalled();
  });
});
