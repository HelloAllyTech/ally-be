import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { ScenarioDifficultyLevel } from 'src/learn/type/scenario.type';
import {
  AnalyticsScopingDto,
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/**
 * Scenarios as practice content, part two — the Curriculum sub-tab's
 * "Scenarios" section.
 *
 *  - GET /v1/analytics/scenarios/calibration (EFF-32, AAQ-227): is EASY
 *    actually easy? Where do learners' session scores land, per scenario
 *    version, against what the scenario lets a learner earn? Read on
 *    `scenario_sessions.score` (ruler R2). ALL TIME by construction and takes
 *    no range: a scenario's calibration is a property of the scenario, and a
 *    date window would only measure who happened to play it inside it.
 *  - GET /v1/analytics/scenarios/progression (EFF-34, AAQ-228): did the learner
 *    move the client? What share of sessions reach the scenario's terminal
 *    state, advance at least one state, or never get past the opening state?
 *    Read on the per-turn simulation state the worker stamps on
 *    `scenario_session_turn_metrics.metadata` (ruler R9). A CALENDAR trend, so
 *    it takes the standard window query, bucketed by session end.
 *
 * Platform-wide unless `tenantId` narrows to one org (by the session's own
 * tenant, bound as a parameter); test organisations always excluded; countable
 * sessions only (ENDED + COMPLETED, no preview or seed rooms). These shapes are
 * a frontend contract.
 *
 * Why calibration is measured rather than read off the label: challenge has to
 * be tuned empirically against real learners — design alone cannot predict how
 * hard a task lands (Stacks: "Playtesting and Tuning Challenge Calibration"),
 * and easy/difficult depends on the learner's prior knowledge, not only on the
 * task (Stacks: "Task Classes Maintain Consistent Difficulty Despite
 * Increasing Complexity"). Hence the caveat on the card: this measures how
 * scores land, a property of the scenario's scoring AND its learners.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────────────────────

export class ScenarioCalibrationProvenanceDto {
  @ApiProperty({
    description:
      'Which ruler the numbers are read on (R2 session score, R9 state progression) and how they are made',
  })
  derivation!: string;

  @ApiProperty({ description: 'The caveat the card must carry' })
  note!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/analytics/scenarios/calibration
// ─────────────────────────────────────────────────────────────────────────────

export class ScenarioCalibrationQueryDto {
  @ApiProperty({
    description:
      "Narrow to a single tenant (uuid or code), by the session's own tenant. " +
      'The scoring config a range is derived from is the scenario’s, whoever plays it. ' +
      'Omitted: every non-test org.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'tenantId must be a tenant uuid or code',
  })
  tenantId?: string;
}

/** One band of a calibration row. */
export class ScenarioScoreBandDto {
  @ApiProperty({
    description:
      'Stable band key. Derived ranges: below0 | pct0to25 | pct25to50 | pct50to75 | pct75to100 | over100. Raw fallback: below0 | raw0to49 | raw50to99 | raw100plus. Bands come in this order; stack them in it',
    example: 'pct75to100',
  })
  key!: string;

  @ApiProperty({
    description:
      'Display label: "< 0", "0–25%" … "> 100%" (share of `attainableMax`), or "< 0", "0–49", "50–99", "100+" (raw points)',
    example: '75–100%',
  })
  label!: string;

  @ApiProperty({
    description: 'Banded sessions whose score falls in this band',
  })
  count!: number;

  @ApiProperty({
    description:
      "count ÷ the row's `bandedSessions` as a percentage (0–100, 1 dp); null below `minSampleSize` banded sessions (never inside a listed row, which needs that many to exist)",
    nullable: true,
    type: Number,
  })
  pct!: number | null;
}

export class ScenarioCalibrationRowDto {
  @ApiProperty({ description: 'scenarios.id' })
  scenarioId!: number;

  @ApiProperty({
    description:
      'scenario_versions.id the sessions ran against (production sessions record the scenario’s published version). Null = sessions that recorded no version (they predate versioning). NOTE: a version does not pin the scoring config — studio edits write the live scoring rows while the published version stays the same — which is why a derived range is read only over sessions since `configStableSince`',
    nullable: true,
    type: String,
  })
  versionId!: string | null;

  @ApiProperty({
    description:
      'scenario_versions.versionNumber, for a "v3" label; null with no version',
    nullable: true,
    type: Number,
  })
  versionNumber!: number | null;

  @ApiProperty({
    description:
      'scenarios.title (a deleted scenario keeps its title: its sessions are history)',
  })
  title!: string;

  @ApiProperty({
    description:
      "The scenario's AUTHORED difficulty label (scenarios.difficultyLevel, its current value) — a design prediction this row checks, not a measurement. Null when unset",
    enum: ScenarioDifficultyLevel,
    nullable: true,
  })
  difficultyLevel!: ScenarioDifficultyLevel | null;

  @ApiProperty({
    description:
      'Countable sessions of this version in scope with a resolved score (non-null, and not the unresolved 0 — see `totals.unresolvedExcluded`). At least `minSampleSize`; the sort key',
  })
  sessions!: number;

  @ApiProperty({
    description:
      'The sessions the bands are over. Equal to `sessions` on a raw row; on a derived row, only those that started at or after `configStableSince` (ran on the scoring config the range was derived from). At least `minSampleSize`',
  })
  bandedSessions!: number;

  @ApiProperty({
    description:
      "'derived': bands are shares of `attainableMax`. 'raw': no usable range (see `rangeReason`), bands are raw points",
    enum: ['derived', 'raw'],
  })
  rangeSource!: 'derived' | 'raw';

  @ApiProperty({
    description:
      "Why the row fell back to raw bands; null on a derived row. 'noScoredContributors': the scenario's current scoring config has nothing that adds points. 'tooFewSinceConfigChange': it does, but the config last changed after all but fewer than `minSampleSize` of this version's sessions, so the range does not describe what they ran on",
    enum: ['noScoredContributors', 'tooFewSinceConfigChange'],
    nullable: true,
  })
  rangeReason!: 'noScoredContributors' | 'tooFewSinceConfigChange' | null;

  @ApiProperty({
    description:
      "Most points a session can earn under the scenario's CURRENT scoring config: Σ over positive events of score × detectionConfig.maxOccurrences, plus +10 per SHOULD_DO behaviour instruction; a contributor with no cap (the runtime does not cap it) is counted ONCE. Null when not derivable. Present on raw rows too when derivable, for reference",
    nullable: true,
    type: Number,
  })
  attainableMax!: number | null;

  @ApiProperty({
    description:
      'The same over negative contributors (−10 per SHOULD_NOT_DO behaviour instruction); 0 with none. Null when `attainableMax` is',
    nullable: true,
    type: Number,
  })
  attainableMin!: number | null;

  @ApiProperty({
    description:
      'True when every positive contributor is capped, so `attainableMax` is a real ceiling. False: it is a nominal "every rewarded thing once" ceiling and sessions above it are expected. Null when not derivable',
    nullable: true,
    type: Boolean,
  })
  ceilingIsHard!: boolean | null;

  @ApiProperty({
    description:
      'Positive contributors with no cap, each counted once in `attainableMax` (uncapped events + SHOULD_DO behaviour instructions). Say so on the card when > 0',
  })
  uncappedContributors!: number;

  @ApiProperty({
    description:
      "ISO time the scenario's scoring config last changed (an event mapping, its base event's score, a behaviour instruction or a PASSIVE event created, edited or soft-deleted). Null when nothing is on record. Hard-deleted event mappings leave no trace — a removed positive event shows up as sessions in `> 100%`",
    nullable: true,
    type: String,
  })
  configStableSince!: string | null;

  @ApiProperty({
    type: [ScenarioScoreBandDto],
    description:
      'Every band of the row’s `rangeSource`, in order, empty bands included (count 0)',
  })
  bands!: ScenarioScoreBandDto[];

  @ApiProperty({
    description:
      'Median raw score of the banded sessions; null below `minSampleSize`',
    nullable: true,
    type: Number,
  })
  medianScore!: number | null;

  @ApiProperty({
    description:
      "'tooEasy': more than `thresholds.tooEasyTopBandPct`% of banded sessions in the top band (75–100% derived, 100+ raw). 'tooHard': more than `thresholds.tooHardBelowZeroPct`% below 0. Null otherwise",
    enum: ['tooEasy', 'tooHard'],
    nullable: true,
  })
  flag!: 'tooEasy' | 'tooHard' | null;

  @ApiProperty({
    description:
      'True when the ceiling is hard and some banded sessions still scored above it — impossible under that config, so the derivation does not describe these sessions (scoring edited under them, or a contributor missed). Show the row, mark it',
  })
  rangeSuspect!: boolean;
}

export class ScenarioCalibrationBelowFloorDto {
  @ApiProperty({ description: 'scenarios.id' })
  scenarioId!: number;

  @ApiProperty({ nullable: true, type: String })
  versionId!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  versionNumber!: number | null;

  @ApiProperty()
  title!: string;

  @ApiProperty({
    description:
      'Sessions with a resolved score so far — fewer than `minSampleSize`',
  })
  sessions!: number;
}

export class ScenarioCalibrationBandDefinitionDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;
}

