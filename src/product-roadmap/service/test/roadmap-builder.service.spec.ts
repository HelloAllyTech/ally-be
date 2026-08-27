import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { IsNull } from 'typeorm';

import { RoadmapBuilderService } from '../roadmap-builder.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

const OPP = '11111111-1111-1111-1111-111111111111';
const SESSION = '22222222-2222-2222-2222-222222222222';
const USER = 7;

describe('RoadmapBuilderService', () => {
  let service: RoadmapBuilderService;
  let repository: { findOne: jest.Mock; update: jest.Mock };
  let builderSessions: { createSession: jest.Mock };
  let permissions: { getUserPermissions: jest.Mock };
  let toggles: { hasToggle: jest.Mock };

  const opportunity = (over: Record<string, unknown> = {}) => ({
    id: OPP,
    description: 'Counsellors cannot see which sims a learner failed',
    prd: null,
    builderSessionId: null,
    ...over,
  });

  beforeEach(() => {
    repository = {
      findOne: jest.fn(async () => opportunity()),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    builderSessions = { createSession: jest.fn(async () => ({ id: SESSION })) };
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
    repository.findOne.mockResolvedValue(
      opportunity({ builderSessionId: SESSION }),
    );

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
    repository.findOne.mockResolvedValue(
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
    repository.findOne.mockResolvedValue(
      opportunity({ description: 'Skill drill-down\n\nlong detail here' }),
    );

    await service.openSession(USER, OPP);

    // The title seeds Builder's branch slug, so a whole 1000-char description would produce an
    // unreadable branch name.
    expect(builderSessions.createSession).toHaveBeenCalledWith(USER, {
      title: 'Skill drill-down',
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
    repository.findOne.mockResolvedValue(null);
    await expect(service.openSession(USER, OPP)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('keeps the winner when two presses race, rather than 500ing', async () => {
    repository.update.mockResolvedValue({ affected: 0 });
    repository.findOne
      .mockResolvedValueOnce(opportunity())
      .mockResolvedValueOnce(opportunity({ builderSessionId: 'winner-id' }));

    const result = await service.openSession(USER, OPP);

    expect(result).toEqual({
      sessionId: 'winner-id',
      created: false,
      seedMessage: null,
    });
  });
});
