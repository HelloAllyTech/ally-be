import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioVoices } from 'src/learn/entity/scenario-voices.entity';
import { Competency } from 'src/learn/entity/competency.entity';
import { RoleplaySpec } from '../entity/roleplay-spec.entity';
import { RoleplaySpecService } from './roleplay-spec.service';
import { SpecValidatorService } from './spec-validator.service';
import { SpecCompilerService } from './spec-compiler.service';
import { RoleplaySpecVersionSource } from '../enum/roleplay-spec-version-source.enum';
import {
  applyJsonPatch,
  JsonPatchError,
  JsonPatchOp,
} from '../util/json-patch.util';
import { ToolExecutionOutcome } from '../type/copilot-sse-event.type';
import {
  REHEARSAL_DEFAULT_TURNS_PER_PROFILE,
  REHEARSAL_TRAINEE_PROFILES,
} from '../constants/roleplay-studio.constants';

/** Mutable per-turn context threaded through tool executions. */
export interface ToolExecutionContext {
  spec: RoleplaySpec;
  userId: number;
  /** Patches applied so far this turn (spec_patch payloads). */
  appliedPatches: Record<string, any>[];
  /** Latest snapshot id produced this turn (for the done frame). */
  lastSpecVersionId: string | null;
}

/**
 * The copilot's tool belt. Definitions are plain Anthropic tool JSON; every
 * execution returns a ToolExecutionOutcome (model-facing result + SSE frames
 * + endTurn flag) so the orchestrator stays a dumb loop.
 *
 * update_spec is the only mutating tool: it applies an RFC-6902 subset patch
 * to the draft, validates the result, and on success persists BOTH the draft
 * and an immutable version snapshot — which is why patches survive an
 * aborted turn. Validation failures return `ok:false` with the error list so
 * the model can self-repair without touching the stored draft.
 */
@Injectable()
export class CopilotToolsService {
  private readonly logger = LoggerService.getInstance(CopilotToolsService.name);

  constructor(
    private readonly roleplaySpecService: RoleplaySpecService,
    private readonly specValidator: SpecValidatorService,
    private readonly specCompiler: SpecCompilerService,
    private readonly dataSource: DataSource,
  ) {}

