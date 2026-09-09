import { Injectable } from '@nestjs/common';
import { Brackets, DataSource, Repository } from 'typeorm';
import { resolveSort } from 'src/common/util/sort.util';
import { KbDocument } from '../entity/kb-document.entity';
import {
  KbCorpus,
  KbDocumentSourceType,
  KbDocumentStatus,
} from '../enum/knowledge-base.enum';

export interface ListKbDocumentsOptions {
  /**
   * Required HERE even though the DTOs default it, and that asymmetry is deliberate. The
   * DTO default exists for one reason — the shipped dashboard does not send the field yet
   * and ally-be deploys first — so it belongs at the HTTP edge, where the compatibility
   * problem actually is. Inside, every screen and every retrieval is about exactly one
   * corpus, and a default would only ever serve a caller who forgot: the WhatsApp coverage
   * report was exactly that caller, counting other corpora's documents as its own uncited
   * material until the compiler caught it.
   */
  corpus: KbCorpus;
  limit?: number;
  offset?: number;
  search?: string;
  status?: KbDocumentStatus;
  sourceType?: KbDocumentSourceType;
  tags?: string[];
  includeArchived?: boolean;
  sortBy?: string;
  sortDir?: string;
}

/**
 * What a caller may sort the corpus by. A whitelist — these strings reach ORDER BY.
 *
 * `status` sorts by the enum's stored text rather than by pipeline order, which puts `failed` first
 * ascending. That happens to be the useful end of the list, so it is left alone rather than given a
 * CASE expression nobody asked for.
 */
const DOCUMENT_SORT_COLUMNS = {
  title: 'doc.title',
  status: 'doc.status',
  chunkCount: 'doc.chunkCount',
  updatedAt: 'doc.updatedAt',
  createdAt: 'doc.createdAt',
};

@Injectable()
export class KbDocumentRepository extends Repository<KbDocument> {
  constructor(private readonly dataSource: DataSource) {
    super(KbDocument, dataSource.createEntityManager());
  }

  async list(
    options: ListKbDocumentsOptions,
  ): Promise<{ documents: KbDocument[]; count: number }> {
    const {
      corpus,
      limit = 25,
      offset = 0,
      search,
      status,
      sourceType,
      tags,
      includeArchived = false,
    } = options;
    const sort = resolveSort(
      DOCUMENT_SORT_COLUMNS,
      'doc.createdAt',
      options.sortBy,
      options.sortDir,
    );

    const query = this.createQueryBuilder('doc');

    query.andWhere('doc.corpus = :corpus', { corpus });

    if (!includeArchived) {
      query.andWhere('doc.archivedAt IS NULL');
    }
    if (status) {
      query.andWhere('doc.status = :status', { status });
    }
    if (sourceType) {
      query.andWhere('doc.sourceType = :sourceType', { sourceType });
    }
    if (tags?.length) {
      // `&&` is array overlap: match a document carrying ANY of the requested tags. Requiring all
      // of them would make multi-tag filtering almost always empty.
      query.andWhere('doc.tags && :tags', { tags });
    }
    if (search?.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      query.andWhere(
        new Brackets((qb) => {
          qb.where('LOWER(doc.title) LIKE :term', { term })
            // rawText is searched too, so an admin can find the document that contains a phrase
            // rather than only the one whose title mentions it. Deliberately LIKE rather than
            // full-text: this is a small admin corpus, and a tsvector index plus its maintenance
            // is not worth it until the list is slow.
            .orWhere('LOWER(doc.rawText) LIKE :term', { term });
        }),
      );
    }

    // Selecting rawText into a list response would send megabytes per page for a column no list
    // view renders. Excluded explicitly rather than by accident.
    query
      .select([
        'doc.id',
        'doc.title',
        'doc.sourceType',
        'doc.sourceUrl',
        'doc.fileUrl',
        'doc.fileName',
        'doc.contentType',
        'doc.sizeBytes',
        'doc.language',
        'doc.tags',
        'doc.status',
        'doc.statusMessage',
        'doc.chunkCount',
        'doc.indexedChunkCount',
        'doc.contentHash',
        'doc.chunkVersion',
        'doc.archivedAt',
        'doc.createdBy',
        'doc.updatedBy',
        'doc.createdAt',
        'doc.updatedAt',
      ])
      // Archived last ALWAYS, whatever the chosen sort — mirrors the comfort-audio library, where
      // archiving hides an item from use without removing it from management. The requested sort is
      // secondary to that: a retired document sorting to the top of a title sort would put material
      // the bot no longer uses above material it does.
      .orderBy('doc.archivedAt', 'ASC', 'NULLS FIRST')
      .addOrderBy(sort.column, sort.direction)
      .limit(limit)
      .offset(offset);

    const [documents, count] = await query.getManyAndCount();
    return { documents, count };
  }

