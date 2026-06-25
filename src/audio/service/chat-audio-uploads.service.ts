import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  ChatAudioUploads,
  ChatAudioUploadStatus,
} from '../entity/chat-audio-uploads.entity';
import { LoggerService } from '../../logger/logger.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { ChatAudioUploadRepository } from '../repository/chat-audio-upload.repository';
import { S3Service } from 'src/aws/service/s3.service';
import { AppConfigService } from 'src/config/config.service';

@Injectable()
export class ChatAudioUploadsService {
  private readonly logger = LoggerService.getInstance(
    ChatAudioUploadsService.name,
  );

  constructor(
    private chatAudioUploadRepository: ChatAudioUploadRepository,
    private s3Service: S3Service,
    private config: AppConfigService,
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
        `Failed to create audio upload for chatId: ${data.chatId} with error ${JSON.stringify(
          error,
        )}`,
      );
      throw error;
    }
  }

  async updateAudioUpload(
    chatId: number,
    data: {
      status?: ChatAudioUploadStatus;
      sampleRate?: number | null;
      storageKey?: string | null;
      format?: string | null;
    },
  ): Promise<ChatAudioUploads> {
    const { status, sampleRate, storageKey, format } = data || {};
    try {
      await this.chatAudioUploadRepository.update(
        { chatId },
        { status, sampleRate, storageKey, format },
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
        `Failed to update audio upload status for ChatId: ${chatId} with error ${JSON.stringify(
          error,
        )}`,
      );
      throw error;
    }
  }

  async getAudioUpload(chatId: number): Promise<ChatAudioUploads | null> {
    const audioUpload = await this.chatAudioUploadRepository.findOne({
      where: { chatId },
    });

    return audioUpload;
  }

  async deleteChatAudioUploadsByChatId(
    chatId: number,
    tenantId: string,
    entityManager?: EntityManager,
  ): Promise<boolean> {
    const result =
      await this.chatAudioUploadRepository.deleteChatAudioUploadsByChatId(
        chatId,
        tenantId || ExecutionManager.getTenantId()!,
        entityManager,
      );
    return result;
  }

  /**
   * Deletes the stored audio from S3 and clears the storageKey on the row so
   * the DB never claims audio that is already gone. Best-effort and idempotent:
   * returns false when there is nothing to delete.
   *
   * Call this ONLY once the summary is final (first-pass SUCCESS, manual retry,
   * or auto-retry). Until then the recording is kept so a summary timeout or
   * failure can be recovered by re-transcribing/re-summarising.
   */
  async cleanupStoredAudio(chatId: number): Promise<boolean> {
    const deleted = await this.deleteUploadedAudioFile(chatId);
    if (!deleted) {
      return false;
    }
    try {
      await this.updateAudioUpload(chatId, {
        storageKey: null,
        sampleRate: null,
        format: null,
      });
    } catch (error) {
      this.logger.error(
        `Audio deleted from S3 but failed to clear storageKey for chatId: ${chatId} with error ${JSON.stringify(
          error,
        )}`,
      );
    }
    return true;
  }

  async deleteUploadedAudioFile(chatId: number): Promise<boolean> {
    const uploadedAudioFile = await this.getAudioUpload(chatId);
    if (!uploadedAudioFile?.storageKey) {
      return false;
    }
    try {
      await this.s3Service.deleteObject({
        bucket: this.config.s3.audioBucket!,
        key: uploadedAudioFile.storageKey,
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to delete uploaded audio file for chatId: ${chatId} with error ${JSON.stringify(
          error,
        )}`,
      );
      return false;
    }
  }
}
