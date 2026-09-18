import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CompetencyService } from '../competency.service';
import { CompetencyRepository } from '../../repository/competency.repository';
import { CompetencyBehaviorRepository } from '../../repository/competency-behavior.repository';
import { BehaviorRepository } from '../../repository/behavior.repository';
import { ScenariosRepository } from '../../repository/scenario.repository';
import { CompetencyClusterService } from '../competency-cluster.service';
import { Competency } from '../../entity/competency.entity';

describe('CompetencyService (custom competencies)', () => {
  let service: CompetencyService;
  let competencyRepository: jest.Mocked<CompetencyRepository>;
  let competencyBehaviorRepository: jest.Mocked<CompetencyBehaviorRepository>;
  let behaviorRepository: jest.Mocked<BehaviorRepository>;
  let scenariosRepository: jest.Mocked<ScenariosRepository>;
  let clusterService: jest.Mocked<CompetencyClusterService>;

  const makeCompetency = (overrides: Partial<Competency> = {}): Competency =>
    ({
      id: 'comp-1',
      name: 'Active Listening',
      isCustom: false,
      createdBy: undefined,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      ...overrides,
    }) as Competency;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetencyService,
        {
          provide: CompetencyRepository,
          useValue: {
            create: jest.fn((x) => x),
            save: jest.fn((x) => Promise.resolve({ id: 'new-id', ...x })),
            getCompetencies: jest.fn(),
            getCompetencyById: jest.fn(),
            getMaxCustomIndexForUser: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: CompetencyBehaviorRepository,
          useValue: {
            getBehavioursForCompetency: jest.fn().mockResolvedValue([]),
            replaceForCompetency: jest.fn(),
            addBehavioursIgnoreConflicts: jest.fn(),
          },
        },
        {
          provide: BehaviorRepository,
          useValue: {
            getBehaviorsByNames: jest.fn().mockResolvedValue([]),
            create: jest.fn((x) => x),
            // New behaviours get a deterministic id keyed by lowercased name, so
            // case-variant inputs ("Empathy" / "empathy") collapse to one id.
            save: jest.fn((rows: { name: string }[]) =>
              Promise.resolve(
                rows.map((b) => ({
                  id: `b-${b.name.toLowerCase()}`,
                  name: b.name,
                })),
              ),
            ),
          },
        },
        {
          provide: ScenariosRepository,
          useValue: {
            existsWithCompetencyId: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: CompetencyClusterService,
          useValue: {
            setClustersForCompetency: jest.fn(),
            getClustersByCompetency: jest.fn().mockResolvedValue(new Map()),
          },
        },
      ],
    }).compile();

    service = module.get(CompetencyService);
    competencyRepository = module.get(CompetencyRepository);
    competencyBehaviorRepository = module.get(CompetencyBehaviorRepository);
    behaviorRepository = module.get(BehaviorRepository);
    scenariosRepository = module.get(ScenariosRepository);
    clusterService = module.get(CompetencyClusterService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('createCompetency', () => {
    it('generates a sequential {userId}_custom_{N} name for custom competencies', async () => {
      competencyRepository.getMaxCustomIndexForUser.mockResolvedValue(2);

      const result = await service.createCompetency({ isCustom: true }, 42);

      expect(
        competencyRepository.getMaxCustomIndexForUser,
      ).toHaveBeenCalledWith(42);
      expect(competencyRepository.create).toHaveBeenCalledWith({
        name: '42_custom_3',
        isCustom: true,
        createdBy: 42,
      });
      expect(result).toEqual({
        id: 'new-id',
        name: '42_custom_3',
        isCustom: true,
      });
    });

    it('starts custom indexing at 1 when the user has none', async () => {
      competencyRepository.getMaxCustomIndexForUser.mockResolvedValue(0);

      const result = await service.createCompetency({ isCustom: true }, 7);

      expect(result.name).toBe('7_custom_1');
    });

    it('rejects a custom competency without an owner', async () => {
      await expect(
        service.createCompetency({ isCustom: true }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('retries with a bumped index when the custom name collides', async () => {
      competencyRepository.getMaxCustomIndexForUser
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3);
      // First save loses the race on the partial unique index, second succeeds.
      competencyRepository.save.mockImplementationOnce(() => {
        throw { code: '23505' };
      });

      const result = await service.createCompetency({ isCustom: true }, 42);

      expect(
        competencyRepository.getMaxCustomIndexForUser,
      ).toHaveBeenCalledTimes(2);
      expect(result.name).toBe('42_custom_4');
    });

    it('rethrows a non-unique error without retrying', async () => {
      competencyRepository.getMaxCustomIndexForUser.mockResolvedValue(0);
      competencyRepository.save.mockImplementationOnce(() => {
        throw { code: '50000' };
      });

      await expect(
        service.createCompetency({ isCustom: true }, 42),
      ).rejects.toMatchObject({ code: '50000' });
      expect(
        competencyRepository.getMaxCustomIndexForUser,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('setCompetencyBehaviours (de-duplication)', () => {
    beforeEach(() => {
      competencyRepository.getCompetencyById.mockResolvedValue(
        makeCompetency(),
      );
    });

    it('keeps a behaviour listed in both lists as helpful only', async () => {
      await service.setCompetencyBehaviours('comp-1', {
        helpful: ['Empathy'],
        unhelpful: ['Empathy'],
      });

      expect(
        competencyBehaviorRepository.replaceForCompetency,
      ).toHaveBeenCalledWith('comp-1', [
        { behaviorId: 'b-empathy', type: 'HELPFUL' },
      ]);
    });

    it('collapses case-variant duplicates into a single mapping row', async () => {
      await service.setCompetencyBehaviours('comp-1', {
        helpful: ['Empathy', 'empathy', '  Empathy  '],
        unhelpful: [],
      });

      expect(
        competencyBehaviorRepository.replaceForCompetency,
      ).toHaveBeenCalledWith('comp-1', [
        { behaviorId: 'b-empathy', type: 'HELPFUL' },
      ]);
    });

    it('does not create behaviours when both lists are empty', async () => {
      await service.setCompetencyBehaviours('comp-1', {
        helpful: [],
        unhelpful: [],
      });

      expect(behaviorRepository.save).not.toHaveBeenCalled();
      expect(
        competencyBehaviorRepository.replaceForCompetency,
      ).toHaveBeenCalledWith('comp-1', []);
    });

    it('keeps the provided name for a non-custom competency', async () => {
      const result = await service.createCompetency(
        { name: 'Empathy', isCustom: false },
        42,
      );

      expect(competencyRepository.create).toHaveBeenCalledWith({
        name: 'Empathy',
        isCustom: false,
        createdBy: 42,
      });
      expect(result.name).toBe('Empathy');
    });
  });

  describe('getCompetencies', () => {
    it('forwards the own-custom scope to the repository', async () => {
      competencyRepository.getCompetencies.mockResolvedValue({
        data: [],
        count: 0,
      });

      await service.getCompetencies(undefined, undefined, {
        includeOwnCustom: true,
        userId: 42,
      });

      expect(competencyRepository.getCompetencies).toHaveBeenCalledWith(
        undefined,
        undefined,
        { includeOwnCustom: true, userId: 42 },
      );
    });

    it('maps isCustom into the response', async () => {
      competencyRepository.getCompetencies.mockResolvedValue({
        data: [makeCompetency({ isCustom: true, createdBy: 42 })],
        count: 1,
      });

      const result = await service.getCompetencies();

      expect(result.data[0]).toEqual({
        id: 'comp-1',
        name: 'Active Listening',
        isCustom: true,
        clusters: [],
      });
    });

    it('decorates each competency with the clusters it belongs to', async () => {
      competencyRepository.getCompetencies.mockResolvedValue({
        data: [makeCompetency(), makeCompetency({ id: 'comp-2' })],
        count: 2,
      });
      clusterService.getClustersByCompetency.mockResolvedValue(
        new Map([
          ['comp-1', [{ id: 'cluster-1', name: 'Core Communication' }]],
        ]),
      );

      const result = await service.getCompetencies();

      // One membership query for the whole page, not one per row.
      expect(clusterService.getClustersByCompetency).toHaveBeenCalledTimes(1);
      expect(clusterService.getClustersByCompetency).toHaveBeenCalledWith([
        'comp-1',
        'comp-2',
      ]);
      expect(result.data[0].clusters).toEqual([
        { id: 'cluster-1', name: 'Core Communication' },
      ]);
      // A competency in no cluster reads as an empty list, never undefined.
      expect(result.data[1].clusters).toEqual([]);
    });
  });

  describe('clustering', () => {
    it('replaces a competency’s clusters when clusterNames is sent', async () => {
      competencyRepository.getCompetencyById.mockResolvedValue(
        makeCompetency(),
      );

      await service.updateCompetency(
        'comp-1',
        {
          name: 'Active Listening',
          clusterNames: ['Core Communication', 'In-house'],
        },
        7,
      );

      expect(clusterService.setClustersForCompetency).toHaveBeenCalledWith(
        'comp-1',
        ['Core Communication', 'In-house'],
        7,
      );
    });

    it('leaves clustering alone when clusterNames is omitted', async () => {
      competencyRepository.getCompetencyById.mockResolvedValue(
        makeCompetency(),
      );

      await service.updateCompetency('comp-1', { name: 'Renamed' }, 7);

      expect(clusterService.setClustersForCompetency).not.toHaveBeenCalled();
    });

    it('removes a competency from every cluster on an empty clusterNames', async () => {
      competencyRepository.getCompetencyById.mockResolvedValue(
        makeCompetency(),
      );

      await service.updateCompetency(
        'comp-1',
        { name: 'Active Listening', clusterNames: [] },
        7,
      );

      expect(clusterService.setClustersForCompetency).toHaveBeenCalledWith(
        'comp-1',
        [],
        7,
      );
    });

    // A custom competency is private to its owner, so putting one in a shared
    // framework would publish a name nobody else can resolve.
    it('never clusters a custom competency', async () => {
      competencyRepository.getCompetencyById.mockResolvedValue(
        makeCompetency({ isCustom: true, createdBy: 7 }),
      );

      await service.updateCompetency(
        'comp-1',
        { name: 'my rubric', clusterNames: ['Core Communication'] },
        7,
      );

      expect(clusterService.setClustersForCompetency).not.toHaveBeenCalled();
    });
  });

  describe('ownership enforcement', () => {
    it('blocks renaming another user’s custom competency', async () => {
      competencyRepository.getCompetencyById.mockResolvedValue(
        makeCompetency({ isCustom: true, createdBy: 99 }),
      );

      await expect(
        service.updateCompetency('comp-1', { name: 'x' }, 42),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks deleting another user’s custom competency', async () => {
      competencyRepository.getCompetencyById.mockResolvedValue(
        makeCompetency({ isCustom: true, createdBy: 99 }),
      );

      await expect(service.deleteCompetency('comp-1', 42)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows the owner to delete their own custom competency', async () => {
      competencyRepository.getCompetencyById.mockResolvedValue(
        makeCompetency({ isCustom: true, createdBy: 42 }),
      );

      await service.deleteCompetency('comp-1', 42);

      expect(competencyRepository.delete).toHaveBeenCalledWith('comp-1');
    });

    it('allows managing a global competency regardless of user', async () => {
      competencyRepository.getCompetencyById.mockResolvedValue(
        makeCompetency({ isCustom: false }),
      );

      await service.deleteCompetency('comp-1', 42);

      expect(competencyRepository.delete).toHaveBeenCalledWith('comp-1');
    });

    it('throws NotFound for a missing competency', async () => {
      competencyRepository.getCompetencyById.mockResolvedValue(null);

      await expect(service.deleteCompetency('missing', 42)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteCompetency (reference checks)', () => {
    beforeEach(() => {
      competencyRepository.getCompetencyById.mockResolvedValue(
        makeCompetency(),
      );
    });

    it('blocks deletion when a scenario still references the competency', async () => {
      scenariosRepository.existsWithCompetencyId.mockResolvedValue(true);

      await expect(service.deleteCompetency('comp-1', 42)).rejects.toThrow(
        ConflictException,
      );
      expect(competencyRepository.delete).not.toHaveBeenCalled();
    });

    it('allows deletion when nothing references the competency', async () => {
      scenariosRepository.existsWithCompetencyId.mockResolvedValue(false);

      await service.deleteCompetency('comp-1', 42);

      expect(competencyRepository.delete).toHaveBeenCalledWith('comp-1');
    });
  });
});
