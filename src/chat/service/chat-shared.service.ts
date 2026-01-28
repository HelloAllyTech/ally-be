import { Injectable } from '@nestjs/common';
import { ChatRepository } from '../repository/chat.repository';
import { CounselorStatsQueryDto } from 'src/analytics/dto/analytics.dto';

@Injectable()
export class ChatSharedService {
  constructor(private readonly chatRepository: ChatRepository) {}

  async getCounselorStatsRaw(
    queryParams: CounselorStatsQueryDto,
    userId: number,
  ): Promise<any> {
    return this.chatRepository.getCounselorStatsRaw(queryParams, userId);
  }
}