export class ScenarioCalibrationBandDefinitionsDto {
  @ApiProperty({
    type: [ScenarioCalibrationBandDefinitionDto],
    description: "Band order and labels for `rangeSource: 'derived'` rows",
  })
  derived!: ScenarioCalibrationBandDefinitionDto[];

  @ApiProperty({
    type: [ScenarioCalibrationBandDefinitionDto],
    description: "Band order and labels for `rangeSource: 'raw'` rows",
  })
  raw!: ScenarioCalibrationBandDefinitionDto[];
}

export class ScenarioCalibrationThresholdsDto {
  @ApiProperty({
    description: 'Too easy: more than this share (%) in the top band',
    example: 80,
  })
  tooEasyTopBandPct!: number;

  @ApiProperty({
    description: 'Too hard: more than this share (%) below 0',
    example: 50,
  })
  tooHardBelowZeroPct!: number;
}

export class ScenarioCalibrationTotalsDto {
  @ApiProperty({
    description:
      'Countable sessions in scope with a resolved score, over every scenario version (rows + below floor)',
  })
  sessions!: number;

  @ApiProperty({
    description:
      'Countable sessions dropped as the unresolved score: score 0 with no detected event (the worker sends 0 when it cannot resolve a score). The same rule as repeat improvement (AAQ-216)',
  })
  unresolvedExcluded!: number;

