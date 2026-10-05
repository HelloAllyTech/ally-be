import { AgentMemory } from 'src/agent-memory/entity/agent-memory.entity';
import { AgentMemoryStatus } from 'src/agent-memory/enum/agent-memory.enum';

import { BugFindingStatus } from '../../enum/bug-finding.enum';
import {
  BugHunterMemoryRetirementService,
  decideRetirement,
  RetirementContext,
} from '../bug-hunter-memory-retirement.service';

const NOW = new Date('2026-10-05T00:30:00.000Z');

const entry = (over: Partial<AgentMemory> = {}) =>
  ({
    id: 'mem-1',
    body: 'ally-be: the scheduler suite needs a live Redis.',
    repos: ['ally-be'],
    tags: ['flaky-test'],
    status: AgentMemoryStatus.ACTIVE,
    pinned: false,
    sourceCount: 1,
    timesApplied: 0,
    timesContradicted: 0,
    findingId: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...over,
  }) as AgentMemory;

const ctx = (over: Partial<RetirementContext> = {}): RetirementContext => ({
  feedbackRunsSince: 0,
  finding: null,
  now: NOW,
  ...over,
});

describe('decideRetirement — the three rules', () => {
  it('keeps a fresh entry nobody has judged yet', () => {
    expect(decideRetirement(entry(), ctx())).toBeNull();
  });

  it('never retires a pinned entry, whatever the evidence says', () => {
    expect(
      decideRetirement(
        entry({ pinned: true, timesContradicted: 9 }),
        ctx({ feedbackRunsSince: 99 }),
      ),
    ).toBeNull();
  });

  describe('rule 1 — contradicted more than confirmed', () => {
    it('needs the contradictions to EXCEED applied plus sightings, so one bad night is not enough', () => {
      // sourceCount 1, applied 0: one contradiction is a tie, two retire.
      expect(
        decideRetirement(entry({ timesContradicted: 1 }), ctx()),
      ).toBeNull();
      expect(decideRetirement(entry({ timesContradicted: 2 }), ctx())).toMatch(
        /reported it wrong 2 times/,
      );
    });

    it('weighs applications and sightings against it', () => {
      expect(
        decideRetirement(
          entry({ timesContradicted: 3, timesApplied: 2, sourceCount: 2 }),
          ctx(),
        ),
      ).toBeNull();
      expect(
        decideRetirement(
          entry({ timesContradicted: 5, timesApplied: 2, sourceCount: 2 }),
          ctx(),
        ),
      ).toMatch(/against 2 applied and 2 independent sightings/);
    });
  });

  describe('rule 2 — never applied', () => {
    it('counts only runs that reported feedback, so the rule cannot fire before the loop is live', () => {
      expect(
        decideRetirement(entry(), ctx({ feedbackRunsSince: 29 })),
      ).toBeNull();
      expect(decideRetirement(entry(), ctx({ feedbackRunsSince: 30 }))).toMatch(
        /No run applied it in the last 30 runs/,
      );
    });

    it('keeps an entry that was applied even once', () => {
      expect(
        decideRetirement(
          entry({ timesApplied: 1 }),
          ctx({ feedbackRunsSince: 300 }),
        ),
      ).toBeNull();
    });
  });

  describe('rule 3 — its bug shipped and stayed fixed', () => {
    const released = (
      daysAgo: number,
      over: Partial<RetirementContext['finding']> = {},
    ) =>
      ctx({
        finding: {
          status: BugFindingStatus.RELEASED,
          releasedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
          regressed: false,
          ...over,
        },
      });
    const aboutOneBug = entry({ findingId: 'f-1', tags: ['root-cause'] });

    it('retires a bug-specific note once the bug has been live past the grace period', () => {
      expect(decideRetirement(aboutOneBug, released(13))).toBeNull();
      expect(decideRetirement(aboutOneBug, released(14))).toMatch(
        /live for 14 days without coming back/,
      );
    });

    it('keeps the note while the bug is not yet released, or came back', () => {
      expect(
        decideRetirement(
          aboutOneBug,
          released(40, { status: BugFindingStatus.MERGED }),
        ),
      ).toBeNull();
      expect(
        decideRetirement(aboutOneBug, released(40, { regressed: true })),
      ).toBeNull();
      expect(
        decideRetirement(aboutOneBug, released(40, { releasedAt: null })),
      ).toBeNull();
    });

    it('never retires a repo trap for its bug shipping — the trap outlives the bug', () => {
      for (const tag of ['fix-gotcha', 'postmortem', 'flaky-test']) {
        expect(
          decideRetirement(
            entry({ findingId: 'f-1', tags: [tag] }),
            released(100),
          ),
        ).toBeNull();
      }
    });

    it('keeps a bug-specific note other runs have since confirmed or applied', () => {
      expect(
        decideRetirement({ ...aboutOneBug, sourceCount: 2 }, released(100)),
      ).toBeNull();
      expect(
        decideRetirement({ ...aboutOneBug, timesApplied: 1 }, released(100)),
      ).toBeNull();
    });
  });
});

