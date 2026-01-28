import { Injectable } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { Pagination } from '../../common/type/common.type';
import { TokenUser } from '../../auth/type/auth.types';
import { ChatRepository } from '../repository/chat.repository';
import { CallDetailsRepository } from '../repository/call-details.repository';
import { CallDetailsService } from './call-details.service';
import { UserService } from '../../user/service/user.service';
import {
  CallLogFilters,
  CallLogSortBy,
  SortOrder,
} from '../dto/call-log.request.dto';
import { User } from 'src/user/entity/user.entity';
import { CallDetails } from '../entity/call.details.entity';
import { ChatStatus, Chat } from '../entity/chat.entity';

@Injectable()
export class CallLogService {
  private readonly logger = LoggerService.getInstance(CallLogService.name);

  constructor(
    private chatRepository: ChatRepository,
    private callDetailsRepository: CallDetailsRepository,
    private callDetailsService: CallDetailsService,
    private userService: UserService,
  ) {}

  async getCallLogs(user: TokenUser, options: Pagination) {
    const query = this.chatRepository
      .createQueryBuilder('chat')
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
      );
    query.where('chat.counselorId = :counselorId', { counselorId: user.id });
    if (options.limit) {
      query.limit(options.limit);
    }
    if (options.offset) {
      query.offset(options.offset);
    }
    if (options.sortBy) {
      const sortOrder =
        options.order === 'ASC' || options.order === 'DESC'
          ? (options.order as SortOrder)
          : SortOrder.DESC;
      this.applySorting(query, options.sortBy as CallLogSortBy, sortOrder);
    }
    query.andWhere('chat.tenantId = :tenantId', {
      tenantId: ExecutionManager.getTenantId(),
    });
    query.andWhere('chat.status = :status', { status: ChatStatus.ENDED });
    const [callLogs, count] = await query.getManyAndCount();

    const decryptedCallLogs = await Promise.all(
      callLogs.map(async (callLog: any) => ({
        ...callLog,
        details:
          (await this.callDetailsService.decryptCallDetails(callLog.details)) ??
          ({} as CallDetails),
      })),
    );
    return {
      data: decryptedCallLogs,
      count,
    };
  }

  async getAdminCallLogs(filters: CallLogFilters) {
    const query = this.chatRepository
      .createQueryBuilder('chat')
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
      );

    // Only show ENDED calls for admin call logs
    query.andWhere('chat.status = :status', { status: ChatStatus.ENDED });

    this.applyStringFilters(query, filters);
    this.applyIdFilters(query, filters);
    this.applyDateFilters(query, filters);
    this.applyDurationFilters(query, filters);
    this.applyQualityFilters(query, filters);
    this.applyTagFilters(query, filters);

    query.andWhere('chat.tenant_id = :tenantId', {
      tenantId: ExecutionManager.getTenantId(),
    });

    if (filters.limit) query.limit(filters.limit);
    if (filters.offset) query.offset(filters.offset);

    this.applySorting(
      query,
      (filters.sortBy as CallLogSortBy) || CallLogSortBy.START_DATE,
      (filters.order as SortOrder) || SortOrder.DESC,
    );

    const [callLogs, count] = await query.getManyAndCount();
    const decryptedCallLogs = await Promise.all(
      callLogs.map(async (callLog: any) => ({
        ...callLog,
        details:
          (await this.callDetailsService.decryptCallDetails(callLog.details)) ??
          ({} as CallDetails),
      })),
    );
    return { data: decryptedCallLogs, count };
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

  private applyQualityFilters(
    query: SelectQueryBuilder<Chat>,
    filters: CallLogFilters,
  ) {
    if (filters.minQualityScore !== undefined) {
      query.andWhere(
        "CAST(details.summary->>'callQuality' AS NUMERIC) >= :minQualityScore",
        {
          minQualityScore: filters.minQualityScore,
        },
      );
    }
    if (filters.maxQualityScore !== undefined) {
      query.andWhere(
        "CAST(details.summary->>'callQuality' AS NUMERIC) <= :maxQualityScore",
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
    query: any,
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
        query.orderBy(
          "CAST(details.summary->>'callQuality' AS NUMERIC)",
          sortOrder,
        );
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

  async getCounselorNames(limit?: number, offset?: number, search?: string) {
    return this.userService.getCounselorNames(limit, offset, search);
  }

  async getAllTags(limit?: number, offset?: number, search?: string) {
    const query = this.callDetailsRepository
      .createQueryBuilder('details')
      .select(
        "DISTINCT jsonb_array_elements(details.summary->'tags')->>'tag'",
        'tag',
      )
      .where("details.summary->'tags' IS NOT NULL")
      .andWhere("jsonb_typeof(details.summary->'tags') = 'array'")
      .andWhere('details.tenant_id = :tenantId', {
        tenantId: ExecutionManager.getTenantId(),
      })
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
}