  @ApiProperty({ description: 'Rows at or above the floor' })
  rows!: number;

  @ApiProperty({ description: "Of those, rows with rangeSource 'derived'" })
  derivedRows!: number;

  @ApiProperty({ description: 'Rows flagged tooEasy' })
  tooEasy!: number;

  @ApiProperty({ description: 'Rows flagged tooHard' })
  tooHard!: number;
}

export class ScenarioCalibrationResponseDto {
  @ApiProperty({
    description:
      'A version needs this many sessions for a row (and a derived range this many since the config last changed); shares below it are withheld',
  })
  minSampleSize!: number;

  @ApiProperty({
    type: [ScenarioCalibrationRowDto],
    description:
      'Scenario versions with at least `minSampleSize` resolved sessions, most sessions first. Empty (never 404) when none qualify',
  })
  rows!: ScenarioCalibrationRowDto[];

  @ApiProperty({
    type: [ScenarioCalibrationBelowFloorDto],
    description:
      'Scenario versions with some resolved sessions but fewer than `minSampleSize` — n only, most sessions first',
  })
  belowFloor!: ScenarioCalibrationBelowFloorDto[];

  @ApiProperty({ type: ScenarioCalibrationTotalsDto })
  totals!: ScenarioCalibrationTotalsDto;

  @ApiProperty({ type: ScenarioCalibrationBandDefinitionsDto })
  bandDefinitions!: ScenarioCalibrationBandDefinitionsDto;

  @ApiProperty({ type: ScenarioCalibrationThresholdsDto })
  thresholds!: ScenarioCalibrationThresholdsDto;

  @ApiProperty({ type: ScenarioCalibrationProvenanceDto })
  provenance!: ScenarioCalibrationProvenanceDto;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty()
  computedAt!: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/analytics/scenarios/progression
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard window query. `tenantId` narrows by the session's own tenant;
 * `compare` is accepted (inherited) and ignored — there is no KPI delta here.
 */
export class ScenarioProgressionQueryDto extends AnalyticsWindowQueryDto {}

/**
 * The three progression classes, counted per session over the sessions whose
 * turns carry a usable simulation state ("tracked"):
 *
 *  - reachedTerminal: some turn ran in the scenario's last state
 *    (`stateIsTerminal`, or stateIndex = stateCount − 1);
 *  - advanced: got past the state it opened in (a higher stateIndex than its
 *    first state-bearing turn) without reaching the last;
 *  - neverAdvanced: never got past its opening state — including sessions that
 *    only fell back to an earlier state (`fellBackOnly`).
 *
 * The three sum to `sessions`; their pcts are over `sessions`.
 */
export class ScenarioProgressionCountsDto {
  @ApiProperty({
    description:
      'Tracked sessions (turns carry a usable simulation state) — the denominator of the three shares',
  })
  sessions!: number;

