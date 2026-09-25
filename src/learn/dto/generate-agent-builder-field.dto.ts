import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AgentBuilderField } from '../enum/agent-builder-field.enum';

/**
 * One parallel field-generation call for Agent Builder Copilot. The frontend
 * fires one of these per target field (role instruction, title, challenge
 * description, knowledge sources, persona, backstory, opening statements,
 * reminders, linguistic style samples, allowed filler words, and — only when
 * a states-enabled main-agent prompt is selected — states) concurrently, each
 * rendering its own editable prompt template with the shared runtime
 * variables below.
 *
 * The three language-scoped fields (opening statements, linguistic style
 * samples, allowed filler words) are fired once per language the client
 * speaks, with `languageId` naming the language to write in. The wizard learns
 * that list from the `spoken_languages` field, which it fires first.
 *
 * Generation is CHAINED in two stages so the fields agree with each other:
 * the challenge description and persona are generated first, from the brief
 * alone, and every later field is sent them as `establishedContext` — the
 * backstory is written for the person the persona named, the states for the
 * challenge the description set out.
 */
/**
 * The persona as the wizard applied it to the form. Every key is optional: a
 * trainer can edit or clear any of them between stages, and a partial persona
 * still anchors the later fields better than none.
 */
export class EstablishedPersonaDto {
  @ApiProperty({ required: false, example: 'Priya Sharma' })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false, example: 34 })
  @IsInt()
  @Min(1)
  @Max(120)
  @IsOptional()
  age?: number;

  @ApiProperty({ required: false, example: 'female' })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  gender?: string;

  @ApiProperty({ required: false, example: 'Software engineer' })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  profession?: string;

  @ApiProperty({ required: false, example: 'Pune' })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  currentLocation?: string;
}

/**
 * What the first stage of the chain settled, passed to the second-stage
 * fields so they build on it rather than each reinventing the client.
 */
export class EstablishedContextDto {
  @ApiProperty({
    description:
      'The generated Challenge Description (HTML allowed; tags are stripped ' +
      'before it reaches the prompt).',
    required: false,
  })
  @IsString()
  @MaxLength(8000)
  @IsOptional()
  challengeDescription?: string;

  @ApiProperty({ type: EstablishedPersonaDto, required: false })
  @ValidateNested()
  @Type(() => EstablishedPersonaDto)
  @IsOptional()
  persona?: EstablishedPersonaDto;
}

export class GenerateAgentBuilderFieldDto {
  @ApiProperty({
    description: 'Which Basic Settings field to generate',
    enum: AgentBuilderField,
    example: AgentBuilderField.TITLE,
  })
  @IsEnum(AgentBuilderField)
  @IsNotEmpty()
  field!: AgentBuilderField;

  @ApiProperty({
    description: 'Free-text "Describe roleplay actor" brief from the wizard',
  })
  @IsString()
  @IsNotEmpty()
  actorDescription!: string;

  @ApiProperty({
    description: 'Selected competency name (steers generation)',
    required: false,
  })
  @IsString()
  @IsOptional()
  competency?: string;

  @ApiProperty({
    description:
      'Selected agent test cases as a human-readable, comma-joined string',
    required: false,
  })
  @IsString()
  @IsOptional()
  agentTestCases?: string;

  @ApiProperty({
    description:
      'Number of knowledge source documents to produce (only used by the ' +
      'knowledge_sources field). Defaults to 3.',
    required: false,
  })
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  numKnowledgeSources?: number;

  @ApiProperty({
    description:
      'Language to generate in, for the language-scoped fields ' +
      '(opening_statements / linguistic_style_samples / allowed_filler_words). ' +
      'A `languages.id` as a string, from the `spoken_languages` field or the ' +
      'scenario-voice language catalog. Ignored by every other field; when ' +
      'omitted (or unknown) the language-scoped fields fall back to English.',
    required: false,
    example: '1',
  })
  @IsString()
  @IsOptional()
  languageId?: string;

  @ApiProperty({
    description:
      'Languages to cast a voice for (`languages.id` strings), used by the ' +
      '`language_voices` field only. Normally the ids `spoken_languages` ' +
      'returned; when omitted, every voiced language in the catalog is offered.',
    required: false,
    example: ['1', '2'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  languageIds?: string[];

  @ApiProperty({
    description:
      "The generated persona's gender, so `language_voices` can cast a voice " +
      'that matches the client the wizard just wrote. Free text; blank means ' +
      'unknown rather than any particular gender.',
    required: false,
    example: 'female',
  })
  @IsString()
  @IsOptional()
  personaGender?: string;

  @ApiProperty({
    description:
      "The generated persona's age in years, matched against a voice's age " +
      'band by `language_voices`.',
    required: false,
    example: 34,
  })
  @IsInt()
  @Min(1)
  @Max(120)
  @IsOptional()
  personaAge?: number;

  @ApiProperty({
    description:
      'What the first stage of the chain already generated (challenge ' +
      'description + persona). Appended to the actor brief as facts to stay ' +
      'consistent with. Ignored by the first-stage fields themselves and by ' +
      '`spoken_languages`, which read the brief alone.',
    type: EstablishedContextDto,
    required: false,
  })
  @ValidateNested()
  @Type(() => EstablishedContextDto)
  @IsOptional()
  establishedContext?: EstablishedContextDto;

  @ApiProperty({
    description: 'Model override for generation',
    required: false,
  })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiProperty({
    description: 'AI provider to use for generation',
    enum: ['openai', 'anthropic'],
    required: false,
    default: 'openai',
  })
  @IsEnum(['openai', 'anthropic'])
  @IsOptional()
  provider?: 'openai' | 'anthropic';

  @ApiProperty({
    description:
      'LLM sampling temperature (0–2). Overrides the prompt-level default.',
    required: false,
  })
  @IsNumber()
  @Min(0)
  @Max(2)
  @IsOptional()
  temperature?: number;
}

export class GenerateAgentBuilderFieldResponseDto {
  @ApiProperty({ enum: AgentBuilderField })
  field!: AgentBuilderField;

  @ApiProperty({
    description:
      'Parsed field value. Shape depends on `field`: string for ' +
      'role_instruction / title / challenge_description / backstory / ' +
      'opening_statements / reminders (opening_statements and reminders are ' +
      'newline-joined text, one line per item); ' +
      '{name,age,gender,profession,currentLocation} for persona; ' +
      '[{title,content}] for knowledge_sources; ' +
      '[{id,name,guidelines,scoreLower,scoreUpper,ragEnabled}] for states ' +
      '(ids + contiguous score bands assigned server-side); ' +
      'string[] for linguistic_style_samples / allowed_filler_words ' +
      '(written in the requested `languageId`, which the frontend keys them ' +
      'under); [{languageId,label,code}] for spoken_languages; ' +
      '[{languageId,languageLabel,voiceId,voiceName,voiceGender}] for ' +
      'language_voices.',
  })
  value!: unknown;
}
