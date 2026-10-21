import { BadRequestException } from '@nestjs/common';

import { ExecutionManager } from 'src/common/execution/execution-manager';
import { NotFoundException } from 'src/exception/custom.exception';

import { PublicRoadmapItem } from '../../entity/public-roadmap-item.entity';
import { PublicRoadmapItemRepository } from '../../repository/public-roadmap-item.repository';
import { PublicRoadmapService } from '../public-roadmap.service';

const card = (overrides: Partial<PublicRoadmapItem> = {}): PublicRoadmapItem =>
  ({
    id: 'a0000000-0000-4000-8000-000000000001',
    title: 'Learner App',
    description: 'A vertical, voice-first LMS.',
    note: null,
    category: 'prepare',
    stage: 'beta',
    sortOrder: 0,
    isPublic: true,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  }) as PublicRoadmapItem;

describe('PublicRoadmapService', () => {
  let repository: jest.Mocked<
    Pick<
      PublicRoadmapItemRepository,
      | 'listOrdered'
      | 'nextSortOrder'
      | 'create'
      | 'save'
      | 'findOne'
      | 'find'
      | 'count'
      | 'remove'
    >
  > & { manager: { transaction: jest.Mock } };
  let service: PublicRoadmapService;

  beforeEach(() => {
    repository = {
      listOrdered: jest.fn(),
      nextSortOrder: jest.fn().mockResolvedValue(3),
      create: jest.fn((value) => value as PublicRoadmapItem) as never,
      save: jest.fn(async (value) =>
        card(value as Partial<PublicRoadmapItem>),
      ) as never,
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      remove: jest.fn(),
      manager: {
        transaction: jest.fn(async (work) =>
          work({ save: jest.fn(async (_entity, rows) => rows) }),
        ),
      },
    };
    service = new PublicRoadmapService(
      repository as unknown as PublicRoadmapItemRepository,
    );
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('42');
  });

  afterEach(() => jest.restoreAllMocks());

  describe('getPublicRoadmap', () => {
    it('serves only visible cards, without the visibility flag or audit fields', async () => {
      repository.listOrdered.mockResolvedValue([card()]);

      const result = await service.getPublicRoadmap();

      expect(repository.listOrdered).toHaveBeenCalledWith({ publicOnly: true });
      expect(result.items[0]).toEqual({
        id: card().id,
        title: 'Learner App',
        description: 'A vertical, voice-first LMS.',
        note: null,
        category: 'prepare',
        stage: 'beta',
        sortOrder: 0,
      });
    });

    it('dates the page by its most recently changed card', async () => {
      repository.listOrdered.mockResolvedValue([
        card({ updatedAt: new Date('2026-07-02T00:00:00Z') }),
        card({ updatedAt: new Date('2026-10-09T00:00:00Z') }),
        card({ updatedAt: new Date('2026-09-15T00:00:00Z') }),
      ]);

      const { updatedAt } = await service.getPublicRoadmap();

      expect(updatedAt).toBe('2026-10-09T00:00:00.000Z');
    });

    it('has no date when nothing is on the page', async () => {
      repository.listOrdered.mockResolvedValue([]);

      expect(await service.getPublicRoadmap()).toEqual({
        items: [],
        updatedAt: null,
      });
    });
  });

  describe('create', () => {
    it('appends the card to the end of its cell, visible by default, trimmed', async () => {
      await service.create({
        title: '  Field Companion ',
        description: ' In-the-moment voice guidance. ',
        note: '   ',
        category: 'perform',
        stage: 'idea',
      });

      expect(repository.nextSortOrder).toHaveBeenCalledWith('perform', 'idea');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Field Companion',
          description: 'In-the-moment voice guidance.',
          note: null,
          isPublic: true,
          sortOrder: 3,
          createdBy: 42,
          updatedBy: 42,
        }),
      );
    });

    it('rejects a title that is only whitespace', async () => {
      await expect(
        service.create({
          title: '   ',
          description: 'Something',
          category: 'perform',
          stage: 'idea',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('moves a card to the end of its new cell when its stage changes', async () => {
      repository.findOne.mockResolvedValue(card({ sortOrder: 0 }));

      await service.update(card().id, { stage: 'released' });

      expect(repository.nextSortOrder).toHaveBeenCalledWith(
        'prepare',
        'released',
      );
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'released', sortOrder: 3 }),
      );
    });

    it('keeps its position when it stays in the same cell', async () => {
      repository.findOne.mockResolvedValue(card({ sortOrder: 2 }));

      await service.update(card().id, { title: 'Learner app', stage: 'beta' });

      expect(repository.nextSortOrder).not.toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Learner app', sortOrder: 2 }),
      );
    });

    it('clears the note when sent blank or null, and hides the card', async () => {
      repository.findOne.mockResolvedValue(card({ note: 'Current priority' }));

      await service.update(card().id, { note: null, isPublic: false });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ note: null, isPublic: false, updatedBy: 42 }),
      );
    });

    it('404s for a card that does not exist', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.update(card().id, { title: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reorder', () => {
    const a = card({
      id: 'a0000000-0000-4000-8000-00000000000a',
      sortOrder: 0,
    });
    const b = card({
      id: 'a0000000-0000-4000-8000-00000000000b',
      sortOrder: 1,
    });

    it('numbers the whole cell in the order sent', async () => {
      repository.find.mockResolvedValue([a, b]);
      repository.count.mockResolvedValue(2);

      const result = await service.reorder([b.id, a.id]);

      expect(result.map((i) => [i.id, i.sortOrder])).toEqual([
        [b.id, 0],
        [a.id, 1],
      ]);
    });

    it('refuses a partial cell, which would leave ties', async () => {
      repository.find.mockResolvedValue([a, b]);
      repository.count.mockResolvedValue(3);

      await expect(service.reorder([b.id, a.id])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses cards from different cells', async () => {
      repository.find.mockResolvedValue([a, { ...b, stage: 'lab' }]);

      await expect(service.reorder([b.id, a.id])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('404s when a card has been deleted meanwhile', async () => {
      repository.find.mockResolvedValue([a]);

      await expect(service.reorder([b.id, a.id])).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
