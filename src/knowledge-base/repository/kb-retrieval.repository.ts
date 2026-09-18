import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { KbRetrieval } from '../entity/kb-retrieval.entity';
import { KbRetrievalPassage } from '../entity/kb-retrieval-passage.entity';

/** One candidate's row, before it has a retrieval id to hang from. */
export type RetrievalPassageRecord = Omit<
  KbRetrievalPassage,
  'id' | 'retrievalId' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class KbRetrievalRepository extends Repository<KbRetrieval> {
  constructor(private readonly dataSource: DataSource) {
    super(KbRetrieval, dataSource.createEntityManager());
  }

  /**
   * Write a retrieval and its candidates together.
   *
   * One transaction, because a retrieval row with no passages is indistinguishable from a
   * retrieval that genuinely found nothing — and that distinction is exactly what the "does
   * the corpus have a gap" question turns on. Half a log is worse than none.
   */
  async record(
    retrieval: Omit<KbRetrieval, 'id' | 'createdAt' | 'updatedAt'>,
    passages: RetrievalPassageRecord[],
  ): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const saved = await manager
        .getRepository(KbRetrieval)
        .save(manager.getRepository(KbRetrieval).create(retrieval));

      if (passages.length) {
        await manager
          .getRepository(KbRetrievalPassage)
          .insert(
            passages.map((passage) => ({ ...passage, retrievalId: saved.id })),
          );
      }
      return saved.id;
    });
  }
}
