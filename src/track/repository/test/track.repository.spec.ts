import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { AssignmentStatus } from 'src/common/type/common.type';
import { TrackRepository } from '../track.repository';
import { Track } from '../../entity/track.entity';
import {
  TrackFilterOptions,
  TrackProgressionMode,
  TrackStatus,
} from '../../type/track.type';

describe('TrackRepository', () => {
  let repository: TrackRepository;
  let queryBuilder: jest.Mocked<SelectQueryBuilder<Track>>;

  const mockTrack: Track = {
    id: 'track-1',
    title: 'Test Track',
    description: 'Test description',
    coverImageUrl: 'https://example.com/image.jpg',
    status: TrackStatus.ACTIVE,
    isGlobal: false,
    progressionMode: TrackProgressionMode.SEQUENTIAL,
    totalItems: 4,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
    deletedAt: undefined,
  } as Track;

  beforeEach(async () => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoinAndMapOne: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    } as any;

    const mockEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<TrackRepository>(TrackRepository);
    repository.createQueryBuilder = jest.fn().mockReturnValue(queryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllTracks', () => {
    it('returns all tracks without filters', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[mockTrack], 1]);

      const result = await repository.getAllTracks();

      expect(repository.createQueryBuilder).toHaveBeenCalledWith('track');
      expect(result).toEqual({ data: [mockTrack], count: 1 });
    });

    it('maps the tenant assignment when tenantId is provided', async () => {
      const filters: TrackFilterOptions = { tenantId: 'tenant-1' };
      queryBuilder.getManyAndCount.mockResolvedValue([[mockTrack], 1]);

      await repository.getAllTracks(filters);

      expect(queryBuilder.leftJoinAndMapOne).toHaveBeenCalledWith(
        'track.trackTenant',
        'track_tenants',
        'trackTenant',
        '"trackTenant"."trackId" = track.id AND "trackTenant"."tenantId" = :tenantId AND "trackTenant"."deletedAt" IS NULL',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
      });
    });

    it('filters to assigned tracks when assignmentStatus is ASSIGNED', async () => {
      const filters: TrackFilterOptions = {
        tenantId: 'tenant-1',
        assignmentStatus: AssignmentStatus.ASSIGNED,
      };
      queryBuilder.getManyAndCount.mockResolvedValue([[mockTrack], 1]);

      await repository.getAllTracks(filters);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '"trackTenant"."id" IS NOT NULL',
      );
    });

    it('filters to unassigned tracks when assignmentStatus is UNASSIGNED', async () => {
      const filters: TrackFilterOptions = {
        tenantId: 'tenant-1',
        assignmentStatus: AssignmentStatus.UNASSIGNED,
      };
      queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getAllTracks(filters);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '"trackTenant"."id" IS NULL',
      );
    });

    it('ignores assignmentStatus when tenantId is not provided', async () => {
      const filters: TrackFilterOptions = {
        assignmentStatus: AssignmentStatus.ASSIGNED,
      };
      queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await repository.getAllTracks(filters);

      expect(queryBuilder.leftJoinAndMapOne).not.toHaveBeenCalled();
      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
        '"trackTenant"."id" IS NOT NULL',
      );
    });
  });
});
