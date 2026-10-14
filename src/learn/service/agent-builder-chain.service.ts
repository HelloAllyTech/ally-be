import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { sanitizeDescriptionHtml } from 'src/common/util/sanitize-html.util';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioCharacterRequestDto } from 'src/scenario-character/dto/scenario-character.dto';
import { ScenarioCharacter } from 'src/scenario-character/entity/scenario-character.entity';
import { ScenarioCharacterService } from 'src/scenario-character/service/scenario-character.service';
import { CreateScenarioDto } from '../dto/create-scenario.dto';
import {
  EstablishedContextDto,
  EstablishedPersonaDto,
  GenerateAgentBuilderFieldDto,
} from '../dto/generate-agent-builder-field.dto';
import { AgentBuilderField } from '../enum/agent-builder-field.enum';
import { Gender, GenderIdentity, SexualOrientation } from '../enum/gender.enum';
import { ScenarioCategory } from '../enum/scenario-category.enum';
import { ScenarioDifficultyLevel, ScenarioStatus } from '../type/scenario.type';
import { ScenarioService } from './scenario.service';
import { ScenarioSharedService } from './scenario-shared.service';

/**
 * Most languages one generated roleplay is built in. Each language adds three
 * field calls (opening dialogues, style samples, filler words), so this is the
 * cost ceiling as much as a content one; Course Copilot's own limit
 * (`COURSE_COPILOT_LIMITS.languagesPerRoleplay`) is the same number.
 */
export const AGENT_BUILDER_CHAIN_MAX_LANGUAGES = 4;

/** The first call plus one retry, per field. */
const FIELD_ATTEMPTS = 2;

/** What the wizard asks `knowledge_sources` for (useAgentBuilderGeneration). */
const DEFAULT_KNOWLEDGE_SOURCES = 3;

/**
 * Write caps, mirrored from the admin wizard so a server-built roleplay holds
 * exactly what a wizard-built one could: agentBuilderApply.ts `MAX_LENGTHS`
 * and scenarioLanguageUtils.ts (5 opening-dialogue slots and 5 style samples
 * per language tab, 20 filler words). The editor renders that many and drops
 * the rest on the next save, so writing more would only be lost later.
 */
const MAX_LENGTHS = {
  title: 100,
  description: 1000,
  prompt: 1500,
  // CreateScenarioDto.characterProfileText @MaxLength(2500)
  backstory: 2500,
} as const;
const OPENING_DIALOGUE_LINE_SLOTS = 5;
const STYLE_SAMPLE_COUNT = 5;
const ALLOWED_FILLER_WORDS_MAX = 20;

/** EstablishedContextDto's caps (agentBuilderApply.ts ESTABLISHED_CONTEXT_LIMITS). */
const ESTABLISHED_CONTEXT_LIMITS = {
  challengeDescription: 8000,
  text: 200,
  gender: 50,
} as const;

/**
 * What a brand-new simulation's form holds before anyone touches it: every
 * TOGGLE_BUTTON's declared default, which CreateSimulation seeds as the form
 * baseline (`buildToggleDefaultValues(SIMULATION_CREATOR_FIELD_GROUPS)`) and
 * the wizard's save then sends verbatim. A toggle with no declared default is
 * seeded `false`. Copied so a Course Copilot roleplay behaves at runtime like
 * one a trainer generated in the studio and saved untouched — a course should
 * not quietly get a different call experience from the library.
 *
 * Two form values are deliberately absent: `languageGlossaryEnabled` and
 * `mainPromptVariantByLanguage`. createScenarios drops both for anyone but
 * SUPER_DUPER_ADMIN, and absent already means "on"/"default" at runtime.
 */
const wizardFormBaseline = (): Partial<CreateScenarioDto> => ({
  timerMode: false,
  showScoreMeter: false,
  feedbackTabs: { debrief: true, transcript: true },
  pauseEnabled: false,
  supervisorNotesEnabled: false,
  textChatEnabled: false,
  liveTabEnabled: false,
  optGuardrails: true,
  fillerEnabled: true,
  comfortAudioEnabled: false,
  videoActorEnabled: false,
  historyTrimEnabled: true,
  fhsBenchmark: false,
  continuousBackchanneling: false,
  interimReplyEnabled: true,
  currentState: false,
  remindersEnabled: false,
});

/**
 * A saved character needs a gender identity and an orientation, which the
 * persona field does not generate. The character interview's rule applies:
 * for a straightforward identity, fold these into confident defaults rather
 * than asking (character_interview/interviewer_system.txt, IDENTITY step).
 * The trainer edits the saved character if the brief says otherwise.
 */
const GENDER_IDENTITY_BY_GENDER: Record<Gender, GenderIdentity> = {
  [Gender.FEMALE]: GenderIdentity.FEMALE_WOMAN,
  [Gender.MALE]: GenderIdentity.MALE_MAN,
  [Gender.NON_BINARY]: GenderIdentity.NONBINARY,
};
const DEFAULT_SAVED_CHARACTER_ORIENTATION = SexualOrientation.HETEROSEXUAL;

export type AgentBuilderChainDifficulty = `${ScenarioDifficultyLevel}`;

