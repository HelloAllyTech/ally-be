import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import {
  BugFindingDecisionReason,
  BugFindingSeverity,
  BugFindingSource,
  BugFindingStatus,
  BugHunterMode,
} from '../enum/bug-finding.enum';
import { BugHunterNotificationLevel } from '../enum/bug-hunter-notification.enum';
import {
  RoadmapOpportunitySource,
  RoadmapOpportunityStage,
} from 'src/product-roadmap/enum/roadmap-opportunity.enum';
import {
  BUG_FINDING_DECISION_NOTE_MAX_LENGTH,
  BUG_FINDING_DESCRIPTION_MAX_LENGTH,
  BUG_HUNTER_METRICS_DEFAULT_DAYS,
  BUG_HUNTER_METRICS_MAX_DAYS,
} from '../constants/bug-hunter.constants';

export class BugHuntEventDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  runId!: string | null;

  @ApiProperty({ nullable: true })
  repo!: string | null;

  @ApiProperty({ enum: BugHuntEventStage })
  stage!: BugHuntEventStage;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ type: Object, nullable: true })
  payload!: Record<string, any> | null;

  @ApiProperty({ nullable: true })
  suggestionId!: string | null;

  @ApiProperty({ nullable: true })
  findingId!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

/**
 * Body of `POST pipeline/runs/:id/report` — one progress event from the
 * external Claude Code pipeline.
 *
 * `stage` is validated against the enum on purpose, unlike most inbound
 * values in this repo, which are deliberately lenient (see CLAUDE.md: a
 * tightened enum can lock out a released mobile build that sends the old
 * value verbatim). Nothing here is a released client — the only callers are
 * `buildSweepPrompt` and `buildFixSessionPrompt`, both compiled from this
 * same enum — and the column carries a CHECK constraint matching it, so an
 * unrecognised stage was never going to be stored either way. Without this
 * it reached Postgres and came back as a 500 `Database query failed`, which
 * is how `verify_result` sat in the sweep prompt for a week silently
 * dropping every Phase-2 verification event: the pipeline treats the failed
 * POST as a transient blip and carries on. A 400 naming the bad value fails
 * the drift loudly, at the edge, for the price of one decorator.
 */
export class ReportBugHuntEventDto {
  @ApiPropertyOptional({
    description:
      "Repo this event is about. Defaults to the run's own repo when omitted.",
  })
  @IsOptional()
  @IsString()
  repo?: string;

  @ApiProperty({ enum: BugHuntEventStage })
  @IsEnum(BugHuntEventStage)
  stage!: BugHuntEventStage;

  @ApiProperty({ description: 'One line, for the run timeline.' })
  @IsString()
  summary!: string;

