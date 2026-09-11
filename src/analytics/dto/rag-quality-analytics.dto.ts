import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import {
  AnalyticsWindowDto,
  AnalyticsWindowQueryDto,
} from './platform-analytics.dto';

/** Consumers a retrieval can come from — see `consumer` on kb_retrievals. */
export const RAG_CONSUMERS = [
  'interview_agent',
  'admin_preview',
  'whatsapp_bot',
  'reference_search',
  'roadmap_matcher',
] as const;
export type RagConsumerParam = (typeof RAG_CONSUMERS)[number];

/**
 * Every corpus the log holds, including the two it cannot judge.
 *
 * `reference_documents` and `roadmap_opportunities` are real vector searches whose passage
 * text lives in ally-ai's own collections, so no relevance label exists for them. They are
 * here for their score distribution and their volume, and the response's `judged` count is
 * what says so — a zero there beside a non-zero `retrievals` is the honest shape of
 * "logged but not judged", not a gap in the judge.
 */
export const RAG_CORPORA = [
  'whatsapp_qa',
  'character_library',
  'reference_documents',
  'roadmap_opportunities',
] as const;
export type RagCorpusParam = (typeof RAG_CORPORA)[number];

/**
 * Window params plus the two segmentations that decide whether these numbers mean anything.
 *
 * `consumer` is not a convenience filter. The admin retrieval preview is an operator probing
 * thresholds — deliberately odd queries, repeated, often against material uploaded a minute
 * earlier — and the interview agent's queries are the ones a floor should be calibrated
 * against. Pooled, an afternoon of tuning moves the very distribution the tuning was meant to
 * read, which is the trap the language judge already fell into once.
 */
export class RagQualityQueryDto extends AnalyticsWindowQueryDto {
  @ApiProperty({
    description:
      'Narrow to one consumer. Omitted returns both, which is the honest default only ' +
      'because `byConsumer` breaks it down in the same response.',
    enum: RAG_CONSUMERS,
    required: false,
  })
  @IsOptional()
  @IsIn(RAG_CONSUMERS)
  consumer?: RagConsumerParam;

  @ApiProperty({
    description:
      'Narrow to one corpus. Chunk size and the similarity floor differ per corpus, so a ' +
      'similarity distribution pooled across both describes neither.',
    enum: RAG_CORPORA,
    required: false,
  })
  @IsOptional()
  @IsIn(RAG_CORPORA)
  corpus?: RagCorpusParam;
}

/** How much of the window the judge has actually seen. */
export class RagCoverageDto {
  @ApiProperty({ description: 'Retrievals logged in the window' })
  retrievals!: number;

  @ApiProperty({
    description:
      'Of those, how many carry a judgment under the pinned (model, rubric) pair. Every ' +
      'rate below is computed over THIS number, not over `retrievals`.',
  })
  judged!: number;

  @ApiProperty({ description: 'Candidate passages recorded, judged or not' })
  passages!: number;

  @ApiProperty({ description: 'Of those, how many carry a relevance label' })
  judgedPassages!: number;

  @ApiProperty({
    description:
      'True when the judged set is too small for a rate to mean anything. Surfaces should ' +
      'show the counts and suppress the percentages.',
  })
  belowReportingFloor!: boolean;
}

/** One label and its count. Counts, never bare percentages — see the service. */
export class RagLabelCountDto {
  @ApiProperty() label!: string;
  @ApiProperty() count!: number;
}

export class RagConsumerBreakdownDto {
  @ApiProperty({ enum: RAG_CONSUMERS }) consumer!: string;
  @ApiProperty() retrievals!: number;
  @ApiProperty() judged!: number;
  @ApiProperty({
    description:
      'Retrievals that returned nothing at all. Read with `gaps`: a corpus gap and a floor ' +
      'set too tight arrive as the same count here.',
  })
  emptyRetrievals!: number;
}

/**
 * One candidate floor, and what keeping it would have cost.
 *
 * This is the row the whole log was built for. Each entry asks: if the floor were X, which
 * judged passages would have survived, and how many of those were actually relevant?
 */
