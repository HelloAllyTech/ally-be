import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CompetencyService } from '../competency.service';
import { CompetencyRepository } from '../../repository/competency.repository';
import { CompetencyBehaviorRepository } from '../../repository/competency-behavior.repository';
import { BehaviorRepository } from '../../repository/behavior.repository';
import { Competency } from '../../entity/competency.entity';

describe('CompetencyService (custom competencies)', () => {
  let service: CompetencyService;
  let competencyRepository: jest.Mocked<CompetencyRepository>;
  let competencyBehaviorRepository: jest.Mocked<CompetencyBehaviorRepository>;
  let behaviorRepository: jest.Mocked<BehaviorRepository>;

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
      ],
    }).compile();

    service = module.get(CompetencyService);
    competencyRepository = module.get(CompetencyRepository);
    competencyBehaviorRepository = module.get(CompetencyBehaviorRepository);
    behaviorRepository = module.get(BehaviorRepository);
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
      });
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
});