  getToolDefinitions(): any[] {
    return [
      {
        name: 'update_spec',
        description:
          'Apply an RFC-6902 patch (add/replace/remove only) to the current draft spec document. ' +
          'Use small, incremental patches — one concern per call. The result is validated; on ' +
          'failure you get the structured error list back and MUST self-repair with a corrected patch.',
        input_schema: {
          type: 'object',
          properties: {
            ops: {
              type: 'array',
              description: 'RFC-6902 operations (add | replace | remove)',
              items: {
                type: 'object',
                properties: {
                  op: { type: 'string', enum: ['add', 'replace', 'remove'] },
                  path: { type: 'string', description: 'JSON pointer' },
                  value: { description: 'Value for add/replace' },
                },
                required: ['op', 'path'],
              },
            },
            summary: {
              type: 'string',
              description: 'One-line human summary of what this patch changes',
            },
          },
          required: ['ops', 'summary'],
        },
      },
      {
        name: 'ask_trainer',
        description:
          'Ask the trainer ONE question and wait for their answer (the turn ends). ' +
          'Ask exactly one question at a time; prefer choice questions when options are natural.',
        input_schema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The question to ask' },
            kind: { type: 'string', enum: ['freeText', 'choice'] },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Choices when kind=choice',
            },
          },
          required: ['prompt', 'kind'],
        },
      },
      {
        name: 'suggest_test_cases',
        description:
          'Propose agent test cases (behavioral checks for the actor) for the trainer to accept. ' +
          'Nothing is persisted here — the trainer accepts via the studio UI.',
        input_schema: {
          type: 'object',
          properties: {
            suggestions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  category: { type: 'string' },
                  description: { type: 'string' },
                  condition: {
                    type: 'string',
                    description: 'When/if condition the case exercises',
                  },
                  test: {
                    type: 'string',
                    description: 'What the judge should verify',
                  },
                },
                required: ['title', 'category'],
              },
            },
          },
          required: ['suggestions'],
        },
      },
      {
        name: 'pick_voice',
        description:
          'List active TTS voices for a language so a voice id can be written into ' +
          'voice.languageVoices via update_spec.',
        input_schema: {
          type: 'object',
          properties: {
            languageId: { type: 'number' },
          },
          required: ['languageId'],
        },
      },
      {
        name: 'get_competencies',
        description: 'List available competencies (id + name).',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'compile_spec',
        description:
          'Fully validate the current draft (including catalog checks) and report the compiled ' +
          'runtime payload size. Use before proposing publish or rehearsal.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'propose_rehearsal',
        description:
          'Propose an automated rehearsal of the current draft to the trainer (they start it ' +
          'from the studio UI). No side effects.',
        input_schema: {
          type: 'object',
          properties: {
            turnsPerProfile: { type: 'number' },
            rationale: { type: 'string' },
          },
        },
      },
    ];
  }

  async execute(
    name: string,
    input: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutcome> {
    switch (name) {
      case 'update_spec':
        return this.executeUpdateSpec(input, context);
      case 'ask_trainer':
        return this.executeAskTrainer(input);
      case 'suggest_test_cases':
        return this.executeSuggestTestCases(input);
      case 'pick_voice':
        return this.executePickVoice(input);
      case 'get_competencies':
        return this.executeGetCompetencies();
      case 'compile_spec':
        return this.executeCompileSpec(context);
      case 'propose_rehearsal':
        return this.executeProposeRehearsal(input);
      default:
        return {
          modelResult: { ok: false, error: `Unknown tool "${name}"` },
          summary: `Unknown tool "${name}"`,
        };
    }
  }

  private async executeUpdateSpec(
    input: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutcome> {
    const ops = (input?.ops ?? []) as JsonPatchOp[];
    const summary =
      typeof input?.summary === 'string' && input.summary.trim()
        ? input.summary.trim()
        : 'Spec updated';

    let nextDraft;
    try {
      nextDraft = applyJsonPatch(context.spec.draftSpec, ops);
    } catch (error) {
      if (error instanceof JsonPatchError) {
        return {
          modelResult: {
            ok: false,
            error: 'patch_failed',
            message: error.message,
            opIndex: error.opIndex ?? null,
          },
          summary: `Patch failed: ${error.message}`,
        };
      }
      throw error;
    }

    // Structural/referential validation only — catalog checks run at
    // compile/publish so an in-progress draft can reference a voice the
    // trainer hasn't picked yet without blocking every intermediate patch.
    const validation = this.specValidator.validateStructure(nextDraft);
    const blocking = validation.filter(
      (issue) => !this.isIncompletenessError(issue.code),
    );
    if (blocking.length > 0) {
      return {
        modelResult: {
          ok: false,
          error: 'validation_failed',
          message:
            'The patch produced an invalid spec. Fix these and retry with a corrected patch.',
          errors: blocking,
        },
        summary: `Patch rejected: ${blocking.length} validation error(s)`,
      };
    }

    const patchId = uuidv4();
    const { spec: savedSpec, version } =
      await this.roleplaySpecService.persistDraftMutation(
        context.spec,
        nextDraft,
        context.userId,
        RoleplaySpecVersionSource.COPILOT_PATCH,
        patchId,
      );
    // Thread the fresh row (updatedAt!) through the rest of the turn.
    context.spec = savedSpec;
    context.lastSpecVersionId = version.id;

    const patchPayload = {
      patchId,
      summary,
      ops,
      specVersionId: version.id,
    };
    context.appliedPatches.push(patchPayload);

    this.logger.info(
      `Copilot patch applied: spec=${savedSpec.id} version=${version.id} ops=${ops.length}`,
    );
    return {
      modelResult: {
        ok: true,
        specVersionId: version.id,
        remainingIssues: validation, // incompleteness notes, informational
      },
      summary,
      events: [{ event: 'spec_patch', data: patchPayload }],
    };
  }

  /**
   * Error codes that just mean "the draft isn't finished yet" (missing
   * sections). These never block a patch — only genuine inconsistencies
   * (dangling refs, bad enums, state-count bounds when states exist…) do.
   */
  private isIncompletenessError(code: string): boolean {
    return code === 'required';
  }

  private executeAskTrainer(input: Record<string, any>): ToolExecutionOutcome {
    const questionId = uuidv4();
    const kind = input?.kind === 'choice' ? 'choice' : 'freeText';
    const question = {
      id: questionId,
      prompt: String(input?.prompt ?? ''),
      kind,
      ...(kind === 'choice' && Array.isArray(input?.options)
        ? { options: input.options.map(String) }
        : {}),
    };
    return {
      modelResult: {
        ok: true,
        questionId,
        note: 'Question delivered; the trainer will answer in their next message.',
      },
      summary: `Asked: ${question.prompt}`,
      events: [{ event: 'question', data: question }],
      endTurn: true,
    };
  }

  private executeSuggestTestCases(
    input: Record<string, any>,
  ): ToolExecutionOutcome {
    const suggestions = Array.isArray(input?.suggestions)
      ? input.suggestions
      : [];
    return {
      modelResult: {
        ok: true,
        count: suggestions.length,
        note: 'Suggestions surfaced to the trainer; accepted ones are persisted via the studio.',
      },
      summary: `Suggested ${suggestions.length} test case(s): ${suggestions
        .map((suggestion: any) => suggestion?.title)
        .filter(Boolean)
        .join(', ')}`,
    };
  }

  private async executePickVoice(
    input: Record<string, any>,
  ): Promise<ToolExecutionOutcome> {
    const languageId = Number(input?.languageId);
    if (!Number.isFinite(languageId)) {
      return {
        modelResult: { ok: false, error: 'languageId must be a number' },
        summary: 'pick_voice failed: invalid languageId',
      };
    }
    const voices = await this.dataSource
      .getRepository(ScenarioVoices)
      .find({ where: { languageId, active: true } });
    return {
      modelResult: {
        ok: true,
        voices: voices.map((voice) => ({
          id: voice.id,
          name: voice.name,
          provider: voice.provider,
          languageId: voice.languageId,
        })),
      },
      summary: `Found ${voices.length} active voice(s) for language ${languageId}`,
    };
  }

  private async executeGetCompetencies(): Promise<ToolExecutionOutcome> {
    const competencies = await this.dataSource
      .getRepository(Competency)
      .find({ where: { isCustom: false }, order: { name: 'ASC' }, take: 100 });
    return {
      modelResult: {
        ok: true,
        competencies: competencies.map((competency) => ({
          id: competency.id,
          name: competency.name,
        })),
      },
      summary: `Listed ${competencies.length} competencies`,
    };
  }

  private async executeCompileSpec(
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutcome> {
    const validation = await this.specValidator.validate(
      context.spec.draftSpec,
    );
    const info = this.specCompiler.compileWithInfo(context.spec.draftSpec);
    return {
      modelResult: {
        ok: validation.valid,
        valid: validation.valid,
        errors: validation.errors,
        sizeBytes: info.sizeBytes,
        inline: info.inline,
      },
      summary: validation.valid
        ? `Spec compiles cleanly (${info.sizeBytes} bytes, ${
            info.inline ? 'inlineable' : 'needs specFetch'
          })`
        : `Spec has ${validation.errors.length} validation issue(s)`,
    };
  }

  private executeProposeRehearsal(
    input: Record<string, any>,
  ): ToolExecutionOutcome {
    const proposal = {
      traineeProfiles: REHEARSAL_TRAINEE_PROFILES,
      turnsPerProfile:
        Number(input?.turnsPerProfile) || REHEARSAL_DEFAULT_TURNS_PER_PROFILE,
      rationale: input?.rationale ?? null,
    };
    return {
      modelResult: {
        ok: true,
        proposal,
        note: 'Proposal surfaced to the trainer; they start the rehearsal from the studio.',
      },
      summary: `Proposed a rehearsal (${proposal.turnsPerProfile} turns/profile)`,
    };
  }
}
