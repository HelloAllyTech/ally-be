import { BadRequestException } from '@nestjs/common';
import { BuilderEpicService, parseMilestones } from '../builder-epic.service';
import { BuilderMilestoneStatus } from '../../enum/builder.enum';

/**
 * Epic decomposition is validated in code rather than trusted to the model
 * because both ways it can be wrong are silent. A requirement in two
 * milestones gets built twice; a requirement in none is simply dropped, and
 * nobody notices until the feature is short a piece.
 */

const prd = (requirementIds: string[]) =>
  ({
    title: 'Comfort audio',
    summary: 'Per-simulation comfort audio.',
    problem: 'Volume is fixed platform-wide.',
    requirements: requirementIds.map((id) => ({
      id,
      title: `Requirement ${id}`,
      description: 'Something to build.',
      acceptanceCriteria: ['it works'],
    })),
    technicalPlan: { repos: [{ repo: 'ally-be', changesMd: 'Add it.' }] },
  }) as any;

const session = { id: 'session-1', slug: 'comfort-audio' } as any;

describe('BuilderEpicService', () => {
  let service: BuilderEpicService;
  let repository: any;
  let reply: string;

  beforeEach(() => {
    reply = JSON.stringify([
      {
        title: 'Store the setting',
        summary: 'Column, migration, service read path.',
        requirementIds: ['R1'],
        technicalNotes: 'Migration first.',
      },
      {
        title: 'Expose it in the admin form',
        summary: 'The field.',
        requirementIds: ['R2'],
        technicalNotes: 'Reads what milestone 1 stored.',
      },
    ]);

    repository = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
      update: jest.fn(),
      save: jest.fn(async (rows) =>
        rows.map((row: any, index: number) => ({ id: `m-${index}`, ...row })),
      ),
      create: jest.fn((row) => row),
    };

    service = new BuilderEpicService(
      {
        anthropic: { apiKey: 'test' },
        builder: { plannerModel: 'claude-opus-5' },
      } as any,
      { getRepository: () => repository } as any,
      { record: jest.fn() } as any,
    );

    (service as any).client = {
      messages: {
        create: jest.fn(async () => ({
          content: [{ type: 'text', text: reply }],
          usage: { input_tokens: 10, output_tokens: 5 },
        })),
      },
    };
  });

  describe('propose', () => {
    it('stores an ordered series with stacked branch slugs', async () => {
      const saved = await service.propose(session, prd(['R1', 'R2']));

      expect(saved).toHaveLength(2);
      const created = repository.create.mock.calls.map(
        (call: any[]) => call[0],
      );
      expect(created[0]).toMatchObject({
        position: 1,
        branchSlug: 'comfort-audio-m1',
        status: BuilderMilestoneStatus.PENDING,
      });
      expect(created[1]).toMatchObject({
        position: 2,
        branchSlug: 'comfort-audio-m2',
      });
    });

    it('refuses a split that leaves a requirement unassigned', async () => {
      // Silently dropped work is the failure nobody notices until the feature
      // is short a piece.
      await expect(
        service.propose(session, prd(['R1', 'R2', 'R3'])),
      ).rejects.toThrow(/unassigned/i);
    });

    it('refuses a requirement assigned to two milestones', async () => {
      reply = JSON.stringify([
        { title: 'One', summary: '', requirementIds: ['R1', 'R2'] },
        { title: 'Two', summary: '', requirementIds: ['R2'] },
      ]);

      await expect(service.propose(session, prd(['R1', 'R2']))).rejects.toThrow(
        /more than one milestone/i,
      );
    });

    it('refuses a requirement the PRD does not contain', async () => {
      reply = JSON.stringify([
        { title: 'One', summary: '', requirementIds: ['R1'] },
        { title: 'Two', summary: '', requirementIds: ['R2'] },
        { title: 'Invented', summary: '', requirementIds: ['R99'] },
      ]);

      await expect(service.propose(session, prd(['R1', 'R2']))).rejects.toThrow(
        /not in the PRD/i,
      );
    });

    it('refuses to split a PRD too small to be worth splitting', async () => {
      await expect(service.propose(session, prd(['R1']))).rejects.toThrow(
        /fewer than two requirements/i,
      );
    });

    it('refuses to redraw a split once building has started', async () => {
      // Milestone 1's branch already exists and may already have a pull
      // request; renumbering underneath that would strand both.
      repository.find.mockResolvedValue([
        { id: 'm-0', status: BuilderMilestoneStatus.COMPLETED },
      ]);

      await expect(
        service.propose(session, prd(['R1', 'R2'])),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('replaces an unconfirmed proposal rather than appending to it', async () => {
      repository.find.mockResolvedValue([
        { id: 'old', status: BuilderMilestoneStatus.PENDING },
      ]);

      await service.propose(session, prd(['R1', 'R2']));

      expect(repository.delete).toHaveBeenCalledWith({
        sessionId: 'session-1',
      });
    });

    it('refuses an empty decomposition rather than building nothing', async () => {
      reply = '[]';

      await expect(service.propose(session, prd(['R1', 'R2']))).rejects.toThrow(
        /came back empty/i,
      );
    });
  });

  describe('sequencing', () => {
    const milestones = [
      { id: 'm-1', position: 1, status: BuilderMilestoneStatus.COMPLETED },
      { id: 'm-2', position: 2, status: BuilderMilestoneStatus.PENDING },
      { id: 'm-3', position: 3, status: BuilderMilestoneStatus.PENDING },
    ];

    it('offers the earliest pending milestone, so the series stays in order', async () => {
      repository.find.mockResolvedValue(milestones);

      const next = await service.nextPending('session-1');

      expect(next?.id).toBe('m-2');
    });

    it('reports the epic finished when nothing is pending', async () => {
      repository.find.mockResolvedValue([
        { id: 'm-1', position: 1, status: BuilderMilestoneStatus.COMPLETED },
      ]);

      await expect(service.nextPending('session-1')).resolves.toBeNull();
    });

    it('lists only the completed milestones before a position', async () => {
      // What the next milestone's prompt may rely on already existing.
      repository.find.mockResolvedValue(milestones);

      const done = await service.completedBefore('session-1', 3);

      expect(done.map((m) => m.id)).toEqual(['m-1']);
    });
  });
});

describe('parseMilestones', () => {
  it('reads a fenced array with prose around it', () => {
    const text =
      'Here is the split:\n```json\n[{"title":"One","requirementIds":["R1"]}]\n```';
    expect(parseMilestones(text)).toEqual([
      expect.objectContaining({ title: 'One', requirementIds: ['R1'] }),
    ]);
  });

  it('drops a milestone with no requirements, which would build nothing', () => {
    expect(parseMilestones('[{"title":"Empty","requirementIds":[]}]')).toEqual(
      [],
    );
  });

  it('drops a milestone with no title', () => {
    expect(parseMilestones('[{"requirementIds":["R1"]}]')).toEqual([]);
  });

  it('returns nothing on unparseable output', () => {
    expect(parseMilestones('I would rather describe it in prose.')).toEqual([]);
  });
});
