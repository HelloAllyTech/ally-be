import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService } from 'src/logger/logger.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ScenarioService } from 'src/learn/service/scenario.service';
import { CompetencyService } from 'src/learn/service/competency.service';
import { OpenAIAutofillService } from 'src/learn/service/openai-autofil-service';
import { ScenarioVoicesRepository } from 'src/learn/repository/scenario-voices.repository';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { ScenarioReportService } from 'src/scenario-report/service/scenario-report.service';
import { ScenarioReportStatus } from 'src/scenario-report/enum/scenario-report.enum';
import { SCENARIO_REPORT_END_STATUSES } from 'src/scenario-report/constants/scenario-report.constant';
import { GeneratableField } from 'src/learn/enum/generatable-field.enum';
import { ScenarioStatus } from 'src/learn/type/scenario.type';
import { CreateScenarioDto } from 'src/learn/dto/create-scenario.dto';
import { UpdateScenarioDto } from 'src/learn/dto/update-scenario.dto';
import { CopilotRunRepository } from '../repository/copilot-run.repository';
import { CopilotRun } from '../entity/copilot-run.entity';
import {
  CopilotReportCompletedPayload,
  COPILOT_REPORT_COMPLETED_EVENT,
  CopilotRunStatus,
} from '../enum/copilot-run.enum';
import {
  COPILOT_COUNSELOR_BRIEF,
  COPILOT_DEFAULT_LANGUAGE_VALUE,
  COPILOT_END_STATUSES,
  COPILOT_MAX_ROUNDS,
  COPILOT_MAX_TURNS,
  COPILOT_SCORE_THRESHOLD,
} from '../constants/copilot.constant';
import { CreateCopilotRunDto, CopilotRunDto } from '../dto/copilot.dto';
import { CopilotRoundHistoryEntry } from '../type/copilot-run.type';
import {
  extractAvailableVariableNames,
  planStructuredGeneration,
} from '../util/variable-field-map.util';
import {
  computeCompositeScore,
  parseCopilotBaseOutput,
} from '../util/copilot-output.util';

/** Max chars of the previous round's report fed back into refinement. */
const MAX_FEEDBACK_CHARS = 4000;
const DEFAULT_NUM_STATES = 4;
const DEFAULT_NUM_KNOWLEDGE_SOURCES = 3;

/**
 * Orchestrates the Copilot auto-build & self-improve pipeline as a server-side
 * state machine. A run:
 *   1. Provisions a DRAFT scenario + auto defaults (competency, language, voice).
 *   2. GENERATING — generates the actor's Basic Settings field values
 *      (agent-builder base call + per-field, dependency-ordered structured
 *      generation for the skill-mapped fields), writes them to the draft.
 *   3. EVALUATING — runs a practice conversation + LLM-judge evaluation by
 *      reusing the scenario-report feature, then parks awaiting its webhook.
 *   4. onReportCompleted — composite = mean(metrics). >= threshold -> SUCCEEDED;
 *      max rounds -> FAILED; else REFINING and loop with the report's feedback.
 */
@Injectable()
export class CopilotService {
  private readonly logger = LoggerService.getInstance(CopilotService.name);

  constructor(
    private readonly copilotRunRepository: CopilotRunRepository,
    private readonly scenarioService: ScenarioService,
    private readonly competencyService: CompetencyService,
    private readonly openAIAutofillService: OpenAIAutofillService,
    private readonly scenarioVoicesRepository: ScenarioVoicesRepository,
    private readonly promptSharedService: PromptSharedService,
    private readonly scenarioReportService: ScenarioReportService,
  ) {}

  // ------------------------------------------------------------------
  // Public API (controller)
  // ------------------------------------------------------------------

