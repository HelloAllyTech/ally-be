import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import {
  ChatAudioUploads,
  ChatAudioUploadStatus,
} from '../../common/entities/chat-audio-uploads.entity';
import { LoggerService } from '../../logger/logger.service';
import { ExecutionManager } from '../../common/execution/execution-manager';

@Injectable()
export class ChatAudioUploadsService {
  private readonly logger = LoggerService.getInstance(
    ChatAudioUploadsService.name,
  );

  constructor(
    @InjectRepository(ChatAudioUploads)
    private chatAudioUploadRepository: Repository<ChatAudioUploads>,
  ) {}

  async createAudioUpload(
    data: {
      chatId: number;
      storageKey: string;
      status?: ChatAudioUploadStatus;
      sampleRate?: number;
      format?: string;
    },
    entityManager?: EntityManager,
  ): Promise<ChatAudioUploads> {
    try {
      const repo =
        entityManager?.getRepository(ChatAudioUploads) ||
        this.chatAudioUploadRepository;
      const audioUpload = repo.create({
        ...data,
        status: data.status || ChatAudioUploadStatus.PENDING,
        tenantId: ExecutionManager.getTenantId(),
      });

      const savedUpload = await repo.save(audioUpload);

      this.logger.info(
        `Audio upload created | ChatId: ${data.chatId} | Status: ${savedUpload.status} | storageKey: ${data.storageKey}`,
      );

      return savedUpload;
    } catch (error) {
      this.logger.error(
        `Failed to create audio upload for chatId: ${data.chatId}`,
        error,
      );
      throw error;
    }
  }

  async updateAudioUpload(
    chatId: number,
    data: {
      status?: ChatAudioUploadStatus;
      sampleRate?: number;
    },
  ): Promise<ChatAudioUploads> {
    const { status, sampleRate } = data || {};
    try {
      await this.chatAudioUploadRepository.update(
        { chatId },
        { status, sampleRate },
      );

      const updatedUpload = await this.chatAudioUploadRepository.findOne({
        where: { chatId },
      });

      if (!updatedUpload) {
        throw new Error(`Audio upload not found for chatId: ${chatId}`);
      }

      this.logger.info(
        `Audio upload status updated | ChatId: ${chatId} | Status: ${status}`,
      );

      return updatedUpload;
    } catch (error) {
      this.logger.error(
        `Failed to update audio upload status for ChatId: ${chatId}`,
        error,
      );
      throw error;
    }
  }
}