  @ApiPropertyOptional({
    type: Object,
    description:
      'Structured detail only — never raw log or PII content, which this table must not carry.',
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  suggestionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  findingId?: string;
}

/**
 * ── The machine surface's bodies ────────────────────────────────────────────
 *
 * `POST pipeline/runs`, `.../runs/:id/findings`, `.../runs/:id/close`,
 * `.../runs/:id/cost` and `PATCH pipeline/findings/:id` all used to declare
 * their body as an inline object type. TypeScript erases those at runtime, so
 * the global ValidationPipe had no decorated class to inspect and handed the
 * raw JSON straight through to the database — the same gap that let the sweep
 * prompt's `verify_result` reach a CHECK constraint and come back as a generic
 * 500 for a week. Every caller here is an LLM following prose instructions in
 * a prompt, which is precisely the caller most likely to send a plausible
 * wrong value.
 *
 * Where the line is drawn, deliberately — the aim is to change how these
 * requests FAIL, not which ones succeed:
 *
 *   - STRICT on enum-backed fields. Each already has a CHECK constraint behind
 *     it, so an unrecognised value was never going to be stored; it only chose
 *     between failing clearly and failing cryptically.
 *   - LENIENT — optional, type-checked only — wherever the column is nullable
 *     or carries a default. Requiring more than the schema does would reject
 *     bodies that work today, which is the trap CLAUDE.md warns about.
 *   - REQUIRED only where absence crashes or silently corrupts: a finding's
 *     `description` (sliced for the row title, so `undefined` throws) and a
 *     run's close `status` (see CloseBugHuntRunDto).
 *
 * None of this is the be-lenient-on-inbound-enums exception being ignored:
 * that rule protects released mobile builds that send a frozen value verbatim.
 * There is no released client on this controller — it is `x-api-key` guarded
 * and reachable only by the pipeline, whose prompts are compiled from these
 * same enums.
 */
export class StartBugHuntRunDto {
  @ApiProperty({ enum: BugHuntTrigger })
  @IsEnum(BugHuntTrigger)
  trigger!: BugHuntTrigger;

  @ApiProperty({ example: 'ally-be' })
  @IsString()
  @IsNotEmpty()
  repo!: string;
}

export class RawBugFindingDto {
  @ApiProperty({ enum: BugFindingSource })
  @IsEnum(BugFindingSource)
  source!: BugFindingSource;

  @ApiProperty({
    description:
      'Plain-language paragraph, blank line, then the technical detail. Sliced to 200 chars for the table title.',
  })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiPropertyOptional({
    description:
      'Optional because the column is nullable and BugFindingRepository.dedupeKey takes null: a production-log cluster often spans no single file.',
  })
  @IsOptional()
  @IsString()
  file?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  evidence?: string;

  @ApiPropertyOptional({ enum: BugFindingSeverity })
  @IsOptional()
  @IsEnum(BugFindingSeverity)
  severity?: BugFindingSeverity;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  proven?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  touchesGuardedPath?: boolean;

  @ApiPropertyOptional({
    description:
      'Function, class, route, component or endpoint. Omitting it drops dedup back to a description fingerprint.',
  })
  @IsOptional()
  @IsString()
  symbol?: string;

  @ApiPropertyOptional({
    description:
      'Only for source=reported_bug — the roadmap row this came from.',
  })
  @IsOptional()
  @IsUUID()
  reportedBugId?: string;
}

/**
 * One Discover round, persisted in a single call.
 *
 * Validating the whole batch up front is a real improvement on what it
 * replaced, not just a nicer error: `persistFindings` saves in a loop, so a
 * bad finding halfway through left the earlier ones written, threw, and
 * returned no `items` at all — leaving the agent with rows it cannot name and
 * no ids to report against. All-or-nothing matches what the prompt already
 * asks for ("persist them all in ONE call") and is recoverable by retrying.
 */
export class PersistBugFindingsDto {
  @ApiProperty({ example: 'ally-be' })
  @IsString()
  @IsNotEmpty()
  repo!: string;

  @ApiProperty({ type: [RawBugFindingDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RawBugFindingDto)
  findings!: RawBugFindingDto[];
}

export class PatchBugFindingDto {
  @ApiPropertyOptional({ enum: BugFindingStatus })
  @IsOptional()
  @IsEnum(BugFindingStatus)
  status?: BugFindingStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  escalationQuestion?: string;

  @ApiPropertyOptional({
    enum: BugFindingDecisionReason,
    description:
      'Why the Verify phase refuted this, sent alongside `status: dismissed`. ' +
      'Counted against the finder in the accuracy metric for not_a_bug / ' +
      'wrong_repo / duplicate, and shown back to the next sweep as a known ' +
      'non-bug — so a dismissal without one is a decision nothing can learn from.',
  })
  @IsOptional()
  @IsEnum(BugFindingDecisionReason)
  decisionReason?: BugFindingDecisionReason;

  @ApiPropertyOptional({
    description: 'One or two sentences on what the verifier actually checked.',
    maxLength: BUG_FINDING_DECISION_NOTE_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(BUG_FINDING_DECISION_NOTE_MAX_LENGTH)
  decisionNote?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 1,
    description:
      "The LOWEST verifier certainty for this finding, 0-1. Below the platform's " +
      'low-confidence threshold the finding waits for a human even in AI mode. ' +
      'Values outside [0,1] are discarded rather than clamped — a model reporting ' +
      '95 instead of 0.95 would otherwise read as maximum confidence, which is the ' +
      'wrong direction to fail in.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @ApiPropertyOptional({
    type: [Object],
    description:
      'The individual refute verdicts behind `confidence`, so a reader can tell ' +
      '"all three were unsure" from "two were certain and one dissented".',
  })
  @IsOptional()
  @IsArray()
  verifierVotes?: Record<string, any>[];
}

/**
 * An admin declining a bug.
 *
 * `reason` is REQUIRED, which makes this the one triage action that cannot be
 * taken without saying something — a deliberate cost on the commonest button
 * on the page. It buys the two things the tab could not do before: stop the
 * next sweep re-filing the same non-bug nightly, and answer how often Bug
 * Hunter is actually right. The UI keeps the cost to one keystroke (a
 * pick-list, one reason for a whole bulk batch) rather than making the field
 * optional, because an optional field is empty exactly when the reviewer was
 * in a hurry.
 */
export class RejectBugFindingDto {
  @ApiProperty({
    enum: BugFindingDecisionReason,
    description:
      'not_a_bug / wrong_repo / duplicate mean the finder got it wrong and count ' +
      'against its accuracy; wont_fix / too_risky mean it was right and the answer ' +
      'is still no, which is a priority call and is not held against it.',
  })
  @IsEnum(BugFindingDecisionReason)
  reason!: BugFindingDecisionReason;

  @ApiPropertyOptional({
    description:
      'Anything the six reasons cannot carry, in your own words. Optional on ' +
      'purpose: a mandatory note pushes people towards whichever reason needs ' +
      'least typing, which corrupts the field that is actually counted.',
    maxLength: BUG_FINDING_DECISION_NOTE_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(BUG_FINDING_DECISION_NOTE_MAX_LENGTH)
  note?: string;
}

export class BugHuntModelUsageDto {
  @ApiProperty({ example: 'claude-opus-4-5' })
  @IsString()
  @IsNotEmpty()
  model!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  inputTokens!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  outputTokens!: number;

  @ApiPropertyOptional({
    description: 'Prompt-cache read tokens (subset of input), when reported.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  cacheReadInputTokens?: number;

  @ApiPropertyOptional({
    description: 'Prompt-cache write tokens (subset of input), when reported.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  cacheCreationInputTokens?: number;
}

export class RecordBugHuntRunCostDto {
  @ApiProperty({ type: [BugHuntModelUsageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BugHuntModelUsageDto)
  modelUsage!: BugHuntModelUsageDto[];

  @ApiPropertyOptional({
    description:
      "The CLI's own cost figure, kept alongside ours for comparison.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cliReportedCostUsd?: number;
}

/** The only two states a run may be closed into. */
export const BUG_HUNT_RUN_CLOSE_STATUSES = ['completed', 'failed'] as const;

export type BugHuntRunCloseStatus =
  (typeof BUG_HUNT_RUN_CLOSE_STATUSES)[number];

/**
 * `status` is the one REQUIRED field here, and the reason is worth stating:
 * the handler maps anything that is not `'failed'` to COMPLETED, so before
 * this DTO a malformed or missing status silently recorded a sweep that died
 * as a clean night. That is bad data rather than a bad error message, and it
 * is invisible — nobody goes looking at a run that says it succeeded.
 *
 * Refusing the call instead leaves the run OPEN, which the prompts already
 * describe as the loud failure ("a run left open looks to an admin like a
 * sweep still working"). Honest and visible beats silent and wrong.
 *
 * The four totals stay optional for the opposite reason: they land in an
 * UPDATE that skips undefined, so omitting one has always meant "leave it at
 * zero", and a close that 400s over a missing count would strand the run open
 * for no real gain. Both prompts send all four anyway.
 */
export class CloseBugHuntRunDto {
  @ApiProperty({ enum: BUG_HUNT_RUN_CLOSE_STATUSES })
  @IsIn(BUG_HUNT_RUN_CLOSE_STATUSES)
  status!: BugHuntRunCloseStatus;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  foundCount?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  autoMergedCount?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  prOpenedCount?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  dismissedCount?: number;

  @ApiPropertyOptional({
    description: 'Recorded into run metadata on a FAILED close.',
  })
  @IsOptional()
  @IsString()
  errorMessage?: string;
}

export class BugHunterSettingsDto {
  @ApiProperty({
    enum: BugHunterMode,
    description:
      'OFF blocks every trigger. MANUAL and AI both let discovery run; only MANUAL gates the fix stage on an admin approval.',
  })
  mode!: BugHunterMode;

  @ApiProperty({ nullable: true })
  updatedBy!: number | null;

  @ApiProperty()
  updatedAt!: Date;
}

export class UpdateBugHunterSettingsDto {
  @ApiProperty({ enum: BugHunterMode })
  @IsEnum(BugHunterMode)
  mode!: BugHunterMode;
}

/**
 * Everything that is true of a bug because a PERSON filed it, rather than a
 * finder discovering it. Null on every sweep-found row.
 *
 * Read from the linked `roadmap_opportunities` row (`reportedBugId`), which is
 * still where a report is recorded — bugs left the roadmap's VIEWS, not its
 * storage. Surfaced here because Bug Hunter is now the only screen that lists
 * them, so this is the only place the reporter can be seen at all.
 */
export class ReportedBugContextDto {
  @ApiProperty({
    description: 'The roadmap_opportunities row behind this bug.',
  })
  opportunityId!: string;

  @ApiProperty({
    enum: RoadmapOpportunitySource,
    description:
      "'consumer' means the in-app Report-a-problem form; 'staff' means somebody internal filed it.",
  })
  reporterSource!: RoadmapOpportunitySource;

  @ApiProperty({ nullable: true })
  reportedBy!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      "The reporter's name, resolved at read time so a rename propagates.",
  })
  reportedByName!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Tenant the reporter belongs to.',
  })
  tenantId!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Diagnostic context captured silently at report time — route, device, OS, app version, ' +
      'client clock. Free-form: written by three different clients and never validated, so ' +
      'treat every key as optional.',
    type: 'object',
    additionalProperties: true,
  })
  reporterContext!: Record<string, any> | null;

  @ApiProperty({ description: 'When the bug was reported.' })
  reportedAt!: Date;
}

/**
 * PATCH findings/:id/stage. `stage: null` clears the override and hands the row
 * back to derivation — the "Back to auto" action, expressed as the same field
 * rather than a second endpoint so the two can never disagree.
 *
 * STRICT on the enum, per this file's validation doc: a stage outside the five
 * has a CHECK constraint waiting for it either way, and this only chooses
 * between failing clearly and failing cryptically. There is no released client
 * on this endpoint, so the be-lenient-on-inbound-enums exception does not apply.
 */
export class SetBugFindingStageDto {
  @ApiPropertyOptional({
    enum: RoadmapOpportunityStage,
    nullable: true,
    description:
      'Null clears the override and returns the row to derived stage.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEnum(RoadmapOpportunityStage)
  stage?: RoadmapOpportunityStage | null;
}

/**
 * The answer to "where did this roadmap bug go?" — nothing more.
 *
 * Deliberately just the id: the caller is a redirect, and handing it a whole
 * finding would mean fetching one twice (once here, once by the drawer it is
 * about to open).
 */
export class BugFindingRefDto {
  @ApiProperty({
    nullable: true,
    description:
      'Null when no finding was ever opened for this roadmap row — possible for a bug filed ' +
      'before Bug Hunter existed, or one whose inbox write failed (that write is best-effort).',
  })
  findingId!: string | null;
}

export class BugFindingDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  runId!: string | null;

  @ApiProperty({ nullable: true })
  repo!: string | null;

  @ApiProperty({ enum: BugFindingSource })
  source!: BugFindingSource;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({
    nullable: true,
    description:
      "The finder's or reporter's own words, before an admin rewrote them. Null when nobody has edited this bug — `description` is then still original.",
  })
  originalDescription!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'The admin who last rewrote the description.',
  })
  descriptionEditedBy!: number | null;

  @ApiProperty({ nullable: true })
  descriptionEditedAt!: Date | null;

  @ApiProperty({ nullable: true })
  file!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Function/class/route/component the finding sits on. Part of the dedupe key.',
  })
  symbol!: string | null;

  @ApiProperty({ nullable: true })
  evidence!: string | null;

  @ApiProperty({ enum: BugFindingSeverity, nullable: true })
  severity!: BugFindingSeverity | null;

  @ApiProperty()
  proven!: boolean;

  @ApiProperty()
  touchesGuardedPath!: boolean;

  @ApiProperty({ nullable: true })
  reportedBugId!: string | null;

  @ApiProperty({ enum: BugFindingStatus })
  status!: BugFindingStatus;

  @ApiProperty({
    enum: RoadmapOpportunityStage,
    description:
      'The coarse roadmap ladder for this bug. Derived from `status` unless an admin pinned ' +
      'it — see `stageIsAuto`. Always present, including on sweep-found bugs that have no ' +
      'roadmap row at all.',
  })
  stage!: RoadmapOpportunityStage;

  @ApiProperty({
    description:
      'True when `stage` is derived from `status` and will keep tracking it. False when an ' +
      'admin pinned the stage by hand, at which point pipeline transitions no longer move it.',
  })
  stageIsAuto!: boolean;

  @ApiProperty({
    nullable: true,
    description: 'The admin who pinned the stage.',
  })
  stageOverriddenBy!: number | null;

  @ApiProperty({ nullable: true })
  stageOverriddenByName!: string | null;

  @ApiProperty({ nullable: true })
  stageOverriddenAt!: Date | null;

  @ApiProperty({
    type: ReportedBugContextDto,
    nullable: true,
    description:
      'Present only when a person filed this bug. Null on every finder-discovered row.',
  })
  report!: ReportedBugContextDto | null;

  @ApiProperty({ nullable: true })
  prUrl!: string | null;

  @ApiProperty({ nullable: true })
  escalationQuestion!: string | null;

  @ApiProperty({ nullable: true })
  escalationAnswer!: string | null;

  @ApiProperty({ nullable: true })
  escalationAnsweredBy!: number | null;

  @ApiProperty({ nullable: true })
  escalationAnsweredAt!: Date | null;

  @ApiProperty({ nullable: true })
  decidedBy!: number | null;

  @ApiProperty({ nullable: true })
  decidedAt!: Date | null;

  @ApiProperty({
    enum: BugFindingDecisionReason,
    nullable: true,
    description:
      'Why this was declined. Null on anything not declined, and on rows declined before the reason was recorded.',
  })
  decisionReason!: BugFindingDecisionReason | null;

  @ApiProperty({ nullable: true })
  decisionNote!: string | null;

  @ApiProperty({
    nullable: true,
    minimum: 0,
    maximum: 1,
    description:
      "The Verify phase's lowest verifier certainty. Null on a proven finding (nothing to verify) and on rows predating verifier scoring.",
  })
  confidence!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'The id of the earlier finding this one is a return of — set when a shipped fix did not hold.',
  })
  regressionOf!: string | null;

  @ApiProperty({
    description:
      "True on the EARLIER finding whose fix came back. Distinct from `regressionOf`, which points the other way: this row's fix failed, that row is the failure.",
  })
  regressed!: boolean;

  @ApiProperty({
    description:
      'How many sweeps have re-found this bug since it was declined. A high count is the sweep arguing with a human.',
  })
  rediscoveredCount!: number;

  @ApiProperty({
    nullable: true,
    description:
      'GitHub Actions run doing the fixing. Null until the reconcile task correlates the dispatch to a run.',
  })
  sessionRunUrl!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'GitHub Actions run id for the fix session, once resolved. What "Stop fix session" cancels.',
  })
  sessionRunId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'e.g. `v1.4.2` or `admin-v2.1.0`.',
  })
  releaseTag!: string | null;

  @ApiProperty({ nullable: true })
  releaseRunUrl!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'The admin who promoted this fix to production.',
  })
  releasedBy!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'When the release workflow finished green — not when it was dispatched.',
  })
  releasedAt!: Date | null;

  @ApiProperty({
    nullable: true,
    description: 'The admin who pressed "Stop fix session".',
  })
  cancelledBy!: number | null;

  @ApiProperty({ nullable: true })
  cancelledAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class BugFixStepDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: '0-based position in the plan.' })
  stepIndex!: number;

  @ApiProperty({ nullable: true })
  repo!: string | null;

  @ApiProperty({ nullable: true })
  stepSummary!: string | null;

  @ApiProperty({ enum: BugFindingStatus })
  status!: BugFindingStatus;

  @ApiProperty({ nullable: true })
  prUrl!: string | null;

  @ApiProperty({ nullable: true })
  releaseTag!: string | null;

  @ApiProperty({ nullable: true })
  sessionRunUrl!: string | null;

  @ApiProperty({ nullable: true })
  releaseRunUrl!: string | null;
}