  async startRun(
    dto: CreateCopilotRunDto,
    userId: number,
  ): Promise<{ runId: string; status: CopilotRunStatus }> {
    const provider = await this.resolveProvider(dto.model);
    const { languageId, languageCode, voiceId } =
      await this.resolveDefaultLanguageVoice();
    const competency = await this.resolveCompetency(dto.brief, dto.model);

    // Provision the transient DRAFT scenario the run builds and evaluates
    // against. Mandatory fields (title/prompt) are written each round in
    // runRound; competency + languageVoices are stable so we set them here.
    const draftId = await this.createDraftScenario(
      competency.id,
      languageId,
      voiceId,
      dto.skillPromptCode,
      userId,
    );

    const run = this.copilotRunRepository.create({
      status: CopilotRunStatus.STARTED,
      brief: dto.brief,
      config: {
        brief: dto.brief,
        skillPromptCode: dto.skillPromptCode,
        model: dto.model,
        provider,
        languageId,
        languageCode,
        voiceId,
        competencyId: competency.id,
        competencyName: competency.name,
        turns: COPILOT_MAX_TURNS,
        // Capture the acting user's tenant now (we're in their request
        // context) so background rounds can re-establish auth — see runRound.
        tenantId: ExecutionManager.getTenantId(),
      },
      draftScenarioId: draftId,
      round: 1,
      createdBy: userId,
      updatedBy: userId,
    });
    const saved = await this.copilotRunRepository.save(run);

    this.logger.info(
      `[COPILOT] run ${saved.id} started: draft=${draftId} competency=${competency.name} ` +
        `provider=${provider} model=${dto.model ?? 'default'} skill=${dto.skillPromptCode ?? 'default'}`,
    );

    // Fire-and-forget the first round. Errors are caught and recorded on the run.
    void this.runRound(saved.id);

    return { runId: saved.id, status: saved.status };
  }

  async getRun(runId: string, userId?: number): Promise<CopilotRunDto> {
    const run = await this.copilotRunRepository.findOne({
      where: { id: runId },
    });
    if (!run) {
      throw new NotFoundException('Copilot run not found');
    }
    if (userId && run.createdBy !== userId) {
      throw new ForbiddenException('You are not allowed to view this run');
    }
    return this.toDto(run);
  }

