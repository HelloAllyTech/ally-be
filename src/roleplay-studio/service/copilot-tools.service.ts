import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioVoices } from 'src/learn/entity/scenario-voices.entity';
import { Competency } from 'src/learn/entity/competency.entity';
import { AgentTestCase } from 'src/learn/entity/agent-test-case.entity';
import { RoleplaySpec } from '../entity/roleplay-spec.entity';
import { RoleplaySpecService } from './roleplay-spec.service';
import { SpecValidatorService } from './spec-validator.service';
import { SpecCompilerService } from './spec-compiler.service';
import { CritiqueEvidenceService } from './critique-evidence.service';
import { RehearsalComparisonService } from './rehearsal-comparison.service';
import { ImprovementOrchestratorService } from './improvement-orchestrator.service';
import { RoleplaySpecVersionSource } from '../enum/roleplay-spec-version-source.enum';
import { RehearsalRunRepository } from '../repository/rehearsal-run.repository';
import { RehearsalTranscriptRepository } from '../repository/rehearsal-transcript.repository';
import { CritiqueProposalRepository } from '../repository/critique-proposal.repository';
import { ImprovementRunRepository } from '../repository/improvement-run.repository';
import { ImprovementRoundRepository } from '../repository/improvement-round.repository';
import { RehearsalStatus } from '../enum/rehearsal-status.enum';
import {
  applyJsonPatch,
  JsonPatchError,
  JsonPatchOp,
} from '../util/json-patch.util';
import { ToolExecutionOutcome } from '../type/copilot-sse-event.type';

