import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { LoggerService } from '../../logger/logger.service';
import {
  ActiveCallStream,
  DeepgramTranscriptMetadata,
  UserChatSessionData,
} from '../type/chat.type';
import {
  CombinedSpeakerSegment,
  SpeakerSegment,
} from '../../ai/type/transcription.type';
import { AiService } from '../../ai/service/ai.service';
import { ChatService } from './chat.service';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { AppConfigService } from '../../config/config.service';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import { processSequentially } from 'src/common/util/async.util';
import { ChatEvents } from '../constants/chat.constants';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { MessageBrokerChannel } from '../../common/constants/message-broker.constants';
import { ANONYMOUS_CLIENT_ID } from '../../common/constants/user.constants';
import { TranscriptionService } from '../../ai/service/transcription.service';
import { MessageType } from '../../common/entities/message.entity';
import { S3Service } from '../../aws/service/s3.service';
import { ChatAudioUploadStatus } from 'src/common/entities/chat-audio-uploads.entity';
import { ChatAudioUploadsService } from './chat-audio-uploads.service';

@Injectable()
export class MultiSpeakerAudioService {
  private readonly logger = LoggerService.getInstance(
    MultiSpeakerAudioService.name,
  );

  private speakers: { [key: string]: Array<{ id: number; role: string }> } = {};
  private chatBuffer: {
    [key: string]: Array<{
      speakerSegments: SpeakerSegment[];
      createdAt: Date | undefined;
    }>;
  } = {};
  private MIN_PART_SIZE = 6 * 1024 * 1024; // 6 MB

  private activeCallStreams: {
    [key: string]: {
      parts: Array<{
        ETag: string;
        PartNumber: number;
      }>;
      uploadId: string;
      key: string;
      partNumber: number;
      currentFileIndex: number;
      files: {
        fileWriteStream: fs.WriteStream;
        tempFilePath: string;
        bufferSize: number;
      }[];
      chatId: number;
      id: string;
    };
  } = {};

  private pendingAudioQueue: { [key: string]: Buffer[] } = {};

  constructor(
    private aiService: AiService,
    private chatService: ChatService,
    private publisher: MessageBrokerService,
    private config: AppConfigService,
    private transcriptionService: TranscriptionService,
    private s3Service: S3Service,
    private chatAudioUploadsService: ChatAudioUploadsService,
  ) {}
  async addConversationSpeakers(session: UserChatSessionData) {
    const currentChatBuffer = this.chatBuffer[session.id];
    const chatId = session.chatId;
    const combinedSegments: CombinedSpeakerSegment[] = [];
    currentChatBuffer.forEach((buffer) => {
      const mergedChat = this.combineConsecutiveSpeakerSegments(
        buffer.speakerSegments,
      );
      combinedSegments.push(...mergedChat);
    });
    const uniqueSpeakers: string[] = [];
    const chatHistory = combinedSegments.map((segment) => {
      const role = `speaker${segment.speaker}`;
      if (!uniqueSpeakers.includes(role)) uniqueSpeakers.push(role);
      return {
        role,
        content: segment.content,
      };
    });
    if (chatHistory.length < 2 || uniqueSpeakers.length < 2) {
      this.logger.info(
        `🎤 Waiting for more speaker segments for chatId: ${chatId} and provider: ${session.provider}`,
      );
      return;
    }
    const speakers =
      await this.aiService.identifySpeakersFromConversation(chatHistory);

    if (!speakers || !speakers.speaker0 || !speakers.speaker1) {
      this.logger.info(
        `🎤 No speaker details from ai service for chatId: ${chatId} and provider: ${session.provider}`,
      );
      return;
    }

    // If both speakers are unknown, we can't proceed
    if (speakers.speaker0 === 'unknown' && speakers.speaker1 === 'unknown') {
      this.logger.info(
        `🎤 Both speakers are unknown for chatId: ${chatId} and provider: ${session.provider}`,
      );
      return;
    }

    // If speaker0 is identified but speaker1 is unknown
    if (speakers.speaker0 !== 'unknown' && speakers.speaker1 === 'unknown') {
      speakers.speaker1 =
        speakers.speaker0 === 'client' ? 'counselor' : 'client';
      this.logger.info(
        `🎤 Assumed speaker1 is ${speakers.speaker1} for chatId: ${chatId} and provider: ${session.provider}`,
      );
    }

    // If speaker1 is identified but speaker0 is unknown
    else if (
      speakers.speaker0 === 'unknown' &&
      speakers.speaker1 !== 'unknown'
    ) {
      speakers.speaker0 =
        speakers.speaker1 === 'client' ? 'counselor' : 'client';
      this.logger.info(
        `🎤 Assumed speaker0 is ${speakers.speaker0} for chatId: ${chatId} and provider: ${session.provider}`,
      );
    }

    const speakerMap = {
      counselor: session.userId,
      client: ANONYMOUS_CLIENT_ID,
    };

    this.speakers[session.id] = [
      {
        id: speakerMap[speakers.speaker0 as 'client' | 'counselor']!,
        role: speakers.speaker0,
      },
      {
        id: speakerMap[speakers.speaker1 as 'client' | 'counselor']!,
        role: speakers.speaker1,
      },
    ];

    this.logger.info(
      `🎤 Speakers identified: ${JSON.stringify(this.speakers[session.id])} for chatId: ${chatId} and provider: ${session.provider}`,
    );
  }

