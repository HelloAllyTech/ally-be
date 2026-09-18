import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface RagWindowFilter {
  from: Date;
  /** Exclusive upper bound, so a bucket cannot be counted twice. */
  toExclusive: Date;
  consumer?: string | null;
  corpus?: string | null;
  judgeModel: string;
  judgePromptVersion: string;
}

export interface RagCoverageRow {
  retrievals: number;
  judged: number;
  passages: number;
  judged_passages: number;
}

export interface RagLabelRow {
  label: string;
  count: number;
}

export interface RagConsumerRow {
  consumer: string;
  retrievals: number;
  judged: number;
  empty_retrievals: number;
}

export interface RagFloorRow {
  floor: number;
  kept: number;
  relevant: number;
  tangential: number;
  irrelevant: number;
  relevant_lost: number;
}

export interface RagGapRow {
  query: string | null;
  query_sensitive: boolean;
  sufficiency: string;
  missing: string | null;
  consumer: string;
  returned_count: number;
  min_similarity: number;
  occurred_at: Date;
}

export interface RagJudgeVersionRow {
  judge_model: string;
  judge_prompt_version: string;
  judgments: number;
}

/**
 * Reads the retrieval log and its judgments.
 *
 * No test-tenant predicate anywhere here, unlike every other analytics repository, and that is
 * deliberate: a retrieval has no tenant. A corpus document is global or targeted by an explicit
 * join, and the population that actually distorts these numbers is the admin retrieval preview
 * — which `consumer` separates, and which every caller is expected to segment by.
 *
 * Judgments are always scoped to ONE (judge model, rubric version) pair. A rate that mixes two
 * judges is not a rate; `judgeVersions` exists so a surface can say when that is happening.
 */