  /**
   * The retrievable documents of one corpus, split by whether a curator mapped them to
   * the topic being asked about.
   *
   * This split IS the boost. Retrieval searches `preferred` first and tops up from
   * `rest`, so a curator's hint wins ties without ever hiding the unmapped passage that
   * turns out to matter. Archived documents appear in neither: their vectors are deleted,
   * so returning their ids would only ask ally-ai about chunks it no longer holds.
   *
   * Returning ids rather than a filter flag is what keeps the corpus boundary honest —
   * ally-ai's search takes `document_ids`, so the scope becomes the query itself.
   */
  async retrievableIds(options: {
    corpus: KbCorpus;
    tags?: string[];
    characterTopics?: string[];
  }): Promise<{ preferred: string[]; rest: string[] }> {
    const query = this.createQueryBuilder('doc')
      .select(['doc.id', 'doc.characterTopics'])
      .where('doc.corpus = :corpus', { corpus: options.corpus })
      .andWhere('doc.archivedAt IS NULL')
      // Only an indexed document has vectors to match against; the others are still
      // extracting or have failed, and asking about them returns nothing at a cost.
      .andWhere('doc.status = :status', { status: KbDocumentStatus.INDEXED });

    if (options.tags?.length) {
      // `&&` overlap, matching the list filter's semantics rather than inventing a
      // second meaning for the same field.
      query.andWhere('doc.tags && :tags', { tags: options.tags });
    }

    const rows = await query.getMany();
    const wanted = new Set(options.characterTopics ?? []);
    const preferred: string[] = [];
    const rest: string[] = [];
    for (const row of rows) {
      const mapped =
        wanted.size > 0 &&
        (row.characterTopics ?? []).some((topic) => wanted.has(topic));
      (mapped ? preferred : rest).push(row.id);
    }
    return { preferred, rest };
  }

  /** Counts by status, for one corpus's stats strip. */
  async countsByStatus(corpus: KbCorpus): Promise<Record<string, number>> {
    const rows = await this.createQueryBuilder('doc')
      .select('doc.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('doc.corpus = :corpus', { corpus })
      .andWhere('doc.archivedAt IS NULL')
      .groupBy('doc.status')
      .getRawMany<{ status: string; count: string }>();

    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {});
  }

  async totals(
    corpus: KbCorpus,
  ): Promise<{ chunkCount: number; indexedChunkCount: number }> {
    const row = await this.createQueryBuilder('doc')
      .select('COALESCE(SUM(doc.chunkCount), 0)', 'chunkCount')
      .addSelect('COALESCE(SUM(doc.indexedChunkCount), 0)', 'indexedChunkCount')
      .where('doc.corpus = :corpus', { corpus })
      .andWhere('doc.archivedAt IS NULL')
      .getRawOne<{ chunkCount: string; indexedChunkCount: string }>();

    return {
      chunkCount: Number(row?.chunkCount ?? 0),
      indexedChunkCount: Number(row?.indexedChunkCount ?? 0),
    };
  }
}