/** Mutable per-turn context threaded through tool executions. */
export interface ToolExecutionContext {
  spec: RoleplaySpec;
  /** The copilot session this turn belongs to (loop narration target). */
  sessionId: string;
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
    private readonly critiqueEvidenceService: CritiqueEvidenceService,
    private readonly comparisonService: RehearsalComparisonService,
    private readonly rehearsalRunRepository: RehearsalRunRepository,
    private readonly rehearsalTranscriptRepository: RehearsalTranscriptRepository,
    private readonly critiqueProposalRepository: CritiqueProposalRepository,
    private readonly improvementRunRepository: ImprovementRunRepository,
    private readonly improvementRoundRepository: ImprovementRoundRepository,
    private readonly improvementOrchestrator: ImprovementOrchestratorService,
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
          'These surface as accept cards in the chat; the trainer accepts them there and the ' +
          'chosen cases are persisted and wired into the spec automatically.',
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
        name: 'get_rehearsal_findings',
        description:
          'Fetch rehearsal evidence for this spec: judge scores (with the delta vs the ' +
          'previous rehearsal), failed/inconclusive agent test cases with evaluator evidence, ' +
          'condensed transcript excerpts, and prior critique proposals with their outcomes. ' +
          'ALWAYS call this before proposing update_spec fixes for a rehearsal problem.',
        input_schema: {
          type: 'object',
          properties: {
            rehearsalId: {
              type: 'string',
              description:
                'A specific rehearsal run id; omit for the latest completed rehearsal',
            },
          },
        },
      },
      {
        name: 'get_improvement_run_status',
        description:
          "Status of the spec's auto-improve runs: per-round scores + deltas, applied " +
          'proposals, the best version so far, and whether a result awaits trainer review.',
        input_schema: {
          type: 'object',
          properties: {
            improvementRunId: {
              type: 'string',
              description: 'A specific run id; omit for the latest run',
            },
          },
        },
      },
      {
        name: 'get_agent_test_cases',
        description:
          'List the existing agent test case library (id, title, category, condition, test). ' +
          'Use it to offer relevant EXISTING cases to the trainer (via ask_trainer) and write ' +
          'chosen ids into agentTestCaseIds with update_spec; suggest_test_cases covers NEW cases.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'start_auto_improve',
        description:
          'Snapshot the current draft and start the autonomous improve loop: it rehearses the ' +
          'spec with simulated trainees and the selected agent test cases, critiques the results, ' +
          'applies fixes, and re-rehearses until the targets are met (or rounds run out). ' +
          'Progress messages are posted into this chat automatically, and when the targets are ' +
          'met the improved spec is applied to the draft automatically. Requires a fully valid ' +
          'draft; refuses while a run is already in progress.',
        input_schema: {
          type: 'object',
          properties: {
            maxRounds: {
              type: 'number',
              description: 'Improvement rounds cap (default 3)',
            },
            minOverall: {
              type: 'number',
              description: 'Minimum judged overall score target (default 70)',
            },
            requireAllTestCasesPass: {
              type: 'boolean',
              description:
                'Every selected agent test case must pass (default true)',
            },
          },
        },
      },
      {
        name: 'resolve_improvement_run',
        description:
          "Resolve a finished auto-improve run per the trainer's decision: 'accept' applies the " +
          'best version to the draft, \'discard\' keeps the current draft. For "iterate more", ' +
          'accept first (locking in gains), then call start_auto_improve again.',
        input_schema: {
          type: 'object',
          properties: {
            improvementRunId: {
              type: 'string',
              description: 'Omit for the latest run awaiting review',
            },
            action: { type: 'string', enum: ['accept', 'discard'] },
          },
          required: ['action'],
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
      case 'get_rehearsal_findings':
        return this.executeGetRehearsalFindings(input, context);
      case 'get_improvement_run_status':
        return this.executeGetImprovementRunStatus(input, context);
      case 'get_agent_test_cases':
        return this.executeGetAgentTestCases();
      case 'start_auto_improve':
        return this.executeStartAutoImprove(input, context);
      case 'resolve_improvement_run':
        return this.executeResolveImprovementRun(input, context);
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
    const suggestions = (
      Array.isArray(input?.suggestions) ? input.suggestions : []
    ).map((suggestion: Record<string, any>) => ({
      id: uuidv4(),
      title: String(suggestion?.title ?? ''),
      category: suggestion?.category ?? null,
      description: suggestion?.description ?? null,
      condition: suggestion?.condition ?? null,
      test: suggestion?.test ?? null,
    }));
    return {
      modelResult: {
        ok: true,
        count: suggestions.length,
        note: 'Suggestions surfaced to the trainer; accepted ones are persisted via the studio.',
      },
      summary: `Suggested ${suggestions.length} test case(s): ${suggestions
        .map((suggestion) => suggestion.title)
        .filter(Boolean)
        .join(', ')}`,
      // Structured frame so the studio can render accept-to-persist cards
      // (the summary string alone used to be the only thing that survived).
      events: [{ event: 'test_case_suggestions', data: { suggestions } }],
    };
  }

  /**
   * Rehearsal evidence pack for the copilot: scores + delta vs the previous
   * rehearsal, failing test cases, condensed transcript evidence, and the
   * proposal history. Read-only.
   */
  private async executeGetRehearsalFindings(
    input: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutcome> {
    const specId = context.spec.id;
    let run;
    if (input?.rehearsalId) {
      run = await this.rehearsalRunRepository.findOne({
        where: { id: String(input.rehearsalId), specId },
      });
    } else {
      run = await this.rehearsalRunRepository
        .createQueryBuilder('run')
        .where('run.specId = :specId', { specId })
        .andWhere('run.status = :status', {
          status: RehearsalStatus.COMPLETED,
        })
        .orderBy('run.createdAt', 'DESC')
        .getOne();
    }
    if (!run || run.status !== RehearsalStatus.COMPLETED) {
      return {
        modelResult: {
          ok: false,
          error: 'no_completed_rehearsal',
          message:
            'No completed rehearsal found for this spec — suggest running one first.',
        },
        summary: 'No completed rehearsal found',
      };
    }

    const previous = await this.rehearsalRunRepository
      .createQueryBuilder('previous')
      .where('previous.specId = :specId', { specId })
      .andWhere('previous.status = :status', {
        status: RehearsalStatus.COMPLETED,
      })
      .andWhere('previous.createdAt < :createdAt', {
        createdAt: run.createdAt,
      })
      .andWhere('previous.id != :id', { id: run.id })
      .orderBy('previous.createdAt', 'DESC')
      .getOne();

    const transcripts = await this.rehearsalTranscriptRepository.listByRun(
      run.id,
    );
    const version = await this.roleplaySpecService.getVersionById(
      run.specVersionId,
    );
    const evidence = this.critiqueEvidenceService.buildEvidence(
      run,
      transcripts,
      version.spec,
      { charBudget: 8_000 },
    );
    const proposals = await this.critiqueProposalRepository.listByRehearsal(
      run.id,
    );
    const failing = (
      (run.results?.test_case_results ?? []) as Record<string, any>[]
    ).filter((result) => result.verdict !== 'PASSED');

    return {
      modelResult: {
        ok: true,
        rehearsalId: run.id,
        specVersionId: run.specVersionId,
        results: run.results ?? null,
        deltaVsPrevious: previous
          ? this.comparisonService.compare(previous.results, run.results)
          : null,
        failingTestCases: failing,
        evidence,
        priorProposals: proposals.map((proposal) => ({
          id: proposal.id,
          summary: proposal.summary,
          targetSection: proposal.targetSection,
          severity: proposal.severity,
          status: proposal.status,
        })),
      },
      summary: `Rehearsal ${run.id.slice(0, 8)}: overall ${
        run.results?.overall ?? '?'
      }, ${failing.length} failing test case(s)`,
    };
  }

  private async executeGetImprovementRunStatus(
    input: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutcome> {
    const specId = context.spec.id;
    let run;
    if (input?.improvementRunId) {
      run = await this.improvementRunRepository.findOne({
        where: { id: String(input.improvementRunId), specId },
      });
    } else {
      const runs = await this.improvementRunRepository.listBySpec(specId);
      run = runs[0] ?? null;
    }
    if (!run) {
      return {
        modelResult: {
          ok: false,
          error: 'no_improvement_run',
          message: 'No auto-improve run exists for this spec.',
        },
        summary: 'No improvement run found',
      };
    }
    const rounds = await this.improvementRoundRepository.listByRun(run.id);
    return {
      modelResult: {
        ok: true,
        improvementRunId: run.id,
        status: run.status,
        outcome: run.outcome ?? null,
        currentRound: run.currentRound,
        bestVersionId: run.bestVersionId ?? null,
        awaitingReview: run.status === 'AWAITING_REVIEW',
        rounds: rounds.map((round) => ({
          roundNumber: round.roundNumber,
          kind: round.kind,
          status: round.status,
          fullScope: round.fullScope,
          scores: round.scores ?? null,
          deltas: round.deltas ?? null,
          proposalsAppliedCount: round.proposalsAppliedCount,
        })),
      },
      summary: `Improvement run ${run.id.slice(0, 8)}: ${run.status}${
        run.outcome ? ` (${run.outcome})` : ''
      }, round ${run.currentRound}`,
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

  private async executeGetAgentTestCases(): Promise<ToolExecutionOutcome> {
    const testCases = await this.dataSource
      .getRepository(AgentTestCase)
      .find({ order: { title: 'ASC' }, take: 100 });
    return {
      modelResult: {
        ok: true,
        testCases: testCases.map((testCase) => ({
          id: testCase.id,
          title: testCase.title,
          category: testCase.category ?? null,
          condition: testCase.condition ?? null,
          test: testCase.test ?? null,
        })),
      },
      summary: `Listed ${testCases.length} existing agent test case(s)`,
    };
  }

  /**
   * Snapshot the draft and start the autonomous improve loop, linked to this
   * chat (progress narration + auto-apply on targets met). The draft is
   * snapshotted explicitly because title-only PUT edits mutate draftSpec
   * without a version snapshot — "latest version == draft" isn't guaranteed.
   */
  private async executeStartAutoImprove(
    input: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutcome> {
    const validation = await this.specValidator.validate(
      context.spec.draftSpec,
    );
    if (!validation.valid) {
      return {
        modelResult: {
          ok: false,
          error: 'spec_invalid',
          message:
            'The draft has validation errors — fix them with update_spec, then retry.',
          errors: validation.errors,
        },
        summary: `Auto-improve refused: ${validation.errors.length} validation error(s)`,
      };
    }

    const { spec: savedSpec, version } =
      await this.roleplaySpecService.persistDraftMutation(
        context.spec,
        context.spec.draftSpec,
        context.userId,
        RoleplaySpecVersionSource.SNAPSHOT,
      );
    context.spec = savedSpec;
    context.lastSpecVersionId = version.id;

    const agentTestCaseIds =
      ((savedSpec.draftSpec as Record<string, any>)?.agentTestCaseIds as
        | string[]
        | undefined) ?? [];

    let run;
    try {
      run = await this.improvementOrchestrator.startImprovementRun(
        savedSpec.id,
        version.id,
        {
          maxRounds:
            typeof input?.maxRounds === 'number' ? input.maxRounds : undefined,
          targets: {
            ...(typeof input?.minOverall === 'number'
              ? { minOverall: input.minOverall }
              : {}),
            ...(typeof input?.requireAllTestCasesPass === 'boolean'
              ? { requireAllTestCasesPass: input.requireAllTestCasesPass }
              : {}),
          },
          agentTestCaseIds,
        },
        context.userId,
        {
          copilotSessionId: context.sessionId,
          autoAcceptOnTargetsMet: true,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('already in progress')) {
        return {
          modelResult: {
            ok: false,
            error: 'run_in_progress',
            message:
              'An improvement run is already in progress for this spec — wait for it to finish.',
          },
          summary: 'Auto-improve refused: a run is already in progress',
        };
      }
      throw error;
    }

    return {
      modelResult: {
        ok: true,
        improvementRunId: run.id,
        baseVersionId: version.id,
        maxRounds: run.config.maxRounds,
        targets: run.config.targets,
        testCaseCount: agentTestCaseIds.length,
        note:
          'The loop is running; progress messages will be posted into this chat. ' +
          'Tell the trainer it may take a while and they can leave and come back.',
      },
      summary: `Auto-improve started (run ${run.id.slice(0, 8)}, ${agentTestCaseIds.length} test case(s))`,
    };
  }

  private async executeResolveImprovementRun(
    input: Record<string, any>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutcome> {
    const action = String(input?.action ?? '');
    if (!['accept', 'discard'].includes(action)) {
      return {
        modelResult: {
          ok: false,
          error: 'invalid_action',
          message: "action must be 'accept' or 'discard'",
        },
        summary: 'resolve_improvement_run failed: invalid action',
      };
    }

    let run;
    if (input?.improvementRunId) {
      run = await this.improvementRunRepository.findOne({
        where: { id: String(input.improvementRunId), specId: context.spec.id },
      });
    } else {
      run = await this.improvementRunRepository.findAwaitingReview(
        context.spec.id,
      );
    }
    if (!run) {
      return {
        modelResult: {
          ok: false,
          error: 'no_run_awaiting_review',
          message: 'No improvement run is awaiting review for this spec.',
        },
        summary: 'No improvement run awaiting review',
      };
    }

    const resolved =
      action === 'accept'
        ? await this.improvementOrchestrator.acceptRun(
            run.id,
            {},
            context.userId,
          )
        : await this.improvementOrchestrator.discardRun(run.id, context.userId);

    // Accepting rewrites the draft — refresh the turn's spec so later tool
    // calls (or a follow-up start_auto_improve) see the applied version.
    if (action === 'accept') {
      context.spec = await this.roleplaySpecService.getSpec(context.spec.id);
    }

    return {
      modelResult: {
        ok: true,
        improvementRunId: resolved.id,
        status: resolved.status,
        bestVersionId: resolved.bestVersionId ?? null,
        acceptedVersionId: resolved.acceptedVersionId ?? null,
      },
      summary:
        action === 'accept'
          ? 'Accepted the improvement into the draft'
          : 'Discarded the improvement run',
    };
  }
}
