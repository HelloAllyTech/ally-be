import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { AnalyticsScopingDto } from './platform-analytics.dto';

/**
 * The competency map takes NO window params, for the same reason skill growth and
 * roleplay volume do not.
 *
 * A per-competency median needs a sample. Splitting the platform across a dozen
 * competencies AND a 30-day window puts nearly every cell below the score floor,
 * so the map would report the length of the window rather than which skills are
 * weak. Offering `range` and silently ignoring it would be worse than not
 * offering it; the card states "all time" on its face.
 */
export class CompetencyMapQueryDto {
  @ApiProperty({
    description:
      'Narrow to a single tenant (uuid or code). The sessions are scoped; the ' +
      'competencies and scenarios they point at are platform objects.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/** One competency: how much it is practised, and how well it goes. */
export class CompetencyMapRowDto {
  @ApiProperty({ description: 'Competency uuid' })
  competencyId!: string;

  @ApiProperty({
    description:
      'Competency name, falling back to the raw id when the competency row has ' +
      'been deleted — an unresolvable tag stays visible under its id rather ' +
      'than dropping its practice volume out of the map.',
  })
  name!: string;

  @ApiProperty({
    description:
      'Completed sessions on scenarios tagged with this competency. This is the ' +
      'volume axis, and it counts sessions whether or not they were judged: a ' +
      'competency practised 400 times with 12 sessions judged is a finding in ' +
      'itself, and restricting the axis to judged sessions would hide exactly ' +
      'the competencies where evaluation coverage is the problem.',
  })
  completedSessions!: number;

  @ApiProperty({
    description: 'Of those, sessions with a completed evaluation and a score',
  })
  evaluatedSessions!: number;

  @ApiProperty({
    description:
      'Median composite score (0-100) across this competency, or null when ' +
      '`evaluatedSessions` is below `minSampleSize`. The row still travels — ' +
      'only the score is suppressed, so the volume axis stays complete and the ' +
      'card can say "n = 4 · need 20" instead of losing the competency.',
    nullable: true,
    type: Number,
  })
  medianScore!: number | null;

  @ApiProperty({
    description: 'Distinct learners who practised this competency',
  })
  learners!: number;

  @ApiProperty({
    description:
      'Distinct scenarios tagged with this competency that have actually been ' +
      'played. Not the number of scenarios that exist: a competency with 30 ' +
      'scenarios of which 2 are ever picked is a content-discovery problem, not ' +
      'a content-supply one.',
  })
  scenarios!: number;

  @ApiProperty({
    description:
      '`evaluatedSessions < minSampleSize`. Sent as a flag as well as a null ' +
      'score so a surface can badge the row as a thin sample rather than ' +
      'inferring the reason for a missing number.',
  })
  belowFloor!: boolean;
}

/** Practice the map cannot attribute to any competency. */
export class CompetencyMapUnattributedDto {
  @ApiProperty({
    description: 'Completed sessions whose scenario carries no competency tag',
  })
  completedSessions!: number;

  @ApiProperty({ description: 'Of those, sessions with a score' })
  evaluatedSessions!: number;

  @ApiProperty({
    description: 'Display label for the unattributed slice',
    example: 'No competency tagged',
  })
  label!: string;
}

/** Whole-platform totals behind the map. */
export class CompetencyMapSummaryDto {
  @ApiProperty({ description: 'Competencies with at least one played session' })
  competencies!: number;

  @ApiProperty({
    description:
      'DISTINCT completed sessions in scope, attributed or not. NOT the sum of ' +
      '`competencies[].completedSessions` — a session on a multi-competency ' +
      'scenario is counted once here and once per competency there.',
  })
  completedSessions!: number;

  @ApiProperty({
    description: 'DISTINCT sessions in scope with a completed evaluation',
  })
  evaluatedSessions!: number;
}

/**
 * Which competencies are heavily practised, and which score badly?
 *
 * Practice volume against median score, so the quadrants are decisions: high
 * volume + low score is where content work pays off now, low volume + low score
 * is a gap nobody is training, high volume + high score may be over-served. A
 * ranked list of scores cannot say which of those a competency is.
 *
 * **Sessions can be counted more than once.** A scenario tagged with several
 * competencies (Roleplay Studio v2 multi-competency tagging) is practice of each
 * of them, so its sessions contribute to EVERY tagged competency's row — which
 * means the per-competency counts can sum to more than
 * `summary.completedSessions`. Stated here rather than quietly done: the
 * alternative, attributing each session to the first competency only, would
 * understate every competency after the first and make the ranking depend on the
 * order somebody ticked boxes in.
 */
export class CompetencyMapResponseDto {
  @ApiProperty({
    description:
      'Competencies sorted by `completedSessions` descending (name as the ' +
      'tiebreak). Rows below the score floor are INCLUDED with a null ' +
      '`medianScore` and `belowFloor: true`.',
    type: [CompetencyMapRowDto],
  })
  competencies!: CompetencyMapRowDto[];

  @ApiProperty({
    description:
      'Sessions whose scenario carries no competency at all. Reported rather ' +
      'than dropped: if a third of practice volume is untagged then the map ' +
      'covers two thirds of the platform, and the reader needs to know that ' +
      'before concluding which skills are neglected.',
    type: CompetencyMapUnattributedDto,
  })
  unattributed!: CompetencyMapUnattributedDto;

  @ApiProperty({
    description:
      'Evaluated sessions a median is stated from. Below it the score is null, ' +
      'the row stays. Echoed so the client does not keep a second copy that can ' +
      'drift from the one the server suppresses at.',
  })
  minSampleSize!: number;

  @ApiProperty({
    description:
      'Fixed [min, max] for the score axis, so it cannot auto-scale to the data ' +
      'and turn a nine-point spread into a chasm.',
    type: [Number],
    example: [0, 100],
  })
  scoreDomain!: [number, number];

  @ApiProperty({ type: CompetencyMapSummaryDto })
  summary!: CompetencyMapSummaryDto;

  @ApiProperty({
    description:
      'Which tenant this was narrowed to, if any. `unscopedSections` is empty: ' +
      'the sessions carry a tenant, and the competencies/scenarios they point ' +
      'at are platform objects rather than per-org data.',
    type: AnalyticsScopingDto,
  })
  scoping!: AnalyticsScopingDto;

  @ApiProperty({ description: 'When this response was computed (ISO 8601)' })
  computedAt!: string;
}
