import { SkillExperimentRouterService } from '../skill-experiment-router.service';
import {
  SkillExperimentStatus,
  SkillObservationStatus,
} from '../../enum/skill-experiment.enum';
import { LoggerService } from 'src/logger/logger.service';

const CODE = 'track_quiz_open_ended_grading_user';

function harness(experiment: Record<string, unknown> | null, pending = 0) {
  const experiments = {
    find: jest.fn(async () =>
      experiment
        ? [
            {
              id: 'exp-1',
              promptCode: CODE,
              status: SkillExperimentStatus.TESTING,
              championVariantId: 'v-0',
              challengerVariantId: 'v-1',
              challengerTrafficPercent: 30,
              ...experiment,
            },
          ]
        : [],
    ),
  };
  const variants = {
    find: jest.fn(async () => [
      { id: 'v-0', content: 'ORIGINAL', isOriginal: true },
      { id: 'v-1', content: 'VARIANT', isOriginal: false },
    ]),
  };
  const observations = {
    insert: jest.fn(async () => undefined),
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(async () =>
        pending ? [{ experimentId: 'exp-1', count: String(pending) }] : [],
      ),
    })),
  };
  const router = new SkillExperimentRouterService(
    experiments as any,
    variants as any,
    observations as any,
  );
  return { router, experiments, observations };
}

describe('SkillExperimentRouterService', () => {
  beforeEach(() => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('never touches the database for a skill that is not connected', async () => {
    const { router, experiments } = harness({});
    expect(await router.assign('some_other_skill')).toBeNull();
    expect(experiments.find).not.toHaveBeenCalled();
  });

  it('returns null when no experiment is live for the skill', async () => {
    const { router } = harness(null);
    expect(await router.assign(CODE)).toBeNull();
  });

  it('splits traffic by the challenger share', async () => {
    const { router } = harness({});
    const random = jest.spyOn(Math, 'random');
    random.mockReturnValueOnce(0.29);
    expect((await router.assign(CODE))?.variantId).toBe('v-1');
    random.mockReturnValueOnce(0.31);
    const arm = await router.assign(CODE);
    expect(arm).toMatchObject({
      variantId: 'v-0',
      content: 'ORIGINAL',
      isOriginal: true,
      record: true,
    });
  });

  it('serves the champion to everyone, without recording, while paused', async () => {
    const { router } = harness({
      status: SkillExperimentStatus.PAUSED,
      championVariantId: 'v-1',
      challengerVariantId: null,
    });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    expect(await router.assign(CODE)).toMatchObject({
      variantId: 'v-1',
      content: 'VARIANT',
      record: false,
    });
  });

  it('stops recording when the judge backlog is full', async () => {
    const { router } = harness({}, 500);
    expect((await router.assign(CODE))?.record).toBe(false);
  });

  it('reads live experiments once per cache window', async () => {
    const { router, experiments } = harness({});
    await router.assign(CODE);
    await router.assign(CODE);
    expect(experiments.find).toHaveBeenCalledTimes(1);
    router.invalidate();
    await router.assign(CODE);
    expect(experiments.find).toHaveBeenCalledTimes(2);
  });

  it('serves the skill as usual if the lookup fails', async () => {
    const { router, experiments } = harness({});
    experiments.find.mockRejectedValueOnce(new Error('db down'));
    expect(await router.assign(CODE)).toBeNull();
  });

  it('records an output as a pending observation, truncating huge fields', async () => {
    const { router, observations } = harness({});
    await router.record(
      {
        experimentId: 'exp-1',
        variantId: 'v-1',
        promptCode: CODE,
        content: 'VARIANT',
        isOriginal: false,
        record: true,
      },
      { input: { answer: 'x'.repeat(40_000) }, output: '{}', tenantId: 't-1' },
    );
    const row = (observations.insert.mock.calls[0] as any)[0];
    expect(row).toMatchObject({
      experimentId: 'exp-1',
      variantId: 'v-1',
      tenantId: 't-1',
      output: '{}',
      status: SkillObservationStatus.PENDING,
    });
    expect(row.input.answer.length).toBeLessThan(31_000);
  });

  it('records nothing for a null arm or a non-recording arm, and never throws', async () => {
    const { router, observations } = harness({});
    await router.record(null, { input: {} });
    await router.record(
      {
        experimentId: 'e',
        variantId: 'v',
        promptCode: CODE,
        content: '',
        isOriginal: true,
        record: false,
      },
      { input: {} },
    );
    expect(observations.insert).not.toHaveBeenCalled();
    observations.insert.mockRejectedValueOnce(new Error('db down'));
    await expect(
      router.record(
        {
          experimentId: 'e',
          variantId: 'v',
          promptCode: CODE,
          content: '',
          isOriginal: true,
          record: true,
        },
        { input: {} },
      ),
    ).resolves.toBeUndefined();
  });
});
