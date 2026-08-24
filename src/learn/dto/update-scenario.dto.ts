import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsUUID,
  IsArray,
  IsBoolean,
  Validate,
  ValidateNested,
  IsObject,
  ArrayMaxSize,
  ValidateIf,
  IsNotEmpty,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

import {
  ScenarioDifficultyLevel,
  ScenarioStatus,
  ExperienceMode,
  ChecklistType,
  FeedbackTabsConfig,
} from '../type/scenario.type';
import { Gender, GenderIdentity, SexualOrientation } from '../enum/gender.enum';
import { ScenarioCategory } from '../enum/scenario-category.enum';
import { CustomFieldsDto } from './custom-fields.dto';
import { IsConfigIdByLanguageConstraint } from './config-id-by-language.constraint';
import {
  MAX_CUSTOM_FIELDS_COUNT,
  MAX_KNOWLEDGE_SOURCES_COUNT,
} from '../constants/scenario.constants';
import { TerminationEventsDto } from './termination-events.dto';
import { BehaviorInstructionDto } from './behavior-instruction.dto';
import { MAX_BEHAVIOR_INSTRUCTIONS_COUNT } from '../constants/scenario-behavior-instuctions.constants';
import { KnowledgeSourceDto } from './knowledge-source.dto';
import { SimulationStateDto } from './simulation-state.dto';
import { StateNamesDto } from './state-names.dto';
import { sanitizeDescriptionHtml } from 'src/common/util/sanitize-html.util';