/** One new roleplay to build: the wizard's three inputs plus the course's settings. */
export interface AgentBuilderChainInput {
  /** The "Describe roleplay actor" brief — who the client is and how they behave. */
  actorDescription: string;
  /** Scalar competency; mandatory for ACTIVE and always competencyIds[0]. */
  competencyId: string;
  competencyIds: string[];
  /** Steers every field prompt, as the wizard's single competency pick does. */
  competencyName?: string;
  /** The behaviours to stress, as the comma-joined titles the wizard sends. */
  agentTestCases?: string;
  /** Agent test case ids, persisted on metadata.agentTestCaseIds as the wizard does. */
  agentTestCaseIds?: string[];
  /**
   * Numeric `languages.id` values as strings, at most four. Empty means the
   * brief decides, through the `spoken_languages` field.
   */
  languageIds: string[];
  /** Persona hints from the course; the persona field still writes the rest. */
  personaGender?: string;
  personaAge?: number;
  difficultyLevel?: AgentBuilderChainDifficulty | ScenarioDifficultyLevel;
  triggerWarningIds?: string[];
  coverImageUrl?: string | null;
  /** Used as the title when the title field cannot be generated. */
  titleHint?: string;
  /** Reuse a Character Library character instead of generating a persona. */
  characterId?: string;
  /** Also save the generated persona to the Character Library (ignored with characterId). */
  saveCharacter?: boolean;
  category: ScenarioCategory;
  /**
   * Where this roleplay came from ("Generated by Course Copilot for …").
   * Stored with the actor brief on metadata.agentBuilderDescription, the
   * field the studio keeps for the Agent Builder's brief.
   */
  provenance: string;
}

export interface AgentBuilderChainContext {
  userId: number;
  /**
   * The caller's tenant. Informational: createScenarios is scoped by user, and
   * assigning the roleplay to organisations is the caller's job.
   */
  tenantId?: string | null;
  /** Merged into every field call's usage row, e.g. `{ courseCopilotSessionId, jobId }`. */
  usageMetadata: Record<string, any>;
}

export interface AgentBuilderChainResult {
  scenarioId: number;
  title: string;
  /** The languages the roleplay was actually built in (each has a voice). */
  languageIds: string[];
  /** One line for a build panel or change log. */
  summary: string;
  /** The library character reused or saved, when there was one. */
  characterId?: string;
}

/**
 * A chain failure a caller can act on: a required field that would not
 * generate, no voiced language, or a missing execution context. `field` names
 * the Agent Builder field when one is to blame.
 */
export class AgentBuilderChainError extends Error {
  constructor(
    message: string,
    public readonly field?: AgentBuilderField,
  ) {
    super(message);
    this.name = 'AgentBuilderChainError';
  }
}

/**
 * Upper bound on the model calls one roleplay costs, before retries, for cost
 * estimates. Stage one is the challenge description and persona (plus
 * `spoken_languages` when no language was given, which then builds one);
 * stage two is title, role instruction, backstory, knowledge sources and
 * reminders, and three per-language fields; `language_voices` closes it. A
 * reused character only ever lowers this.
 */
export const estimateAgentBuilderChainCalls = (
  languageCount: number,
): number => {
  const languagesOpen = !(languageCount > 0);
  const languages = languagesOpen
    ? 1
    : Math.min(Math.floor(languageCount), AGENT_BUILDER_CHAIN_MAX_LANGUAGES);
  return 2 + (languagesOpen ? 1 : 0) + 5 + 3 * languages + 1;
};

interface ChainPersona {
  name?: string;
  age?: number;
  gender?: string;
  profession?: string;
  currentLocation?: string;
}

interface ChainLanguage {
  languageId: string;
  label: string;
}

/** A catalog row as getScenarioVoiceLanguagesForAdmin(true, true) returns it. */
interface VoicedLanguage {
  language_id: number;
  value?: string;
  label: string;
  translationCode?: string;
  voices: {
    id: string;
    name: string;
    provider?: string;
    gender?: string | null;
  }[];
}

interface SharedFieldInputs {
  actorDescription: string;
  competency?: string;
  agentTestCases?: string;
}

interface FieldCall {
  field: AgentBuilderField;
  languageId?: string;
  languageIds?: string[];
  personaGender?: string;
  personaAge?: number;
  establishedContext?: EstablishedContextDto;
  numKnowledgeSources?: number;
}

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

const truncate = (value: string, max: number): string =>
  value.length > max ? value.slice(0, max) : value;

/**
 * Truncate HTML without leaving half a tag behind: cut back to the last
 * closing `>` inside the limit, and let the sanitiser close what is open.
 * The wizard truncates blindly, which can leave a stray `<stro` as text.
 */
const truncateHtml = (html: string, max: number): string => {
  if (html.length <= max) return html;
  const cut = html.slice(0, max);
  const lastClose = cut.lastIndexOf('>');
  return lastClose > 0 ? cut.slice(0, lastClose + 1) : cut;
};

const nonEmptyLines = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const stringList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [])
    .filter(isNonEmptyString)
    .map((s) => s.trim());

/** scenarioLanguageUtils.uniqueFillerNamesPreserveOrder, case-insensitive. */
const uniqueFillers = (names: string[]): string[] => {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const toGender = (value: unknown): Gender | undefined => {
  const normalised =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (Object.values(Gender) as string[]).includes(normalised)
    ? (normalised as Gender)
    : undefined;
};

const toAge = (value: unknown): number | undefined =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 120
    ? value
    : undefined;

const dedupe = (values: (string | null | undefined)[]): string[] => [
  ...new Set(
    values.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean),
  ),
];