export class BugFindingDetailDto extends BugFindingDto {
  @ApiProperty({ type: [BugHuntEventDto] })
  events!: BugHuntEventDto[];

  @ApiProperty({
    type: [BugFixStepDto],
    description:
      "A coordinated fix's ordered steps, one per repo. Empty for an ordinary single-repo bug — its presence is what makes this a multi-repo fix.",
  })
  steps!: BugFixStepDto[];

  @ApiProperty({
    description:
      'Whether "Release to production" should be offered right now. False both when the fix is not merged yet and when it is merged but this repo/file cannot be mapped to one deployable.',
  })
  releasable!: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'What would be deployed, e.g. "Admin dashboard (CloudFront)" — shown in the release confirmation so the admin sees the blast radius before confirming.',
  })
  releaseTarget!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Why releasing is unavailable despite the fix being merged. Null when releasable, or when the fix simply is not merged yet (no explanation needed for that).',
  })
  releaseBlockedReason!: string | null;
}

export class BugHunterNotificationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, description: 'Opens this bug when clicked.' })
  findingId!: string | null;

  @ApiProperty({ nullable: true })
  runId!: string | null;

  @ApiProperty({ nullable: true })
  repo!: string | null;

  @ApiProperty({
    enum: BugHunterNotificationLevel,
    description:
      'Only ACTION_NEEDED means Bug Hunter has stopped and is waiting on you.',
  })
  level!: BugHunterNotificationLevel;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  body!: string | null;

  @ApiProperty({ nullable: true })
  readAt!: Date | null;

  @ApiProperty({ nullable: true })
  readBy!: number | null;

  @ApiProperty()
  createdAt!: Date;
}