  combineConsecutiveSpeakerSegments(chat: SpeakerSegment[]) {
    return chat.reduce((acc: CombinedSpeakerSegment[], curr) => {
      const lastItem = acc[acc.length - 1];
      if (lastItem && lastItem.speaker === curr.speaker) {
        lastItem.content += ' ' + curr.word;
      } else {
        acc.push({ speaker: curr.speaker, content: curr.word });
      }
      return acc;
    }, []);
  }

  async saveMessageAndTriggerNudge(
    segment: CombinedSpeakerSegment,
    session: UserChatSessionData,
    chatId: number,
    createdAt: Date,
  ) {
    const speakers = this.speakers[session.id];
    const sender = speakers[segment.speaker];
    this.setAuthContext(session);
    const completedMessage = await this.chatService.saveMessage(
      chatId,
      sender.id,
      {
        content: segment.content,
        createdAt: createdAt,
      },
    );
    const sessionData = {
      id: session.id,
      type: 'user' as const,
      userId: sender.id,
      user: null,
      room: `user-${sender.id}`,
      role: sender.role,
      chatId,
      tenantId: session.tenantId!,
    };

    if (sender.role === 'counselor') {
      await this.chatService.triggerNudge(
        completedMessage,
        sessionData,
        chatId,
        MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE,
      );
    }
  }

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleDeepgramTranscript(
    session: UserChatSessionData,
    chatId: number,
    transcript: string,
    metadata?: DeepgramTranscriptMetadata,
  ) {
    const {
      isSentenceComplete,
      currentTranscriptCreatedAt,
      isFinal,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      isUtteranceEnd,
      speakerSegments: currentSpeakerSegments,
    } = metadata || {};
    this.logger.info(
      `🎤 Transcript: ${transcript} - ${new Date().toISOString()} - chatId: ${chatId} and provider: ${session.provider}`,
    );

    if (!currentSpeakerSegments || currentSpeakerSegments.length === 0) {
      this.logger.error(
        `🎤No speaker segments found for chatId: ${chatId} and provider: ${session.provider}`,
      );
      return;
    }

    // if there are more than 2 speakers, we need to filter out the speaker segments
    const speakerSegments = currentSpeakerSegments.filter(
      (segment) => segment.speaker <= 1,
    );

    if (!speakerSegments || speakerSegments.length === 0) {
      this.logger.info(
        `🎤 No speaker segments found after removing speaker > 1 for chatId: ${chatId} and provider: ${session.provider}`,
      );
      return;
    }

    // TODO: handle utternaceEnd

    // Temporarily store speaker segments to chatBuffer until speakers are identified
    if (
      isSentenceComplete &&
      !this.speakers[session.id] &&
      speakerSegments &&
      speakerSegments.length > 0
    ) {
      this.chatBuffer[session.id] = [
        ...(this.chatBuffer[session.id] || []),
        {
          speakerSegments,
          createdAt: currentTranscriptCreatedAt,
        },
      ];

      // Find speakers of the conversation and add to session
      await this.addConversationSpeakers(session);
    }

    // Immeaditely broadcast the message to the counselor
    if (
      this.speakers[session.id] &&
      speakerSegments &&
      speakerSegments.length > 0
    ) {
      const mergedChat =
        this.combineConsecutiveSpeakerSegments(speakerSegments);
      await processSequentially(mergedChat, async (segment) => {
        const senderId = this.speakers[session.id][segment.speaker]?.id;
        const message = await this.chatService.getMessageObject(
          chatId,
          senderId,
          {
            content: segment.content,
          },
        );
        const participants = [session.userId];
        // for now handling both microphone and exotel messages in the same channel
        this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE, {
          participants,
          message: {
            ...message,
            isFinal,
            isSentenceComplete,
          },
          broadCastOptions: {
            event: ChatEvents.MESSAGE_RECEIVED,
          },
        });
      });
    }