/**
 * Agent Builder Copilot, server-side: builds and saves one ACTIVE roleplay
 * from a free-text actor brief, running the same field chain the admin
 * wizard runs in the browser (ally-web `useAgentBuilderGeneration.ts`) and
 * assembling the same create payload its save sends
 * (`CreateSimulation.saveSimulationChangesCore`). Course Copilot calls it for
 * every new roleplay a course needs, so a generated course's practice is the
 * same kind of roleplay a trainer would have built by hand, editable in the
 * same studio.
 *
 * The chain, as in the wizard:
 *  1. In parallel, from the brief alone: `challenge_description` and
 *     `persona` — plus `spoken_languages` only when the caller left the
 *     languages open.
 *  2. In parallel, with those two attached as `establishedContext` so every
 *     field describes the same client: `title`, `role_instruction`,
 *     `backstory`, `knowledge_sources`, `reminders`, and per language
 *     `opening_statements`, `linguistic_style_samples`,
 *     `allowed_filler_words`. `states` is never generated: the wizard fires
 *     it only when the selected main prompt uses `{state_x_guidelines}`, and a
 *     chain-built roleplay selects no main prompt (the default uses none).
 *  3. `language_voices` last, casting a voice per language from the catalog;
 *     anything it does not answer for falls back to the best catalog voice
 *     for the persona's gender (the wizard's `pickVoicesForLanguages`).
 *
 * Failure policy: each field gets one retry. A required field (challenge
 * description, persona, role instruction, title, and a non-empty voice
 * mapping) that still fails fails the whole chain with AgentBuilderChainError
 * before anything is saved; an optional field falls back to empty, exactly
 * as a wizard row marked "no content generated" would.
 *
 * Context requirement: reusing a library character (`characterId`) and
 * saving a new one (`saveCharacter`) go through ScenarioCharacterService,
 * which scopes by the CURRENT user. Run the chain inside
 * `ExecutionManager.runWithContext(...)` with
 * `ExecutionManager.setAuthContext(userId, tenantId)` already called; without
 * it those two paths fail up front, before any model call is spent.
 *
 * ScenarioCharacterService is resolved lazily through ModuleRef rather than
 * injected: LearnModule does not import ScenarioCharacterModule, and adding
 * that edge would pull the character module's KnowledgeBase → Ai imports into
 * LearnModule's existing forwardRef cycles. The import here is the class
 * token only; its file pulls in no module or user service.
 */
@Injectable()
export class AgentBuilderChainService {
  private readonly logger = LoggerService.getInstance(
    AgentBuilderChainService.name,
  );

