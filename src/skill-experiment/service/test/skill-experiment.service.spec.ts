import { BadRequestException, ConflictException } from '@nestjs/common';
import { SkillExperimentService } from '../skill-experiment.service';
import {
  SkillExperimentEventType,
  SkillExperimentStatus,
} from '../../enum/skill-experiment.enum';
import { ExecutionManager } from 'src/common/execution/execution-manager';

const PROMPT = {
  id: 'prompt-1',
  promptCode: 'track_quiz_open_ended_grading_user',
  name: 'Quiz grader',
  description: '',
};
const RUBRIC = [{ key: 'fair', name: 'Fair', description: 'Fair', weight: 1 }];

function harness(experiment: Record<string, unknown> | null, prompt = PROMPT) {
  const row = experiment
    ? {
        id: 'exp-1',
        promptId: 'prompt-1',
        promptCode: PROMPT.promptCode,
        status: SkillExperimentStatus.OFF,
        run: 0,
        rubric: RUBRIC,
        minSamplesPerVariant: 30,
        maxVariants: 8,
        targetScore: 85,
        judgeModel: null,
        ...experiment,
      }
    : null;
  const state: any = {
    experiments: {
      findOneBy: jest.fn(async () => (row ? { ...row } : null)),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => ({ id: 'exp-1', ...v })),
      find: jest.fn(async () => (row ? [row] : [])),
      query: jest.fn(async () => []),
    },
    variants: {
      findOneBy: jest.fn(),
      find: jest.fn(async () => []),
      update: jest.fn(),
    },
    observations: { count: jest.fn(async () => 0) },
    events: { find: jest.fn(async () => []) },
    currentSkillText: jest.fn(async () => 'Grade {{answer}}'),
    beginRun: jest.fn(async () => true),
    guardedUpdate: jest.fn(async () => true),
    retireLiveVariants: jest.fn(),
    abandonPending: jest.fn(),
    logEvent: jest.fn(),
  };
  const router = { invalidate: jest.fn() };
  const promptsService = { updatePrompt: jest.fn(async () => true) };
  const prompts = { findOneBy: jest.fn(async () => prompt), find: jest.fn() };
  const service = new SkillExperimentService(
    state,
    router as any,
    promptsService as any,
    prompts as any,
  );
  return { service, state, router, promptsService };
}

describe('SkillExperimentService', () => {
  beforeEach(() => {
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('42');
  });
  afterEach(() => jest.restoreAllMocks());

  describe('configure', () => {
    it('refuses a skill that does not report its outputs', async () => {
      const { service } = harness(null, {
        ...PROMPT,
        promptCode: 'some_other_skill',
      });
      await expect(service.configure('prompt-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates an experiment starting from the suggested rubric', async () => {
      const { service, state } = harness(null);
      await service.configure('prompt-1', { targetScore: 90 });
      const saved = state.experiments.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        status: SkillExperimentStatus.OFF,
        targetScore: 90,
        updatedBy: 42,
      });
      expect(saved.rubric.length).toBeGreaterThan(0);
    });

    it('refuses to change the rubric while a run is live', async () => {
      const { service } = harness({ status: SkillExperimentStatus.TESTING });
      await expect(
        service.configure('prompt-1', {
          rubric: [{ ...RUBRIC[0], weight: 3 }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('lets thresholds change while a run is live', async () => {
      const { service, state } = harness({
        status: SkillExperimentStatus.TESTING,
      });
      await service.configure('prompt-1', {
        rubric: RUBRIC,
        challengerTrafficPercent: 10,
      });
      expect(state.experiments.save).toHaveBeenCalledWith(
        expect.objectContaining({ challengerTrafficPercent: 10 }),
      );
    });

    it('refuses duplicate rubric keys', async () => {
      const { service } = harness(null);
      await expect(
        service.configure('prompt-1', { rubric: [RUBRIC[0], RUBRIC[0]] }),
      ).rejects.toThrow(/unique key/);
    });
  });

  describe('start', () => {
    it('needs a saved experiment first', async () => {
      const { service } = harness(null);
      await expect(service.start('prompt-1')).rejects.toThrow(/rubric/);
    });

    it('snapshots the current skill text into a new run', async () => {
      const { service, state } = harness({});
      await service.start('prompt-1');
      expect(state.beginRun).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'exp-1' }),
        'Grade {{answer}}',
        [SkillExperimentStatus.OFF],
        expect.objectContaining({
          type: SkillExperimentEventType.STARTED,
          actorId: 42,
        }),
      );
    });

    it('refuses to start twice', async () => {
      const { service } = harness({ status: SkillExperimentStatus.BASELINE });
      await expect(service.start('prompt-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('apply', () => {
    it('refuses when the original is still the best version', async () => {
      const { service, state } = harness({
        status: SkillExperimentStatus.PAUSED,
        championVariantId: 'v-0',
      });
      state.variants.findOneBy.mockResolvedValue({
        id: 'v-0',
        isOriginal: true,
      });
      await expect(service.apply('prompt-1')).rejects.toThrow(
        /nothing to apply/,
      );
    });

    it('stops the experiment, then writes the winner as a new skill version', async () => {
      const { service, state, promptsService } = harness({
        status: SkillExperimentStatus.PAUSED,
        championVariantId: 'v-2',
      });
      state.variants.findOneBy.mockResolvedValue({
        id: 'v-2',
        label: 'V2',
        isOriginal: false,
        content: 'Better {{answer}}',
        meanScore: 88,
      });
      const order: string[] = [];
      state.guardedUpdate.mockImplementation(async () => {
        order.push('stop');
        return true;
      });
      promptsService.updatePrompt.mockImplementation(async () => {
        order.push('write');
        return true;
      });

      await service.apply('prompt-1');

      expect(order).toEqual(['stop', 'write']);
      expect(promptsService.updatePrompt).toHaveBeenCalledWith('prompt-1', {
        prompt: 'Better {{answer}}',
        useDashboardOverride: true,
      });
      expect(state.logEvent).toHaveBeenCalledWith(
        'exp-1',
        SkillExperimentEventType.APPLIED,
        expect.stringContaining('V2'),
        expect.objectContaining({ actorId: 42 }),
      );
    });
  });

  it('resume resets the per-run budget', async () => {
    const { service, state } = harness({
      status: SkillExperimentStatus.PAUSED,
    });
    await service.resume('prompt-1');
    expect(state.guardedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'exp-1' }),
      [SkillExperimentStatus.PAUSED],
      expect.objectContaining({
        status: SkillExperimentStatus.TESTING,
        variantsDrafted: 0,
        consecutiveLosses: 0,
      }),
    );
  });
});