export class ListBugHunterNotificationsQueryDto {
  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({
    required: false,
    description:
      'Show only what has not been read. Off by default — coming back to the tab, you want what happened while you were away, not only what nobody has clicked.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly?: boolean;
}

export class ListBugHunterNotificationsResponseDto {
  @ApiProperty({ type: [BugHunterNotificationDto] })
  items!: BugHunterNotificationDto[];

  @ApiProperty({ description: 'Drives the badge — unread across all levels.' })
  unreadCount!: number;
}

export class BugFixPlanStepDto {
  @ApiProperty({ description: 'Repo this step changes.' })
  @IsString()
  repo!: string;

  @ApiProperty({
    description: 'What has to change here, in one or two sentences.',
  })
  @IsString()
  summary!: string;
}

export class RecordBugFixPlanDto {
  @ApiProperty({
    type: [BugFixPlanStepDto],
    description:
      'In DEPENDENCY order — the step that has to ship first comes first. Bug Hunter fixes and releases them in exactly this order.',
  })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => BugFixPlanStepDto)
  steps!: BugFixPlanStepDto[];
}

export class StartBugFixSessionDto {
  @ApiProperty({
    required: false,
    description:
      'Override for which repo the session should run in. Not sent by the admin dashboard — when the finding has no repo yet (the usual case for a freshly reported bug), Bug Hunter classifies it itself rather than asking the caller to.',
  })
  @IsOptional()
  @IsString()
  repo?: string;
}

export class TriggerBugHuntSweepDto {
  @ApiProperty({
    description:
      'Repo to sweep. Must be one Bug Hunter is configured for — see GET pipeline/repo-commands.',
    example: 'ally-be',
  })
  @IsString()
  repo!: string;