  constructor(
    private readonly scenarioService: ScenarioService,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** See estimateAgentBuilderChainCalls. */
  estimateCalls(languageCount: number): number {
    return estimateAgentBuilderChainCalls(languageCount);
  }

  async buildScenarioFromBrief(
    input: AgentBuilderChainInput,
    ctx: AgentBuilderChainContext,
  ): Promise<AgentBuilderChainResult> {
    this.assertInput(input);
    const reuseCharacter = isNonEmptyString(input.characterId);
    const saveCharacter = !reuseCharacter && input.saveCharacter === true;
    if (reuseCharacter || saveCharacter) this.assertUserContext();

    const catalog = await this.loadVoicedCatalog();
    const requested = this.resolveRequestedLanguages(
      input.languageIds,
      catalog,
    );
    const character = reuseCharacter
      ? await this.loadCharacter(input.characterId as string)
      : undefined;

    const shared: SharedFieldInputs = {
      actorDescription: this.composeBrief(input),
      competency: input.competencyName?.trim() || undefined,
      agentTestCases: input.agentTestCases?.trim() || undefined,
    };

    // ── Stage 1 ─────────────────────────────────────────────────────────
    const [challengeRun, personaRun, languagesRun] = await Promise.allSettled([
      this.generateField<string>(
        { field: AgentBuilderField.CHALLENGE_DESCRIPTION },
        shared,
        ctx,
        { required: true, usable: isNonEmptyString },
      ),
      character
        ? Promise.resolve(this.personaFromCharacter(character))
        : this.generateField<ChainPersona>(
            { field: AgentBuilderField.PERSONA },
            shared,
            ctx,
            {
              required: true,
              usable: (v) => isNonEmptyString((v as ChainPersona)?.name),
            },
          ),
      requested.languages.length > 0
        ? Promise.resolve(requested.languages)
        : this.detectSpokenLanguages(shared, ctx, catalog),
    ]);
    const challengeDescription = this.settled(challengeRun) as string;
    const persona = this.withPersonaHints(
      this.settled(personaRun) as ChainPersona,
      input,
    );
    const languages = (this.settled(languagesRun) as ChainLanguage[]).slice(
      0,
      AGENT_BUILDER_CHAIN_MAX_LANGUAGES,
    );

    const establishedContext = this.buildEstablishedContext(
      challengeDescription,
      persona,
    );

    // ── Stage 2 ─────────────────────────────────────────────────────────
    const characterSamples = character?.linguisticStyleSamples ?? {};
    const characterKnowledge = Array.isArray(character?.knowledgeSources)
      ? character!.knowledgeSources!
      : [];
    const titleRequired = !isNonEmptyString(input.titleHint);
    const optional = (usable: (v: unknown) => boolean) => ({
      required: false,
      usable,
    });
    const nonEmptyArray = (v: unknown) => Array.isArray(v) && v.length > 0;

    const stageTwo = await Promise.allSettled([
      this.generateField<string>(
        { field: AgentBuilderField.TITLE, establishedContext },
        shared,
        ctx,
        { required: titleRequired, usable: isNonEmptyString },
      ),
      this.generateField<string>(
        { field: AgentBuilderField.ROLE_INSTRUCTION, establishedContext },
        shared,
        ctx,
        { required: true, usable: isNonEmptyString },
      ),
      character
        ? Promise.resolve(character.characterProfileText ?? undefined)
        : this.generateField<string>(
            { field: AgentBuilderField.BACKSTORY, establishedContext },
            shared,
            ctx,
            optional(isNonEmptyString),
          ),
      // A character's own sources replace generated ones in the studio
      // (CharacterProfileSelector), so generating them would be discarded.
      characterKnowledge.length > 0
        ? Promise.resolve(undefined)
        : this.generateField<{ title: string; content: string }[]>(
            {
              field: AgentBuilderField.KNOWLEDGE_SOURCES,
              establishedContext,
              numKnowledgeSources: DEFAULT_KNOWLEDGE_SOURCES,
            },
            shared,
            ctx,
            optional(nonEmptyArray),
          ),
      this.generateField<string>(
        { field: AgentBuilderField.REMINDERS, establishedContext },
        shared,
        ctx,
        optional(isNonEmptyString),
      ),
      Promise.all(
        languages.map((language) =>
          this.generateLanguageFields(
            language,
            establishedContext,
            shared,
            ctx,
            stringList(characterSamples[language.languageId]).length > 0,
          ),
        ),
      ),
    ]);
    const [
      titleRun,
      roleInstructionRun,
      backstoryRun,
      knowledgeRun,
      remindersRun,
      perLanguageRun,
    ] = stageTwo;
    // Settle in order so the first required failure is the one reported.
    const generatedTitle = this.settled(titleRun) as string | undefined;
    const roleInstruction = this.settled(roleInstructionRun) as string;
    const backstory = this.settled(backstoryRun) as string | undefined;
    const generatedKnowledge = this.settled(knowledgeRun) as
      | { title: string; content: string }[]
      | undefined;
    const reminders = this.settled(remindersRun) as string | undefined;
    const perLanguage = this.settled(perLanguageRun) as LanguageFields[];

    // ── Stage 3: voices ─────────────────────────────────────────────────
    const voiced = await this.castVoices(
      languages,
      persona,
      establishedContext,
      character,
      catalog,
      shared,
      ctx,
    );
    const finalLanguages = languages.filter(
      (l) => voiced.languageVoices[l.languageId],
    );
    if (finalLanguages.length === 0) {
      throw new AgentBuilderChainError(
        'None of the roleplay languages could be given a voice, so it cannot ' +
          'be published. Add an active voice for ' +
          `${languages.map((l) => l.label).join(', ')} under Voices, then retry.`,
        AgentBuilderField.LANGUAGE_VOICES,
      );
    }

    const title = generatedTitle?.trim() || (input.titleHint as string).trim();
    const dto = await this.assembleScenarioDto({
      input,
      title,
      challengeDescription,
      roleInstruction,
      persona,
      backstory,
      generatedKnowledge,
      reminders,
      perLanguage: perLanguage.filter((p) =>
        finalLanguages.some((l) => l.languageId === p.languageId),
      ),
      languages: finalLanguages,
      languageVoices: voiced.languageVoices,
      character,
    });

    const [scenario] = await this.scenarioService.createScenarios(
      { scenarios: [dto] },
      ctx.userId,
    );

    let characterId = character?.id;
    const notes: string[] = [];
    if (requested.dropped.length > 0) {
      notes.push(`skipped ${requested.dropped.join(', ')} (no voice)`);
    }
    if (character) notes.push(`reused character ${character.name}`);
    if (saveCharacter) {
      const saved = await this.saveGeneratedCharacter(dto, persona);
      if (saved.id) {
        characterId = saved.id;
        notes.push('saved to Character Library');
      } else {
        notes.push(`not saved to Character Library: ${saved.reason}`);
      }
    }
    if (!backstory) notes.push('no backstory');

    return {
      scenarioId: scenario.id,
      title: dto.title as string,
      languageIds: finalLanguages.map((l) => l.languageId),
      summary: this.summarise(dto, persona, finalLanguages, notes),
      ...(characterId ? { characterId } : {}),
    };
  }

  // ── Field calls ───────────────────────────────────────────────────────

  /**
   * One field, retried once. "Failed" means the call threw OR returned
   * nothing usable — an empty title is as much a failure as a 500, and one
   * more call is cheaper than a roleplay with a blank field. A required field
   * that fails twice throws; an optional one resolves undefined.
   */
  private async generateField<T>(
    call: FieldCall,
    shared: SharedFieldInputs,
    ctx: AgentBuilderChainContext,
    policy: { required: boolean; usable: (value: unknown) => boolean },
  ): Promise<T | undefined> {
    const dto: GenerateAgentBuilderFieldDto = {
      field: call.field,
      actorDescription: shared.actorDescription,
      ...(shared.competency ? { competency: shared.competency } : {}),
      ...(shared.agentTestCases
        ? { agentTestCases: shared.agentTestCases }
        : {}),
      ...(call.languageId ? { languageId: call.languageId } : {}),
      ...(call.languageIds ? { languageIds: call.languageIds } : {}),
      ...(call.personaGender ? { personaGender: call.personaGender } : {}),
      ...(call.personaAge !== undefined ? { personaAge: call.personaAge } : {}),
      ...(call.establishedContext
        ? { establishedContext: call.establishedContext }
        : {}),
      ...(call.numKnowledgeSources
        ? { numKnowledgeSources: call.numKnowledgeSources }
        : {}),
    };
    // The scenario service adds `field`; the language is added here so a
    // per-language call can be told apart on the usage row.
    const usageMetadata = call.languageId
      ? { ...ctx.usageMetadata, languageId: call.languageId }
      : { ...ctx.usageMetadata };
    const label = call.languageId
      ? `${call.field} (language ${call.languageId})`
      : call.field;

    let problem = 'no attempt was made';
    for (let attempt = 1; attempt <= FIELD_ATTEMPTS; attempt++) {
      try {
        const { value } = await this.scenarioService.generateAgentBuilderField(
          dto,
          { usageMetadata },
        );
        if (policy.usable(value)) return value as T;
        problem = 'the model returned nothing usable';
      } catch (error) {
        problem = (error as Error)?.message ?? String(error);
      }
      this.logger.warn(
        `[AGENT_BUILDER_CHAIN] ${label} attempt ${attempt}/${FIELD_ATTEMPTS} failed: ${problem}`,
      );
    }
    if (policy.required) {
      throw new AgentBuilderChainError(
        `Could not generate the roleplay's ${label}, which it cannot be ` +
          `published without (tried ${FIELD_ATTEMPTS} times): ${problem}`,
        call.field,
      );
    }
    return undefined;
  }

  /** The three per-language fields for one language, in parallel. */
  private async generateLanguageFields(
    language: ChainLanguage,
    establishedContext: EstablishedContextDto | undefined,
    shared: SharedFieldInputs,
    ctx: AgentBuilderChainContext,
    characterHasSamples: boolean,
  ): Promise<LanguageFields> {
    const optional = (usable: (v: unknown) => boolean) => ({
      required: false,
      usable,
    });
    const nonEmptyArray = (v: unknown) => Array.isArray(v) && v.length > 0;
    const base = { languageId: language.languageId, establishedContext };
    const [openingStatements, styleSamples, fillerWords] = await Promise.all([
      this.generateField<string>(
        { ...base, field: AgentBuilderField.OPENING_STATEMENTS },
        shared,
        ctx,
        optional(isNonEmptyString),
      ),
      characterHasSamples
        ? Promise.resolve(undefined)
        : this.generateField<string[]>(
            { ...base, field: AgentBuilderField.LINGUISTIC_STYLE_SAMPLES },
            shared,
            ctx,
            optional(nonEmptyArray),
          ),
      this.generateField<string[]>(
        { ...base, field: AgentBuilderField.ALLOWED_FILLER_WORDS },
        shared,
        ctx,
        optional(nonEmptyArray),
      ),
    ]);
    return {
      languageId: language.languageId,
      openingStatements,
      styleSamples,
      fillerWords,
    };
  }

  /**
   * `spoken_languages`, for a caller that left the languages to the brief.
   * Optional: the server already falls back to the primary language on an
   * unusable answer, and a call that fails twice does the same here, so the
   * roleplay is still built in one language rather than not at all.
   */
  private async detectSpokenLanguages(
    shared: SharedFieldInputs,
    ctx: AgentBuilderChainContext,
    catalog: VoicedLanguage[],
  ): Promise<ChainLanguage[]> {
    const detected = await this.generateField<
      { languageId: string; label: string }[]
    >({ field: AgentBuilderField.SPOKEN_LANGUAGES }, shared, ctx, {
      required: false,
      usable: (v) => Array.isArray(v) && v.length > 0,
    });
    const voicedIds = new Set(catalog.map((l) => String(l.language_id)));
    const languages = (detected ?? [])
      .filter((l) => voicedIds.has(String(l?.languageId)))
      .map((l) => ({ languageId: String(l.languageId), label: l.label }));
    if (languages.length > 0) return languages;
    const primary = this.primaryCatalogLanguage(catalog);
    return primary
      ? [{ languageId: String(primary.language_id), label: primary.label }]
      : [];
  }

  /**
   * Fill the language–voice mapping, the wizard's way: a reused character's
   * own voices first (CharacterProfileSelector merges them by language), then
   * the `language_voices` cast for the languages still empty, then the best
   * catalog voice for anything the cast skipped. A cast that fails is not
   * fatal — the fallback still voices every language — so `language_voices`
   * is "required" only in the sense that the final mapping must not be empty,
   * which the caller checks.
   */
  private async castVoices(
    languages: ChainLanguage[],
    persona: ChainPersona,
    establishedContext: EstablishedContextDto | undefined,
    character: ScenarioCharacter | undefined,
    catalog: VoicedLanguage[],
    shared: SharedFieldInputs,
    ctx: AgentBuilderChainContext,
  ): Promise<{ languageVoices: Record<string, string> }> {
    const byId = new Map(catalog.map((l) => [String(l.language_id), l]));
    const languageVoices: Record<string, string> = {};

    for (const language of languages) {
      const voiceId = character?.voices?.[language.languageId];
      const voices = byId.get(language.languageId)?.voices ?? [];
      // Only a voice the catalog still offers for this language: a character
      // saved before a voice was deactivated would otherwise fail validation.
      if (isNonEmptyString(voiceId) && voices.some((v) => v.id === voiceId)) {
        languageVoices[language.languageId] = voiceId;
      }
    }

    const unmapped = languages.filter((l) => !languageVoices[l.languageId]);
    if (unmapped.length === 0) return { languageVoices };

    const cast = await this.generateField<
      { languageId: string; voiceId: string }[]
    >(
      {
        field: AgentBuilderField.LANGUAGE_VOICES,
        languageIds: unmapped.map((l) => l.languageId),
        personaGender: persona.gender,
        personaAge: persona.age,
        establishedContext,
      },
      shared,
      ctx,
      // Any array is an answer: the server has already dropped ids that do
      // not belong to their language, and the fallback covers the gaps.
      { required: false, usable: (v) => Array.isArray(v) },
    );
    const unmappedIds = new Set(unmapped.map((l) => l.languageId));
    for (const pick of cast ?? []) {
      const languageId = String(pick?.languageId ?? '');
      // Enforced here as in the wizard: only the languages asked for.
      if (unmappedIds.has(languageId) && isNonEmptyString(pick.voiceId)) {
        languageVoices[languageId] = pick.voiceId;
      }
    }

    for (const language of unmapped) {
      if (languageVoices[language.languageId]) continue;
      const fallback = this.pickFallbackVoice(
        byId.get(language.languageId)?.voices ?? [],
        persona.gender,
      );
      if (fallback) {
        languageVoices[language.languageId] = fallback;
      } else {
        this.logger.warn(
          `[AGENT_BUILDER_CHAIN] ${language.label} has no active voice; dropping it`,
        );
      }
    }
    return { languageVoices };
  }

  /**
   * The best catalog voice for a persona when the cast skipped a language.
   * A reduced port of the studio's `pickVoiceForLanguage`: gender match
   * first, an unrecorded gender before a deliberate mismatch, then a stable
   * order so a re-run casts the same voice. Never excludes — an imperfectly
   * voiced language beats an unvoiced one.
   */
  private pickFallbackVoice(
    voices: VoicedLanguage['voices'],
    personaGender?: string,
  ): string | undefined {
    const wanted = (personaGender ?? '').trim().toLowerCase();
    const rank = (gender?: string | null): number => {
      if (!wanted) return 0;
      const actual = (gender ?? '').trim().toLowerCase();
      if (actual === wanted) return 0;
      return actual ? 2 : 1;
    };
    return [...voices]
      .filter((v) => isNonEmptyString(v?.id))
      .sort(
        (a, b) =>
          rank(a.gender) - rank(b.gender) ||
          (a.name ?? '').localeCompare(b.name ?? '') ||
          a.id.localeCompare(b.id),
      )[0]?.id;
  }

  // ── Assembly ─────────────────────────────────────────────────────────

  /**
   * The create payload, field for field as the wizard's save builds it
   * (CreateSimulation.saveSimulationChangesCore over the values
   * agentBuilderApply.ts wrote into the form), with the course's settings on
   * top. Values the ValidationPipe would transform on the HTTP path are
   * transformed here, because createScenarios is called directly: the
   * challenge description is sanitised as CreateScenarioDto's @Transform
   * would.
   */
  private async assembleScenarioDto(parts: {
    input: AgentBuilderChainInput;
    title: string;
    challengeDescription: string;
    roleInstruction: string;
    persona: ChainPersona;
    backstory?: string;
    generatedKnowledge?: { title: string; content: string }[];
    reminders?: string;
    perLanguage: LanguageFields[];
    languages: ChainLanguage[];
    languageVoices: Record<string, string>;
    character?: ScenarioCharacter;
  }): Promise<CreateScenarioDto> {
    const { input, persona, character } = parts;

    // Opening dialogues for the primary language live on `openingStatements`,
    // every other language's on `translationOpeningStatements` — the split
    // the Opening Dialogues panel writes. The primary is resolved the way the
    // server reads it back (metadata.defaultLanguageId, else English (India)),
    // so lines land where the studio and runtime look for them.
    const resolvedPrimary =
      await this.scenarioSharedService.resolveOpeningDialoguePrimaryLanguageId(
        null,
      );
    const primaryLanguageId =
      resolvedPrimary != null
        ? String(resolvedPrimary)
        : parts.languages[0]?.languageId;

    let openingStatements: string[] | undefined;
    const translationOpeningStatements: Record<string, string[]> = {};
    const linguisticStyleSamples: Record<string, string[]> = {};
    const allowedFillerWords: Record<string, string[]> = {};
    const scenarioLanguageIds = new Set(
      parts.languages.map((l) => l.languageId),
    );

    for (const fields of parts.perLanguage) {
      if (isNonEmptyString(fields.openingStatements)) {
        const lines = nonEmptyLines(fields.openingStatements).slice(
          0,
          OPENING_DIALOGUE_LINE_SLOTS,
        );
        if (lines.length > 0) {
          if (fields.languageId === primaryLanguageId) {
            openingStatements = lines;
          } else {
            translationOpeningStatements[fields.languageId] = lines;
          }
        }
      }
      const samples = stringList(fields.styleSamples).slice(
        0,
        STYLE_SAMPLE_COUNT,
      );
      if (samples.length > 0) {
        linguisticStyleSamples[fields.languageId] = samples;
      }
      const fillers = uniqueFillers(stringList(fields.fillerWords)).slice(
        0,
        ALLOWED_FILLER_WORDS_MAX,
      );
      if (fillers.length > 0) allowedFillerWords[fields.languageId] = fillers;
    }

    // A reused character's per-language text merges in by language, as
    // CharacterProfileSelector does — but only for this roleplay's languages:
    // the copilot caps languages, and a language without opening dialogues
    // or a deliberate voice is not one the course asked for.
    const languageCharacteristics: Record<string, string> = {};
    if (character) {
      for (const [languageId, samples] of Object.entries(
        character.linguisticStyleSamples ?? {},
      )) {
        const list = stringList(samples);
        if (scenarioLanguageIds.has(languageId) && list.length > 0) {
          linguisticStyleSamples[languageId] = list;
        }
      }
      for (const [languageId, text] of Object.entries(
        character.languageCharacteristics ?? {},
      )) {
        if (scenarioLanguageIds.has(languageId) && isNonEmptyString(text)) {
          languageCharacteristics[languageId] = text;
        }
      }
    }

    const knowledgeSources =
      character && (character.knowledgeSources ?? []).length > 0
        ? (character.knowledgeSources ?? []).map((source) => ({
            id: source.id,
            title: source.title,
            content: source.text ?? '',
          }))
        : (parts.generatedKnowledge ?? [])
            .filter(
              (k) => isNonEmptyString(k?.title) && isNonEmptyString(k?.content),
            )
            .map((k) => ({
              id: randomUUID(),
              title: k.title.trim(),
              content: k.content.trim(),
            }));

    const reminders = isNonEmptyString(parts.reminders)
      ? nonEmptyLines(parts.reminders)
      : [];

    // competencyIds[0] must be the scalar: resolveCompetencySelection derives
    // `competencyId` from the array whenever the array is sent.
    const competencyIds = dedupe([input.competencyId, ...input.competencyIds]);
    const difficultyLevel = (
      Object.values(ScenarioDifficultyLevel) as string[]
    ).includes(input.difficultyLevel ?? '')
      ? (input.difficultyLevel as ScenarioDifficultyLevel)
      : undefined;
    const coverImageUrl = isNonEmptyString(input.coverImageUrl)
      ? input.coverImageUrl
      : isNonEmptyString(character?.coverImageUrl)
        ? character!.coverImageUrl
        : undefined;
    const agentTestCaseIds = dedupe(input.agentTestCaseIds ?? []);
    const triggerWarningIds = dedupe(input.triggerWarningIds ?? []);
    const backstory = isNonEmptyString(parts.backstory)
      ? truncate(parts.backstory.trim(), MAX_LENGTHS.backstory)
      : undefined;
    const gender = toGender(persona.gender);

    const dto: CreateScenarioDto = {
      ...wizardFormBaseline(),
      // Course Copilot's fixed settings: Track 2.0 only references ACTIVE
      // roleplays, and a course-built roleplay is visible to no organisation
      // until the course is assigned to it.
      status: ScenarioStatus.ACTIVE,
      isGlobal: false,
      isPublic: false,
      category: input.category,
      title: truncate(parts.title.trim(), MAX_LENGTHS.title),
      description: sanitizeDescriptionHtml(
        truncateHtml(parts.challengeDescription, MAX_LENGTHS.description),
      ),
      prompt: truncate(parts.roleInstruction, MAX_LENGTHS.prompt),
      competencyId: competencyIds[0],
      competencyIds,
      languageVoices: parts.languageVoices,
      ...(persona.name ? { name: persona.name } : {}),
      ...(persona.age !== undefined ? { age: persona.age } : {}),
      ...(gender ? { gender } : {}),
      ...(persona.profession ? { profession: persona.profession } : {}),
      ...(persona.currentLocation
        ? { currentLocation: persona.currentLocation }
        : {}),
      ...(character?.genderIdentity
        ? { genderIdentity: character.genderIdentity as GenderIdentity }
        : {}),
      ...(character?.sexualOrientation
        ? {
            sexualOrientation: character.sexualOrientation as SexualOrientation,
          }
        : {}),
      ...(backstory ? { characterProfileText: backstory } : {}),
      ...(openingStatements ? { openingStatements } : {}),
      ...(Object.keys(translationOpeningStatements).length > 0
        ? { translationOpeningStatements }
        : {}),
      reminders,
      linguisticStyleSamples,
      allowedFillerWords,
      ...(Object.keys(languageCharacteristics).length > 0
        ? { languageCharacteristics }
        : {}),
      knowledgeSources,
      ...(difficultyLevel ? { difficultyLevel } : {}),
      ...(triggerWarningIds.length > 0 ? { triggerWarningIds } : {}),
      ...(coverImageUrl ? { coverImageUrl } : {}),
      ...(isNonEmptyString(character?.coverVideoUrl)
        ? { coverVideoUrl: character!.coverVideoUrl }
        : {}),
      ...(agentTestCaseIds.length > 0 ? { agentTestCaseIds } : {}),
      // The studio's field for the Agent Builder brief: provenance first, so
      // anyone opening the roleplay sees where it came from, then the brief
      // itself so it can be regenerated from the same words (unless the
      // caller's provenance already quotes it).
      agentBuilderDescription: this.describeProvenance(input),
    };
    return dto;
  }

  private describeProvenance(input: AgentBuilderChainInput): string {
    const provenance = input.provenance?.trim() ?? '';
    const brief = input.actorDescription.trim();
    if (!provenance) return brief;
    return provenance.includes(brief)
      ? provenance
      : `${provenance}\n\n${brief}`;
  }

  /**
   * Save the generated persona as a library character so the trainer can
   * reuse it. Runs after the roleplay exists and never fails the chain: the
   * roleplay is what the course needs, and failing here would make the job
   * retry and build a duplicate roleplay. The reason is returned for the
   * summary instead.
   */
  private async saveGeneratedCharacter(
    dto: CreateScenarioDto,
    persona: ChainPersona,
  ): Promise<{ id?: string; reason?: string }> {
    const gender = toGender(persona.gender);
    const missing = [
      !persona.name && 'name',
      persona.age === undefined && 'age',
      !gender && 'gender',
      !persona.profession && 'profession',
      !persona.currentLocation && 'location',
    ].filter((m): m is string => Boolean(m));
    if (missing.length > 0) {
      return { reason: `persona has no ${missing.join(', ')}` };
    }
    const request: ScenarioCharacterRequestDto = {
      name: persona.name as string,
      age: persona.age as number,
      gender: gender as Gender,
      profession: persona.profession as string,
      currentLocation: persona.currentLocation as string,
      genderIdentity: GENDER_IDENTITY_BY_GENDER[gender as Gender],
      sexualOrientation: DEFAULT_SAVED_CHARACTER_ORIENTATION,
      ...(dto.characterProfileText
        ? { characterProfileText: dto.characterProfileText }
        : {}),
      voices: { ...(dto.languageVoices ?? {}) },
      ...(dto.linguisticStyleSamples &&
      Object.keys(dto.linguisticStyleSamples).length > 0
        ? { linguisticStyleSamples: dto.linguisticStyleSamples }
        : {}),
      ...((dto.knowledgeSources ?? []).length > 0
        ? {
            knowledgeSources: (dto.knowledgeSources ?? []).map((k) => ({
              id: k.id,
              title: k.title,
              text: k.content,
            })),
          }
        : {}),
    } as ScenarioCharacterRequestDto;
    try {
      const saved =
        await this.characterService().createScenarioCharacter(request);
      return { id: saved.id };
    } catch (error) {
      const reason = (error as Error)?.message ?? String(error);
      this.logger.warn(
        `[AGENT_BUILDER_CHAIN] Roleplay built but its character was not saved: ${reason}`,
      );
      return { reason };
    }
  }

  // ── Inputs ───────────────────────────────────────────────────────────

  private assertInput(input: AgentBuilderChainInput): void {
    if (!isNonEmptyString(input?.actorDescription)) {
      throw new AgentBuilderChainError(
        'An actor description is required to build a roleplay.',
      );
    }
    if (!isNonEmptyString(input.competencyId)) {
      throw new AgentBuilderChainError(
        'A competency is required: an ACTIVE roleplay must name the skill it trains.',
      );
    }
    if (!input.category) {
      throw new AgentBuilderChainError('A scenario category is required.');
    }
  }

  private assertUserContext(): void {
    if (!ExecutionManager.getUserId()) {
      throw new AgentBuilderChainError(
        'Reusing or saving a library character needs a user context: run ' +
          'buildScenarioFromBrief inside ExecutionManager.runWithContext() ' +
          'after ExecutionManager.setAuthContext(userId, tenantId).',
      );
    }
  }

  private async loadVoicedCatalog(): Promise<VoicedLanguage[]> {
    const catalog =
      ((await this.scenarioService.getScenarioVoiceLanguagesForAdmin(
        true,
        true,
      )) ?? []) as VoicedLanguage[];
    const voiced = catalog.filter((l) => (l.voices ?? []).length > 0);
    if (voiced.length === 0) {
      throw new AgentBuilderChainError(
        'No active language has an active voice, so no roleplay can be voiced. ' +
          'Add a voice under Voices, then retry.',
        AgentBuilderField.LANGUAGE_VOICES,
      );
    }
    return voiced;
  }

  /**
   * The caller's languages, narrowed to ones that can be voiced and capped.
   * Checked before any model call: a language without a voice is unreachable
   * at runtime, so generating its dialogues would be spend on nothing.
   */
  private resolveRequestedLanguages(
    languageIds: string[] | undefined,
    catalog: VoicedLanguage[],
  ): { languages: ChainLanguage[]; dropped: string[] } {
    const requested = dedupe((languageIds ?? []).map((id) => String(id)));
    if (requested.length === 0) return { languages: [], dropped: [] };
    const byId = new Map(catalog.map((l) => [String(l.language_id), l]));
    const languages = requested
      .filter((id) => byId.has(id))
      .map((id) => ({ languageId: id, label: byId.get(id)!.label }));
    const dropped = requested.filter((id) => !byId.has(id));
    if (languages.length === 0) {
      throw new AgentBuilderChainError(
        `None of the requested languages (ids ${requested.join(', ')}) has an ` +
          'active voice, so the roleplay could not be voiced in any of them.',
        AgentBuilderField.LANGUAGE_VOICES,
      );
    }
    if (dropped.length > 0) {
      this.logger.warn(
        `[AGENT_BUILDER_CHAIN] Dropping languages with no active voice: ${dropped.join(', ')}`,
      );
    }
    return {
      languages: languages.slice(0, AGENT_BUILDER_CHAIN_MAX_LANGUAGES),
      dropped: dropped.map((id) => `language ${id}`),
    };
  }

  /**
   * The brief every field reads. Course persona hints ride on the brief
   * itself, as the wizard's established context does, so the persona call
   * honours them and every later field agrees with it.
   */
  private composeBrief(input: AgentBuilderChainInput): string {
    const gender = toGender(input.personaGender);
    const age = toAge(input.personaAge);
    const hints = [gender && `gender ${gender}`, age && `age ${age}`].filter(
      Boolean,
    );
    const brief = input.actorDescription.trim();
    return hints.length > 0
      ? `${brief}\n\nPersona: ${hints.join(', ')}.`
      : brief;
  }

  private async loadCharacter(id: string): Promise<ScenarioCharacter> {
    try {
      return await this.characterService().getScenarioCharacterById(id);
    } catch (error) {
      throw new AgentBuilderChainError(
        `Character ${id} could not be loaded for reuse: ${
          (error as Error)?.message ?? String(error)
        }`,
      );
    }
  }

  private characterService(): ScenarioCharacterService {
    return this.moduleRef.get(ScenarioCharacterService, { strict: false });
  }

  private personaFromCharacter(character: ScenarioCharacter): ChainPersona {
    return {
      name: character.name?.trim() || undefined,
      age: toAge(character.age),
      gender: toGender(character.gender) ?? character.gender ?? undefined,
      profession: character.profession?.trim() || undefined,
      currentLocation: character.currentLocation?.trim() || undefined,
    };
  }

  /**
   * Fill what the persona call left blank from the course's hints. Hints
   * never overwrite a generated value: the name the persona chose was chosen
   * for its gender and age, and the hints were already in the brief it read.
   */
  private withPersonaHints(
    persona: ChainPersona,
    input: AgentBuilderChainInput,
  ): ChainPersona {
    return {
      ...persona,
      gender: persona.gender ?? toGender(input.personaGender),
      age: persona.age ?? toAge(input.personaAge),
    };
  }

  /**
   * What stage one settled, shaped and capped as the wizard's
   * readEstablishedContext does. Undefined when there is nothing to send.
   */
  private buildEstablishedContext(
    challengeDescription: string,
    persona: ChainPersona,
  ): EstablishedContextDto | undefined {
    const text = (value: string | undefined, max: number) =>
      isNonEmptyString(value) ? truncate(value.trim(), max) : undefined;
    const candidate: EstablishedPersonaDto = {
      name: text(persona.name, ESTABLISHED_CONTEXT_LIMITS.text),
      age: toAge(persona.age),
      gender: text(persona.gender, ESTABLISHED_CONTEXT_LIMITS.gender),
      profession: text(persona.profession, ESTABLISHED_CONTEXT_LIMITS.text),
      currentLocation: text(
        persona.currentLocation,
        ESTABLISHED_CONTEXT_LIMITS.text,
      ),
    };
    const present = Object.fromEntries(
      Object.entries(candidate).filter(([, v]) => v !== undefined),
    ) as EstablishedPersonaDto;
    const challenge = text(
      challengeDescription,
      ESTABLISHED_CONTEXT_LIMITS.challengeDescription,
    );
    const hasPersona = Object.keys(present).length > 0;
    if (!challenge && !hasPersona) return undefined;
    return {
      ...(challenge ? { challengeDescription: challenge } : {}),
      ...(hasPersona ? { persona: present } : {}),
    };
  }

  /** The catalog's English row, else its first (ScenarioService.primaryCatalogLanguage). */
  private primaryCatalogLanguage(
    catalog: VoicedLanguage[],
  ): VoicedLanguage | undefined {
    return (
      catalog.find(
        (l) =>
          (l.translationCode || l.value || '')
            .trim()
            .toLowerCase()
            .startsWith('en') || l.label?.trim().toLowerCase() === 'english',
      ) ?? catalog[0]
    );
  }

  private settled<T>(result: PromiseSettledResult<T>): T {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  }

  private summarise(
    dto: CreateScenarioDto,
    persona: ChainPersona,
    languages: ChainLanguage[],
    notes: string[],
  ): string {
    const who = [
      persona.name,
      persona.age !== undefined ? `${persona.age}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    const parts = [
      `"${dto.title}"`,
      who ? `client ${who}` : '',
      languages.map((l) => l.label).join(', '),
    ].filter(Boolean);
    return [parts.join(' · '), ...notes].join('; ');
  }
}

interface LanguageFields {
  languageId: string;
  openingStatements?: string;
  styleSamples?: string[];
  fillerWords?: string[];
}