export class RagFloorPointDto {
  @ApiProperty({ description: 'Candidate similarity floor' })
  floor!: number;

  @ApiProperty({
    description: 'Judged passages scoring at or above this floor',
  })
  kept!: number;

  @ApiProperty({ description: 'Of those, labelled relevant' })
  relevant!: number;

  @ApiProperty({ description: 'Of those, labelled tangential' })
  tangential!: number;

  @ApiProperty({ description: 'Of those, labelled irrelevant' })
  irrelevant!: number;

  @ApiProperty({
    description:
      'Relevant passages that scored BELOW this floor — what raising it to here would have ' +
      'thrown away. The reason 0.5 was wrong: a direct hit measured 0.5056.',
  })
  relevantLost!: number;
}

/** A retrieval the judge found wanting, with what it said was missing. */
export class RagGapDto {
  @ApiProperty({
    description:
      "The query as issued, or NULL when withheld. The WhatsApp bot's queries are health " +
      "workers' own questions, so they are withheld in SQL rather than in the client.",
    nullable: true,
    type: String,
  })
  query!: string | null;

  @ApiProperty({
    description:
      "True when the query was withheld because it is someone's own words.",
  })
  querySensitive!: boolean;

  @ApiProperty({ description: 'sufficient | partial | nothing_useful' })
  sufficiency!: string;

  @ApiProperty({
    description:
      'What the judge would have needed and did not get, in its own words',
    nullable: true,
    type: String,
  })
  missing!: string | null;

  @ApiProperty({ enum: RAG_CONSUMERS }) consumer!: string;

  @ApiProperty({ description: 'Passages returned to the caller' })
  returnedCount!: number;

  @ApiProperty({ description: 'The floor this retrieval actually ran at' })
  minSimilarity!: number;

  @ApiProperty({ description: 'When the retrieval happened, ISO 8601' })
  occurredAt!: string;
}

export class RagJudgeVersionDto {
  @ApiProperty() judgeModel!: string;
  @ApiProperty() judgePromptVersion!: string;
  @ApiProperty({ description: 'Judgments written by this pair in the window' })
  judgments!: number;
}

export class RagQualityResponseDto {
  @ApiProperty({ type: AnalyticsWindowDto }) window!: AnalyticsWindowDto;

  @ApiProperty({ type: RagCoverageDto }) coverage!: RagCoverageDto;

  @ApiProperty({
    description:
      'Retrieval-level verdicts: sufficient / partial / nothing_useful, as counts.',
    type: [RagLabelCountDto],
  })
  sufficiency!: RagLabelCountDto[];

  @ApiProperty({
    description:
      'Passage-level labels: relevant / tangential / irrelevant, as counts.',
    type: [RagLabelCountDto],
  })
  relevance!: RagLabelCountDto[];

  @ApiProperty({
    description:
      'Passages that scored well on shared wording while answering something else. An ' +
      'EMBEDDING fact rather than a corpus one: this is the count that argues for reranking ' +
      'rather than for uploading more material.',
  })
  superficialMatches!: number;

  @ApiProperty({ type: [RagConsumerBreakdownDto] })
  byConsumer!: RagConsumerBreakdownDto[];

  @ApiProperty({
    description:
      'Precision at every candidate floor, over judged passages. NOTE the asymmetry: every ' +
      'passage here already cleared the floor in force at the time, so this measures ' +
      'precision and can only estimate what a HIGHER floor would have lost. What a LOWER ' +
      'floor would have found is not in the log at all — that needs the same queries re-run.',
    type: [RagFloorPointDto],
  })
  floorCurve!: RagFloorPointDto[];

  @ApiProperty({
    description:
      'The most recent retrievals the judge called partial or nothing_useful, with what it ' +
      'said was missing. The qualitative half, and the only place a corpus gap gets a name.',
    type: [RagGapDto],
  })
  gaps!: RagGapDto[];

  @ApiProperty({
    description:
      'Which (judge model, rubric version) pairs wrote the judgments in this window. More ' +
      'than one means the numbers mix two judges and are not comparable.',
    type: [RagJudgeVersionDto],
  })
  judgeVersions!: RagJudgeVersionDto[];
}