  async cancelRun(runId: string, userId: number): Promise<CopilotRunDto> {
    const run = await this.copilotRunRepository.findOne({
      where: { id: runId },
    });
    if (!run) {
      throw new NotFoundException('Copilot run not found');
    }
    if (run.createdBy !== userId) {
      throw new ForbiddenException('You are not allowed to cancel this run');
    }
    if (COPILOT_END_STATUSES.includes(run.status)) {
      throw new BadRequestException('Run has already finished');
    }

    run.status = CopilotRunStatus.CANCELLED;
    run.updatedBy = userId;
    run.endedAt = new Date();
    await this.copilotRunRepository.save(run);

    // Stop any in-flight practice conversation so ai-learn stops burning tokens.
    if (run.currentReportId) {
      await this.scenarioReportService
        .cancelScenarioReport(run.currentReportId, userId)
        .catch((err) =>
          this.logger.warn(
            `[COPILOT] run ${runId}: failed to cancel in-flight report ${run.currentReportId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
    }

    return this.toDto(run);
  }

  // ------------------------------------------------------------------
  // Round state machine
  // ------------------------------------------------------------------

  /**
   * Run a round inside the run owner's execution context.
   *
   * Round 1 is triggered from the user's HTTP request (already authorized),
   * but refinement rounds are triggered from the scenario-report webhook — an
   * api-key request with no user. `updateScenario` / `createScenarioReport`
   * authorize against the current AsyncLocalStorage execution context's user,
   * so without this the background round threw "Unauthorized". Re-establishing
   * the owner's auth context makes every round behave like round 1.
   */
  private async runRound(runId: string): Promise<void> {
    const ctxRun = await this.copilotRunRepository.findOne({
      where: { id: runId },
    });
    if (!ctxRun || COPILOT_END_STATUSES.includes(ctxRun.status)) {
      return;
    }
    await ExecutionManager.runWithContext(
      async () => {
        ExecutionManager.setAuthContext(
          String(ctxRun.createdBy),
          ctxRun.config.tenantId ?? '',
        );
        await this.executeRound(runId);
      },
      { path: 'copilot/run-round' },
    );
  }

  private async executeRound(runId: string): Promise<void> {
    let run = await this.copilotRunRepository.findOne({ where: { id: runId } });
    if (!run || COPILOT_END_STATUSES.includes(run.status)) {
      return;
    }
    if (!run.draftScenarioId) {
      await this.failRun(run, 'Draft scenario was not provisioned');
      return;
    }
    const draftScenarioId = run.draftScenarioId;

    try {
      run.status = CopilotRunStatus.GENERATING;
      run.updatedAt = new Date();
      await this.copilotRunRepository.save(run);

      const feedback = this.latestReportMarkdown(run);
      const fieldValues = await this.generateFields(run, feedback);

      // Persist the generated values onto the draft scenario.
      await this.scenarioService.updateScenario(
        draftScenarioId,
        this.buildUpdateDto(fieldValues, run),
        run.createdBy,
      );

      run = (await this.copilotRunRepository.findOne({
        where: { id: runId },
      }))!;
      run.fieldValues = fieldValues as Record<string, unknown>;
      run.status = CopilotRunStatus.EVALUATING;
      await this.copilotRunRepository.save(run);

      // Reuse the scenario-report feature: it validates the draft's mandatory
      // fields, builds the metadata envelope, triggers the ai-learn practice
      // conversation + LLM-judge, and sets its own Redis TTL. We park here;
      // onReportCompleted resumes when its webhook lands.
      const report = await this.scenarioReportService.createScenarioReport(
        draftScenarioId,
        {
          languageId: run.config.languageId,
          turns: run.config.turns,
          helperAgentPrompt: COPILOT_COUNSELOR_BRIEF,
        },
        run.createdBy,
      );

      run.currentReportId = report.id;
      await this.copilotRunRepository.save(run);

      this.logger.info(
        `[COPILOT] run ${runId} round ${run.round}: report ${report.id} dispatched (parked, awaiting webhook)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[COPILOT] run ${runId} round failed during generation/dispatch: ${message}`,
      );
      const fresh = await this.copilotRunRepository.findOne({
        where: { id: runId },
      });
      if (fresh && !COPILOT_END_STATUSES.includes(fresh.status)) {
        await this.failRun(fresh, message);
      }
    }
  }

  /** Resume point: the scenario-report webhook reached a terminal status. */
  @OnEvent(COPILOT_REPORT_COMPLETED_EVENT)
  async onReportCompleted(
    payload: CopilotReportCompletedPayload,
  ): Promise<void> {
    const run = await this.copilotRunRepository.findActiveByReportId(
      payload.reportId,
    );
    if (!run || COPILOT_END_STATUSES.includes(run.status)) {
      // Not a copilot report, or the run is already finished/cancelled.
      return;
    }

    let report;
    try {
      report = await this.scenarioReportService.getScenarioReportById(
        payload.reportId,
      );
    } catch (err) {
      this.logger.error(
        `[COPILOT] run ${run.id}: report ${payload.reportId} not readable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    if (!SCENARIO_REPORT_END_STATUSES.includes(report.status)) {
      return; // Not actually terminal yet.
    }

    if (report.status !== ScenarioReportStatus.COMPLETED) {
      // The practice conversation / evaluation failed or was cancelled — we
      // cannot score this round. Fail the run with the report's reason.
      await this.failRun(
        run,
        report.errorMessage ??
          `Practice conversation ${report.status.toLowerCase()} for round ${run.round}`,
      );
      return;
    }

    const composite = computeCompositeScore(report.metrics);
    const roundEntry: CopilotRoundHistoryEntry = {
      round: run.round,
      score: composite,
      metrics: report.metrics,
      reportMarkdown: report.reportMarkdown,
      fieldValues: run.fieldValues,
      reportId: payload.reportId,
    };
    run.roundHistory = [...(run.roundHistory ?? []), roundEntry];

    if (
      composite !== null &&
      (run.bestScore == null || composite > run.bestScore)
    ) {
      run.bestScore = composite;
      run.bestFieldValues = run.fieldValues;
    }
    run.currentReportId = undefined;

    this.logger.info(
      `[COPILOT] run ${run.id} round ${run.round} scored ${composite ?? 'n/a'} ` +
        `(best=${run.bestScore ?? 'n/a'}, threshold=${COPILOT_SCORE_THRESHOLD})`,
    );

    if (composite !== null && composite >= COPILOT_SCORE_THRESHOLD) {
      run.status = CopilotRunStatus.SUCCEEDED;
      run.endedAt = new Date();
      await this.copilotRunRepository.save(run);
      return;
    }

    if (run.round >= COPILOT_MAX_ROUNDS) {
      run.status = CopilotRunStatus.FAILED;
      run.errorMessage = `Reached ${COPILOT_MAX_ROUNDS} rounds without scoring ${COPILOT_SCORE_THRESHOLD}+ (best ${run.bestScore ?? 0}).`;
      run.endedAt = new Date();
      await this.copilotRunRepository.save(run);
      return;
    }

    // Refine: another round with this round's feedback.
    run.status = CopilotRunStatus.REFINING;
    run.round = run.round + 1;
    await this.copilotRunRepository.save(run);
    void this.runRound(run.id);
  }

  // ------------------------------------------------------------------
  // Generation
  // ------------------------------------------------------------------

  /**
   * Generate the actor's field values for one round. The prose core (role
   * instruction, title, persona, description, backstory, opening statements)
   * comes from the agent-builder meta call; the structured skill-mapped fields
   * (linguistic samples, fillers, behaviours, states, knowledge) come from
   * per-field, dependency-ordered generators.
   */
  private async generateFields(
    run: CopilotRun,
    feedback: string | undefined,
  ): Promise<Record<string, unknown>> {
    const description = this.buildBuilderDescription(run, feedback);

    const baseResult = await this.scenarioService.generateAgentSystemPrompt({
      description,
      model: run.config.model,
      provider: run.config.provider,
    });
    const base = parseCopilotBaseOutput(baseResult.systemPrompt) ?? {};

    const fieldValues: Record<string, unknown> = {
      roleInstruction:
        base.roleInstruction?.trim() || `You are role-playing: ${run.brief}`,
      title: base.title?.trim() || this.deriveTitle(run.brief),
      description: base.description ?? '',
      characterBackstory: base.characterBackstory ?? '',
      openingStatements: Array.isArray(base.openingStatements)
        ? base.openingStatements.filter(
            (s) => typeof s === 'string' && s.trim(),
          )
        : [],
      persona: base.persona ?? {},
      customFields: Array.isArray(base.customFields) ? base.customFields : [],
    };

    // Resolve the skill's available variables to decide which structured
    // fields to generate ("only fields mapped to the skill").
    const { availableVariableNames, hasStates } = await this.resolveSkillShape(
      run.config.skillPromptCode,
    );
    const tiers = planStructuredGeneration(availableVariableNames, hasStates);

    const sharedContext = {
      title: (fieldValues.title as string) || 'Practice scenario',
      characterProfileText: (fieldValues.characterBackstory as string) || '',
      challengeDescription: (fieldValues.description as string) || '',
      competency: run.config.competencyName,
      languageId: String(run.config.languageId),
      languageCode: run.config.languageCode,
    };

    for (const tier of tiers) {
      const results = await Promise.all(
        tier.map((field) =>
          this.generateOneField(run, field, sharedContext, feedback),
        ),
      );
      for (const result of results) {
        if (result) fieldValues[result.field] = result.content;
      }
    }

    return fieldValues;
  }

  private async generateOneField(
    run: CopilotRun,
    field: GeneratableField,
    sharedContext: {
      title: string;
      characterProfileText: string;
      challengeDescription: string;
      competency?: string;
      languageId: string;
      languageCode: string;
    },
    feedback: string | undefined,
  ): Promise<{ field: GeneratableField; content: unknown } | null> {
    try {
      const scenarioContext: Record<string, unknown> = {
        ...sharedContext,
        // Forward-compat: refinement feedback is available to any field prompt
        // that opts to consume {{improvementRecommendation}}.
        ...(feedback ? { improvementRecommendation: feedback } : {}),
      };
      if (field === GeneratableField.STATES) {
        scenarioContext.numStates = DEFAULT_NUM_STATES;
      }
      if (field === GeneratableField.KNOWLEDGE_SOURCES) {
        scenarioContext.numKnowledgeSources = DEFAULT_NUM_KNOWLEDGE_SOURCES;
      }

      const { content } = await this.scenarioService.generateField({
        fieldName: field,
        scenarioContext: scenarioContext as never,
        model: run.config.model,
        provider: run.config.provider,
      });
      return { field, content };
    } catch (error) {
      // A single field failing must not abort the whole round — the actor can
      // still run without optional enrichment (behaviours/states/knowledge).
      this.logger.warn(
        `[COPILOT] run ${run.id} round ${run.round}: field ${field} generation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** Build the agent-builder description, injecting refinement feedback on round >= 2. */
  private buildBuilderDescription(
    run: CopilotRun,
    feedback: string | undefined,
  ): string {
    if (!feedback) return run.brief;
    return (
      `${run.brief}\n\n` +
      `## Revision context (round ${run.round})\n` +
      `A previous version of this roleplay actor was tested in a simulated ` +
      `practice conversation and scored below target. Address the evaluation ` +
      `feedback below to make the actor a more realistic, challenging, and ` +
      `consistent training partner, while preserving what already worked.\n\n` +
      `### Evaluation feedback\n${feedback.slice(0, MAX_FEEDBACK_CHARS)}`
    );
  }

  // ------------------------------------------------------------------
  // Persistence mapping (generated values -> scenario update DTO)
  // ------------------------------------------------------------------

  private buildUpdateDto(
    fieldValues: Record<string, unknown>,
    run: CopilotRun,
  ): UpdateScenarioDto {
    const languageKey = String(run.config.languageId);
    const persona = (fieldValues.persona ?? {}) as Record<string, unknown>;
    const dto: Record<string, unknown> = {
      status: ScenarioStatus.DRAFT,
      title: fieldValues.title,
      prompt: fieldValues.roleInstruction,
      description: fieldValues.description,
      characterProfileText: fieldValues.characterBackstory,
      competencyId: run.config.competencyId,
      selectedMainPromptCode: run.config.skillPromptCode,
      // Persona demographics persist into metadata (no typed columns).
      name: persona.name,
      age: typeof persona.age === 'number' ? persona.age : undefined,
      gender: persona.gender,
      genderIdentity: persona.genderIdentity,
      sexualOrientation: persona.sexualOrientation,
      profession: persona.profession,
      currentLocation: persona.currentLocation,
    };

    if (
      Array.isArray(fieldValues.openingStatements) &&
      fieldValues.openingStatements.length > 0
    ) {
      dto.openingStatements = fieldValues.openingStatements;
    }

    const linguistic = fieldValues[GeneratableField.LINGUISTIC_STYLE_SAMPLES];
    if (Array.isArray(linguistic) && linguistic.length > 0) {
      dto.linguisticStyleSamples = { [languageKey]: linguistic };
    }

    const fillers = fieldValues[GeneratableField.ALLOWED_FILLER_WORDS];
    if (Array.isArray(fillers) && fillers.length > 0) {
      dto.allowedFillerWords = { [languageKey]: fillers };
    }

    const behavior = fieldValues[GeneratableField.BEHAVIOR_INSTRUCTIONS] as
      | { instructions?: any[]; stateNames?: any[] }
      | undefined;
    if (behavior?.instructions?.length) {
      dto.behaviorInstructions = behavior.instructions.map((item) => ({
        category: item.category,
        behaviors: Array.isArray(item.behaviors)
          ? item.behaviors
              .map((b: { id?: string }) => b?.id)
              .filter((id: unknown): id is string => typeof id === 'string')
          : [],
        stateInstructions: Array.isArray(item.stateInstructions)
          ? item.stateInstructions.map(
              (si: { stateId: string; instruction?: string }) => ({
                stateId: String(si.stateId),
                instruction: si.instruction ?? '',
              }),
            )
          : [],
      }));
      if (Array.isArray(behavior.stateNames) && behavior.stateNames.length) {
        dto.stateNames = behavior.stateNames;
      }
    }

    const states = fieldValues[GeneratableField.STATES];
    if (Array.isArray(states) && states.length > 0) {
      dto.states = states.map((s: Record<string, unknown>, index: number) => ({
        id: String(index + 1),
        name: s.name ?? `State ${index + 1}`,
        guidelines: s.guidelines ?? '',
        scoreLower: typeof s.scoreLower === 'number' ? s.scoreLower : null,
        scoreUpper: typeof s.scoreUpper === 'number' ? s.scoreUpper : null,
        ragEnabled: typeof s.ragEnabled === 'boolean' ? s.ragEnabled : true,
      }));
    }

    const knowledge = fieldValues[GeneratableField.KNOWLEDGE_SOURCES];
    if (Array.isArray(knowledge) && knowledge.length > 0) {
      dto.knowledgeSources = knowledge.map((k: Record<string, unknown>) => ({
        id: uuidv4(),
        title: k.title ?? 'Reference',
        content: k.content ?? '',
      }));
    }

    return dto as unknown as UpdateScenarioDto;
  }

  // ------------------------------------------------------------------
  // Auto defaults
  // ------------------------------------------------------------------

  private async resolveProvider(
    model?: string,
  ): Promise<'openai' | 'anthropic'> {
    if (!model) return 'openai';
    try {
      const models = await this.scenarioService.getAvailableModels();
      const match = models.find((m) => m.value === model);
      return match?.provider === 'anthropic' ? 'anthropic' : 'openai';
    } catch {
      return 'openai';
    }
  }

  private async resolveDefaultLanguageVoice(): Promise<{
    languageId: number;
    languageCode: string;
    voiceId: string;
  }> {
    const languages =
      await this.scenarioVoicesRepository.getLanguagesWithVoices(true, true);
    const english =
      languages.find((l) => l.value === COPILOT_DEFAULT_LANGUAGE_VALUE) ??
      languages.find((l) => l.translationCode === 'en') ??
      languages.find((l) => l.voices?.length > 0);
    const voiceId = english?.voices?.[0]?.id;
    if (!english || !voiceId) {
      throw new BadRequestException(
        'No language with an available voice is configured; cannot build a practice actor.',
      );
    }
    return {
      languageId: english.language_id,
      languageCode: english.value,
      voiceId,
    };
  }

  private async resolveCompetency(
    brief: string,
    model?: string,
  ): Promise<{ id: string; name: string }> {
    const { data: competencies } =
      await this.competencyService.getCompetencies();
    if (!competencies || competencies.length === 0) {
      throw new BadRequestException(
        'No competencies are configured. Add at least one competency before using Copilot.',
      );
    }

    const chosenId = await this.openAIAutofillService
      .selectCompetency(brief, competencies, model)
      .catch(() => null);
    const chosen =
      competencies.find((c) => c.id === chosenId) ?? competencies[0];
    return { id: chosen.id, name: chosen.name };
  }

  private async resolveSkillShape(skillPromptCode?: string): Promise<{
    availableVariableNames: Set<string>;
    hasStates: boolean;
  }> {
    if (!skillPromptCode) {
      return { availableVariableNames: new Set(), hasStates: false };
    }
    try {
      const prompts = await this.promptSharedService.getPromptsByOptions({
        promptCode: [skillPromptCode],
      });
      const prompt = prompts[0] as
        | { availableVariables?: unknown[]; hasStates?: boolean }
        | undefined;
      return {
        availableVariableNames: extractAvailableVariableNames(
          prompt?.availableVariables as never,
        ),
        hasStates: Boolean(prompt?.hasStates),
      };
    } catch (error) {
      this.logger.warn(
        `[COPILOT] could not resolve skill ${skillPromptCode}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { availableVariableNames: new Set(), hasStates: false };
    }
  }

  private async createDraftScenario(
    competencyId: string,
    languageId: number,
    voiceId: string,
    skillPromptCode: string | undefined,
    userId: number,
  ): Promise<number> {
    const draft: Partial<CreateScenarioDto> = {
      status: ScenarioStatus.DRAFT,
      title: 'Copilot draft (building…)',
      competencyId,
      languageVoices: { [String(languageId)]: voiceId },
      selectedMainPromptCode: skillPromptCode,
      isGlobal: false,
      isPublic: false,
    };
    const created = await this.scenarioService.createScenarios(
      { scenarios: [draft] } as never,
      userId,
    );
    const draftScenario = created?.[0];
    if (!draftScenario?.id) {
      throw new BadRequestException('Failed to provision draft scenario');
    }
    return draftScenario.id;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private latestReportMarkdown(run: CopilotRun): string | undefined {
    const history = run.roundHistory ?? [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const md = history[i]?.reportMarkdown;
      if (md && md.trim()) return md;
    }
    return undefined;
  }

  private deriveTitle(brief: string): string {
    const firstLine = brief.trim().split('\n')[0] ?? 'Roleplay actor';
    return firstLine.slice(0, 100);
  }

  private async failRun(run: CopilotRun, message: string): Promise<void> {
    run.status = CopilotRunStatus.FAILED;
    run.errorMessage = message.slice(0, 500);
    run.endedAt = new Date();
    run.currentReportId = undefined;
    await this.copilotRunRepository.save(run);
    this.logger.error(`[COPILOT] run ${run.id} FAILED: ${message}`);
  }

  private toDto(run: CopilotRun): CopilotRunDto {
    return {
      id: run.id,
      status: run.status,
      brief: run.brief,
      config: run.config,
      draftScenarioId: run.draftScenarioId,
      round: run.round,
      bestScore: run.bestScore,
      bestFieldValues: run.bestFieldValues,
      roundHistory: run.roundHistory,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      endedAt: run.endedAt,
    };
  }
}
