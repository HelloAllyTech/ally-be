import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioVoices } from 'src/learn/entity/scenario-voices.entity';
import { Competency } from 'src/learn/entity/competency.entity';
import { Behavior } from 'src/learn/entity/behavior.entity';
import { CompetencyBehavior } from 'src/learn/entity/competency-behavior.entity';
import { CompetencyBehaviorType } from 'src/learn/enum/competency-behavior.enum';
import { BehaviorInstructionCategory } from 'src/learn/enum/behavior-instruction.enum';
import { COMPETENCY_BEHAVIOR_INSTRUCTION_PRESETS } from 'src/learn/constants/competency-behavior-instruction-templates.constants';
import { Languages } from 'src/language/entity/languages.entity';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { RoleplaySpec } from '../entity/roleplay-spec.entity';
import { RoleplayDirectorEvent } from '../entity/roleplay-director-event.entity';
import { RoleplayRubricScore } from '../entity/roleplay-rubric-score.entity';
import { RoleplayDirectorEventType } from '../enum/director-event-type.enum';
import { CopilotSessionMode } from '../enum/copilot-session-mode.enum';
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

/** Mutable per-turn context threaded through tool executions. */
export interface ToolExecutionContext {
  spec: RoleplaySpec;
  /** The copilot session this turn belongs to (loop narration target). */
  sessionId: string;
  userId: number;
  /**
   * Copilot mode for the session. Drives the version-snapshot source of
   * update_spec (COPILOT_PATCH while BUILDING, COPILOT_ITERATION while
   * ITERATING). Optional/undefined is treated as BUILDING.
   */
  mode?: CopilotSessionMode;
  /** Patches applied so far this turn (spec_patch payloads). */
  appliedPatches: Record<string, any>[];
  /** Latest snapshot id produced this turn (for the done frame). */
  lastSpecVersionId: string | null;
}

