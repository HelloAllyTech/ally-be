import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AGENT_LIMITS } from '../constants/analytics-agent.constants';

/**
 * One prior exchange in the conversation, replayed by the client.
 *
 * The agent is **stateless on the server**: the browser holds the thread and
 * sends back the turns it wants considered. That is what makes a follow-up
 * ("and by language?") work and "Reset chat" free — there is no server-side
 * session to expire, migrate, or forget to clean up, and two tabs cannot fight
 * over one conversation.
 *
 * The cost is that history is client-asserted. It is only ever used as *context
 * for writing a query*, never as authority: every query it produces goes through
 * the same guard and the same read-only envelope, so a tampered history can at
 * most produce a differently-worded question from a reader who could already ask
 * it directly.
 */
export class AnalyticsAgentTurnDto {
  @ApiProperty({ description: 'The question asked in that turn' })
  @IsString()
  @MaxLength(AGENT_LIMITS.MAX_QUESTION_CHARS)
  question!: string;

  @ApiProperty({
    description: 'The SQL that answered it, if any',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(AGENT_LIMITS.MAX_SQL_CHARS)
  sql?: string;

  @ApiProperty({ description: 'The answer given, if any', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  answer?: string;
}

export class AskAnalyticsAgentDto {
  @ApiProperty({
    description: 'The question, in English.',
    example:
      'How many simulations were completed per week over the last 90 days?',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(AGENT_LIMITS.MAX_QUESTION_CHARS)
  question!: string;

  @ApiProperty({
    description:
      'The conversation so far, oldest first. Only the most recent ' +
      `${AGENT_LIMITS.MAX_HISTORY_TURNS} turns are used; older turns are ignored ` +
      'rather than rejected, so a long thread degrades instead of breaking.',
    required: false,
    type: [AnalyticsAgentTurnDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AnalyticsAgentTurnDto)
  history?: AnalyticsAgentTurnDto[];
}

/**
 * What happened to the question. Five outcomes rather than a boolean, because
 * the four non-answers are genuinely different for the reader and each needs its
 * own screen: a question worth rephrasing, a question this data cannot answer, a
 * query that was refused, and a query that failed.
 */
export enum AnalyticsAgentOutcome {
  /** The query ran; `answer`, `rows` and possibly `chart` are populated. */
  ANSWER = 'answer',
  /** Ambiguous question — `message` holds the clarifying question. */
  CLARIFY = 'clarify',
  /** Not answerable from the readable tables — `message` says what is missing. */
  REFUSED = 'refused',
  /** The generated SQL broke a safety rule — `message` says which, `sql` shows it. */
  REJECTED = 'rejected',
  /** The query was valid but failed to run (e.g. it timed out). */
  FAILED = 'failed',
}

export enum AnalyticsAgentChartType {
  NONE = 'none',
  LINE = 'line',
  BAR = 'bar',
  STACKED_BAR = 'stacked_bar',
  SCATTER = 'scatter',
}

export class AnalyticsAgentChartDto {
  @ApiProperty({ enum: AnalyticsAgentChartType })
  type!: AnalyticsAgentChartType;

  @ApiProperty({ description: 'Result column for the x axis' })
  x!: string;

  @ApiProperty({ description: 'Result column holding the numeric measure' })
  y!: string;

  @ApiProperty({
    description: 'Result column splitting y into series; empty for one series',
  })
  group!: string;

  @ApiProperty() xLabel!: string;
  @ApiProperty() yLabel!: string;
  @ApiProperty() title!: string;
}

/**
 * Which models and prompt version produced this answer.
 *
 * Required, not decorative: the wiki's data-visualisation rules say a derived
 * number must carry the provenance of the thing that derived it, and comparisons
 * are only valid within one (model, prompt version) pair. An answer screenshotted
 * into a meeting should say what wrote it.
 */
export class AnalyticsAgentProvenanceDto {
  @ApiProperty({ description: 'Model that wrote the SQL' })
  plannerModel!: string;

  @ApiProperty({
    description: 'Model that wrote the prose (empty if it never ran)',
  })
  answerModel!: string;

  @ApiProperty({ description: 'Agent prompt version' })
  promptVersion!: string;
}

export class AskAnalyticsAgentResponseDto {
  @ApiProperty({ enum: AnalyticsAgentOutcome })
  outcome!: AnalyticsAgentOutcome;

  @ApiProperty({
    description:
      'The question echoed back, so a client rendering a thread does not have to ' +
      'pair responses with requests itself.',
  })
  question!: string;

  @ApiProperty({
    description:
      'For clarify/refused/rejected/failed: what the reader needs to know. Empty ' +
      'for a successful answer.',
  })
  message!: string;

  @ApiProperty({
    description: 'The answer prose (markdown). Empty unless outcome=answer.',
  })
  answer!: string;

  @ApiProperty({
    description:
      'The SQL that ran — or, for outcome=rejected, the SQL that was refused. ' +
      'Always returned when one was generated: the number is only auditable if ' +
      'the reader can see the query behind it.',
  })
  sql!: string;

  @ApiProperty({
    description: "The planner's one-line description of what the query counts",
  })
  rationale!: string;

  @ApiProperty({
    description: 'Result columns, in the order the query selected them',
    type: [String],
  })
  columns!: string[];

  @ApiProperty({
    description:
      'Result rows (objects keyed by column name), capped server-side.',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  rows!: Record<string, unknown>[];

  @ApiProperty({ description: 'Rows returned after the cap' })
  rowCount!: number;

  @ApiProperty({
    description:
      'True when the result hit the row cap, so any total stated in the answer is ' +
      'a lower bound. The client must say so on the table.',
  })
  truncated!: boolean;

  @ApiProperty({ type: AnalyticsAgentChartDto, nullable: true })
  chart!: AnalyticsAgentChartDto | null;

  @ApiProperty({
    description: 'Honest limits of this result, rendered under the answer.',
    type: [String],
  })
  caveats!: string[];

  @ApiProperty({ description: 'Suggested next questions', type: [String] })
  followUps!: string[];

  @ApiProperty({
    description: 'Query execution time in milliseconds (0 if it never ran)',
  })
  durationMs!: number;

  @ApiProperty({ type: AnalyticsAgentProvenanceDto })
  provenance!: AnalyticsAgentProvenanceDto;
}

/** One table in the readable catalogue, for the "what can I ask about?" panel. */
export class AnalyticsAgentCatalogTableDto {
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'What the table is for' }) purpose!: string;
  @ApiProperty({ description: 'Readable column names', type: [String] })
  columns!: string[];
}

export class AnalyticsAgentCatalogResponseDto {
  @ApiProperty({ type: [AnalyticsAgentCatalogTableDto] })
  tables!: AnalyticsAgentCatalogTableDto[];

  @ApiProperty({
    description:
      'Column names that are never readable, so the panel can state the policy ' +
      'rather than leaving a reader to discover it by being refused.',
    type: [String],
  })
  deniedColumns!: string[];

  @ApiProperty({ description: 'Server-side row cap for one question' })
  rowLimit!: number;
}
