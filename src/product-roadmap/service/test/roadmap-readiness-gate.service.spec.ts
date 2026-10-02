import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';

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
import { BugHunterRepoClassifierService } from 'src/bug-hunter/service/bug-hunter-repo-classifier.service';
import {
  RoadmapOpportunityEffort,
  RoadmapOpportunityType,
} from '../../enum/roadmap-opportunity.enum';

/**
 * The readiness GATE on `POST /opportunities`.
 *
 * Before this, `create()` validated a description length and a product goal and saved: the whole
 * checklist lived in the admin drawer's `canSave`, so a vote-tier token plus curl filed anything
 * at any size. There is no override: the blank form that offered one is gone, and a failing
 * verdict is refused for everyone.
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
        // These tests all file type=IDEA, so the classifier never runs; this
        // satisfies the constructor.
        {
          provide: BugHunterRepoClassifierService,
          useValue: {
            classifyRepo: jest
              .fn()
              .mockResolvedValue({ repo: null, rationale: '' }),
          },
        },
      ],
    }).compile();

    service = module.get(RoadmapOpportunityService);
  });

  /** The shape the controller sends: a token, and enforcement switched on. */
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

  it('files a passing draft', async () => {
    givenVerdict([]);

    await file();

    expect(opportunityRepository.save).toHaveBeenCalled();
    expect(savedRow()).toMatchObject({ description: DRAFT, productGoal: GOAL });
  });

  /**
   * The hole this closes. Previously this same call — a valid description and goal, nothing
   * else — filed the row, because the checklist only ever ran in the browser.
   */
  it('refuses a failing draft, naming what failed', async () => {
    givenVerdict(['specific', 'who_it_affects']);

    await expect(file()).rejects.toThrow(BadRequestException);
    await expect(file()).rejects.toThrow(/specific, who_it_affects/);
    expect(opportunityRepository.save).not.toHaveBeenCalled();
  });

  /**
   * The override is gone, not hidden. An admin bundle from before this change still sends
   * `readinessOverride: true` from its toggle; it must buy nothing, for a manager or anyone else.
   */
  it('refuses a failing draft even when a stale client asks to override it', async () => {
    givenVerdict(['specific']);

    await expect(
      file({ readinessOverride: true } as never, { canManage: true }),
    ).rejects.toThrow(BadRequestException);
    expect(opportunityRepository.save).not.toHaveBeenCalled();
  });

  /**
   * Size is part of the gate, and it is graded against the effort being FILED rather than the
   * one in the token, so it holds whatever the client sends.
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

    expect(savedRow()).toMatchObject({ effort: RoadmapOpportunityEffort.S });
  });

  /** Unsized is not a pass: "we could not tell how big this is" has to mean "not yet". */
  it('blocks an unsized draft', async () => {
    givenVerdict([], null);

    await expect(file({ effort: null })).rejects.toThrow(/size/);
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
    expect(opportunityRepository.save).toHaveBeenCalled();
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
