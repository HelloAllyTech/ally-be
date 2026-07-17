import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LabRunService } from '../lab-run.service';
import { LabRunRepository } from '../../repository/lab-run.repository';
import { LabSkillRepository } from '../../repository/lab-skill.repository';
import { LabRunAssignmentRepository } from '../../repository/lab-eval.repositories';
import { AppConfigService } from 'src/config/config.service';
import { LabRunStatus } from '../../entity/lab-run.entity';

describe('LabRunService', () => {
  let service: LabRunService;
  let skillRepository: { findOne: jest.Mock };
  let runRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    skillRepository = { findOne: jest.fn() };
    runRepository = {
      // create() returns whatever we pass so the service can mutate it in place.
      create: jest.fn((entity) => entity),
      save: jest.fn(async (entity) => entity),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    const configService = {
      anthropic: { apiKey: 'test-key', autofillModel: 'claude-default' },
      openai: { apiKey: 'test-key' },
    } as unknown as AppConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LabRunService,
        { provide: LabRunRepository, useValue: runRepository },
        { provide: LabSkillRepository, useValue: skillRepository },
        {
          provide: LabRunAssignmentRepository,
          useValue: { createQueryBuilder: jest.fn() },
        },
        { provide: AppConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<LabRunService>(LabRunService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('resolvePrompt', () => {
    const resolve = (
      content: string,
      values: { name: string; value: string }[],
    ) =>
      (
        service as unknown as {
          resolvePrompt: (
            c: string,
            v: { name: string; value: string }[],
          ) => string;
        }
      ).resolvePrompt(content, values);

    it('substitutes placeholders, tolerating surrounding whitespace and repeats', () => {
      expect(
        resolve('Hi {{name}} — {{ name }}!', [{ name: 'name', value: 'Bob' }]),
      ).toBe('Hi Bob — Bob!');
    });

    it('treats a dotted variable name literally (regex-escaped)', () => {
      expect(
        resolve('{{user.name}} vs {{userXname}}', [
          { name: 'user.name', value: 'Q' },
        ]),
      ).toBe('Q vs {{userXname}}');
    });
  });

  describe('create', () => {
    const dto = {
      skillId: 'sk1',
      variableValues: [{ name: 'name', value: 'Bob' }],
    };

    it('resolves the prompt and marks the run COMPLETED on a successful model call', async () => {
      skillRepository.findOne.mockResolvedValue({
        id: 'sk1',
        name: 'Greeter',
        content: 'Hi {{name}}',
        model: 'claude-x',
      });
      jest
        .spyOn(service as never, 'runModel')
        .mockResolvedValue({ text: 'hello Bob', usage: null } as never);

      const run = await service.create(dto);

      expect(run.status).toBe(LabRunStatus.COMPLETED);
      expect(run.resolvedPrompt).toBe('Hi Bob');
      expect(run.output).toBe('hello Bob');
      expect(run.error).toBeUndefined();
    });

    it('records token usage and estimated cost from a priced model', async () => {
      skillRepository.findOne.mockResolvedValue({
        id: 'sk1',
        name: 'Greeter',
        content: 'x',
        model: 'claude-sonnet-4-6',
      });
      jest.spyOn(service as never, 'runModel').mockResolvedValue({
        text: 'ok',
        usage: { promptTokens: 1000, completionTokens: 500 },
      } as never);

      const run = await service.create({ skillId: 'sk1' });

      expect(run.totalTokens).toBe(1500);
      // 1000/1e6*3 + 500/1e6*15 = 0.0105
      expect(Number(run.costUsd)).toBeCloseTo(0.0105, 6);
    });

    it('records a FAILED run (without throwing) when the model call errors', async () => {
      skillRepository.findOne.mockResolvedValue({
        id: 'sk1',
        name: 'Greeter',
        content: 'Hi {{name}}',
        model: 'claude-x',
      });
      jest
        .spyOn(service as never, 'runModel')
        .mockRejectedValue(new Error('LLM down') as never);

      const run = await service.create(dto);

      expect(run.status).toBe(LabRunStatus.FAILED);
      expect(run.error).toBe('LLM down');
    });

    it('falls back to the default model when the skill has none', async () => {
      skillRepository.findOne.mockResolvedValue({
        id: 'sk1',
        name: 'Greeter',
        content: 'x',
        model: null,
      });
      const spy = jest
        .spyOn(service as never, 'runModel')
        .mockResolvedValue({ text: 'ok', usage: null } as never);

      const run = await service.create({ skillId: 'sk1' });

      expect(run.model).toBe('claude-default');
      expect(spy).toHaveBeenCalledWith(
        'claude-default',
        'x',
        expect.any(Object),
      );
    });

    it('throws NotFoundException for an unknown skill', async () => {
      skillRepository.findOne.mockResolvedValue(null);
      await expect(
        service.create({ skillId: 'missing' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
