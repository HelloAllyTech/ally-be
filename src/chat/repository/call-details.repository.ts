import { DataSource, EntityManager, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { CallDetails } from '../../common/entities/call.details.entity';

@Injectable()
export class CallDetailsRepository extends Repository<CallDetails> {
  constructor(private dataSource: DataSource) {
    super(CallDetails, dataSource.createEntityManager());
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
