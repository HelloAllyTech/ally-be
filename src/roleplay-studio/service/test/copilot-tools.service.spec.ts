import { DataSource } from 'typeorm';
import {
  CopilotToolsService,
  ToolExecutionContext,
} from '../copilot-tools.service';
import { RoleplaySpecService } from '../roleplay-spec.service';
import { SpecValidatorService } from '../spec-validator.service';
import { SpecCompilerService } from '../spec-compiler.service';
import { RoleplaySpec } from '../../entity/roleplay-spec.entity';
import { CopilotSessionMode } from '../../enum/copilot-session-mode.enum';
import { RoleplaySpecVersionSource } from '../../enum/roleplay-spec-version-source.enum';

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
    // Iteration tools are hidden while BUILDING.
    expect(names).not.toContain('get_test_session_insights');
    expect(names).not.toContain('summarize_iteration');
  });

  it('adds the iteration tools on top of the authoring tools while ITERATING', () => {
    const names = service
      .getToolDefinitions(CopilotSessionMode.ITERATING)
      .map((tool: any) => tool.name);
    // Authoring tools stay available so any part of the spec is still editable.
    expect(names).toEqual(
      expect.arrayContaining(['update_spec', 'ask_trainer', 'compile_spec']),
    );
    // ...plus the two feedback-loop tools.
    expect(names).toEqual(
      expect.arrayContaining([
        'get_test_session_insights',
        'summarize_iteration',
      ]),
    );
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

  it('summarize_iteration emits an iteration_summary card', async () => {
    const outcome = await service.execute(
      'summarize_iteration',
      {
        feedback: 'She opened up too fast',
        reasoning: 'The transition into Open needed only 2 turns.',
        changes: [
          {
            area: 'State machine',
            summary: 'Raised minTurnsInState on Guarded→Opening to 4',
          },
          { area: '', summary: '' },
        ],
        note: 'Try it again.',
      },
      { ...context, mode: CopilotSessionMode.ITERATING },
    );

    expect(outcome.modelResult.ok).toBe(true);
    const frame = (outcome.events ?? [])[0];
    expect(frame.event).toBe('iteration_summary');
    expect(frame.data.feedback).toBe('She opened up too fast');
    // Blank change entries are dropped.
    expect(frame.data.changes).toHaveLength(1);
    expect(frame.data.note).toBe('Try it again.');
  });

  it('get_test_session_insights returns empty when the spec has no scenario', async () => {
    const outcome = await service.execute(
      'get_test_session_insights',
      {},
      { ...context, mode: CopilotSessionMode.ITERATING },
    );
    expect(outcome.modelResult.ok).toBe(true);
    expect(outcome.modelResult.sessions).toEqual([]);
  });

  it('update_spec records a COPILOT_ITERATION version while ITERATING', async () => {
    const persistDraftMutation = jest
      .fn()
      .mockResolvedValue({ spec, version: { id: 'v-1' } });
    const iterationService = new CopilotToolsService(
      {
        getSpec: jest.fn().mockResolvedValue(spec),
        persistDraftMutation,
      } as unknown as RoleplaySpecService,
      mockValidator as unknown as SpecValidatorService,
      mockCompiler as unknown as SpecCompilerService,
      { getRepository: jest.fn() } as unknown as DataSource,
    );

    await iterationService.execute(
      'update_spec',
      { ops: [{ op: 'replace', path: '/title', value: 'New' }], summary: 'x' },
      { ...context, mode: CopilotSessionMode.ITERATING },
    );

    expect(persistDraftMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      USER_ID,
      RoleplaySpecVersionSource.COPILOT_ITERATION,
      expect.any(String),
    );
  });
});