@Injectable()
export class RagQualityAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Shared WHERE fragment for the retrieval table, with its parameters. */
  private retrievalScope(f: RagWindowFilter, params: unknown[]): string {
    let sql = ` WHERE r."createdAt" >= $${params.push(f.from)}
                  AND r."createdAt" < $${params.push(f.toExclusive)}`;
    if (f.consumer) sql += ` AND r.consumer = $${params.push(f.consumer)}`;
    if (f.corpus) sql += ` AND r.corpus = $${params.push(f.corpus)}`;
    return sql;
  }

  async coverage(f: RagWindowFilter): Promise<RagCoverageRow> {
    const params: unknown[] = [];
    const scope = this.retrievalScope(f, params);
    const jm = `$${params.push(f.judgeModel)}`;
    const jv = `$${params.push(f.judgePromptVersion)}`;
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS retrievals,
              count(j.id)::int AS judged,
              COALESCE(sum(p.n), 0)::int AS passages,
              COALESCE(sum(p.judged_n), 0)::int AS judged_passages
         FROM kb_retrievals r
         LEFT JOIN kb_retrieval_judgments j
           ON j.retrieval_id = r.id
          AND j.judge_model = ${jm}
          AND j.judge_prompt_version = ${jv}
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS n,
                  count(pj.id)::int AS judged_n
             FROM kb_retrieval_passages rp
             LEFT JOIN kb_retrieval_passage_judgments pj
               ON pj.passage_id = rp.id
              AND pj.judge_model = ${jm}
              AND pj.judge_prompt_version = ${jv}
            WHERE rp.retrieval_id = r.id
         ) p ON TRUE
         ${scope}`,
      params,
    )) as RagCoverageRow[];
    return row ?? { retrievals: 0, judged: 0, passages: 0, judged_passages: 0 };
  }

  async sufficiency(f: RagWindowFilter): Promise<RagLabelRow[]> {
    const params: unknown[] = [];
    const scope = this.retrievalScope(f, params);
    return this.dataSource.query(
      `SELECT j.sufficiency AS label, count(*)::int AS count
         FROM kb_retrieval_judgments j
         JOIN kb_retrievals r ON r.id = j.retrieval_id
         ${scope}
          AND j.judge_model = $${params.push(f.judgeModel)}
          AND j.judge_prompt_version = $${params.push(f.judgePromptVersion)}
        GROUP BY j.sufficiency
        ORDER BY count(*) DESC`,
      params,
    );
  }

  async relevance(
    f: RagWindowFilter,
  ): Promise<{ labels: RagLabelRow[]; superficial: number }> {
    const params: unknown[] = [];
    const scope = this.retrievalScope(f, params);
    const rows = (await this.dataSource.query(
      `SELECT pj.relevance AS label,
              count(*)::int AS count,
              count(*) FILTER (WHERE pj.superficial_match)::int AS superficial
         FROM kb_retrieval_passage_judgments pj
         JOIN kb_retrievals r ON r.id = pj.retrieval_id
         ${scope}
          AND pj.judge_model = $${params.push(f.judgeModel)}
          AND pj.judge_prompt_version = $${params.push(f.judgePromptVersion)}
        GROUP BY pj.relevance
        ORDER BY count(*) DESC`,
      params,
    )) as Array<RagLabelRow & { superficial: number }>;
    return {
      labels: rows.map((r) => ({ label: r.label, count: Number(r.count) })),
      superficial: rows.reduce((sum, r) => sum + Number(r.superficial ?? 0), 0),
    };
  }

  async byConsumer(f: RagWindowFilter): Promise<RagConsumerRow[]> {
    const params: unknown[] = [];
    const scope = this.retrievalScope(f, params);
    const jm = `$${params.push(f.judgeModel)}`;
    const jv = `$${params.push(f.judgePromptVersion)}`;
    return this.dataSource.query(
      `SELECT r.consumer,
              count(*)::int AS retrievals,
              count(j.id)::int AS judged,
              count(*) FILTER (WHERE r.returned_count = 0)::int AS empty_retrievals
         FROM kb_retrievals r
         LEFT JOIN kb_retrieval_judgments j
           ON j.retrieval_id = r.id
          AND j.judge_model = ${jm}
          AND j.judge_prompt_version = ${jv}
         ${scope}
        GROUP BY r.consumer
        ORDER BY count(*) DESC`,
      params,
    );
  }

  /**
   * Precision at each candidate floor, over judged passages.
   *
   * `relevant_lost` is the half that matters for a decision: raising the floor to X discards
   * the relevant passages below X, and that is the cost nobody could see when the floor was
   * being argued about. A LATERAL over a floor list rather than four near-identical queries,
   * so every row is computed from exactly the same population.
   */
  async floorCurve(
    f: RagWindowFilter,
    floors: number[],
  ): Promise<RagFloorRow[]> {
    const params: unknown[] = [];
    const scope = this.retrievalScope(f, params);
    const jm = `$${params.push(f.judgeModel)}`;
    const jv = `$${params.push(f.judgePromptVersion)}`;
    const floorParam = `$${params.push(floors)}`;
    return this.dataSource.query(
      `WITH judged AS (
         SELECT pj.relevance, pj.similarity
           FROM kb_retrieval_passage_judgments pj
           JOIN kb_retrievals r ON r.id = pj.retrieval_id
           ${scope}
            AND pj.judge_model = ${jm}
            AND pj.judge_prompt_version = ${jv}
       )
       SELECT f.floor::real AS floor,
              count(*) FILTER (WHERE judged.similarity >= f.floor)::int AS kept,
              count(*) FILTER (
                WHERE judged.similarity >= f.floor AND judged.relevance = 'relevant'
              )::int AS relevant,
              count(*) FILTER (
                WHERE judged.similarity >= f.floor AND judged.relevance = 'tangential'
              )::int AS tangential,
              count(*) FILTER (
                WHERE judged.similarity >= f.floor AND judged.relevance = 'irrelevant'
              )::int AS irrelevant,
              count(*) FILTER (
                WHERE judged.similarity < f.floor AND judged.relevance = 'relevant'
              )::int AS relevant_lost
         FROM unnest(${floorParam}::real[]) AS f(floor)
         LEFT JOIN judged ON TRUE
        GROUP BY f.floor
        ORDER BY f.floor ASC`,
      params,
    );
  }

  /**
   * The retrievals the judge found wanting, newest first.
   *
   * Ordered by when the RETRIEVAL happened rather than when it was judged, so a backfill
   * catching up cannot push month-old rows to the top of a list that reads as recent.
   */
  async gaps(f: RagWindowFilter, limit: number): Promise<RagGapRow[]> {
    const params: unknown[] = [];
    const scope = this.retrievalScope(f, params);
    return this.dataSource.query(
      // The query is WITHHELD IN SQL, not in the client, for a sensitive row. A health
      // worker's question is PHI-adjacent here, and a redaction that lives in a React
      // component is one careless `{gap.query}` away from being undone.
      `SELECT CASE WHEN r.query_sensitive THEN NULL ELSE r.query END AS query,
              r.query_sensitive,
              j.sufficiency,
              j.missing,
              r.consumer,
              r.returned_count,
              r.min_similarity,
              r."createdAt" AS occurred_at
         FROM kb_retrieval_judgments j
         JOIN kb_retrievals r ON r.id = j.retrieval_id
         ${scope}
          AND j.judge_model = $${params.push(f.judgeModel)}
          AND j.judge_prompt_version = $${params.push(f.judgePromptVersion)}
          AND j.sufficiency <> 'sufficient'
        ORDER BY r."createdAt" DESC
        LIMIT $${params.push(limit)}`,
      params,
    );
  }

  /** Every (model, rubric) pair that wrote judgments in the window — NOT filtered to the pin. */
  async judgeVersions(f: RagWindowFilter): Promise<RagJudgeVersionRow[]> {
    const params: unknown[] = [];
    const scope = this.retrievalScope(f, params);
    return this.dataSource.query(
      `SELECT j.judge_model, j.judge_prompt_version, count(*)::int AS judgments
         FROM kb_retrieval_judgments j
         JOIN kb_retrievals r ON r.id = j.retrieval_id
         ${scope}
        GROUP BY j.judge_model, j.judge_prompt_version
        ORDER BY count(*) DESC`,
      params,
    );
  }
}