  @ApiPropertyOptional({
    description:
      'Read the whole repo rather than only the last day of commits. Much more expensive, so it is off by default.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  deep?: boolean;
}

export class ListBugFindingsQueryDto {
  @ApiProperty({
    enum: [...Object.values(BugFindingStatus), 'all'],
    required: false,
  })
  @IsOptional()
  @IsIn([...Object.values(BugFindingStatus), 'all'])
  status?: BugFindingStatus | 'all';

  @ApiProperty({ enum: BugFindingSource, required: false })
  @IsOptional()
  @IsEnum(BugFindingSource)
  source?: BugFindingSource;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  repo?: string;

  @ApiProperty({
    required: false,
    description:
      "Only the findings one sweep touched. A run's own findings are NOT " +
      'necessarily recent: re-triaging a human-reported bug stamps this run ' +
      'onto a row created the day the bug was filed, so this is the only ' +
      'honest way to answer "what did last night produce?".',
  })
  @IsOptional()
  @IsUUID()
  runId?: string;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ListBugFindingsResponseDto {
  @ApiProperty({ type: [BugFindingDto] })
  items!: BugFindingDto[];

  @ApiProperty()
  count!: number;
}

export class AnswerBugFindingDto {
  @ApiProperty()
  @IsString()
  answer!: string;
}

export class EditBugFindingDescriptionDto {
  @ApiProperty({
    description:
      "The bug as you want Bug Hunter to understand it. This becomes the fix agent's entire brief, so it is worth being specific: what breaks, when, and what should happen instead.",
    maxLength: BUG_FINDING_DESCRIPTION_MAX_LENGTH,
  })
  @IsString()
  // Trimmed BEFORE validation, not after: `@IsNotEmpty` is happy with "   ",
  // so without this a whitespace-only body passed the pipe and stored a blank
  // brief — leaving the fix agent's prompt saying "Bug:" and nothing else.
  // Caught by exercising the real endpoint, not by the unit tests.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  // The cap is here because this text is pasted into that same prompt — an
  // accidental log-dump paste would otherwise crowd out the protocol after it.
  @MaxLength(BUG_FINDING_DESCRIPTION_MAX_LENGTH)
  description!: string;
}

export class BugHuntRunDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: BugHuntTrigger })
  trigger!: BugHuntTrigger;

