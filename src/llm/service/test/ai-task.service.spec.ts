import { Test, TestingModule } from '@nestjs/testing';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { AppConfigService } from 'src/config/config.service';
import {
  AI_TASK_REGISTRY,
  AI_TASK_REGISTRY_EXEMPT_TASKS,
} from '../../constants/ai-task-registry.constants';
import { AiTaskModelSource } from '../../dto/ai-task.dto';
import { AiTaskService } from '../ai-task.service';

/**
 * These are the guards that make "keep the AI task registry updated" a rule the
 * build enforces rather than a rule the docs assert. Read the failure messages
 * as instructions: each one names the file to edit.
 */

/**
 * A ConfigService stand-in exposing only the getters registry rows point at.
 * Deliberately NOT the real ConfigService: this suite must fail when a
 * `configPath` names a getter that no longer exists, and a real ConfigService
 * reading a real .env would mask exactly that.
 */
const configStub = {
  openai: {
    autofillModel: 'gpt-5-mini',
    translationModel: 'gpt-4o-mini',
    transcriptionModel: 'whisper-1',
    imageModel: 'gpt-image-1',
  },
  anthropic: {
    autofillModel: 'claude-sonnet-4-6',
    suggestionsModel: 'claude-sonnet-4-6',
  },
  roleplayStudio: { copilotModel: 'claude-sonnet-4-6' },
  characterInterview: { model: 'claude-sonnet-4-6' },
  promptTranslation: { defaultModel: 'gemini-2.5-pro' },
  aiChat: { model: 'gpt-4o-mini' },
  builder: {
    interviewModel: 'claude-sonnet-5',
    plannerModel: 'claude-opus-5',
    coderModel: 'claude-sonnet-5',
    verifierModel: 'claude-opus-5',
    mechanicalModel: 'claude-haiku-4-5',
  },
};

describe('AiTaskService', () => {
  let service: AiTaskService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiTaskService,
        { provide: AppConfigService, useValue: configStub },
      ],
    }).compile();

    service = module.get<AiTaskService>(AiTaskService);
  });

  describe('registry coverage', () => {
    it('has a row for every LlmTask that is not explicitly exempt', () => {
      const covered = new Set(
        AI_TASK_REGISTRY.map((entry) => entry.task).filter(
          (task): task is LlmTask => task !== null,
        ),
      );

      const missing = Object.values(LlmTask).filter(
        (task) =>
          !AI_TASK_REGISTRY_EXEMPT_TASKS.has(task) && !covered.has(task),
      );

      expect(missing).toEqual([]);
      // If this failed: you added a task label but no row describing the call.
      // Add one to src/llm/constants/ai-task-registry.constants.ts — see
      // docs/ai-task-registry.md. Exempting it instead needs a reason in the
      // AI_TASK_REGISTRY_EXEMPT_TASKS comment.
    });

    it('uses a unique id per row', () => {
      const ids = AI_TASK_REGISTRY.map((entry) => entry.id);
      expect(ids).toHaveLength(new Set(ids).size);
      // Ids are the table's row keys and are referenced from outside; reusing
      // one for a different call silently rewrites history.
    });

    it('names a real prompt code on every row that claims a prompt override', () => {
      // A prompt code that does not exist sends an admin looking for a row that
      // is not there — worse than saying nothing. Free-text descriptions ("the
      // field's own prompt row") are allowed for calls whose prompt varies per
      // invocation; anything that LOOKS like a code must be shaped like one.
      const malformed = AI_TASK_REGISTRY.filter((entry) => entry.promptOverride)
        .filter((entry) => {
          const value = entry.promptOverride!;
          const looksLikeCode = !value.includes(' ');
          return looksLikeCode && !/^[a-z][a-z0-9_]*$/.test(value);
        })
        .map((entry) => `${entry.id} -> ${entry.promptOverride}`);

      expect(malformed).toEqual([]);
    });

    it('does not claim a fixed vendor for a call whose provider is set per prompt', () => {
      // A row can name a prompt override AND a provider only when every model
      // that prompt row can select belongs to that same vendor. Where it cannot
      // — the character interview runs Anthropic, OpenAI or Gemini — the row
      // must say `resolved` rather than assert a vendor it cannot guarantee.
      const characterInterview = AI_TASK_REGISTRY.find(
        (entry) => entry.id === 'character-interview',
      );

      expect(characterInterview?.provider).toBe('resolved');
      expect(characterInterview?.promptOverride).toBe(
        'character_interview_interviewer_system',
      );
    });

    it('describes every row with a trigger and a model', () => {
      const incomplete = AI_TASK_REGISTRY.filter(
        (entry) =>
          !entry.trigger.trim() ||
          !entry.defaultModel.trim() ||
          !entry.configuredBy.trim(),
      ).map((entry) => entry.id);

      expect(incomplete).toEqual([]);
    });
  });

  describe('config resolution', () => {
    it('resolves every configPath in the registry', () => {
      const unresolved = AI_TASK_REGISTRY.filter((entry) => entry.configPath)
        .filter((entry) => {
          const [getter, property] = entry.configPath!.split('.');
          const section = (configStub as Record<string, any>)[getter];
          return !section || typeof section[property] !== 'string';
        })
        .map((entry) => `${entry.id} -> ${entry.configPath}`);

      expect(unresolved).toEqual([]);
      // If this failed: a config getter was renamed and a registry row still
      // points at the old name. The service degrades to the documented default
      // rather than throwing, so nothing else would have told you.
    });

    it('marks ally-be rows as resolved from this deployment', () => {
      const autofill = service
        .getTasks()
        .find((task) => task.id === 'autofill-field');

      expect(autofill?.effectiveModel).toBe('gpt-5-mini');
      expect(autofill?.modelSource).toBe(AiTaskModelSource.DEPLOYMENT);
    });

    it('marks rows another service executes as documented, not resolved', () => {
      const agentTurn = service
        .getTasks()
        .find((task) => task.id === 'agent-turn');

      expect(agentTurn?.modelSource).toBe(AiTaskModelSource.DOCUMENTED);
      expect(agentTurn?.effectiveModel).toBe(agentTurn?.defaultModel);
    });

    it('falls back to the documented default when a path goes stale', () => {
      const stale = new AiTaskService({} as AppConfigService);
      const rows = stale.getTasks();

      expect(rows.every((row) => Boolean(row.effectiveModel))).toBe(true);
      expect(
        rows.every((row) => row.modelSource === AiTaskModelSource.DOCUMENTED),
      ).toBe(true);
    });
  });
});