/** How many recent live-test sessions get_test_session_insights summarises. */
const TEST_INSIGHTS_SESSION_LIMIT = 3;

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

  /**
   * The tool belt for a turn. BUILDING exposes the authoring/interview tools.
   * ITERATING adds the two feedback-loop tools (get_test_session_insights,
   * summarize_iteration) on top — the shared authoring tools (update_spec,
   * compile_spec, ask_trainer, catalog lookups) stay available so the copilot
   * can still edit any part of the spec while refining.
   */
  getToolDefinitions(
    mode: CopilotSessionMode = CopilotSessionMode.BUILDING,
  ): any[] {
    const tools: any[] = [
      {
        name: 'update_spec',
        description:
          'Apply an RFC-6902 patch (add/replace/remove only) to the current draft spec document. ' +
          'Batch related edits into ONE call — the ops array carries many operations, so group ' +
          'everything you can decide together (all the basics, a whole persona, the full objective ' +
          'set) into a single patch instead of one field per call; that keeps the turn within its ' +
          'tool round-trip budget. The result is validated; on failure you get the structured error ' +
          'list back and MUST self-repair with a corrected patch.',
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
          'Ask exactly one question at a time. Choose the kind that fits: ' +
          'freeText for open answers; singleSelect for one-of; multiSelect for ' +
          'many-of; dropdown for long option lists (e.g. languages). For ' +
          'select/dropdown kinds each option is a {id,label} object — the id is ' +
          'what you act on afterwards (competency/language/test-case ids). Set ' +
          'allowCustom to let the trainer type their own answer, allowNone to ' +
          'offer a "None of these" choice, and minSelections/maxSelections to ' +
          'bound multiSelect/dropdown answers (e.g. minSelections=1 for language).',
        input_schema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The question to ask' },
            kind: {
              type: 'string',
              enum: ['freeText', 'singleSelect', 'multiSelect', 'dropdown'],
            },
            options: {
              type: 'array',
              description:
                'Choices for singleSelect/multiSelect/dropdown (omit for freeText)',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['id', 'label'],
              },
            },
            allowCustom: {
              type: 'boolean',
              description: 'Show an "add your own" free-text entry',
            },
            allowNone: {
              type: 'boolean',
              description: 'Offer a "None of these" choice',
            },
            minSelections: {
              type: 'number',
              description: 'Minimum selections before the trainer can confirm',
            },
            maxSelections: {
              type: 'number',
              description: 'Maximum selections allowed',
            },
          },
          required: ['prompt', 'kind'],
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
        name: 'get_competency_behaviours',
        description:
          'Given the selected competency ids, return the merged, de-duplicated ' +
          'helpful and unhelpful behaviour names mapped to those competencies. ' +
          'Call this right after the trainer picks competencies, then pass the ' +
          'result into review_behaviours so the trainer can fine-tune them. ' +
          'Returns empty lists when no competency was picked.',
        input_schema: {
          type: 'object',
          properties: {
            competencyIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Competency ids the trainer selected',
            },
          },
          required: ['competencyIds'],
        },
      },
      {
        name: 'review_behaviours',
        description:
          'Present helpful and unhelpful behaviours to the trainer as a review ' +
          'card (every item pre-checked); the turn ends. Seed the two lists from ' +
          'get_competency_behaviours, or — when the trainer picked "None of these" ' +
          'competencies — from behaviours you infer from the character context + ' +
          'difficulty. After the trainer confirms (they may uncheck items and add ' +
          'custom ones), write the confirmed set into rubric.behaviors with ' +
          'update_spec (polarity helpful/unhelpful). Do NOT ask "what does doing ' +
          'well look like" — this card replaces that question.',
        input_schema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Short framing shown above the card',
            },
            helpful: {
              type: 'array',
              items: { type: 'string' },
              description: 'Helpful behaviour names to pre-check',
            },
            unhelpful: {
              type: 'array',
              items: { type: 'string' },
              description: 'Unhelpful behaviour names to pre-check',
            },
          },
          required: ['helpful', 'unhelpful'],
        },
      },
      {
        name: 'get_languages',
        description:
          'List the available active languages (id, code, label). Present them ' +
          'to the trainer via ask_trainer (kind="dropdown", minSelections=1, one ' +
          'option per language with id=languageId). After they choose, write the ' +
          'first to `language` ({languageId, languageCode}) and add a ' +
          'voice.languageVoices key for EVERY selected languageId, then pick_voice ' +
          'each and write a real voice id.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'compile_spec',
        description:
          'Fully validate the current draft (including catalog checks) and report the compiled ' +
          'runtime payload size. Use before proposing publish.',
        input_schema: { type: 'object', properties: {} },
      },
    ];

    if (mode === CopilotSessionMode.ITERATING) {
      tools.push(
        {
          name: 'get_test_session_insights',
          description:
            "Pull runtime telemetry from the trainer's most recent LIVE-TEST runs of this " +
            'roleplay: the state path (which emotional states were reached and on which turn), ' +
            'disclosure unlocks (which secrets came out and when), rubric behaviour hits and the ' +
            'cumulative score, and the end-of-run summary. Call this BEFORE editing for feedback ' +
            'about pacing, disclosure timing, scoring, or "the client did X" — it tells you what ' +
            'actually happened so you patch the real cause and can explain the change concretely. ' +
            'Returns an empty list when the trainer has not tested yet.',
          input_schema: { type: 'object', properties: {} },
        },
        {
          name: 'summarize_iteration',
          description:
            'Show the trainer a structured summary of the change you just made for one piece of ' +
            'feedback: what they asked for, WHY you changed the parts you did (grounded in the ' +
            'runtime model + any telemetry), and the list of edits. Call this AFTER applying the ' +
            'update_spec patches for that feedback — the individual patches stream as progress, ' +
            'this card is the recap. One piece of feedback → one summarize_iteration call.',
          input_schema: {
            type: 'object',
            properties: {
              feedback: {
                type: 'string',
                description: "Restate the trainer's feedback in one line",
              },
              reasoning: {
                type: 'string',
                description:
                  'Why these spec parts drive the behaviour and why you changed them',
              },
              changes: {
                type: 'array',
                description: 'One entry per spec area you edited',
                items: {
                  type: 'object',
                  properties: {
                    area: {
                      type: 'string',
                      description:
                        'Spec area touched, e.g. "State machine", "Disclosure ledger", "Rubric"',
                    },
                    summary: {
                      type: 'string',
                      description: 'What changed in that area (one line)',
                    },
                  },
                  required: ['area', 'summary'],
                },
              },
              note: {
                type: 'string',
                description:
                  'Optional short closing note inviting another test run',
              },
            },
            required: ['feedback', 'reasoning', 'changes'],
          },
        },
      );
    }

    return tools;
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
      case 'pick_voice':
        return this.executePickVoice(input);
      case 'get_competencies':
        return this.executeGetCompetencies();
      case 'get_competency_behaviours':
        return this.executeGetCompetencyBehaviours(input);
      case 'review_behaviours':
        return this.executeReviewBehaviours(input);
      case 'get_languages':
        return this.executeGetLanguages();
      case 'compile_spec':
        return this.executeCompileSpec(context);
      case 'get_test_session_insights':
        return this.executeGetTestSessionInsights(context);
      case 'summarize_iteration':
        return this.executeSummarizeIteration(input);
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
    const source =
      context.mode === CopilotSessionMode.ITERATING
        ? RoleplaySpecVersionSource.COPILOT_ITERATION
        : RoleplaySpecVersionSource.COPILOT_PATCH;
    const { spec: savedSpec, version } =
      await this.roleplaySpecService.persistDraftMutation(
        context.spec,
        nextDraft,
        context.userId,
        source,
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
    const selectKinds = ['singleSelect', 'multiSelect', 'dropdown'];
    // 'choice' is the legacy single-select alias.
    let kind = String(input?.kind ?? 'freeText');
    if (kind === 'choice') kind = 'singleSelect';
    if (![...selectKinds, 'freeText'].includes(kind)) kind = 'freeText';

    const isSelect = selectKinds.includes(kind);
    const options = isSelect
      ? this.normalizeQuestionOptions(input?.options)
      : [];

    const question: Record<string, any> = {
      id: questionId,
      prompt: String(input?.prompt ?? ''),
      kind,
      ...(options.length ? { options } : {}),
      ...(input?.allowCustom ? { allowCustom: true } : {}),
      ...(input?.allowNone ? { allowNone: true } : {}),
      ...(typeof input?.minSelections === 'number'
        ? { minSelections: input.minSelections }
        : {}),
      ...(typeof input?.maxSelections === 'number'
        ? { maxSelections: input.maxSelections }
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

  /** Accepts {id,label,description?} objects or bare strings (legacy). */
  private normalizeQuestionOptions(
    raw: unknown,
  ): { id: string; label: string; description?: string }[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((opt) => {
        if (typeof opt === 'string') {
          const value = opt.trim();
          return value ? { id: value, label: value } : null;
        }
        if (opt && typeof opt === 'object') {
          const o = opt as Record<string, any>;
          const id = String(o.id ?? o.label ?? '').trim();
          const label = String(o.label ?? o.id ?? '').trim();
          if (!id || !label) return null;
          return o.description
            ? { id, label, description: String(o.description) }
            : { id, label };
        }
        return null;
      })
      .filter(Boolean) as { id: string; label: string; description?: string }[];
  }

  private executeReviewBehaviours(
    input: Record<string, any>,
  ): ToolExecutionOutcome {
    const toItems = (names: unknown) =>
      (Array.isArray(names) ? names : [])
        .map((name) => String(name).trim())
        .filter(Boolean)
        .map((name) => ({ id: uuidv4(), name, checked: true }));
    const helpful = toItems(input?.helpful);
    const unhelpful = toItems(input?.unhelpful);
    const review = {
      id: uuidv4(),
      prompt:
        typeof input?.prompt === 'string' && input.prompt.trim()
          ? input.prompt.trim()
          : 'Here are the helpful and unhelpful behaviours mapped to your ' +
            'competencies. Uncheck any that don’t fit, and add your own.',
      helpful,
      unhelpful,
      allowCustom: true,
    };
    return {
      modelResult: {
        ok: true,
        questionId: review.id,
        note: 'Behaviour review delivered; the trainer will confirm the helpful/unhelpful sets in their next message.',
      },
      summary: `Presented ${helpful.length} helpful + ${unhelpful.length} unhelpful behaviour(s) for review`,
      events: [{ event: 'behaviour_review', data: review }],
      endTurn: true,
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

  /**
   * Merge the helpful/unhelpful behaviours mapped to the selected competencies.
   * Read-only: uses the persisted competency→behaviour mappings where they
   * exist, falling back to the preset dictionary (keyed by competency name) for
   * competencies never touched via the admin Competencies tab. Never writes.
   */
  private async executeGetCompetencyBehaviours(
    input: Record<string, any>,
  ): Promise<ToolExecutionOutcome> {
    const competencyIds = Array.isArray(input?.competencyIds)
      ? [...new Set(input.competencyIds.map(String).filter(Boolean))]
      : [];
    if (competencyIds.length === 0) {
      return {
        modelResult: {
          ok: true,
          helpful: [],
          unhelpful: [],
          note: 'No competencies selected — infer behaviours from the character context and difficulty instead, then present them with review_behaviours.',
        },
        summary: 'No competencies selected — no mapped behaviours',
      };
    }

    const competencies = await this.dataSource
      .getRepository(Competency)
      .findBy({ id: In(competencyIds) });
    const nameById = new Map(competencies.map((c) => [c.id, c.name]));

    const mappings = await this.dataSource
      .getRepository(CompetencyBehavior)
      .findBy({ competencyId: In(competencyIds) });
    const behaviourIds = [...new Set(mappings.map((m) => m.behaviorId))];
    const behaviours = behaviourIds.length
      ? await this.dataSource
          .getRepository(Behavior)
          .findBy({ id: In(behaviourIds) })
      : [];
    const behaviourNameById = new Map(behaviours.map((b) => [b.id, b.name]));

    const helpful: string[] = [];
    const unhelpful: string[] = [];
    const competenciesWithMapping = new Set<string>();
    for (const mapping of mappings) {
      competenciesWithMapping.add(mapping.competencyId);
      const name = behaviourNameById.get(mapping.behaviorId);
      if (!name) continue;
      if (mapping.type === CompetencyBehaviorType.HELPFUL) helpful.push(name);
      else if (mapping.type === CompetencyBehaviorType.UNHELPFUL)
        unhelpful.push(name);
    }

    // Competencies with no persisted mapping fall back to preset defaults.
    for (const id of competencyIds) {
      if (competenciesWithMapping.has(id)) continue;
      const preset = this.getPresetBehaviours(nameById.get(id) ?? '');
      helpful.push(...preset.helpful);
      unhelpful.push(...preset.unhelpful);
    }

    const mergedHelpful = this.dedupeNames(helpful);
    const helpfulLower = new Set(mergedHelpful.map((n) => n.toLowerCase()));
    // A behaviour can't be both — helpful wins (mirrors the mapping rule).
    const mergedUnhelpful = this.dedupeNames(unhelpful).filter(
      (name) => !helpfulLower.has(name.toLowerCase()),
    );

    return {
      modelResult: {
        ok: true,
        helpful: mergedHelpful,
        unhelpful: mergedUnhelpful,
      },
      summary: `Merged behaviours from ${competencyIds.length} competency(ies): ${mergedHelpful.length} helpful, ${mergedUnhelpful.length} unhelpful`,
    };
  }

  private getPresetBehaviours(competencyName: string): {
    helpful: string[];
    unhelpful: string[];
  } {
    const preset = COMPETENCY_BEHAVIOR_INSTRUCTION_PRESETS[competencyName];
    if (!preset) return { helpful: [], unhelpful: [] };
    return {
      helpful: preset
        .filter((p) => p.category === BehaviorInstructionCategory.SHOULD_DO)
        .map((p) => p.behaviorName),
      unhelpful: preset
        .filter((p) => p.category === BehaviorInstructionCategory.SHOULD_NOT_DO)
        .map((p) => p.behaviorName),
    };
  }

  private dedupeNames(names: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }

  private async executeGetLanguages(): Promise<ToolExecutionOutcome> {
    const languages = await this.dataSource
      .getRepository(Languages)
      .find({ where: { active: true }, order: { label: 'ASC' }, take: 100 });
    return {
      modelResult: {
        ok: true,
        languages: languages.map((language) => ({
          id: language.id,
          code: language.value,
          label: language.label,
        })),
      },
      summary: `Listed ${languages.length} active language(s)`,
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

  /**
   * Summarise the trainer's recent LIVE-TEST runs of this roleplay so the
   * copilot can ground iteration edits in what actually happened at runtime.
   * Scoped to the trainer's own sessions for this spec's scenario, newest
   * first, capped at TEST_INSIGHTS_SESSION_LIMIT. Read-only.
   */
  private async executeGetTestSessionInsights(
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutcome> {
    const scenarioId = context.spec.scenarioId;
    if (scenarioId === undefined || scenarioId === null) {
      return {
        modelResult: {
          ok: true,
          sessions: [],
          note: 'This spec has no scenario yet — reason from the spec alone.',
        },
        summary: 'No live-test sessions found',
      };
    }

    const sessions = await this.dataSource
      .getRepository(ScenarioSessions)
      .find({
        where: { scenarioId, counselorId: context.userId },
        order: { createdAt: 'DESC' },
        take: TEST_INSIGHTS_SESSION_LIMIT,
      });
    if (sessions.length === 0) {
      return {
        modelResult: {
          ok: true,
          sessions: [],
          note: 'The trainer has not live-tested this roleplay yet — reason from the spec alone and say so.',
        },
        summary: 'No live-test sessions found',
      };
    }

    const sessionIds = sessions.map((session) => session.id);
    const [events, scores] = await Promise.all([
      this.dataSource.getRepository(RoleplayDirectorEvent).find({
        where: { scenarioSessionId: In(sessionIds) },
        order: { createdAt: 'ASC' },
      }),
      this.dataSource.getRepository(RoleplayRubricScore).find({
        where: { scenarioSessionId: In(sessionIds) },
        order: { turnIndex: 'ASC' },
      }),
    ]);

    const stateNameById = this.stateNameMap(context.spec.draftSpec);
    const behaviorNameById = this.rubricNameMap(context.spec.draftSpec);

    const summaries = sessions.map((session) =>
      this.summariseTestSession(
        session,
        events.filter((event) => event.scenarioSessionId === session.id),
        scores.filter((score) => score.scenarioSessionId === session.id),
        stateNameById,
        behaviorNameById,
      ),
    );

    return {
      modelResult: { ok: true, sessions: summaries },
      summary: `Summarised ${summaries.length} recent live-test run(s)`,
    };
  }

  /** stateId → state name, from the draft's state machine (for readable telemetry). */
  private stateNameMap(draftSpec: Record<string, any>): Map<string, string> {
    const states = Array.isArray(draftSpec?.stateMachine?.states)
      ? draftSpec.stateMachine.states
      : [];
    return new Map(
      states
        .filter((state: any) => state?.id)
        .map((state: any) => [
          String(state.id),
          String(state.name ?? state.id),
        ]),
    );
  }

  /** behaviorId → behaviour name, from the draft's rubric. */
  private rubricNameMap(draftSpec: Record<string, any>): Map<string, string> {
    const behaviors = Array.isArray(draftSpec?.rubric?.behaviors)
      ? draftSpec.rubric.behaviors
      : [];
    return new Map(
      behaviors
        .filter((behavior: any) => behavior?.id)
        .map((behavior: any) => [
          String(behavior.id),
          String(behavior.name ?? behavior.id),
        ]),
    );
  }

  /**
   * Collapse one session's raw director telemetry into a compact, model-facing
   * shape: the state path with turn indices, disclosures unlocked, aggregated
   * rubric hits, and the end-of-run summary.
   */
  private summariseTestSession(
    session: ScenarioSessions,
    events: RoleplayDirectorEvent[],
    scores: RoleplayRubricScore[],
    stateNames: Map<string, string>,
    behaviorNames: Map<string, string>,
  ): Record<string, any> {
    const nameState = (id: unknown) => {
      const key = id === undefined || id === null ? '' : String(id);
      return key ? (stateNames.get(key) ?? key) : null;
    };

    const statePath = events
      .filter(
        (event) =>
          event.eventType === RoleplayDirectorEventType.STATE_TRANSITION,
      )
      .map((event) => ({
        turn: event.turnIndex ?? event.payload?.turn_index ?? null,
        from: nameState(event.payload?.from_state_id),
        to: nameState(event.payload?.to_state_id),
        via:
          event.payload?.observed_behavior ?? event.payload?.guard_id ?? null,
      }));

    const disclosures = events
      .filter(
        (event) =>
          event.eventType === RoleplayDirectorEventType.DISCLOSURE_UNLOCK,
      )
      .map((event) => ({
        turn: event.turnIndex ?? event.payload?.turn_index ?? null,
        secretId: event.payload?.secret_id ?? null,
        via: event.payload?.unlock_condition_id ?? null,
      }));

    // Aggregate rubric hits per behaviour: how many times it scored and the
    // average score — the currency the copilot reasons about.
    const byBehavior = new Map<string, { hits: number; total: number }>();
    for (const score of scores) {
      const entry = byBehavior.get(score.behaviorId) ?? { hits: 0, total: 0 };
      entry.hits += 1;
      entry.total += Number(score.score ?? 0);
      byBehavior.set(score.behaviorId, entry);
    }
    const rubric = [...byBehavior.entries()].map(([behaviorId, entry]) => ({
      behavior: behaviorNames.get(behaviorId) ?? behaviorId,
      hits: entry.hits,
      avgScore: Number((entry.total / entry.hits).toFixed(2)),
    }));

    const runtimeSummary = session.metadata?.roleplaySummary ?? null;
    const lastTurn = Math.max(
      0,
      ...events.map((event) => event.turnIndex ?? 0),
      ...scores.map((score) => score.turnIndex ?? 0),
    );

    return {
      startedAt: session.createdAt,
      endedAt: session.endedAt ?? null,
      turns: lastTurn,
      cumulativeScore: runtimeSummary?.cumulativeScore ?? session.score ?? null,
      finalState: runtimeSummary?.finalStateId
        ? nameState(runtimeSummary.finalStateId)
        : (statePath[statePath.length - 1]?.to ?? null),
      statePath,
      disclosuresUnlocked: disclosures,
      rubric,
    };
  }

  /**
   * Emit the iteration_summary card (the "summary of updates made" the trainer
   * sees after a feedback-driven edit). Pure formatting — no persistence; the
   * spec_patch frames already committed the edits.
   */
  private executeSummarizeIteration(
    input: Record<string, any>,
  ): ToolExecutionOutcome {
    const changes = (Array.isArray(input?.changes) ? input.changes : [])
      .map((change: any) => ({
        area: String(change?.area ?? '').trim(),
        summary: String(change?.summary ?? '').trim(),
      }))
      .filter((change: any) => change.area || change.summary);
    const summaryCard = {
      id: uuidv4(),
      feedback: String(input?.feedback ?? '').trim(),
      reasoning: String(input?.reasoning ?? '').trim(),
      changes,
      ...(typeof input?.note === 'string' && input.note.trim()
        ? { note: input.note.trim() }
        : {}),
    };
    return {
      modelResult: {
        ok: true,
        note: 'Iteration summary delivered to the trainer.',
      },
      summary: `Summarised iteration: ${changes.length} change(s)`,
      events: [{ event: 'iteration_summary', data: summaryCard }],
    };
  }
}
