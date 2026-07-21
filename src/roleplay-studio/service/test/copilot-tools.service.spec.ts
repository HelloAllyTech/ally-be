import { DataSource } from 'typeorm';
import {
  CopilotToolsService,
  ToolExecutionContext,
} from '../copilot-tools.service';
import { RoleplaySpecService } from '../roleplay-spec.service';
import { SpecValidatorService } from '../spec-validator.service';
import { SpecCompilerService } from '../spec-compiler.service';
import { RoleplaySpec } from '../../entity/roleplay-spec.entity';

const SPEC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = 42;

describe('CopilotToolsService — tool belt', () => {
  let service: CopilotToolsService;
  let context: ToolExecutionContext;
  let mockValidator: Record<string, jest.Mock>;
  let mockCompiler: Record<string, jest.Mock>;

  const spec = {
    id: SPEC_ID,
    draftSpec: { title: 'Spec' },
  } as unknown as RoleplaySpec;

  beforeEach(() => {
    mockValidator = {
      validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
      validateStructure: jest.fn().mockReturnValue([]),
    };
    mockCompiler = {
      compileWithInfo: jest
        .fn()
        .mockReturnValue({ sizeBytes: 128, inline: true }),
    };

    service = new CopilotToolsService(
      {
        getSpec: jest.fn().mockResolvedValue(spec),
      } as unknown as RoleplaySpecService,
      mockValidator as unknown as SpecValidatorService,
      mockCompiler as unknown as SpecCompilerService,
      { getRepository: jest.fn() } as unknown as DataSource,
    );

    context = {
      spec,
      sessionId: SESSION_ID,
      userId: USER_ID,
      appliedPatches: [],
      lastSpecVersionId: null,
    };
  });

  it('exposes only the build/authoring tools; rehearsal + auto-improve tools are gone', () => {
    const names = service.getToolDefinitions().map((tool: any) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'update_spec',
        'ask_trainer',
        'pick_voice',
        'get_competencies',
        'get_competency_behaviours',
        'review_behaviours',
        'get_languages',
        'compile_spec',
      ]),
    );
    for (const removed of [
      'suggest_test_cases',
      'get_agent_test_cases',
      'get_rehearsal_findings',
      'get_improvement_run_status',
      'start_auto_improve',
      'resolve_improvement_run',
      'propose_rehearsal',
    ]) {
      expect(names).not.toContain(removed);
    }
  });

  it('compile_spec reports validation + payload size', async () => {
    const outcome = await service.execute('compile_spec', {}, context);
    expect(outcome.modelResult).toEqual(
      expect.objectContaining({ ok: true, valid: true, inline: true }),
    );
  });

  it('returns an error for a removed/unknown tool', async () => {
    const outcome = await service.execute('start_auto_improve', {}, context);
    expect(outcome.modelResult.ok).toBe(false);
    expect(outcome.summary).toContain('Unknown tool');
  });
});
