import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { User } from 'src/user/entity/user.entity';
import { BugFinding } from 'src/bug-hunter/entity/bug-finding.entity';
import { S3Service } from 'src/aws/service/s3.service';
import { AppConfigService } from 'src/config/config.service';

import { RoadmapOpportunityService } from '../roadmap-opportunity.service';
import { RoadmapGoalImpactService } from '../roadmap-goal-impact.service';
import { RoadmapStrategyGoalService } from '../roadmap-strategy-goal.service';
import { RoadmapVectorService } from '../roadmap-vector.service';
import { RoadmapNotificationService } from '../roadmap-notification.service';
import { RoadmapReadinessTokenService } from '../roadmap-readiness-token.service';
import { RoadmapOpportunityRepository } from '../../repository/roadmap-opportunity.repository';
import { RoadmapAllocationRepository } from '../../repository/roadmap-allocation.repository';
import {
  RoadmapOpportunityEffort,
  RoadmapOpportunityType,
} from '../../enum/roadmap-opportunity.enum';

/**
 * The readiness GATE on `POST /opportunities`.
 *
 * Before this, `create()` validated a description length and a product goal and saved: the whole
 * checklist lived in the admin drawer's `canSave`, so a vote-tier token plus curl filed anything
 * at any size, and the "only managers may override" rule was a boolean in a React component.
 *
 * These tests are about the rule, not about the signature — RoadmapReadinessTokenService has its
 * own suite for that, and the token service is stubbed here so a verdict can be stated directly.
 */
