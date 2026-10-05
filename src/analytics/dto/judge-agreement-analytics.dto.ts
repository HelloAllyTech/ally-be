import { ApiProperty } from '@nestjs/swagger';

/**
 * Judge vs human agreement — GET /v1/analytics/foundational-skills/judge-agreement
 * (AAQ-223, plan EFF-81; Highlights → Helping skills).
 *
 * Every helping-skills number on the tab comes from one LLM judge (ruler R1).
 * This is the check on it: people rate a stratified sample of the same cuts
 * against the same rubric (`fhs_human_ratings`, 30 cuts per calendar quarter,
 * `GET /v1/foundational-skills/human-ratings/sample`), and the judge's levels
 * are read against theirs. Raters tick behaviour codes and the level is derived
 * in code with the judge's own rule, so agreement is about what each SAW.
 *
 * Per skill, two comparisons:
 *  - `judgeVsHuman` — one pair per human rating (the judge's verdict on that
 *    cut against that person's), pooled across raters;
 *  - `humanVsHuman` — every pair of people who rated the same cut (cuts with
 *    two or more raters), the ceiling the judge can reasonably be held to.
 * And for each: opportunity agreement (did both find the skill assessable?)
 * and, over the cuts where BOTH did, level agreement — Cohen's κ unweighted,
 * quadratic-weighted κ (levels are ordinal 1–4), and % exact. Plus agreement on
 * the cut-level "any unhelpful behaviour" flag.
 *
 * ALL TIME and PLATFORM-WIDE by design, so it takes no query params: it is a
 * property of the instrument, not of an org, and a 30-a-quarter sample split by
 * org would be empty. Test organisations excluded. One rubric version (human
 * ratings under any other version are excluded and counted). κ and % are null
 * below `minSampleSize` distinct rated cuts per skill and comparison; the
 * counts always travel. With no ratings at all, `status` is `notYetMeasured`
 * and every statistic is null. This shape is a frontend contract.
 */

export class JudgeAgreementProvenanceDto {
  @ApiProperty({
    description:
      'Which ruler the numbers are read on (R1 judge vs human ratings of the same cuts) and how they are made',
  })
  derivation!: string;

  @ApiProperty({ description: 'The caveat the card must carry' })
  note!: string;
}

export class JudgeAgreementLevelDto {
  @ApiProperty({
    description:
      'Pairs compared where BOTH sides found an opportunity: judge vs human, one per human rating; human vs human, one per pair of raters of the same cut',
  })
  pairs!: number;

  @ApiProperty({
    description:
      'Distinct cuts behind `pairs` — the unit `minSampleSize` counts',
  })
  cuts!: number;

  @ApiProperty({
    description:
      "Cohen's κ on the 1–4 level, unweighted (any disagreement counts the same). 1 = perfect, 0 = chance, < 0 = worse than chance. Null below `minSampleSize` cuts, or when both sides used one and the same level throughout (κ undefined)",
    nullable: true,
    type: Number,
  })
  kappa!: number | null;

  @ApiProperty({
    description:
      'Quadratic-weighted κ: a disagreement costs ((a − b)/3)², so 3 vs 4 counts a ninth of 1 vs 4 — the honest κ for an ordinal scale. Null as `kappa`',
    nullable: true,
    type: Number,
  })
  weightedKappa!: number | null;

  @ApiProperty({
    description:
      'Percent of pairs giving the same level (0–100, 1 dp); null below `minSampleSize` cuts',
    nullable: true,
    type: Number,
  })
  exactAgreementPct!: number | null;

  @ApiProperty({
    description:
      'Judge vs human only: mean of (judge level − human level), 2 dp — positive means the judge scores higher. Always null for human vs human (which rater is first is arbitrary); null below `minSampleSize` cuts',
    nullable: true,
    type: Number,
  })
  meanDifference!: number | null;

  @ApiProperty({
    description:
      'Counts, 4×4: rows = level 1–4 given by the judge (human vs human: the rater with the lower user id), columns = level 1–4 given by the human (the other rater). Counts always travel',
    type: 'array',
    items: { type: 'array', items: { type: 'number' } },
    example: [
      [0, 0, 0, 0],
      [0, 3, 1, 0],
      [0, 1, 4, 0],
      [0, 0, 1, 0],
    ],
  })
  confusion!: number[][];
}

export class JudgeAgreementBinaryDto {
  @ApiProperty({
    description:
      'Pairs compared: judge vs human, one per human rating; human vs human, one per pair of raters of the same cut',
  })
  pairs!: number;

  @ApiProperty({ description: 'Distinct cuts behind `pairs`' })
  cuts!: number;

  @ApiProperty({
    description:
      "Cohen's κ on the yes/no call; null below `minSampleSize` cuts, or when both sides gave the same answer every time (κ undefined)",
    nullable: true,
    type: Number,
  })
  kappa!: number | null;

  @ApiProperty({
    description:
      'Percent of pairs giving the same answer (0–100, 1 dp); null below `minSampleSize` cuts',
    nullable: true,
    type: Number,
  })
  agreementPct!: number | null;

  @ApiProperty({ description: 'Both said yes' })
  both!: number;

  @ApiProperty({
    description:
      'Only the first said yes (the judge; human vs human: the rater with the lower user id)',
  })
  onlyFirst!: number;

  @ApiProperty({
    description: 'Only the second said yes (the human; the other rater)',
  })
  onlySecond!: number;

  @ApiProperty({ description: 'Both said no' })
  neither!: number;
}