describe('BugHunterMemoryRetirementService.run', () => {
  let memoryService: {
    listActiveUnpinned: jest.Mock;
    retire: jest.Mock;
  };
  let findingRepository: { findOne: jest.Mock };
  let runRepository: { query: jest.Mock };
  let service: BugHunterMemoryRetirementService;

  beforeEach(() => {
    memoryService = {
      listActiveUnpinned: jest.fn().mockResolvedValue([]),
      retire: jest.fn().mockResolvedValue(undefined),
    };
    findingRepository = { findOne: jest.fn().mockResolvedValue(null) };
    runRepository = { query: jest.fn().mockResolvedValue([{ count: 0 }]) };
    service = new BugHunterMemoryRetirementService(
      memoryService as never,
      findingRepository as never,
      runRepository as never,
    );
  });

  it('retires with the agent (null user) and the rule as the reason, and leaves the rest alone', async () => {
    memoryService.listActiveUnpinned.mockResolvedValue([
      entry({ id: 'stale', timesContradicted: 3 }),
      entry({ id: 'fine' }),
    ]);

    expect(await service.run(NOW)).toBe(1);
    expect(memoryService.retire).toHaveBeenCalledTimes(1);
    expect(memoryService.retire).toHaveBeenCalledWith(
      'stale',
      null,
      expect.stringMatching(/reported it wrong 3 times/),
    );
  });

  it("scopes the feedback-run count to the entry's repos, and to runs since it was written", async () => {
    memoryService.listActiveUnpinned.mockResolvedValue([
      entry({ repos: ['ally-web'] }),
    ]);
    runRepository.query.mockResolvedValue([{ count: 31 }]);

    expect(await service.run(NOW)).toBe(1);
    expect(runRepository.query).toHaveBeenCalledWith(
      expect.stringContaining("r.metadata ? 'memoryFeedback'"),
      [new Date('2026-09-01T00:00:00.000Z'), ['ally-web']],
    );
    // A platform-wide entry counts every repo's runs.
    memoryService.listActiveUnpinned.mockResolvedValue([
      entry({ repos: null }),
    ]);
    await service.run(NOW);
    expect(runRepository.query).toHaveBeenLastCalledWith(expect.any(String), [
      new Date('2026-09-01T00:00:00.000Z'),
      null,
    ]);
  });

  it('reads the finding behind a bug-specific note, and survives one entry failing', async () => {
    memoryService.listActiveUnpinned.mockResolvedValue([
      entry({ id: 'broken', findingId: 'f-x', tags: ['root-cause'] }),
      entry({ id: 'shipped', findingId: 'f-1', tags: ['root-cause'] }),
    ]);
    findingRepository.findOne
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce({
        status: BugFindingStatus.RELEASED,
        releasedAt: new Date(NOW.getTime() - 30 * 86_400_000),
        metadata: { regressed: false },
      });

    expect(await service.run(NOW)).toBe(1);
    expect(memoryService.retire).toHaveBeenCalledWith(
      'shipped',
      null,
      expect.stringMatching(/live for 30 days/),
    );
  });
});