  @ApiProperty()
  repo!: string;

  @ApiProperty({ enum: BugHuntRunStatus })
  status!: BugHuntRunStatus;

  @ApiProperty({ nullable: true })
  finishedAt!: Date | null;

  @ApiProperty()
  foundCount!: number;

  @ApiProperty()
  autoMergedCount!: number;

  @ApiProperty()
  prOpenedCount!: number;

  @ApiProperty()
  dismissedCount!: number;

  @ApiProperty({
    description:
      'USD, snapshotted from llm_usage at close time. Cache-blind (see cliReportedCostUsd) — an approximation, not a billed amount.',
  })
  totalTokenCostUsd!: string;

  @ApiProperty({
    nullable: true,
    description:
      "USD, from the Claude Code CLI's own total_cost_usd for this run — prices prompt-cache reads/writes at their real discounted rate, so this is closer to what the Anthropic console shows. Null for runs closed before this was captured, or if the CLI never reported one.",
  })
  cliReportedCostUsd!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Raw input token count backing totalTokenCostUsd. Null for runs closed before this was tracked.',
  })
  totalInputTokens!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Raw output token count backing totalTokenCostUsd. Null for runs closed before this was tracked.',
  })
  totalOutputTokens!: number | null;

  @ApiProperty()
  createdAt!: Date;
}

