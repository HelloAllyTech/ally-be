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
