import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { RoadmapBoardService } from '../roadmap-board.service';
import {
  RoadmapBoardGroupBy,
  RoadmapOpportunityStage,
} from '../../enum/roadmap-opportunity.enum';

const OPP = '11111111-1111-1111-1111-111111111111';
const ACTOR = 9;

describe('RoadmapBoardService', () => {
  let service: RoadmapBoardService;
  let repository: Record<string, jest.Mock>;
  let opportunityService: Record<string, jest.Mock>;
  let taxonomyService: Record<string, jest.Mock>;
  let notifications: { emit: jest.Mock };

  const row = (over: Record<string, unknown> = {}) => ({
    id: OPP,
    stage: RoadmapOpportunityStage.NEW,
    releasedAt: null,
    plannedMonth: null,
    productGoal: 'Scribe',
    owner: null,
    ...over,
  });

  beforeEach(() => {
    repository = {
      findOne: jest.fn(async () => row()),
      update: jest.fn(async () => ({ affected: 1 })),
      reorderLane: jest.fn(async () => []),
      manager: { transaction: jest.fn(async (cb: never) => cb) } as never,
    };
    opportunityService = { update: jest.fn(async () => ({})) };
    taxonomyService = {
      listGoals: jest.fn(async () => [
        { name: 'Scribe' },
        { name: 'Roleplay' },
      ]),
      listOwners: jest.fn(async () => [{ name: 'Ajey Gore' }]),
    };
    notifications = { emit: jest.fn() };

    service = new RoadmapBoardService(
      repository as never,
      opportunityService as never,
      notifications as never,
      taxonomyService as never,
    );
  });

  describe('move, by grouping', () => {
    it('routes a STAGE drop through the opportunity service, not a bare column write', async () => {
      await service.move(ACTOR, {
        opportunityId: OPP,
        groupBy: RoadmapBoardGroupBy.STAGE,
        lane: RoadmapOpportunityStage.RELEASED,
      });

      // Releasing stamps releasedAt exactly once and re-indexes; a direct UPDATE here would be a
      // second, quieter way to release something.
      expect(opportunityService.update).toHaveBeenCalledWith(ACTOR, OPP, {
        stage: RoadmapOpportunityStage.RELEASED,
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('writes productGoal for a GOAL drop', async () => {
      await service.move(ACTOR, {
        opportunityId: OPP,
        groupBy: RoadmapBoardGroupBy.PRODUCT_GOAL,
        lane: 'Roleplay',
      });

      expect(repository.update).toHaveBeenCalledWith(
        OPP,
        expect.objectContaining({ productGoal: 'Roleplay', updatedBy: ACTOR }),
      );
    });

    it('unassigns on a drop into the owner catch-all lane', async () => {
      // Owner is nullable, so "No owner" is a legal destination — unlike goal.
      await service.move(ACTOR, {
        opportunityId: OPP,
        groupBy: RoadmapBoardGroupBy.OWNER,
        lane: null,
      });

      expect(repository.update).toHaveBeenCalledWith(
        OPP,
        expect.objectContaining({ owner: null }),
      );
    });

    it('refuses a drop into the goal catch-all lane', async () => {
      await expect(
        service.move(ACTOR, {
          opportunityId: OPP,
          groupBy: RoadmapBoardGroupBy.PRODUCT_GOAL,
          lane: null,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it.each([
      [RoadmapBoardGroupBy.PRODUCT_GOAL, 'Deleted Goal'],
      [RoadmapBoardGroupBy.OWNER, 'Nobody At All'],
    ])(
      'rejects a %s value the taxonomy no longer holds',
      async (groupBy, lane) => {
        // These are text FKs by name, so an unknown value is an FK violation arriving as a 500
        // several frames after the drag.
        await expect(
          service.move(ACTOR, { opportunityId: OPP, groupBy, lane }),
        ).rejects.toThrow(UnprocessableEntityException);
        expect(repository.update).not.toHaveBeenCalled();
      },
    );

    it('rejects a stage value that is not a stage', async () => {
      await expect(
        service.move(ACTOR, {
          opportunityId: OPP,
          groupBy: RoadmapBoardGroupBy.STAGE,
          lane: 'nearly_done',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(opportunityService.update).not.toHaveBeenCalled();
    });

    it('does NOT reorder on a field drop', async () => {
      await service.move(ACTOR, {
        opportunityId: OPP,
        groupBy: RoadmapBoardGroupBy.OWNER,
        lane: 'Ajey Gore',
        orderedIds: [OPP],
      });

      // These boards are ordered by priority; echoing the ids back would claim an order the
      // client invented had been persisted.
      expect(repository.reorderLane).not.toHaveBeenCalled();
    });

    it('404s for an unknown opportunity, whatever the grouping', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(
        service.move(ACTOR, {
          opportunityId: OPP,
          groupBy: RoadmapBoardGroupBy.STAGE,
          lane: RoadmapOpportunityStage.NEW,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('still pins a shipped card on the MONTH board', async () => {
      repository.findOne.mockResolvedValue(
        row({
          stage: RoadmapOpportunityStage.RELEASED,
          releasedAt: new Date('2026-03-04T00:00:00Z'),
        }),
      );

      // The one lane rule that survives: a shipped card's month is derived from releasedAt, so
      // there is no field for "put it here" to write.
      await expect(
        service.move(ACTOR, {
          opportunityId: OPP,
          groupBy: RoadmapBoardGroupBy.MONTH,
          lane: '2026-09',
          orderedIds: [],
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('lets that same shipped card change STAGE, because that lane is a real column', async () => {
      repository.findOne.mockResolvedValue(
        row({
          stage: RoadmapOpportunityStage.RELEASED,
          releasedAt: new Date('2026-03-04T00:00:00Z'),
        }),
      );

      await expect(
        service.move(ACTOR, {
          opportunityId: OPP,
          groupBy: RoadmapBoardGroupBy.STAGE,
          lane: RoadmapOpportunityStage.ARCHIVED,
        }),
      ).resolves.toBeDefined();
    });
  });
});
