import { Injectable } from '@nestjs/common';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { Pagination } from '../../common/type/common.type';
import { TokenUser } from '../../auth/type/auth.types';
import { ChatRepository } from '../repository/chat.repository';
import { CallDetailsRepository } from '../repository/call-details.repository';
import { CallDetailsService } from './call-details.service';
import { UserService } from '../../user/service/user.service';
import { CallLogFilters } from '../dto/call-log.request.dto';
import { CallDetails } from '../entity/call.details.entity';

@Injectable()
export class CallLogService {
  constructor(
    private chatRepository: ChatRepository,
    private callDetailsRepository: CallDetailsRepository,
    private callDetailsService: CallDetailsService,
    private userService: UserService,
  ) {}

  async getCallLogs(user: TokenUser, options: Pagination) {
    const { data: callLogs, count } =
      await this.chatRepository.getCallLogsQuery(
        user.id,
        ExecutionManager.getTenantId()!,
        options,
      );

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
    const { data: callLogs, count } =
      await this.chatRepository.getAdminCallLogsQuery(
        ExecutionManager.getTenantId()!,
        filters,
      );

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

  async getCounselorNames(limit?: number, offset?: number, search?: string) {
    return this.userService.getCounselorNames(limit, offset, search);
  }

  async getAllTags(limit?: number, offset?: number, search?: string) {
    return this.callDetailsRepository.getAllTags(
      ExecutionManager.getTenantId()!,
      limit,
      offset,
      search,
    );
  }
}
