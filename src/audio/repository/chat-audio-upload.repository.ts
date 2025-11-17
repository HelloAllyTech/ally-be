import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ChatAudioUploads } from '../entity/chat-audio-uploads.entity';

@Injectable()
export class ChatAudioUploadRepository extends Repository<ChatAudioUploads> {
  constructor(private dataSource: DataSource) {
    super(ChatAudioUploads, dataSource.createEntityManager());
  }

  async deleteChatAudioUploadsByChatId(
    chatId: number,
    tenantId: string,
    em?: EntityManager,
  ): Promise<boolean> {
    const repo =
      em?.getRepository(ChatAudioUploads) ||
      this.dataSource.getRepository(ChatAudioUploads);
    const result = await repo.delete({ chatId, tenantId });
    return result.affected !== 0;
  }
}