export class UpdateScenarioDto {
  @ApiProperty({
    description: 'Title of the scenario',
    example: 'Scenario 1',
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({
    description: 'Description of the scenario (supports HTML formatting)',
    example: '<p>Description 1</p>',
  })
  @IsString()
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? sanitizeDescriptionHtml(value) : value,
  )
  description?: string;

  @ApiProperty({
    description: 'Mapping of language IDs to voice IDs',
    example: { '1': '0000000-1111-2222-3333-444444444444' },
    type: 'object',
    additionalProperties: { type: 'string', format: 'uuid' },
  })
  @IsObject()
  @IsOptional()
  languageVoices?: Record<string, string>;

  @ApiProperty({
    description:
      "Per-language STT choices for this simulation, keyed by language ID and pointing at stt_configs rows — the same shape as languageVoices. Persisted on scenarios.metadata; the row for the session's language is resolved and forwarded to ally-ai-learn as scenario.stt, taking precedence over that language's own default. Omit a language, or map it to null, to inherit the language default.",
    example: { '9': '3f1b0c8e-77a1-4d2b-9a55-1c0f6c2e4d90' },
    type: 'object',
    additionalProperties: { type: 'string', format: 'uuid' },
  })
  @IsOptional()
  @Validate(IsConfigIdByLanguageConstraint)
  sttConfigByLanguage?: Record<string, string | null> | null;

  @ApiProperty({
    description:
      'Mapping of language IDs to linguistic style samples (10 sample utterances per language)',
    example: { '1': ['utterance 1', 'utterance 2'] },
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  @IsObject()
  @IsOptional()
  linguisticStyleSamples?: Record<string, string[]>;

  @ApiProperty({
    description:
      'Per-language allowed discourse fillers for the voice agent (native script preferred)',
    example: { '2': ['അങ്ങനെയൊന്നു', 'എന്തോ'] },
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  @IsObject()
  @IsOptional()
  allowedFillerWords?: Record<string, string[]>;

  @ApiProperty({
    description:
      'Free-text per-language style guidance for this scenario (e.g. dialect, register, code-mixing norms). Keyed by languageId.',
    example: {
      '1': 'Speaks simple, colloquial Chennai Tamil; code-mixes with English.',
    },
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsObject()
  @IsOptional()
  languageCharacteristics?: Record<string, string>;

  @ApiProperty({
    description: 'Cover image URL of the scenario',
    example: 'https://example.com/cover-image.png',
  })
  @IsString()
  @IsOptional()
  coverImageUrl?: string;

  @ApiProperty({
    description: 'Cover video URL of the scenario',
    example: 'https://example.com/cover-video.mp4',
  })
  @IsString()
  @IsOptional()
  coverVideoUrl?: string;

  @ApiProperty({
    description: 'Editorial category of the scenario (Studio grouping)',
    example: ScenarioCategory.ORIGINALS,
    enum: ScenarioCategory,
  })
  @IsEnum(ScenarioCategory)
  @IsOptional()
  category?: ScenarioCategory;

  @ApiProperty({
    description: 'Partner organisation tag (used when category is PARTNER_SIM)',
    example: 'Acme Health',
  })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  partnerOrgName?: string;

  @ApiProperty({
    description: 'Status of the scenario (only DRAFT or ACTIVE allowed)',
    example: 'ACTIVE',
    enum: [ScenarioStatus.DRAFT, ScenarioStatus.ACTIVE],
  })
  @IsEnum(ScenarioStatus)
  @IsOptional()
  status?: ScenarioStatus;

  @ApiProperty({
    description: 'Is the scenario public',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiProperty({
    description: 'Prompt of the scenario',
    example: 'Prompt 1',
  })
  @IsString()
  @IsOptional()
  prompt?: string;

  @ApiProperty({
    description: 'Name of the AI client persona',
    example: 'Ahana',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'Age of the AI client persona',
    example: 16,
  })
  @IsNumber()
  @IsOptional()
  age?: number;

  @ApiProperty({
    description: 'Gender of the AI client persona',
    example: Gender.FEMALE,
    enum: Gender,
  })
  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @ApiProperty({
    description: 'Gender identity of the AI client persona',
    example: GenderIdentity.FEMALE_WOMAN,
    enum: GenderIdentity,
  })
  @IsEnum(GenderIdentity)
  @IsOptional()
  genderIdentity?: GenderIdentity;

  @ApiProperty({
    description: 'Sexual orientation of the AI client persona',
    example: SexualOrientation.HETEROSEXUAL,
    enum: SexualOrientation,
  })
  @IsEnum(SexualOrientation)
  @IsOptional()
  sexualOrientation?: SexualOrientation;

  @ApiProperty({
    description: 'Current location of the AI client persona',
    example: 'Kolkata, India',
  })
  @IsString()
  @IsOptional()
  currentLocation?: string;

  @ApiProperty({
    description: 'Profession of the AI client persona',
    example: 'Student',
    required: true,
  })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  profession?: string;

  @ApiProperty({
    description:
      'Selected agent test case ids for this roleplay (Agent Builder Copilot ' +
      'V2). Persisted on scenarios.metadata.agentTestCaseIds.',
    type: [String],
    required: false,
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  agentTestCaseIds?: string[];

  @ApiProperty({
    description: 'Difficulty level of the scenario',
    example: ScenarioDifficultyLevel.EASY,
    enum: ScenarioDifficultyLevel,
  })
  @IsEnum(ScenarioDifficultyLevel)
  @IsOptional()
  difficultyLevel?: ScenarioDifficultyLevel;

  @ApiProperty({
    description:
      'Roleplay-level LLM sampling temperature for the main response agent. Persisted on scenarios.metadata and forwarded to ally-ai-learn as promptData.temperature, where it overrides the per-language llm.config.temperature and the global LLM_TEMPERATURE default for this simulation only. Lower values (0.2–0.4) keep the persona tightly consistent; higher values add variety. Range 0–2; unspecified falls back to the global default.',
    example: 0.7,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiProperty({
    description:
      'Enable the thinking-filler back-channel (a short acknowledgement played while the agent generates its reply) to mask turn latency. Defaults to true on creation when unspecified; omitting it on update leaves the existing value unchanged.',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  fillerEnabled?: boolean;

  @ApiProperty({
    description:
      'Serve the per-language glossary (Tier 0 style card + retrieved sections) to sessions of this simulation. Temporary per-simulation canary gate for glossary rollout; defaults to false (opt-in) when unspecified.',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  languageGlossaryEnabled?: boolean;

  @ApiProperty({
    description:
      'Enable comfort audio (a faint, constant room tone played on the background track) for this simulation so the line never sounds dead between turns. Gated by the global COMFORT_AUDIO_ENABLED kill-switch. Defaults to false (opt-in) when unspecified.',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  comfortAudioEnabled?: boolean;

  @ApiProperty({
    description:
      'Public URL of the uploaded comfort-audio track (from the comfort-audio library) to play as the comfort audio for this simulation. When unset, comfort audio (if enabled) falls back to the synthesized room tone. Only meaningful when comfortAudioEnabled is true.',
    example:
      'https://assets-bucket.s3.us-east-1.amazonaws.com/comfort-audio-library/1730000000000-rain.mp3',
    required: false,
  })
  @IsOptional()
  @IsString()
  comfortAudioUrl?: string;

  @ApiProperty({
    description:
      'Playback volume (0..1) of the comfort audio for this simulation. When unset, falls back to the global COMFORT_AUDIO_VOLUME default. Only meaningful when comfortAudioEnabled is true.',
    example: 0.3,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  comfortAudioVolume?: number;

  @ApiProperty({
    description:
      'Trim conversation history sent to the agent to the last few dialogues (older turns dropped) to reduce turn latency. Defaults to false (opt-in) when unspecified.',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  historyTrimEnabled?: boolean;

  @ApiProperty({
    description:
      "Enable continuous back-channeling — brief 'mm-hmm'-style listener affirmations played sparsely while the learner is still speaking on a long turn. Defaults to false (opt-in) when unspecified.",
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  continuousBackchanneling?: boolean;

  @ApiProperty({
    description:
      "Enable the predictive interim reply — while the learner is still speaking on a long turn, a fast model drafts a short, non-committal holding reply the agent speaks the instant they stop, to mask the real reply's latency (then cut when the real reply begins). Defaults to false (opt-in) when unspecified.",
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  interimReplyEnabled?: boolean;

  @ApiProperty({
    description: 'Opening statements of the AI client persona',
    example: ['Hi, I need some help.', 'I am feeling down today.'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  openingStatements?: string[];

  @ApiProperty({
    description:
      'Opening dialogue lines for non-primary languages (persisted to scenario_translations), keyed by languageId string',
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  @IsObject()
  @IsOptional()
  translationOpeningStatements?: Record<string, string[]>;

  @ApiProperty({
    description:
      'Plain-text reminder bullet points shown to the learner during the live session. Purely informational — not linked to AI scoring/checklist events.',
    example: ['Maintain eye contact', 'Ask open-ended questions'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  reminders?: string[];

  @ApiProperty({
    description:
      'Reminders for non-primary languages (persisted to scenario_translations.metadata.reminders), keyed by languageId string',
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  @IsObject()
  @IsOptional()
  translationReminders?: Record<string, string[]>;

  @ApiProperty({
    description:
      'Challenge description text for non-primary languages (persisted to scenario_translations.metadata.description), keyed by languageId string. Supports the same HTML formatting allow-list as the primary description.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsObject()
  @IsOptional()
  @Transform(({ value }) => {
    if (!value || typeof value !== 'object') return value;
    const sanitized: Record<string, string> = {};
    for (const [lang, html] of Object.entries(
      value as Record<string, unknown>,
    )) {
      sanitized[lang] =
        typeof html === 'string'
          ? sanitizeDescriptionHtml(html)
          : (html as string);
    }
    return sanitized;
  })
  translationDescription?: Record<string, string>;

  @ApiProperty({
    description:
      'Title text for non-primary languages (persisted to scenario_translations.metadata.title), keyed by languageId string.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsObject()
  @IsOptional()
  translationTitle?: Record<string, string>;

  @ApiProperty({
    description: 'AutoTermination status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autoTerminationStatus?: boolean;

  @ApiProperty({
    description: 'Termination message',
    example: 'Termination message',
  })
  @IsOptional()
  @IsString()
  terminationMessage?: string;

  @ApiProperty({
    description: 'Termination event ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  terminationEventId?: string;

  terminationEvents?: TerminationEventsDto[];

  @ApiProperty({ description: 'Global tenant visibility', example: false })
  isGlobal?: boolean;

  @ApiProperty({
    description: 'Trigger warning IDs',
    example: [
      '123e4567-e89b-12d3-a456-426614174000',
      '123e4567-e89b-12d3-a456-426614174001',
    ],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  triggerWarningIds?: string[];

  @ApiProperty({
    description: 'Custom fields',
    type: [CustomFieldsDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CUSTOM_FIELDS_COUNT)
  @ValidateNested({ each: true })
  @Type(() => CustomFieldsDto)
  customFields?: CustomFieldsDto[];

  @ApiProperty({
    description:
      'promptCode of the main-agent prompt variant this simulation uses. ' +
      'When omitted, the runtime falls back to the default main_agent prompt. ' +
      'Branching and multilingual prompts are not selectable per simulation; ' +
      'they remain singletons shared by all variants.',
    required: false,
  })
  @IsOptional()
  @IsString()
  selectedMainPromptCode?: string;

  @ApiProperty({
    description:
      'promptCode of the transcript-evaluator prompt variant used when ' +
      'scoring reports for this simulation. When omitted, the default ' +
      'evaluator template is used.',
    required: false,
  })
  @IsOptional()
  @IsString()
  selectedEvaluatorPromptCode?: string;

  @ApiProperty({
    description:
      'Per-language choice of main-agent prompt variant for this simulation, ' +
      'keyed by languageId: "GENERIC" (English source) or "MULTILINGUAL" ' +
      '(translated body). Missing entry defaults to GENERIC; English always ' +
      'uses English.',
    required: false,
    example: { '2': 'MULTILINGUAL', '6': 'GENERIC' },
  })
  @IsOptional()
  @IsObject()
  mainPromptVariantByLanguage?: Record<string, 'GENERIC' | 'MULTILINGUAL'>;

  @ApiProperty({
    description:
      'Per-simulation states used by `hasStates` main-agent prompt variants. ' +
      'Runtime resolves the active state per turn score and substitutes its ' +
      'guidelines into `{state_x_guidelines}`. Server-side validation enforces ' +
      'exactly one starting state, contiguous ranges with open ends, and a ' +
      'minimum gap of 50 between finite bounds.',
    type: [SimulationStateDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SimulationStateDto)
  states?: SimulationStateDto[];

  @ApiProperty({
    description: 'Experience mode for the scenario',
    enum: ExperienceMode,
    example: ExperienceMode.FEEDBACK,
    required: false,
  })
  @IsOptional()
  @ValidateIf((o) => o.experienceMode !== undefined)
  @IsEnum(ExperienceMode)
  experienceMode?: ExperienceMode;

  @ApiProperty({
    description: 'Checklist type (required when experienceMode is CHECKLIST)',
    enum: ChecklistType,
    example: ChecklistType.GUIDED,
    required: false,
  })
  @IsEnum(ChecklistType)
  @ValidateIf((o) => o.experienceMode === ExperienceMode.CHECKLIST)
  @IsNotEmpty()
  checklistType?: ChecklistType;

  @ApiProperty({
    description:
      "Show the checklist on the learner's post-session summary. Opt-in per roleplay and OFF by default; the in-session checklist panel is unaffected.",
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  summaryChecklistEnabled?: boolean;

  @ApiProperty({
    description:
      'Timer mode for the scenario, to show timer during the session.',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  timerMode?: boolean;

  @ApiProperty({
    description:
      'Maximum time value for the scenario timer (required when timerMode is true)',
    example: '1:30:00',
    required: false,
  })
  @ValidateIf((o) => o.timerMode === true)
  @IsNotEmpty()
  @IsString()
  maxTimeValue?: string;

  @ApiProperty({
    description: 'Enable conversational guardrails for the scenario',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  optGuardrails?: boolean;

  @ApiProperty({
    description: 'Behavior instructions',
    type: [BehaviorInstructionDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BEHAVIOR_INSTRUCTIONS_COUNT)
  @ValidateNested({ each: true })
  @Type(() => BehaviorInstructionDto)
  behaviorInstructions?: BehaviorInstructionDto[];

  @ApiProperty({
    description: 'Character profile text',
    example: 'A detailed character profile...',
    required: false,
    maxLength: 2500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2500)
  characterProfileText?: string;

  @ApiProperty({
    description: 'Helper agent prompt used when generating reports',
    example: 'You are a mental healthcare worker',
    required: false,
  })
  @IsOptional()
  @IsString()
  helperAgentPrompt?: string;

  @ApiProperty({
    description:
      'Agent Builder Copilot: free-text description of the roleplay actor',
    required: false,
  })
  @IsOptional()
  @IsString()
  agentBuilderDescription?: string;

  @ApiProperty({
    description:
      'Agent Builder Copilot: generated/edited comprehensive system prompt for the roleplay actor',
    required: false,
  })
  @IsOptional()
  @IsString()
  agentBuilderPrompt?: string;

  @ApiProperty({
    description: 'Show score meter',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  showScoreMeter?: boolean;

  @ApiProperty({
    description: 'Enable the AI feedback/evaluation summary after a session',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  enableFeedback?: boolean;

  @ApiProperty({
    description:
      'Stream live coaching hints from the AI supervisor into a Supervisor tab ' +
      "in the learner's session sidebar. Opt-in: off unless explicitly true.",
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  supervisorNotesEnabled?: boolean;

  @ApiProperty({
    description:
      "Show the learner's Live transcript tab during the roleplay. " +
      'Opt-out: on unless explicitly set to false.',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  liveTabEnabled?: boolean;

  @ApiProperty({
    description:
      'Sub-toggles of enableFeedback, controlling which post-session tabs the ' +
      "learner sees (debrief, skills, transcript). Omitting a key, or the whole " +
      'object, keeps that tab on.',
    example: { debrief: true, skills: false, transcript: true },
    required: false,
  })
  @IsOptional()
  @IsObject()
  feedbackTabs?: Partial<FeedbackTabsConfig>;

  @ApiProperty({
    description:
      'Allow the learner to pause/resume the simulation. Defaults to enabled ' +
      '(only an explicit false hides the pause control).',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  pauseEnabled?: boolean;

  @ApiProperty({
    description: 'Enable current state for the scenario',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  currentState?: boolean;

  @ApiProperty({
    description:
      'Whether reminders are shown to the learner during the roleplay',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  remindersEnabled?: boolean;

  @ApiProperty({
    description: 'Competency ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  competencyId?: string;

  @ApiProperty({
    description: 'Knowledge sources',
    example: [
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Knowledge source 1',
        content: 'Knowledge source content 1',
      },
      {
        id: '123e4567-e89b-12d3-a456-426614174001',
        title: 'Knowledge source 2',
        content: 'Knowledge source content 2',
      },
    ],
    type: [KnowledgeSourceDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_KNOWLEDGE_SOURCES_COUNT)
  @ValidateNested({ each: true })
  @Type(() => KnowledgeSourceDto)
  knowledgeSources?: KnowledgeSourceDto[];

  @ApiProperty({
    description: 'State names map',
    example: [
      {
        stateId: '1',
        name: 'name for state 1',
      },
    ],
    type: [StateNamesDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StateNamesDto)
  stateNames?: StateNamesDto[];
}
