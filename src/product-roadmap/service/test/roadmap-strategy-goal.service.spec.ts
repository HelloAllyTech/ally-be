import { BadRequestException, ConflictException } from '@nestjs/common';
import { RoadmapStrategyGoalService } from '../roadmap-strategy-goal.service';
import { ROADMAP_RANK } from '../../constants/product-roadmap.constants';

const ACTOR = 7;

describe('RoadmapStrategyGoalService', () => {
  const buildService = (overrides: {
    goalCount?: number;
    existingByName?: unknown;
    weights?: Record<string, number>;
  }) => {
    const goalRepository = {
      count: jest.fn().mockResolvedValue(overrides.goalCount ?? 0),
      findOne: jest.fn().mockResolvedValue(overrides.existingByName ?? null),
      findAllOrdered: jest.fn().mockResolvedValue([]),
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown) => ({ id: 'g1', ...(x as object) })),
      countUnassessed: jest.fn().mockResolvedValue(12),
      remove: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      getUnassessedCounts: jest.fn().mockResolvedValue({}),
    };
    const impactRepository = { count: jest.fn().mockResolvedValue(40) };
    const weightsRepository = {
      getWeights: jest.fn().mockResolvedValue({
        id: 1,
        votesWeight: 3,
        votersWeight: 3,
        effortWeight: 1,
        goalImpactWeight: 3,
        ...(overrides.weights ?? {}),
      }),
      save: jest.fn(async (x: unknown) => x),
      getRankBases: jest
        .fn()
        .mockResolvedValue({ maxScore: 10, maxVoters: 3, totalGoals: 4 }),
    };
    const notifications = { emit: jest.fn() };

    return {
      service: new RoadmapStrategyGoalService(
        goalRepository as never,
        impactRepository as never,
        weightsRepository as never,
        notifications as never,
      ),
      goalRepository,
      impactRepository,
      weightsRepository,
      notifications,
    };
  };

  it('reports how many opportunities a new goal just made unassessed', async () => {
    // Adding a goal grows the coverage denominator, so every score on the board drops until a
    // bulk run catches up. Returning the count is what lets the UI say so rather than letting
    // the board look as though it re-ranked on merit.
    const { service } = buildService({});

    await expect(service.createGoal(ACTOR, ' Ship faster ')).resolves.toEqual({
      goal: expect.objectContaining({ name: 'Ship faster' }),
      unassessed: 12,
    });
  });

  it('refuses a goal beyond the ceiling', async () => {
    const { service } = buildService({
      goalCount: ROADMAP_RANK.MAX_STRATEGY_GOALS,
    });

    await expect(service.createGoal(ACTOR, 'One more')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a duplicate name', async () => {
    const { service } = buildService({ existingByName: { id: 'g0' } });

    await expect(service.createGoal(ACTOR, 'Existing')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('reports the verdicts a delete throws away', async () => {
    // Deleting never blocks — the FK cascades and coverage recomputes correctly — but the
    // assessments cost money to produce and are not recoverable, so the count is surfaced.
    const { service, goalRepository } = buildService({});
    goalRepository.findOne.mockResolvedValue({ id: 'g1', name: 'Goal A' });

    await expect(service.deleteGoal(ACTOR, 'g1')).resolves.toEqual({
      discardedVerdicts: 40,
    });
  });

  it('rejects an all-zero weight set with a readable error, not a constraint violation', async () => {
    // The CHECK would surface as a 500. Clearing four inputs is an ordinary admin mistake.
    const { service } = buildService({
      weights: {
        votesWeight: 0,
        votersWeight: 0,
        effortWeight: 0,
        goalImpactWeight: 0,
      },
    });

    await expect(service.updateWeights(ACTOR, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('patches one weight without restating the others', async () => {
    // PATCH semantics: two admins tuning different sliders must not overwrite each other.
    const { service, weightsRepository } = buildService({});

    await service.updateWeights(ACTOR, { effortWeight: 8 });

    expect(weightsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        votesWeight: 3,
        votersWeight: 3,
        effortWeight: 8,
        goalImpactWeight: 3,
      }),
    );
  });
});