  @ApiProperty({ description: 'Sessions that reached the terminal state' })
  reachedTerminal!: number;

  @ApiProperty({
    description: 'Sessions that advanced at least one state but not to the end',
  })
  advanced!: number;

  @ApiProperty({
    description: 'Sessions that never got past their opening state',
  })
  neverAdvanced!: number;

  @ApiProperty({
    description:
      'reachedTerminal ÷ sessions (0–100, 1 dp); null below `minSampleSize` sessions',
    nullable: true,
    type: Number,
  })
  reachedTerminalPct!: number | null;

  @ApiProperty({
    description:
      'advanced ÷ sessions (0–100, 1 dp); null below `minSampleSize` sessions',
    nullable: true,
    type: Number,
  })
  advancedPct!: number | null;

  @ApiProperty({
    description:
      'neverAdvanced ÷ sessions (0–100, 1 dp); null below `minSampleSize` sessions',
    nullable: true,
    type: Number,
  })
  neverAdvancedPct!: number | null;

  @ApiProperty({
    description:
      'Of `neverAdvanced`, sessions that moved only BACKWARD (the score fell below the opening state’s window). A count, not plotted',
  })
  fellBackOnly!: number;

  @ApiProperty({
    description:
      'Countable sessions with no usable state progression (see `totals.untrackedByReason`). Counted, NOT plotted, and not in `sessions`',
  })
  untracked!: number;
}

export class ScenarioProgressionPointDto extends ScenarioProgressionCountsDto {
  @ApiProperty({
    description:
      'Bucket start (yyyy-mm-dd), by session END. Gap-filled across the window: an empty bucket has zero counts and null shares',
  })
  bucket!: string;
}

export class ScenarioProgressionUntrackedReasonsDto {
  @ApiProperty({
    description:
      'No turn carries `stateCount`: builds before 2026-06-10, scenarios with no states, or sessions with no turn metrics',
  })
  noStateMetadata!: number;

  @ApiProperty({
    description:
      '`stateCount` present but no turn carries `stateIndex` — branching mode, which resolves no scored state',
  })
  branchingMode!: number;

  @ApiProperty({
    description:
      'A scenario with one state, or a session that opened in the last state: there is nowhere to advance to',
  })
  noRoomToAdvance!: number;
}

export class ScenarioProgressionTotalsDto extends ScenarioProgressionCountsDto {
  @ApiProperty({ type: ScenarioProgressionUntrackedReasonsDto })
  untrackedByReason!: ScenarioProgressionUntrackedReasonsDto;
}

export class ScenarioProgressionScenarioDto extends ScenarioProgressionCountsDto {
  @ApiProperty({ description: 'scenarios.id' })
  scenarioId!: number;

  @ApiProperty()
  title!: string;
}

export class ScenarioProgressionResponseDto {
  @ApiProperty({
    description:
      'Shares are withheld (null) below this many tracked sessions in a bucket or scenario',
  })
  minSampleSize!: number;

  @ApiProperty({ type: AnalyticsWindowDto })
  window!: AnalyticsWindowDto;

  @ApiProperty({
    type: [ScenarioProgressionPointDto],
    description:
      'One point per bucket of the window, oldest first. Stack reachedTerminal / advanced / neverAdvanced; put `untracked` under the chart as a count. Skip `window.inProgressBucket` on the chart',
  })
  points!: ScenarioProgressionPointDto[];

  @ApiProperty({
    type: ScenarioProgressionTotalsDto,
    description: 'The whole window',
  })
  totals!: ScenarioProgressionTotalsDto;

  @ApiProperty({
    type: [ScenarioProgressionScenarioDto],
    description:
      'Expanded view: per scenario over the whole window, scenarios with at least one tracked session, most tracked sessions first',
  })
  byScenario!: ScenarioProgressionScenarioDto[];

  @ApiProperty({ type: ScenarioCalibrationProvenanceDto })
  provenance!: ScenarioCalibrationProvenanceDto;

  @ApiProperty({ type: AnalyticsScopingDto })
  scoping!: AnalyticsScopingDto;

  @ApiProperty()
  computedAt!: string;
}
