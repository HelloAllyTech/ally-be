import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Chat } from '../../chat/entity/chat.entity';
import { CounselorStatsQueryDto } from '../dto/analytics.dto';

@Injectable()
export class AnalyticsRepository extends Repository<Chat> {
  constructor(private dataSource: DataSource) {
    super(Chat, dataSource.createEntityManager());
  }

  async getCounselorStats(
    queryParams: CounselorStatsQueryDto,
    userId: number,
  ): Promise<{
    counselorName: string;
    counselorListeningDuration: string;
    counselorSharingDuration: string;
  } | null> {
    const query = this.createQueryBuilder('chat')
      .innerJoin('users', 'user', 'user.id = chat.counselorId')
      .innerJoin('call_details', 'callDetails', 'callDetails.chatId = chat.id')
      .select('user.name', 'counselorName')
      .addSelect(
        `SUM(("callDetails"."callInfo" ->> 'clientTalkingTime')::float)`,
        'counselorListeningDuration',
      )
      .addSelect(
        `SUM(("callDetails"."callInfo" ->> 'counselorTalkingTime')::float)`,
        'counselorSharingDuration',
      )
      .where(`callDetails.callInfo ->> 'clientTalkingTime' IS NOT NULL`)
      .andWhere(`(callDetails.callInfo ->> 'clientTalkingTime')::float > 0`)
      .andWhere(`callDetails.callInfo ->> 'counselorTalkingTime' IS NOT NULL`)
      .andWhere(`(callDetails.callInfo ->> 'counselorTalkingTime')::float >= 0`)
      .groupBy('user.name')
      .orderBy('user.name', 'ASC');

    if (queryParams.startDate && queryParams.endDate) {
      const startDateTime = `${queryParams.startDate} 00:00:00`;
      const endDateTime = `${queryParams.endDate} 23:59:59`;
      query.andWhere('"chat"."startedAt" BETWEEN :startDate AND :endDate', {
        startDate: startDateTime,
        endDate: endDateTime,
      });
    } else if (queryParams.startDate) {
      const startDateTime = `${queryParams.startDate} 00:00:00`;
      query.andWhere('"chat"."startedAt" >= :startDate', {
        startDate: startDateTime,
      });
    } else if (queryParams.endDate) {
      const endDateTime = `${queryParams.endDate} 23:59:59`;
      query.andWhere('"chat"."startedAt" <= :endDate', {
        endDate: endDateTime,
      });
    }

    query.andWhere('user.id = :userId', { userId });

    const result = await query.getRawOne();
    return result ?? null;
  }
}