// ── metrics (GET /v1/bug-hunter/metrics) ──────────────────────────────────

export class BugHunterMetricsQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: BUG_HUNTER_METRICS_MAX_DAYS,
    default: BUG_HUNTER_METRICS_DEFAULT_DAYS,
    description:
      'Days of history. Findings are cohorted by DISCOVERY date, so "filed" and every ' +
      'rate over it share one denominator — see BugHunterMetricsService.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(BUG_HUNTER_METRICS_MAX_DAYS)
  days?: number;
}

export class BugHunterFunnelDto {
  @ApiProperty({
    nullable: true,
    description:
      'The source or repo this row aggregates. Null for a finding with no repo yet.',
  })
  key!: string | null;

  @ApiProperty()
  filed!: number;

  @ApiProperty({ description: 'Refuted by the Verify phase.' })
  dismissed!: number;

  @ApiProperty({ description: 'Declined by a human.' })
  rejected!: number;

  @ApiProperty({
    description:
      'Reached a fix at all — explicitly in Manual mode, implicitly in AI mode.',
  })
  approved!: number;

  @ApiProperty({
    description: 'Reached master. A released fix counts here too.',
  })
  merged!: number;

  @ApiProperty()
  released!: number;

  @ApiProperty({
    description:
      'The agent gave up, the release went red, or a human stopped it.',
  })
  failed!: number;

