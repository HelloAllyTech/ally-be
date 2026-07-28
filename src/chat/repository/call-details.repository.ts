import { DataSource, EntityManager, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { CallDetails } from '../entity/call.details.entity';

@Injectable()
export class CallDetailsRepository extends Repository<CallDetails> {
  constructor(private dataSource: DataSource) {
    super(CallDetails, dataSource.createEntityManager());
  }

  async getAllTags(
    tenantId: string,
    limit?: number,
    offset?: number,
    search?: string,
  ): Promise<{ data: string[]; count: number }> {
    const query = this.createQueryBuilder('details')
      .select(
        "DISTINCT jsonb_array_elements(details.summary->'tags')->>'tag'",
        'tag',
      )
      .where("details.summary->'tags' IS NOT NULL")
      .andWhere("jsonb_typeof(details.summary->'tags') = 'array'")
      .andWhere('details.tenant_id = :tenantId', { tenantId })
      .orderBy('tag', 'ASC');

    if (search && search.trim()) {
      query.andWhere(
        "jsonb_array_elements(details.summary->'tags')->>'tag' ILIKE :search",
        {
          search: `%${search.trim()}%`,
        },
      );
    }

    if (limit) {
      query.limit(limit);
    }
    if (offset) {
      query.offset(offset);
    }

    const tags = await query.getRawMany();
    const count = await query.getCount();

    return {
      data: tags
        .map((item) => item.tag)
        .filter((tag) => tag && tag.trim() !== ''),
      count,
    };
  }

  /**
   * Merge `patch` into the stored `summary` jsonb instead of replacing it.
   *
   * A full replace loses every key the caller didn't know about — the AI-filled
   * fields, tags, and anything another writer (summary regeneration, the
   * auto-retry cron) added between the client's read and its write. Postgres'
   * `||` is a shallow key-wise merge applied inside the UPDATE, so keys absent
   * from the patch keep their stored value and no read-modify-write race
   * window exists.
   *
   * Key semantics follow the custom-field convention used elsewhere: a key
   * present with an explicit `null` clears it; a key omitted from the patch is
   * left untouched (`JSON.stringify` already drops `undefined`).
   *
   * Returns the number of rows updated (0 when the chat has no call_details row).
   */
  async mergeSummary(
    chatId: number,
    tenantId: string,
    patch: Record<string, unknown>,
    em?: EntityManager,
  ): Promise<number> {
    const repo = em ? em.getRepository(CallDetails) : this;
    const result = await repo
      .createQueryBuilder()
      .update(CallDetails)
      .set({
        summary: () => `COALESCE("summary", '{}'::jsonb) || :patch::jsonb`,
      } as unknown as Partial<CallDetails>)
      .where('"chatId" = :chatId', { chatId })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .setParameter('patch', JSON.stringify(patch))
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Merge a summary patch, creating the call_details row if the chat somehow
   * has none. Without the fallback a save against a chat with no row is a
   * silent no-op: the UPDATE matches nothing, the API returns 200, and the
   * counsellor's edit is gone with no error shown.
   */
  async mergeSummaryOrCreate(
    chatId: number,
    tenantId: string,
    patch: Record<string, unknown>,
  ): Promise<{ created: boolean }> {
    return this.dataSource.transaction(async (em) => {
      const affected = await this.mergeSummary(chatId, tenantId, patch, em);
      if (affected > 0) return { created: false };

      await em.getRepository(CallDetails).insert({
        chatId,
        tenantId,
        summary: patch as CallDetails['summary'],
      });
      return { created: true };
    });
  }

  async deleteCallDetailsByChatId(
    chatId: number,
    tenantId: string,
    em?: EntityManager,
  ): Promise<boolean> {
    const callDetailsRepo = em
      ? em.getRepository(CallDetails)
      : this.dataSource.getRepository(CallDetails);

    const result = await callDetailsRepo.delete({ chatId, tenantId });
    return result.affected !== 0;
  }
}