export class JudgeAgreementComparisonDto {
  @ApiProperty({
    type: JudgeAgreementBinaryDto,
    description:
      'Did both find the skill assessable in the window? (yes = opportunity). Over every pair, whatever the level',
  })
  opportunity!: JudgeAgreementBinaryDto;

  @ApiProperty({
    type: JudgeAgreementLevelDto,
    description:
      'Level agreement over the pairs where BOTH found an opportunity',
  })
  level!: JudgeAgreementLevelDto;
}

export class JudgeAgreementSkillDto {
  @ApiProperty({ description: 'Stable rubric skill key (e.g. `verbal`)' })
  skill!: string;

  @ApiProperty({ description: 'Display name from the rubric' })
  name!: string;

  @ApiProperty({ enum: ['engage', 'understand', 'support'] })
  tier!: string;

  @ApiProperty({ type: JudgeAgreementComparisonDto })
  judgeVsHuman!: JudgeAgreementComparisonDto;

  @ApiProperty({ type: JudgeAgreementComparisonDto })
  humanVsHuman!: JudgeAgreementComparisonDto;
}

export class JudgeAgreementUnhelpfulDto {
  @ApiProperty({
    type: JudgeAgreementBinaryDto,
    description:
      "The cut-level flag 'any assessed skill scored 1': the judge's `hasUnhelpfulBehaviour` against the rater's `anyUnhelpful`, one pair per rating",
  })
  judgeVsHuman!: JudgeAgreementBinaryDto;

  @ApiProperty({
    type: JudgeAgreementBinaryDto,
    description: 'The same flag between every pair of raters of the same cut',
  })
  humanVsHuman!: JudgeAgreementBinaryDto;
}

export class JudgeAgreementQuarterDto {
  @ApiProperty({
    description: "Calendar quarter of the cuts' `closedSessionEndedAt`",
    example: '2026Q3',
  })
  quarter!: string;

  @ApiProperty({
    description: 'False for the quarter in progress: its sample can still move',
  })
  complete!: boolean;

  @ApiProperty({
    description:
      'Sampleable cuts: scored by the judge under `rubricVersion` with a composite, non-test orgs',
  })
  population!: number;

  @ApiProperty({
    description:
      'Cuts the sampling rule draws: min(samplePerQuarter, population)',
  })
  sampled!: number;

  @ApiProperty({ description: 'Sampled cuts with at least one human rating' })
  sampledRated!: number;

  @ApiProperty({
    description:
      'Sampled cuts with two or more human ratings (needed for human vs human)',
  })
  sampledMultiRated!: number;
}

export class JudgeAgreementCoverageDto {
  @ApiProperty({
    description: 'Calendar quarters with at least one sampleable cut',
  })
  quarters!: number;

  @ApiProperty({ description: 'Σ sampled over those quarters' })
  sampledCuts!: number;

  @ApiProperty({
    description:
      'Distinct cuts with at least one counted human rating (sampled or not: every rating of a judged cut counts)',
  })
  ratedCuts!: number;

  @ApiProperty({
    description: 'Of `ratedCuts`, those in their quarter’s sample',
  })
  ratedSampledCuts!: number;

  @ApiProperty({
    description: 'Distinct cuts with two or more counted human ratings',
  })
  multiRatedCuts!: number;

  @ApiProperty({ description: 'Counted human ratings (rows)' })
  ratings!: number;

  @ApiProperty({ description: 'Distinct people behind `ratings`' })
  raters!: number;

  @ApiProperty({
    description:
      'Human ratings stored under a different rubric version — excluded, never pooled across rulers',
  })
  excludedOtherRubricVersion!: number;

  @ApiProperty({
    description:
      'Human ratings under `rubricVersion` whose cut has no SCORED judge assessment with a composite under it — excluded (nothing to compare with)',
  })
  excludedNoJudgement!: number;

  @ApiProperty({
    type: [JudgeAgreementQuarterDto],
    description: 'Per quarter, oldest first',
  })
  byQuarter!: JudgeAgreementQuarterDto[];
}

export class JudgeAgreementResponseDto {
  @ApiProperty({
    enum: ['notYetMeasured', 'collecting', 'measured'],
    description:
      '`notYetMeasured`: no counted human rating exists (every statistic is null). `collecting`: ratings exist, but no skill has `minSampleSize` rated cuts for judge vs human level agreement yet. `measured`: at least one skill does',
  })
  status!: 'notYetMeasured' | 'collecting' | 'measured';

  @ApiProperty({
    description: 'The one rubric version every number here comes from',
  })
  rubricVersion!: string;

  @ApiProperty({
    description:
      'κ and % agreement are withheld below this many distinct rated cuts per skill and comparison (MIN_RATED_CUTS_FOR_AGREEMENT)',
  })
  minSampleSize!: number;

  @ApiProperty({
    description: 'Cuts the sampling rule draws per calendar quarter',
  })
  samplePerQuarter!: number;

  @ApiProperty({
    type: [JudgeAgreementSkillDto],
    description: 'Every transcript-scored rubric skill, rubric order',
  })
  skills!: JudgeAgreementSkillDto[];

  @ApiProperty({ type: JudgeAgreementUnhelpfulDto })
  unhelpful!: JudgeAgreementUnhelpfulDto;

  @ApiProperty({ type: JudgeAgreementCoverageDto })
  coverage!: JudgeAgreementCoverageDto;

  @ApiProperty({ type: JudgeAgreementProvenanceDto })
  provenance!: JudgeAgreementProvenanceDto;

  @ApiProperty()
  computedAt!: string;
}