  @ApiProperty({
    description:
      'Still in the pipeline — neither declined, shipped, nor failed.',
  })
  open!: number;

  @ApiProperty({
    description:
      'Declines where the finder was judged wrong (not_a_bug / wrong_repo / duplicate).',
  })
  finderErrors!: number;

  @ApiProperty({
    description:
      'Declines with no reason stored — rows decided before the column existed.',
  })
  reasonNotRecorded!: number;

  @ApiProperty({
    nullable: true,
    description:
      '1 - finderErrors / judged, where judged counts only findings somebody actually ruled ' +
      'on. Null when nothing has been judged: 0/0 is not 0% accurate.',
  })
  accuracy!: number | null;

  @ApiProperty()
  lowConfidence!: number;

  @ApiProperty()
  unscored!: number;
}

export class BugHunterDeclineDto {
  @ApiProperty()
  reason!: string;

  @ApiProperty()
  count!: number;

  @ApiProperty({
    description: 'True when this reason means the finder was wrong.',
  })
  finderError!: boolean;
}

export class BugHunterStageLatencyDto {
  @ApiProperty({
    nullable: true,
    description:
      'Median, not mean — one stalled bug should not describe the month.',
  })
  medianHours!: number | null;

  @ApiProperty({ nullable: true })
  p90Hours!: number | null;

  @ApiProperty({ description: 'Findings the figures are computed from.' })
  sampled!: number;
}

export class BugHunterMetricsDto {
  @ApiProperty()
  windowDays!: number;

  @ApiProperty()
  since!: string;

  @ApiProperty()
  totalFiled!: number;

  @ApiProperty({ type: BugHunterFunnelDto })
  overall!: BugHunterFunnelDto;

  @ApiProperty({ type: [BugHunterFunnelDto] })
  bySource!: BugHunterFunnelDto[];

  @ApiProperty({ type: [BugHunterFunnelDto] })
  byRepo!: BugHunterFunnelDto[];

  @ApiProperty({ type: [BugHunterDeclineDto] })
  declines!: BugHunterDeclineDto[];

  @ApiProperty({
    type: Object,
    description:
      'filedToDecided / filedToMerged / mergedToReleased, each a BugHunterStageLatencyDto.',
  })
  latency!: Record<string, BugHunterStageLatencyDto>;

  @ApiProperty({
    type: Object,
    description:
      'filed (new findings that are a fix coming back), fixesThatFailed (fixes shipped in ' +
      'the window that have since returned), and rate = fixesThatFailed / merged.',
  })
  regressions!: Record<string, number | null>;

  @ApiProperty({
    type: Object,
    description:
      'totalUsd, runs, fixSessionRuns, fixSessionUsd and perMergedFixUsd. Aggregated in ' +
      "Postgres over the whole window, unlike the tab's newest-50 client-side sum.",
  })
  cost!: Record<string, number | null>;
}

export class BugHuntRunDetailDto extends BugHuntRunDto {
  @ApiProperty({ type: [BugHuntEventDto] })
  events!: BugHuntEventDto[];
}

export class ListBugHuntRunsResponseDto {
  @ApiProperty({ type: [BugHuntRunDto] })
  items!: BugHuntRunDto[];
}