    // Save transcript to db
    if (
      this.config.ai.sentenceCompletionRequired &&
      isSentenceComplete &&
      this.speakers[session.id]
    ) {
      const currentChatBuffer = this.chatBuffer[session.id];
      if (currentChatBuffer) {
        await processSequentially(currentChatBuffer, async (chat) => {
          const mergedChat = this.combineConsecutiveSpeakerSegments(
            chat.speakerSegments,
          );
          await processSequentially(mergedChat, async (segment) => {
            await this.saveMessageAndTriggerNudge(
              segment,
              session,
              chatId,
              chat.createdAt!,
            );
          });
        });

        delete this.chatBuffer[session.id];

        return;
      }

      if (speakerSegments && speakerSegments.length > 0) {
        const mergedChat =
          this.combineConsecutiveSpeakerSegments(speakerSegments);
        await processSequentially(mergedChat, async (segment) => {
          await this.saveMessageAndTriggerNudge(
            segment,
            session,
            chatId,
            currentTranscriptCreatedAt!,
          );
        });
      }
    }
  }

  private broadcastUserJoinedMessage(session: UserChatSessionData) {
    this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE, {
      participants: [session.userId],
      message: {
        userId: session.userId,
        chatId: session.chatId,
        content: 'User joined audio chat',
        messageType: MessageType.SYSTEM,
      },
      broadCastOptions: {
        event: ChatEvents.USER_JOINED,
      },
    });
  }

  private broadcastAudioStreamMessage(
    session: UserChatSessionData,
    audioData: Buffer,
  ) {
    this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE, {
      participants: [session.userId],
      message: {
        userId: session.userId,
        audioData,
        chatId: session.chatId,
        content: 'Audio message',
      },
      broadCastOptions: {
        event: ChatEvents.AUDIO_STREAM,
      },
    });
  }

  broadcastUserDisconnectedMessage(session: UserChatSessionData) {
    this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE, {
      participants: [session.userId],
      message: {
        content: 'User disconnected',
        messageType: MessageType.SYSTEM,
      },
      broadCastOptions: {
        event: ChatEvents.USER_DISCONNECTED,
      },
    });
  }

  async startLiveTranscription(session: UserChatSessionData, options: any) {
    await this.transcriptionService
      .startLiveTranscription(
        {
          session,
          chatId: session.chatId,
          // { encoding: 'linear16', sample_rate: 8000 } is used for exotel call and microphone mobile chat
          options: { diarize: true, ...options },
        },
        this.handleDeepgramTranscript.bind(this),
      )
      .catch((error) => {
        this.logger.error(
          `Error starting live transcription for chatId ${session.chatId}:`,
          error,
        );
      });
    this.broadcastUserJoinedMessage(session);
  }

  transcribeAudioData(
    session: UserChatSessionData,
    audioData: string,
    shouldBroadcastAudioMessage: boolean,
  ) {
    const audioBuffer = Buffer.from(audioData, 'base64');

    this.transcriptionService.sendAudio(session, audioBuffer);

    if (session.userId !== -1 && shouldBroadcastAudioMessage) {
      this.broadcastAudioStreamMessage(session, audioBuffer);
    }
  }

  endLiveTranscription(session: UserChatSessionData) {
    this.transcriptionService.stopLiveTranscription(session);
    this.broadcastUserDisconnectedMessage(session);
  }

  addToPendingAudioQueue(clientId: string, audioBuffer: Buffer) {
    if (!this.pendingAudioQueue[clientId]) {
      this.pendingAudioQueue[clientId] = [];
    }
    this.pendingAudioQueue[clientId].push(audioBuffer);
  }

  processPendingAudioQueue(clientId: string, audioBuffer: Buffer) {
    if (this.pendingAudioQueue[clientId]?.length > 0) {
      const pendingAudioBuffer = Buffer.concat([
        ...this.pendingAudioQueue[clientId],
        audioBuffer,
      ]);
      this.clearPendingAudioQueue(clientId);
      return pendingAudioBuffer;
    } else {
      return audioBuffer;
    }
  }

  private generateStorageKey(chatId: number) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const timestamp = now.getTime();
    return `${year}/${month}/${day}/chat-${chatId}-${timestamp}.raw`;
  }

  async updateCallStreamId(chatId: number, callId: string) {
    const activeCalls = Object.values(this.activeCallStreams);
    const activeCall = activeCalls.find((call) => call.chatId === chatId);
    if (activeCall) {
      this.activeCallStreams[callId] = activeCall;
      delete this.activeCallStreams[activeCall.id];
    }
  }

  async startCallStream(session: UserChatSessionData) {
    const callId = session.id;
    const chatId = session.chatId;
    const key = this.generateStorageKey(chatId);

    try {
      const { UploadId } = await this.s3Service.createMultipartUpload({
        Bucket: this.config.s3.audioBucket,
        Key: key,
        ContentType: 'audio/raw',
      });

      // Create two files for ping-pong buffering
      const tempFilePath0 = path.join(
        this.config.audioStorage.dir!,
        `chat-${chatId}-0.part`,
      );
      const tempFilePath1 = path.join(
        this.config.audioStorage.dir!,
        `chat-${chatId}-1.part`,
      );
      const fileWriteStream0 = fs.createWriteStream(tempFilePath0);
      const fileWriteStream1 = fs.createWriteStream(tempFilePath1);

      this.activeCallStreams[callId] = {
        parts: [],
        uploadId: UploadId!,
        key,
        partNumber: 1,
        currentFileIndex: 0, // Start with file 0
        files: [
          {
            fileWriteStream: fileWriteStream0,
            tempFilePath: tempFilePath0,
            bufferSize: 0,
          },
          {
            fileWriteStream: fileWriteStream1,
            tempFilePath: tempFilePath1,
            bufferSize: 0,
          },
        ],
        chatId,
        id: callId,
      };

      this.chatAudioUploadsService.createAudioUpload({
        chatId: session.chatId,
        storageKey: key,
        status: ChatAudioUploadStatus.PENDING,
      });
      this.broadcastUserJoinedMessage(session);
      this.logger.info(
        `Call stream started with dual files | Key: ${key} | ChatId: ${session.chatId} | Provider: ${session.provider}`,
      );
    } catch (err) {
      this.logger.error(
        `Call stream start failed with error: ${err.message} | Key: ${key} | ChatId: ${session.chatId} | Provider: ${session.provider}`,
        err,
      );
    }
  }

  private async flushFileAsPart(
    session: UserChatSessionData,
    activeCallStream: ActiveCallStream,
    fileToFlushIndex: number,
  ) {
    // Get the file to flush (the one that's not currently active)
    const fileToFlush = activeCallStream.files[fileToFlushIndex];

    // End the write stream for the file being flushed
    await new Promise((resolve) => fileToFlush.fileWriteStream.end(resolve));

    // Upload the file to S3
    const fileBuffer = fs.createReadStream(fileToFlush.tempFilePath);
    const { ETag } = await this.s3Service.uploadPart({
      Bucket: this.config.s3.audioBucket,
      Key: activeCallStream.key,
      UploadId: activeCallStream.uploadId,
      PartNumber: activeCallStream.partNumber,
      Body: fileBuffer,
    });

    this.logger.info(
      `Flushed file ${fileToFlushIndex} as part | ETag: ${ETag} | PartNumber: ${activeCallStream.partNumber} | Key: ${activeCallStream.key} | ChatId: ${session.chatId} | Provider: ${session.provider}`,
    );

    activeCallStream.parts.push({
      ETag: ETag!,
      PartNumber: activeCallStream.partNumber,
    });

    // Reset the flushed file for next use
    const newTempFilePath = path.join(
      this.config.audioStorage.dir!,
      `chat-${session.chatId}-${fileToFlushIndex}.part`,
    );
    fileToFlush.tempFilePath = newTempFilePath;
    fileToFlush.fileWriteStream = fs.createWriteStream(newTempFilePath);
    fileToFlush.bufferSize = 0;

    activeCallStream.partNumber += 1;
  }

  saveAudio(
    session: UserChatSessionData,
    audioBase64: string,
    shouldBroadcastAudioMessage?: boolean,
  ) {
    const callId = session.id;
    const activeCallStream = this.activeCallStreams[callId];
    const audioData = Buffer.from(audioBase64, 'base64');
    if (!activeCallStream) {
      this.logger.error(
        `No active stream for call: ${callId} and chatId: ${session.chatId}`,
      );
      this.addToPendingAudioQueue(callId, audioData);
      return;
    }

    const audioBuffer = this.processPendingAudioQueue(callId, audioData);

    // Write to current active file
    const currentFileIndex = activeCallStream.currentFileIndex;
    const currentFile = activeCallStream.files[currentFileIndex];
    currentFile.fileWriteStream.write(audioBuffer);
    currentFile.bufferSize += audioBuffer.length;

    // Check if we need to flush the current file
    if (currentFile.bufferSize >= this.MIN_PART_SIZE) {
      activeCallStream.currentFileIndex = currentFileIndex === 0 ? 1 : 0;
      this.flushFileAsPart(session, activeCallStream, currentFileIndex);
    }

    if (shouldBroadcastAudioMessage) {
      this.broadcastAudioStreamMessage(session, audioBuffer);
    }
  }

  private async cleanUpTemporaryFiles(
    activeCallStream: ActiveCallStream,
    chatId: number,
  ) {
    if (!activeCallStream) return;

    const deletePromises = [];
    for (let i = 0; i < 2; i++) {
      const file = activeCallStream.files[i];
      deletePromises.push(
        fs.promises.unlink(file.tempFilePath).catch((error) => {
          if (error.code !== 'ENOENT') {
            this.logger.error(
              `Error deleting temporary file: ${file.tempFilePath} | ChatId: ${chatId}`,
              error,
            );
          }
        }),
      );
    }

    await Promise.allSettled(deletePromises);
  }

  async endCallStream(session: UserChatSessionData) {
    const callId = session.id;
    const activeCallStream = this.activeCallStreams[callId];
    if (!activeCallStream) return;

    delete this.activeCallStreams[callId];

    const currentFileIndex = activeCallStream.currentFileIndex;
    const currentFile = activeCallStream.files[currentFileIndex];

    try {
      await this.chatService.endChat(session.userId, session.chatId);
      // Check if we have any parts (multipart upload) or just small files
      if (activeCallStream.parts.length > 0) {
        if (currentFile.bufferSize > 0) {
          await this.flushFileAsPart(
            session,
            activeCallStream,
            currentFileIndex,
          );
        }
        // Use multipart upload for large files
        await this.s3Service.completeMultipartUploadWithParts({
          bucket: this.config.s3.audioBucket!,
          key: activeCallStream.key,
          uploadId: activeCallStream.uploadId,
          parts: activeCallStream.parts,
        });
      } else {
        // Abort the multipart upload since we're using regular upload
        try {
          await this.s3Service.abortMultipartUpload({
            Bucket: this.config.s3.audioBucket!,
            Key: activeCallStream.key,
            UploadId: activeCallStream.uploadId,
          });
          this.logger.debug(
            `Aborted multipart upload for regular upload | Key: ${activeCallStream.key} | ChatId: ${session.chatId}`,
          );
        } catch (abortErr) {
          this.logger.warn(
            `Failed to abort multipart upload | Key: ${activeCallStream.key} | Error: ${abortErr.message}`,
          );
        }

        // Use regular upload for small files - only file 0 has data
        const audioBuffer = fs.readFileSync(
          activeCallStream.files[0].tempFilePath,
        );

        await this.s3Service.uploadStream({
          Bucket: this.config.s3.audioBucket!,
          Key: activeCallStream.key,
          Body: audioBuffer,
          ContentType: 'audio/raw',
        });
      }

      this.logger.info(
        `Call stream upload completed | Key: ${activeCallStream.key} | ChatId: ${session.chatId} | Provider: ${session.provider}`,
      );

      await this.chatAudioUploadsService.updateAudioUploadStatus(
        session.chatId,
        ChatAudioUploadStatus.SUCCESS,
      );

      const presignedUrl = await this.s3Service.generatePresignedUrl({
        bucket: this.config.s3.audioBucket!,
        key: activeCallStream.key,
        operation: 'get',
      });

      this.cleanUpTemporaryFiles(activeCallStream, session.chatId);

      this.aiService
        .transcribeAudioAndSummarize({
          s3_pressigned_url: presignedUrl,
          chat_id: session.chatId,
        })
        .catch((err) => {
          this.logger.error(
            `Error transcribing audio for chatId ${session.chatId}:`,
            err,
          );
        });
    } catch (err) {
      this.logger.error(
        `Call stream end failed with error: ${err.message} | Key: ${activeCallStream.key} | ChatId: ${session.chatId} | Provider: ${session.provider}`,
        err,
      );
    }
  }

  clearPendingAudioQueue(callId: string) {
    delete this.pendingAudioQueue[callId];
  }

  setAuthContext(session: UserChatSessionData) {
    ExecutionManager.setAuthContext(
      session.userId.toString(),
      session.role,
      session.tenantId,
    );
  }
}