describe('RoadmapOpportunityService — readiness gate', () => {
  const DRAFT = 'As a counsellor, I lose an hour a week assigning tracks.';
  const GOAL = 'Reliability & Trust';

  let service: RoadmapOpportunityService;
  let opportunityRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOneWithScore: jest.Mock;
  };
  let verify: jest.Mock;

  /** What the stubbed token service will report the grader said. */
  const givenVerdict = (
    failedCriteria: string[],
    proposedEffort: RoadmapOpportunityEffort | null = RoadmapOpportunityEffort.M,
  ) => verify.mockReturnValue({ failedCriteria, proposedEffort });

  beforeEach(async () => {
    opportunityRepository = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockResolvedValue({ id: 'opp-1', description: DRAFT }),
      findOneWithScore: jest.fn().mockResolvedValue({
        id: 'opp-1',
        description: DRAFT,
        type: RoadmapOpportunityType.IDEA,
        stage: 'new',
        priorityScore: 0,
        myVotes: 0,
        commentCount: 0,
        ownerDisplay: null,
      }),
    };
    verify = jest.fn();

    const module = await Test.createTestingModule({
      providers: [
        RoadmapOpportunityService,
        {
          provide: RoadmapOpportunityRepository,
          useValue: opportunityRepository,
        },
        // These tests are about the readiness gate, not voters; this satisfies the constructor.
        {
          provide: RoadmapAllocationRepository,
          useValue: { votersForOpportunity: jest.fn() },
        },
        {
          provide: RoadmapStrategyGoalService,
          useValue: {
            countGoals: jest.fn().mockResolvedValue(0),
            getRankContext: jest.fn().mockResolvedValue({
              weights: {
                votesWeight: 1,
                votersWeight: 1,
                effortWeight: 1,
                goalImpactWeight: 1,
              },
              bases: { maxScore: 0, maxVoters: 0, totalGoals: 0 },
            }),
          },
        },
        {
          provide: RoadmapGoalImpactService,
          useValue: { assessQuietly: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: RoadmapVectorService,
          useValue: { indexQuietly: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: RoadmapNotificationService, useValue: { emit: jest.fn() } },
        {
          provide: getRepositoryToken(User),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(BugFinding),
          useValue: { create: jest.fn(), save: jest.fn() },
        },
        { provide: S3Service, useValue: { parseS3Url: jest.fn() } },
        {
          provide: AppConfigService,
          useValue: { s3: { assetsBucket: 'ally-assets' } },
        },
        { provide: RoadmapReadinessTokenService, useValue: { verify } },
      ],
    }).compile();

    service = module.get(RoadmapOpportunityService);
  });

  /** The shape the controller sends: a token, and the two manage answers resolved separately. */
  const file = (
    dto: Partial<Parameters<RoadmapOpportunityService['create']>[1]> = {},
    extra: Partial<Parameters<RoadmapOpportunityService['create']>[2]> = {},
  ) =>
    service.create(
      7,
      {
        description: DRAFT,
        productGoal: GOAL,
        type: RoadmapOpportunityType.IDEA,
        effort: RoadmapOpportunityEffort.M,
        readinessToken: 'signed.verdict',
        ...dto,
      },
      { enforceReadiness: true, ...extra },
    );

  const savedRow = () => opportunityRepository.create.mock.calls[0][0];

  it('files a passing draft, with nothing stamped', async () => {
    givenVerdict([]);

    await file();

    expect(savedRow()).toMatchObject({
      readinessOverriddenBy: null,
      readinessOverriddenAt: null,
      readinessFailedCriteria: null,
    });
  });

  /**
   * The hole this closes. Previously this same call — a valid description and goal, nothing
   * else — filed the row, because the checklist only ever ran in the browser.
   */
  it('refuses a failing draft with no override, naming what failed', async () => {
    givenVerdict(['specific', 'who_it_affects']);

    await expect(file()).rejects.toThrow(BadRequestException);
    await expect(file()).rejects.toThrow(/specific, who_it_affects/);
    expect(opportunityRepository.save).not.toHaveBeenCalled();
  });

  /**
   * The permission that was decorative until now: the drawer hid the toggle from a non-manager,
   * and that was the only thing enforcing it.
   */
  it('refuses an override from a caller who cannot manage the board', async () => {
    givenVerdict(['specific']);

    await expect(
      file({ readinessOverride: true }, { canManageBoard: false }),
    ).rejects.toThrow(ForbiddenException);
    expect(opportunityRepository.save).not.toHaveBeenCalled();
  });

  /**
   * `canManageBoard`, NOT `canManage`. The permission alone sits on every platform admin since
   * the role collapse, so a rule that consulted it would grant the override to read-only admins
   * — which is exactly what the feature toggle exists to prevent.
   */
  it('is not satisfied by the permission alone', async () => {
    givenVerdict(['specific']);

    await expect(
      file(
        { readinessOverride: true },
        { canManage: true, canManageBoard: false },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('files an overridden draft and stamps who did it and what was red', async () => {
    givenVerdict(['specific']);

    await file({ readinessOverride: true }, { canManageBoard: true });

    const row = savedRow();
    expect(row.readinessOverriddenBy).toBe(7);
    expect(row.readinessOverriddenAt).toBeInstanceOf(Date);
    expect(row.readinessFailedCriteria).toEqual(['specific']);
  });

  /**
   * Size is part of the gate, and it is graded against the effort being FILED rather than the
   * one in the token — correcting a size the model got wrong is a documented exemption, since a
   * re-run would recompute the size and overwrite the correction.
   */
  it('blocks a draft sized above what may be filed, even with every criterion green', async () => {
    givenVerdict([], RoadmapOpportunityEffort.XL);

    await expect(file({ effort: RoadmapOpportunityEffort.XL })).rejects.toThrow(
      /size/,
    );
  });

  it('accepts a human correction of a size the model got wrong', async () => {
    // The grader said XL; the filer corrected it to S, which is what lands in the DTO.
    givenVerdict([], RoadmapOpportunityEffort.XL);

    await file({ effort: RoadmapOpportunityEffort.S });

    expect(savedRow()).toMatchObject({
      effort: RoadmapOpportunityEffort.S,
      readinessOverriddenBy: null,
    });
  });

  /** Unsized is not a pass: "we could not tell how big this is" has to mean "not yet". */
  it('blocks an unsized draft', async () => {
    givenVerdict([], null);

    await expect(file({ effort: null })).rejects.toThrow(/size/);
  });

  /**
   * Ignored rather than refused: there was nothing to override, and marking the row as
   * waved-through when it was not would be worse than not marking it.
   */
  it('ignores an override on a draft that passed anyway', async () => {
    givenVerdict([]);

    await file({ readinessOverride: true }, { canManageBoard: true });

    expect(savedRow()).toMatchObject({
      readinessOverriddenBy: null,
      readinessFailedCriteria: null,
    });
  });

  /**
   * The rollout leniency, and the only path here that does not enforce. It exists because
   * ally-be deploys ahead of the client and the bundle in production sends no token; the
   * warning is the signal that it is safe to flip ROADMAP_READINESS_REQUIRE_TOKEN.
   */
  it('lets a tokenless filing through for now, and says so loudly', async () => {
    const warn = jest.spyOn(
      (service as unknown as { logger: { warn: (m: string) => void } }).logger,
      'warn',
    );

    await file({ readinessToken: undefined });

    expect(verify).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no readiness token'),
    );
    expect(savedRow()).toMatchObject({ readinessOverriddenBy: null });
  });

  /**
   * A bug report shares this method and must NOT be graded: it comes from a one-prompt consumer
   * form that has never shown a checklist, and "names the user group it affects" would refuse
   * every real report.
   */
  it('does not gate a caller that does not ask for enforcement', async () => {
    await service.create(
      7,
      {
        description: 'Vote button saved 0 votes silently',
        productGoal: GOAL,
        type: RoadmapOpportunityType.BUG,
      },
      {},
    );

    expect(verify).not.toHaveBeenCalled();
    expect(opportunityRepository.save).toHaveBeenCalled();
  });
});
