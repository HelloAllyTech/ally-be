import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { IsNull } from 'typeorm';

import { RoadmapBuilderService } from '../roadmap-builder.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

const OPP = '11111111-1111-1111-1111-111111111111';
const SESSION = '22222222-2222-2222-2222-222222222222';
const USER = 7;

const BRIEF = {
  strategicFit: [],
  reach: { howMany: null, howOften: null },
  evidence: [
    {
      source: 'codebase',
      claim: 'Learners already see a post-session star rating',
      ref: 'PostSimulationSummary.tsx',
    },
  ],
  successMetric: 'Share of debriefs marked helpful',
  assumptions: [],
  alternativesDropped: ['Rely only on the existing post-session rating'],
  assessment: {
    rating: 'strong',
    summary: 'Clear gain.',
    openRecommendations: [],
  },
};

const TRANSCRIPT = [
  { role: 'agent', content: 'What do you want to change?' },
  { role: 'admin', content: 'Let learners rate the debrief itself.' },
  { role: 'agent', content: 'Beside the session rating, or instead of it?' },
];

describe('RoadmapBuilderService', () => {
  let service: RoadmapBuilderService;
  let repository: { findOne: jest.Mock; update: jest.Mock };
  let builderSessions: {
    createSession: jest.Mock;
    attachHandoffContext: jest.Mock;
  };
  let permissions: { getUserPermissions: jest.Mock };
  let toggles: { hasToggle: jest.Mock };
  /** What the `select: false` transcript read returns. */
  let transcript: unknown;

  const opportunity = (over: Record<string, unknown> = {}) => ({
    id: OPP,
    code: 'OPP-0042',
    description: 'Counsellors cannot see which sims a learner failed',
    prd: null,
    brief: null,
    builderSessionId: null,
    ...over,
  });

  /**
   * The transcript column is `select: false`, so the service reads it on its own; route that
   * read by its `select` and every other read to `row()`, so tests can sequence row reads
   * without counting the transcript read among them.
   */
  const reads = (...rows: unknown[]) =>
    jest.fn(async (args: { select?: Record<string, boolean> }) => {
      if (args?.select?.interviewTranscript) {
        return { id: OPP, interviewTranscript: transcript };
      }
      return rows.length > 1 ? rows.shift() : rows[0];
    });

  beforeEach(() => {
    transcript = null;
    repository = {
      findOne: reads(opportunity()),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    builderSessions = {
      createSession: jest.fn(async () => ({ id: SESSION })),
      attachHandoffContext: jest.fn(async () => true),
    };
    permissions = {
      getUserPermissions: jest.fn(async () => [PERMISSIONS.EDIT_BUILDER]),
    };
    toggles = { hasToggle: jest.fn(async () => true) };

    service = new RoadmapBuilderService(
      repository as never,
      builderSessions as never,
      permissions as never,
      toggles as never,
    );
  });

  it('creates a session and asks the client to seed it', async () => {
    const result = await service.openSession(USER, OPP);

    expect(result).toMatchObject({ sessionId: SESSION, created: true });
    expect(result.seedMessage).toContain('Counsellors cannot see');
    // Asserted as IsNull(), not null: TypeORM turns a literal null here into `= NULL`, which
    // matches nothing, so the claim silently never lands and every press forks a new session.
    // That shipped once — this assertion is what stops it shipping twice.
    expect(repository.update).toHaveBeenCalledWith(
      { id: OPP, builderSessionId: IsNull() },
      expect.objectContaining({ builderSessionId: SESSION }),
    );
  });

  it('RESUMES an existing session without creating or re-seeding', async () => {
    repository.findOne = reads(opportunity({ builderSessionId: SESSION }));

    const result = await service.openSession(USER, OPP);

    // Pressing the button twice must not fork the work, and must not replay the brief into a
    // transcript that already opens with it.
    expect(result).toEqual({
      sessionId: SESSION,
      created: false,
      seedMessage: null,
    });
    expect(builderSessions.createSession).not.toHaveBeenCalled();
  });

  it('includes the PRD in the brief, under its own heading', async () => {
    repository.findOne = reads(
      opportunity({ prd: 'Must respect tenant isolation.' }),
    );

    const { seedMessage } = await service.openSession(USER, OPP);

    expect(seedMessage).toContain('## Existing PRD notes');
    expect(seedMessage).toContain('Must respect tenant isolation.');
  });

  it('omits the PRD heading entirely when there is no PRD', async () => {
    // An empty "## Existing PRD notes" tells the agent a PRD exists and is blank, which is a
    // different fact from there being none.
    const { seedMessage } = await service.openSession(USER, OPP);
    expect(seedMessage).not.toContain('## Existing PRD notes');
  });

  it('titles the session from the first line only', async () => {
    repository.findOne = reads(
      opportunity({ description: 'Skill drill-down\n\nlong detail here' }),
    );

    await service.openSession(USER, OPP);

    // The title seeds Builder's branch slug, so a whole 1000-char description would produce an
    // unreadable branch name.
    expect(builderSessions.createSession).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ title: 'Skill drill-down' }),
    );
  });

  describe('the hand-off', () => {
    const handoffPassed = (): string =>
      builderSessions.createSession.mock.calls[0][1].handoffContext;

    it("hands the session the copilot's brief and the filing interview", async () => {
      // The regression: a session handed only the description spent its first questions on
      // what the brief already recorded — "beside the session rating" was an alternative the
      // filer had dropped, and the rating's shape was in the success metric.
      repository.findOne = reads(opportunity({ brief: BRIEF }));
      transcript = TRANSCRIPT;

      await service.openSession(USER, OPP);

      const handoff = handoffPassed();
      expect(handoff).toContain('OPP-0042');
      expect(handoff).toContain('Counsellors cannot see');
      expect(handoff).toContain(
        'Rely only on the existing post-session rating',
      );
      expect(handoff).toContain('Share of debriefs marked helpful');
      expect(handoff).toContain('(PostSimulationSummary.tsx)');
      expect(handoff).toContain('ADMIN: Let learners rate the debrief itself.');
      expect(handoff).toContain('COPILOT: Beside the session rating');
    });

    it('says in the seed what came over, so the admin can see it was passed on', async () => {
      repository.findOne = reads(opportunity({ brief: BRIEF }));
      transcript = TRANSCRIPT;

      const { seedMessage } = await service.openSession(USER, OPP);

      expect(seedMessage).toContain(
        "the opportunity copilot's brief and our 3-message filing interview are in your context",
      );
    });

    it('attaches no hand-off to an opportunity filed without the copilot', async () => {
      // A quick-add's description is already the seed, and Builder frames a hand-off as "the
      // admin has answered these once" — which nothing would be true of here.
      const { seedMessage } = await service.openSession(USER, OPP);

      expect(handoffPassed()).toBeNull();
      expect(seedMessage).not.toContain('Hand-off');
    });

    it('carries the brief alone when there is no transcript', async () => {
      repository.findOne = reads(opportunity({ brief: BRIEF }));

      const { seedMessage } = await service.openSession(USER, OPP);

      expect(handoffPassed()).toContain("The opportunity copilot's brief");
      expect(handoffPassed()).not.toContain('filing interview');
      expect(seedMessage).toContain(
        "the opportunity copilot's brief is in your context",
      );
    });

    it('backfills a session opened before the hand-off existed, on the next press', async () => {
      repository.findOne = reads(
        opportunity({ builderSessionId: SESSION, brief: BRIEF }),
      );

      await service.openSession(USER, OPP);

      expect(builderSessions.attachHandoffContext).toHaveBeenCalledWith(
        SESSION,
        expect.stringContaining(
          'Rely only on the existing post-session rating',
        ),
      );
      expect(builderSessions.createSession).not.toHaveBeenCalled();
    });

    it('still opens the session when the backfill fails', async () => {
      // The press is a request to open the session; a failed write must not stand in its way.
      repository.findOne = reads(
        opportunity({ builderSessionId: SESSION, brief: BRIEF }),
      );
      builderSessions.attachHandoffContext.mockRejectedValue(new Error('db'));

      await expect(service.openSession(USER, OPP)).resolves.toMatchObject({
        sessionId: SESSION,
        created: false,
      });
    });

    it('backfills nothing for an opportunity with nothing to hand over', async () => {
      repository.findOne = reads(opportunity({ builderSessionId: SESSION }));

      await service.openSession(USER, OPP);

      expect(builderSessions.attachHandoffContext).not.toHaveBeenCalled();
    });

    it('checks Builder access before a resume, now that a resume can write', async () => {
      repository.findOne = reads(
        opportunity({ builderSessionId: SESSION, brief: BRIEF }),
      );
      toggles.hasToggle.mockResolvedValue(false);

      await expect(service.openSession(USER, OPP)).rejects.toThrow(
        ForbiddenException,
      );
      expect(builderSessions.attachHandoffContext).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['the Builder toggle is off', { toggle: false, permission: true }],
    [
      'the caller lacks edit:admin:builder',
      { toggle: true, permission: false },
    ],
  ])(
    '403s when %s, creating nothing',
    async (_label, { toggle, permission }) => {
      toggles.hasToggle.mockResolvedValue(toggle);
      permissions.getUserPermissions.mockResolvedValue(
        permission ? [PERMISSIONS.EDIT_BUILDER] : [],
      );

      await expect(service.openSession(USER, OPP)).rejects.toThrow(
        ForbiddenException,
      );
      // Roadmap manage does not imply Builder access — the roadmap route gate cannot speak for it.
      expect(builderSessions.createSession).not.toHaveBeenCalled();
    },
  );

  it('404s for an unknown opportunity', async () => {
    repository.findOne = reads(null);
    await expect(service.openSession(USER, OPP)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('keeps the winner when two presses race, rather than 500ing', async () => {
    repository.update.mockResolvedValue({ affected: 0 });
    repository.findOne = reads(
      opportunity(),
      opportunity({ builderSessionId: 'winner-id' }),
    );

    const result = await service.openSession(USER, OPP);

    expect(result).toEqual({
      sessionId: 'winner-id',
      created: false,
      seedMessage: null,
    });
  });
});
