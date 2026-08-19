import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { RoadmapAllocationService } from '../roadmap-allocation.service';
import { RoadmapAllocationRepository } from '../../repository/roadmap-allocation.repository';
import { RoadmapNotificationService } from '../roadmap-notification.service';
import { RoadmapAllocation } from '../../entity/roadmap-allocation.entity';
import { RoadmapOpportunity } from '../../entity/roadmap-opportunity.entity';
import {
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../../enum/roadmap-opportunity.enum';

const OPP_ID = '11111111-1111-1111-1111-111111111111';
const USER = 7;

describe('RoadmapAllocationService', () => {
  let service: RoadmapAllocationService;
  let manager: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    remove: jest.Mock;
    query: jest.Mock;
  };
  let allocationRepository: {
    lockUserPeriod: jest.Mock;
    sumForPeriodExcluding: jest.Mock;
    sumForPeriod: jest.Mock;
  };
  let notifications: { emit: jest.Mock };

  /** An existing allocation row for this user/opportunity/period, or none. */
  const givenExistingAllocation = (
    coins: number | null,
    stage = RoadmapOpportunityStage.NEW,
    type = RoadmapOpportunityType.IDEA,
  ) =>
    manager.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === RoadmapOpportunity) return { id: OPP_ID, stage, type };
      return coins === null ? null : { id: 'alloc-1', coins };
    });

  beforeEach(async () => {
    manager = {
      findOne: jest.fn(),
      save: jest.fn(async (a: unknown, b?: unknown) => b ?? a),
      create: jest.fn((_entity: unknown, data: unknown) => data),
      remove: jest.fn(),
      // The post-write priority-score recount.
      query: jest.fn(async () => [{ total: '0' }]),
    };

    const dataSource = {
      transaction: jest.fn(async (cb: (m: typeof manager) => unknown) =>
        cb(manager),
      ),
    } as unknown as DataSource;

    allocationRepository = {
      lockUserPeriod: jest.fn(),
      sumForPeriodExcluding: jest.fn(async () => 0),
      sumForPeriod: jest.fn(async () => 0),
    };

    notifications = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoadmapAllocationService,
        { provide: DataSource, useValue: dataSource },
        {
          provide: RoadmapAllocationRepository,
          useValue: allocationRepository,
        },
        { provide: RoadmapNotificationService, useValue: notifications },
      ],
    }).compile();

    service = module.get(RoadmapAllocationService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('the monthly cap', () => {
    it('allows a total of exactly 100', async () => {
      givenExistingAllocation(null);
      allocationRepository.sumForPeriodExcluding.mockResolvedValue(60);

      const result = await service.setCoins(USER, OPP_ID, 40);

      expect(result.coins).toBe(40);
      expect(result.budget.used).toBe(100);
      expect(result.budget.remaining).toBe(0);
    });

    it('rejects 101 with a 422 carrying remaining and cap, and writes nothing', async () => {
      givenExistingAllocation(null);
      allocationRepository.sumForPeriodExcluding.mockResolvedValue(60);

      await expect(service.setCoins(USER, OPP_ID, 41)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      // The friendly path must refuse BEFORE touching the table — otherwise the DB trigger
      // answers instead and the client gets a 500-shaped error.
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.remove).not.toHaveBeenCalled();
    });

    it('surfaces remaining/cap in the 422 body so the UI can show the real balance', async () => {
      givenExistingAllocation(null);
      allocationRepository.sumForPeriodExcluding.mockResolvedValue(85);

      await expect(service.setCoins(USER, OPP_ID, 20)).rejects.toMatchObject({
        response: { remaining: 15, cap: 100 },
      });
    });

    /**
     * THE REGRESSION CASE. Raising your own existing vote must not count that row twice.
     * If the self-exclusion is wrong (here, or in the DB trigger's
     * `id IS DISTINCT FROM NEW.id AND "opportunityId" IS DISTINCT FROM NEW."opportunityId"`),
     * a legitimate edit fails with a spurious cap error. Do not delete this test.
     */
    it('lets a user raise their own vote 40 -> 60 while holding 40 elsewhere', async () => {
      givenExistingAllocation(40);
      // 40 committed on OTHER opportunities; this row is excluded from the sum.
      allocationRepository.sumForPeriodExcluding.mockResolvedValue(40);

      const result = await service.setCoins(USER, OPP_ID, 60);

      expect(result.coins).toBe(60);
      expect(result.budget.used).toBe(100);
      expect(allocationRepository.sumForPeriodExcluding).toHaveBeenCalledWith(
        manager,
        USER,
        expect.any(String),
        OPP_ID, // <- the exclusion
      );
    });

    it('takes the advisory lock BEFORE reading the total', async () => {
      givenExistingAllocation(null);
      const order: string[] = [];
      allocationRepository.lockUserPeriod.mockImplementation(async () => {
        order.push('lock');
      });
      allocationRepository.sumForPeriodExcluding.mockImplementation(
        async () => {
          order.push('sum');
          return 0;
        },
      );

      await service.setCoins(USER, OPP_ID, 10);

      // Reversed, and two concurrent writes both read a stale sum and both pass the check.
      expect(order).toEqual(['lock', 'sum']);
    });

    it('maps the DB trigger breach to a 409 rather than a 500', async () => {
      givenExistingAllocation(null);
      manager.save.mockRejectedValue(
        new Error(
          'ROADMAP_MONTHLY_CAP_EXCEEDED: user 7 already holds 100 of 100 coins in 2026-07',
        ),
      );

      await expect(service.setCoins(USER, OPP_ID, 5)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('does not swallow unrelated errors', async () => {
      givenExistingAllocation(null);
      manager.save.mockRejectedValue(new Error('connection terminated'));

      await expect(service.setCoins(USER, OPP_ID, 5)).rejects.toThrow(
        'connection terminated',
      );
    });
  });

  describe('coins: 0', () => {
    it('deletes the row instead of storing a zero', async () => {
      givenExistingAllocation(30);

      await service.setCoins(USER, OPP_ID, 0);

      // "No vote" must have exactly one representation, or every SUM has to special-case zeros.
      expect(manager.remove).toHaveBeenCalledWith(RoadmapAllocation, {
        id: 'alloc-1',
        coins: 30,
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('is a no-op when there was no allocation', async () => {
      givenExistingAllocation(null);

      const result = await service.setCoins(USER, OPP_ID, 0);

      expect(manager.remove).not.toHaveBeenCalled();
      expect(result.coins).toBe(0);
    });
  });

  describe('the stage rule', () => {
    it.each([
      RoadmapOpportunityStage.PRIORITISED,
      RoadmapOpportunityStage.UNDER_DEVELOPMENT,
      RoadmapOpportunityStage.RELEASED,
      RoadmapOpportunityStage.ARCHIVED,
    ])('rejects a vote on a %s opportunity with 409', async (stage) => {
      givenExistingAllocation(null, stage);

      await expect(service.setCoins(USER, OPP_ID, 5)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('allows a vote on a new opportunity', async () => {
      givenExistingAllocation(null, RoadmapOpportunityStage.NEW);
      await expect(service.setCoins(USER, OPP_ID, 5)).resolves.toMatchObject({
        coins: 5,
      });
    });

    it('404s for an unknown opportunity', async () => {
      manager.findOne.mockResolvedValue(null);
      await expect(service.setCoins(USER, OPP_ID, 5)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('the bug-type rule', () => {
    it('rejects a vote on a bug opportunity with 409, even in the new stage', async () => {
      givenExistingAllocation(
        null,
        RoadmapOpportunityStage.NEW,
        RoadmapOpportunityType.BUG,
      );

      await expect(service.setCoins(USER, OPP_ID, 5)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('allows a vote on a new, non-bug opportunity', async () => {
      givenExistingAllocation(
        null,
        RoadmapOpportunityStage.NEW,
        RoadmapOpportunityType.IDEA,
      );
      await expect(service.setCoins(USER, OPP_ID, 5)).resolves.toMatchObject({
        coins: 5,
      });
    });
  });

  describe('the period key', () => {
    it('is server-computed and never taken from the caller', async () => {
      givenExistingAllocation(null);

      const result = await service.setCoins(USER, OPP_ID, 5);

      // Shape only — the exact month depends on the clock. The point is that setCoins takes no
      // periodKey argument at all, so historical periods are read-only by construction. That
      // closes the source's hole where RLS allowed a write to ANY period_key while the score
      // sums every period forever.
      expect(result.periodKey).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
      expect(service.setCoins).toHaveLength(3); // (userId, opportunityId, coins)
    });
  });

  describe('broadcasts', () => {
    it('emits ALLOCATION_CHANGED with the actor id for echo suppression', async () => {
      givenExistingAllocation(null);
      manager.query.mockResolvedValue([{ total: '42' }]);

      await service.setCoins(USER, OPP_ID, 5);

      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'ALLOCATION_CHANGED',
          actorId: USER,
          opportunityId: OPP_ID,
          coins: 5,
          priorityScore: 42,
        }),
      );
    });
  });

  describe('getBudget', () => {
    it('reports the remaining coins for the current period', async () => {
      allocationRepository.sumForPeriod.mockResolvedValue(73);

      const budget = await service.getBudget(USER);

      expect(budget).toMatchObject({
        coinsPerMonth: 100,
        used: 73,
        remaining: 27,
      });
    });

    it('never reports negative remaining, even if the data is over cap', async () => {
      // Defensive: a pre-trigger breach in migrated data must not render as "-20 coins left".
      allocationRepository.sumForPeriod.mockResolvedValue(120);

      const budget = await service.getBudget(USER);

      expect(budget.remaining).toBe(0);
    });
  });
});
