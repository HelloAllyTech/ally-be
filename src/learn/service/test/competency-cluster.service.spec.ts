import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CompetencyClusterService } from '../competency-cluster.service';
import { CompetencyClusterRepository } from '../../repository/competency-cluster.repository';
import { CompetencyClusterMemberRepository } from '../../repository/competency-cluster-member.repository';

describe('CompetencyClusterService', () => {
  let service: CompetencyClusterService;
  let clusterRepository: jest.Mocked<CompetencyClusterRepository>;
  let memberRepository: jest.Mocked<CompetencyClusterMemberRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetencyClusterService,
        {
          provide: CompetencyClusterRepository,
          useValue: {
            create: jest.fn((x) => x),
            save: jest.fn((x) => Promise.resolve({ id: 'cluster-new', ...x })),
            delete: jest.fn(),
            getClusters: jest.fn().mockResolvedValue([]),
            getClusterById: jest.fn(),
            getClusterByName: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: CompetencyClusterMemberRepository,
          useValue: {
            getMembershipsForCompetencies: jest.fn().mockResolvedValue([]),
            getCompetencyIdsForCluster: jest.fn().mockResolvedValue([]),
            getCompetencyIdsByCluster: jest.fn().mockResolvedValue(new Map()),
            replaceForCompetency: jest.fn(),
            replaceForCluster: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(CompetencyClusterService);
    clusterRepository = module.get(CompetencyClusterRepository);
    memberRepository = module.get(CompetencyClusterMemberRepository);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getClusters', () => {
    it('carries each cluster’s members so the picker can expand locally', async () => {
      clusterRepository.getClusters.mockResolvedValue([
        { id: 'cluster-1', name: 'Core Communication' },
        { id: 'cluster-2', name: 'In-house' },
      ] as any);
      memberRepository.getCompetencyIdsByCluster.mockResolvedValue(
        new Map([['cluster-1', ['c-1', 'c-2']]]),
      );

      const result = await service.getClusters();

      expect(result).toEqual({
        data: [
          {
            id: 'cluster-1',
            name: 'Core Communication',
            competencyIds: ['c-1', 'c-2'],
          },
          { id: 'cluster-2', name: 'In-house', competencyIds: [] },
        ],
        count: 2,
      });
    });
  });

  describe('resolveClusterNames', () => {
    it('reuses an existing cluster instead of creating a duplicate', async () => {
      clusterRepository.getClusterByName.mockResolvedValue({
        id: 'cluster-1',
        name: 'Core Communication',
      } as any);

      const ids = await service.resolveClusterNames(['Core Communication']);

      expect(ids).toEqual(['cluster-1']);
      expect(clusterRepository.save).not.toHaveBeenCalled();
    });

    it('creates a cluster for a name that does not exist yet', async () => {
      const ids = await service.resolveClusterNames(['  In-house  '], 7);

      expect(clusterRepository.create).toHaveBeenCalledWith({
        name: 'In-house',
        createdBy: 7,
      });
      expect(ids).toEqual(['cluster-new']);
    });

    it('treats case- and space-variant names as one cluster', async () => {
      // Otherwise "Core" and "core" would sit side by side in the picker,
      // indistinguishable to the author choosing between them.
      await service.resolveClusterNames(['Core', 'core', ' Core ']);

      expect(clusterRepository.getClusterByName).toHaveBeenCalledTimes(1);
    });

    it('drops blank entries', async () => {
      expect(await service.resolveClusterNames(['', '   '])).toEqual([]);
      expect(clusterRepository.getClusterByName).not.toHaveBeenCalled();
    });

    it('re-reads the winner when a concurrent create takes the name', async () => {
      // Two authors typing the same new cluster name both miss the SELECT; the
      // unique index on LOWER(name) is what keeps it single, and the loser has
      // to resolve to the winner's row rather than fail the save.
      clusterRepository.getClusterByName
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'cluster-raced',
          name: 'Core Communication',
        } as any);
      clusterRepository.save.mockRejectedValueOnce({ code: '23505' });

      expect(await service.resolveClusterNames(['Core Communication'])).toEqual(
        ['cluster-raced'],
      );
    });
  });

  describe('updateCluster', () => {
    beforeEach(() => {
      clusterRepository.getClusterById.mockResolvedValue({
        id: 'cluster-1',
        name: 'Core Communication',
      } as any);
    });

    it('leaves membership alone when competencyIds is omitted', async () => {
      await service.updateCluster('cluster-1', {
        name: 'Core Communication v2',
      });

      expect(memberRepository.replaceForCluster).not.toHaveBeenCalled();
    });

    it('empties the cluster on an explicit empty membership', async () => {
      await service.updateCluster('cluster-1', { competencyIds: [] });

      expect(memberRepository.replaceForCluster).toHaveBeenCalledWith(
        'cluster-1',
        [],
      );
    });

    it('rejects a rename onto another cluster’s name', async () => {
      clusterRepository.getClusterByName.mockResolvedValue({
        id: 'cluster-2',
        name: 'In-house',
      } as any);

      await expect(
        service.updateCluster('cluster-1', { name: 'In-house' }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows a rename that only changes the casing of its own name', async () => {
      clusterRepository.getClusterByName.mockResolvedValue({
        id: 'cluster-1',
        name: 'Core Communication',
      } as any);

      await expect(
        service.updateCluster('cluster-1', { name: 'Enact' }),
      ).resolves.toBeDefined();
    });

    it('404s on an unknown cluster', async () => {
      clusterRepository.getClusterById.mockResolvedValue(null);

      await expect(
        service.updateCluster('nope', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getClustersByCompetency', () => {
    it('groups memberships by competency, including multi-cluster ones', async () => {
      // Membership is many-to-many on purpose: an admin decides how their
      // frameworks overlap.
      memberRepository.getMembershipsForCompetencies.mockResolvedValue([
        {
          clusterId: 'cluster-1',
          clusterName: 'Core Communication',
          competencyId: 'c-1',
        },
        {
          clusterId: 'cluster-2',
          clusterName: 'In-house',
          competencyId: 'c-1',
        },
        {
          clusterId: 'cluster-1',
          clusterName: 'Core Communication',
          competencyId: 'c-2',
        },
      ]);

      const byCompetency = await service.getClustersByCompetency([
        'c-1',
        'c-2',
      ]);

      expect(byCompetency.get('c-1')).toEqual([
        { id: 'cluster-1', name: 'Core Communication' },
        { id: 'cluster-2', name: 'In-house' },
      ]);
      expect(byCompetency.get('c-2')).toEqual([
        { id: 'cluster-1', name: 'Core Communication' },
      ]);
    });
  });
});
