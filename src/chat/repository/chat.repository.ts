import { Injectable } from '@nestjs/common';
import { Chat, ChatStatus } from '../entity/chat.entity';
import {
  DataSource,
  EntityManager,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { UpdateChatInput } from '../type/chat.type';
import { CounselorStatsQueryDto } from 'src/analytics/dto/analytics.dto';
import { CallDetails } from '../entity/call.details.entity';
import { User } from 'src/user/entity/user.entity';
import {
  CallLogFilters,
  CallLogSortBy,
  SortOrder,
} from '../dto/call-log.request.dto';
import { CallLogsParams } from '../type/call.details.type';

@Injectable()
export class ChatRepository extends Repository<Chat> {
  // See joinCallQualityCustomFieldValue for why this COALESCEs between the
  // two possible storage locations.
  private static readonly QUALITY_SCORE_EXPRESSION =
    "COALESCE(CAST(cfv_quality.value AS NUMERIC), CAST(details.summary->>'callQuality' AS NUMERIC))";

  constructor(private dataSource: DataSource) {
    super(Chat, dataSource.createEntityManager());
  }

  async getCallLogsQuery(
    params: CallLogsParams,
  ): Promise<{ data: Chat[]; count: number }> {
    const query = this.createQueryBuilder('chat')
      .leftJoinAndMapOne(
        'chat.details',
        CallDetails,
        'details',
        'details.chatId = chat.id',
      )
      .leftJoinAndMapOne(
        'chat.client',
        User,
        'client',
        'client.id = chat.clientId',
      )
      .leftJoinAndMapMany(
        'chat.customFieldValues',
        'chat_custom_field_values',
        'cfv',
        'cfv.chatId = chat.id',
      );
    this.joinCallQualityCustomFieldValue(query);

    query.where('chat.counselorId = :counselorId', {
      counselorId: params.counselorId,
    });

    // Use take/skip (not limit/offset) so pagination counts unique chats. The
    // leftJoinAndMapMany on customFieldValues produces N rows per chat; raw
    // SQL LIMIT would cap at N rows then dedup, returning fewer than the
    // requested page size and hiding chats from later pages.
    if (params.limit) {
      query.take(params.limit);
    }
    if (params.offset) {
      query.skip(params.offset);
    }
    if (params.sortBy) {
      const sortOrder =
        params.order === 'ASC' || params.order === 'DESC'
          ? (params.order as SortOrder)
          : SortOrder.DESC;
      this.applySorting(query, params.sortBy as CallLogSortBy, sortOrder);
    }

    query.andWhere('chat.tenantId = :tenantId', { tenantId: params.tenantId });
    query.andWhere('chat.status = :status', { status: ChatStatus.ENDED });
    if (params.archive) {
      if (params.archive === 'true') {
        query.andWhere('chat.archivedAt IS NOT NULL');
      } else {
        query.andWhere('chat.archivedAt IS NULL');
      }
    }
    if (params.callName) {
      query.andWhere(`details."callInfo"->>'summaryName' ILIKE :callName`, {
        callName: `%${params.callName}%`,
      });
    }

    const [data, count] = await query.getManyAndCount();
    return { data, count };
  }

  async getAdminCallLogsQuery(
    tenantId: string,
    filters: CallLogFilters,
  ): Promise<{ data: Chat[]; count: number }> {
    const query = this.createQueryBuilder('chat')
      .leftJoinAndMapOne(
        'chat.details',
        CallDetails,
        'details',
        'details.chatId = chat.id',
      )
      .leftJoinAndMapOne(
        'chat.client',
        User,
        'client',
        'client.id = chat.clientId',
      )
      .leftJoinAndMapOne(
        'chat.counselor',
        User,
        'counselor',
        'counselor.id = chat.counselorId',
      )
      .leftJoinAndMapMany(
        'chat.customFieldValues',
        'chat_custom_field_values',
        'cfv',
        'cfv.chatId = chat.id',
      );
    this.joinCallQualityCustomFieldValue(query);

    // Only show ENDED calls for admin call logs
    query.andWhere('chat.status = :status', { status: ChatStatus.ENDED });
    if (filters.archive) {
      if (filters.archive === 'true') {
        query.andWhere('chat.archivedAt IS NOT NULL');
      } else {
        query.andWhere('chat.archivedAt IS NULL');
      }
    }

    this.applyStringFilters(query, filters);
    this.applyIdFilters(query, filters);
    this.applyDateFilters(query, filters);
    this.applyDurationFilters(query, filters);
    this.applyQualityFilters(query, filters);
    this.applyTagFilters(query, filters);

    query.andWhere('chat.tenant_id = :tenantId', { tenantId });

    // See getCallLogsQuery for why take/skip instead of limit/offset.
    if (filters.limit) query.take(filters.limit);
    if (filters.offset) query.skip(filters.offset);

    this.applySorting(
      query,
      (filters.sortBy as CallLogSortBy) || CallLogSortBy.START_DATE,
      (filters.order as SortOrder) || SortOrder.DESC,
    );

    const [data, count] = await query.getManyAndCount();
    return { data, count };
  }

  private applyStringFilters(
    query: SelectQueryBuilder<Chat>,
    filters: CallLogFilters,
  ) {
    if (filters.counselorName) {
      query.andWhere('counselor.name ILIKE :counselorName', {
        counselorName: `%${filters.counselorName}%`,
      });
    }
    if (filters.callName) {
      query.andWhere(`details."callInfo"->>'summaryName' ILIKE :callName`, {
        callName: `%${filters.callName}%`,
      });
    }
  }

  private applyIdFilters(
    query: SelectQueryBuilder<Chat>,
    filters: CallLogFilters,
  ) {
    if (filters.counselorIds) {
      const ids = filters.counselorIds
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id));

      if (ids.length > 0) {
        query.andWhere('chat.counselorId IN (:...counselorIds)', {
          counselorIds: ids,
        });
      }
    }
  }

  private applyDateFilters(
    query: SelectQueryBuilder<Chat>,
    filters: CallLogFilters,
  ) {
    if (filters.startDate) {
      query.andWhere('chat.startedAt >= :startDate', {
        startDate: new Date(filters.startDate),
      });
    }
    if (filters.endDate) {
      query.andWhere('chat.startedAt <= :endDate', {
        endDate: new Date(filters.endDate),
      });
    }
  }

  private applyDurationFilters(
    query: SelectQueryBuilder<Chat>,
    filters: CallLogFilters,
  ) {
    if (filters.minDuration !== undefined) {
      query.andWhere('details.callDuration >= :minDuration', {
        minDuration: filters.minDuration,
      });
    }
    if (filters.maxDuration !== undefined) {
      query.andWhere('details.callDuration <= :maxDuration', {
        maxDuration: filters.maxDuration,
      });
    }
  }

  /**
   * callQuality now lives in `chat_custom_field_values` for a migrated
   * tenant (seedKey: 'callQuality') and in `details.summary` for a
   * not-yet-migrated one — never both, per the rollout consistency gate in
   * CustomFieldsService.applyMigratedFieldsGate. Joining the custom field
   * value (if any) lets every consumer read via QUALITY_SCORE_EXPRESSION's
   * COALESCE without needing to know which state a tenant is in.
   */
  private joinCallQualityCustomFieldValue(query: SelectQueryBuilder<Chat>) {
    query
      .leftJoin(
        'custom_field_definitions',
        'cfd_quality',
        'cfd_quality.tenant_id = chat.tenantId AND cfd_quality."seedKey" = :qualitySeedKey AND cfd_quality."isActive" = true',
        { qualitySeedKey: 'callQuality' },
      )
      .leftJoin(
        'chat_custom_field_values',
        'cfv_quality',
        'cfv_quality."chatId" = chat.id AND cfv_quality."fieldDefinitionId" = cfd_quality.id',
      );
  }

  private applyQualityFilters(
    query: SelectQueryBuilder<Chat>,
    filters: CallLogFilters,
  ) {
    if (filters.minQualityScore !== undefined) {
      query.andWhere(
        `${ChatRepository.QUALITY_SCORE_EXPRESSION} >= :minQualityScore`,
        {
          minQualityScore: filters.minQualityScore,
        },
      );
    }
    if (filters.maxQualityScore !== undefined) {
      query.andWhere(
        `${ChatRepository.QUALITY_SCORE_EXPRESSION} <= :maxQualityScore`,
        {
          maxQualityScore: filters.maxQualityScore,
        },
      );
    }
  }

  private applyTagFilters(
    query: SelectQueryBuilder<Chat>,
    filters: CallLogFilters,
  ) {
    query.andWhere(
      "(details.summary->'tags' IS NULL OR jsonb_typeof(details.summary->'tags') = 'array')",
    );

    if (filters.tags) {
      const tags = filters.tags.split(',').map((tag) => tag.trim());
      query.andWhere(
        "EXISTS (SELECT 1 FROM jsonb_array_elements(details.summary->'tags') AS tag WHERE tag->>'tag' = ANY(:tags))",
        { tags },
      );
    }
  }

  private applySorting(
    query: SelectQueryBuilder<Chat>,
    sortBy: CallLogSortBy,
    order: SortOrder = SortOrder.DESC,
  ) {
    const sortOrder = order as 'ASC' | 'DESC';

    switch (sortBy) {
      case CallLogSortBy.ID:
        query.orderBy('chat.id', sortOrder);
        break;
      case CallLogSortBy.COUNSELOR_NAME:
        query.orderBy('counselor.name', sortOrder);
        break;
      case CallLogSortBy.CLIENT_ID:
        query.orderBy('chat.clientId', sortOrder);
        break;
      case CallLogSortBy.CALL_DURATION:
        query.orderBy('details.callDuration', sortOrder);
        break;
      case CallLogSortBy.START_DATE:
        query.orderBy('chat.startedAt', sortOrder);
        break;
      case CallLogSortBy.QUALITY_SCORE:
        query.orderBy(ChatRepository.QUALITY_SCORE_EXPRESSION, sortOrder);
        break;
      case CallLogSortBy.TAGS:
        query.orderBy("details.summary->'tags'->0->>'tag'", sortOrder);
        break;
      case CallLogSortBy.CREATED_AT:
      default:
        query.orderBy('chat.createdAt', sortOrder);
        break;
    }
  }

  async getCounselorStatsRaw(
    queryParams: CounselorStatsQueryDto,
    userId: number,
  ): Promise<any> {
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

    return query.getRawOne();
  }

  async findChatWithDetails(
    id: number,
    tenantId: string,
  ): Promise<(Chat & { details: CallDetails }) | null> {
    const chat = await this.createQueryBuilder('chat')
      .leftJoinAndMapOne(
        'chat.details',
        CallDetails,
        'details',
        'details.chatId = chat.id',
      )
      .where('chat.id = :id', { id })
      .andWhere('chat.tenantId = :tenantId', { tenantId })
      .getOne();

    return chat as (Chat & { details: CallDetails }) | null;
  }

  async updateChat(
    chatId: number,
    input: UpdateChatInput,
    em?: EntityManager,
  ): Promise<boolean> {
    const chatRepo = em
      ? em.getRepository(Chat)
      : this.dataSource.getRepository(Chat);

    const updateData = Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      Object.entries(input).filter(([key, value]) => value !== undefined),
    );

    if (Object.keys(updateData).length === 0) {
      return false;
    }

    const result = await chatRepo.update(chatId, updateData);
    return result.affected !== 0;
  }

  async deleteChat(
    id: number,
    tenantId: string,
    em?: EntityManager,
  ): Promise<boolean> {
    const chatRepo = em
      ? em.getRepository(Chat)
      : this.dataSource.getRepository(Chat);

    const result = await chatRepo.delete({ id, tenantId });
    return result.affected !== 0;
  }
}
