import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { KB_JUDGEABLE_CORPORA } from '../../knowledge-base/enum/knowledge-base.enum';

/** A retrieval worth judging, with the slice dimensions its labels will carry. */
export interface RagRetrievalRow {
  id: string;
  corpus: string;
  consumer: string;
  query: string;
  min_similarity: number;
  returned_count: number;
  occurred_at: Date;
}

/** One candidate passage, assembled with the text the judge has to read. */
export interface RagPassage {
  /** kb_retrieval_passages.id — what the label hangs from. */
  passage_id: string;
  chunk_id: string;
  document_id: string;
  document_title: string | null;
  section_path: string | null;
  similarity: number;
  outcome: string;
  pass: string;
  text: string;
}

/** What the judge returns per passage. */
export interface RagPassageJudgment {
  chunk_id: string;
  relevance: string;
  superficial_match?: boolean | null;
  reasoning?: string | null;
}

/** ...and for the retrieval as a whole. */
export interface RagRetrievalJudgment {
  sufficiency: string;
  missing?: string | null;
}

/**
 * Data access for the RAG-quality judge.
 *
 * Same division as every other judge here: ally-be owns the data and does all selection,
 * assembly and persistence; ally-ai is a stateless judge that never touches this database.
 */
@Injectable()
export class RagQualityRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The rubric from prompt management; null falls back to ally-ai's inline default, which is
   * where it lives today — no `rag_quality_rubric` row is seeded, so this returns null until
   * someone deliberately creates one.
   *
   * The seam is here on purpose: a label that proves wrong mid-backfill can be corrected
   * without a deploy. But note the hazard before using it. `judge_prompt_version` is pinned in
   * ally-ai and does NOT track a dashboard edit, so an override changes what the labels mean
   * while every row still says v1 — two rubrics under one version, silently. Bump the version
   * in ally-ai alongside any override that changes a definition rather than its wording.
   */
  async fetchRubric(): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT pv.prompt
         FROM prompts p
         JOIN prompts_versions pv
           ON pv."promptId" = p.id AND pv.version = p."currentVersion"
        WHERE p."promptCode" = 'rag_quality_rubric'
        LIMIT 1`,
    );
    return rows?.[0]?.prompt ?? null;
  }

  /**
   * Retrievals not yet judged under the target version.
   *
   * Note what is NOT excluded: retrievals that returned nothing. Those are the rows worth
   * judging most, because "the corpus lacks this" and "the floor was too tight" look identical
   * in the counts and only the judge's `missing` text tells them apart.
   *
   * `consumer` is a parameter rather than a free-for-all so the caller can take a balanced
   * sample. An afternoon of an operator probing thresholds in the admin preview can outnumber
   * the interview agent's real queries several times over; pooled and taken newest-first, that
   * afternoon becomes the whole measurement. Sampling across the variation that exists is the
   * cheapest guard against a false read (Stacks: "Mitigate false negatives by recruiting
   * participant variation").
   */
  async selectRetrievals(opts: {
    sinceDays?: number | null;
    limit?: number | null;
    consumer?: string | null;
    corpus?: string | null;
    unjudgedForVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null;
  }): Promise<RagRetrievalRow[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };

    const judgeable = KB_JUDGEABLE_CORPORA;
    let sql = `
      SELECT r.id,
             r.corpus,
             r.consumer,
             r.query,
             r.min_similarity,
             r.returned_count,
             r."createdAt" AS occurred_at
        FROM kb_retrievals r
       WHERE length(btrim(r.query)) > 0
         -- Only corpora whose passages live in kb_document_chunks. The staff document search
         -- and roadmap duplicate detection report into this log too, but their text lives in
         -- ally-ai's own collections, so the judge has nothing to read. Excluded BY NAME
         -- rather than left to fail the text join, which would count them as "passages
         -- outlived their chunk text" and read as a bug in the judge instead of a boundary
         -- of it.
         AND r.corpus = ANY(${p(judgeable)})`;

    if (opts.consumer) sql += ` AND r.consumer = ${p(opts.consumer)}`;
    if (opts.corpus) sql += ` AND r.corpus = ${p(opts.corpus)}`;
    if (opts.sinceDays != null) {
      sql += ` AND r."createdAt" >= now() - make_interval(days => ${p(
        opts.sinceDays,
      )})`;
    }
    if (opts.unjudgedForVersion) {
      sql += ` AND NOT EXISTS (
                 SELECT 1 FROM kb_retrieval_judgments j
                  WHERE j.retrieval_id = r.id
                    AND j.judge_model = ${p(opts.unjudgedForVersion.judgeModel)}
                    AND j.judge_prompt_version = ${p(
                      opts.unjudgedForVersion.judgePromptVersion,
                    )})`;
    }
    sql += ` ORDER BY r."createdAt" DESC`;
    if (opts.limit) sql += ` LIMIT ${p(opts.limit)}`;
    return this.dataSource.query(sql, params);
  }

  /**
   * The candidates to judge, with their text.
   *
   * Dropped candidates come too, not just the returned ones. A retrieval that returned three
   * good passages looks the same whether it discarded nothing or discarded something better,
   * and labelling the discards is the only way the document cap and the span-overlap rule get
   * checked against anything but their own reasoning. Ordered by rank, so a cap keeps the
   * passages that actually reached the consumer.
   *
   * An INNER join to the chunk, deliberately: a re-chunk deletes the old generation's rows, so
   * a passage can outlive its text. Those are dropped here and the caller skips the retrieval
   * rather than judging it on what is left — a partial passage list would be scored as if the
   * missing passages had never been retrieved, which reads as a retrieval that found less than
   * it did.
   */
  async buildPassages(
    retrievalId: string,
    limit: number,
  ): Promise<{ passages: RagPassage[]; recorded: number }> {
    const [countRow] = (await this.dataSource.query(
      `SELECT count(*)::int AS n FROM kb_retrieval_passages WHERE retrieval_id = $1`,
      [retrievalId],
    )) as Array<{ n: number }>;

    const rows = (await this.dataSource.query(
      `SELECT rp.id AS passage_id,
              rp.chunk_id,
              rp.document_id,
              d.title AS document_title,
              c.section_path,
              rp.similarity,
              rp.outcome,
              rp.pass,
              c.text
         FROM kb_retrieval_passages rp
         JOIN kb_document_chunks c ON c.id = rp.chunk_id
         LEFT JOIN kb_documents d ON d.id = rp.document_id
        WHERE rp.retrieval_id = $1
          AND length(btrim(c.text)) > 0
        ORDER BY rp.rank ASC
        LIMIT $2`,
      [retrievalId, limit],
    )) as RagPassage[];

    return { passages: rows, recorded: countRow?.n ?? 0 };
  }

  /**
   * Persist one retrieval's labels.
   *
   * Upsert on (unit, judgeModel, judgePromptVersion): a re-judge under the same version
   * corrects itself in place, while a new rubric writes alongside rather than over the old
   * verdict. One transaction, so a retrieval never carries passage labels without the
   * sufficiency row that says what they add up to.
   *
   * Passage labels are matched by `chunk_id` because that is what the judge was shown. A
   * judgment naming a chunk this retrieval did not include is dropped rather than stored
   * against a passage it does not describe — ally-ai drops those too, and neither layer trusts
   * the other to have done it.
   */
  async upsertJudgments(
    retrieval: RagRetrievalRow,
    passages: RagPassage[],
    passageJudgments: RagPassageJudgment[],
    retrievalJudgment: RagRetrievalJudgment,
    judgeModel: string,
    judgePromptVersion: string,
  ): Promise<number> {
    const byChunk = new Map(passages.map((p) => [p.chunk_id, p]));
    const seen = new Set<string>();
    const matched = passageJudgments.filter((j) => {
      if (!byChunk.has(j.chunk_id) || seen.has(j.chunk_id)) return false;
      seen.add(j.chunk_id);
      return true;
    });

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO kb_retrieval_judgments (
           retrieval_id, sufficiency, missing, passages_judged, passages_skipped,
           corpus, consumer, min_similarity, returned_count, occurred_at,
           judge_model, judge_prompt_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (retrieval_id, judge_model, judge_prompt_version)
         DO UPDATE SET
           sufficiency = EXCLUDED.sufficiency,
           missing = EXCLUDED.missing,
           passages_judged = EXCLUDED.passages_judged,
           passages_skipped = EXCLUDED.passages_skipped,
           "updatedAt" = now()`,
        [
          retrieval.id,
          retrievalJudgment.sufficiency,
          // Blank normalises to NULL: the gap question is read as
          // `missing IS NOT NULL`, and an empty string answers "yes, a gap,
          // unnamed" to every one of those queries. ally-ai normalises too;
          // this column's meaning is ours to keep.
          retrievalJudgment.missing?.trim() ? retrievalJudgment.missing : null,
          matched.length,
          Math.max(0, passages.length - matched.length),
          retrieval.corpus,
          retrieval.consumer,
          retrieval.min_similarity,
          retrieval.returned_count,
          retrieval.occurred_at,
          judgeModel,
          judgePromptVersion,
        ],
      );

      for (const j of matched) {
        const passage = byChunk.get(j.chunk_id)!;
        await manager.query(
          `INSERT INTO kb_retrieval_passage_judgments (
             passage_id, retrieval_id, chunk_id, document_id, relevance,
             superficial_match, reasoning, similarity, outcome, pass,
             corpus, consumer, occurred_at, judge_model, judge_prompt_version
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (passage_id, judge_model, judge_prompt_version)
           DO UPDATE SET
             relevance = EXCLUDED.relevance,
             superficial_match = EXCLUDED.superficial_match,
             reasoning = EXCLUDED.reasoning,
             "updatedAt" = now()`,
          [
            passage.passage_id,
            retrieval.id,
            j.chunk_id,
            passage.document_id,
            j.relevance,
            j.superficial_match ?? false,
            j.reasoning ?? null,
            passage.similarity,
            passage.outcome,
            passage.pass,
            retrieval.corpus,
            retrieval.consumer,
            retrieval.occurred_at,
            judgeModel,
            judgePromptVersion,
          ],
        );
      }
    });

    return matched.length;
  }
}
