import { Injectable } from '@nestjs/common';
import * as WebSocket from 'ws';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggerService } from '../../logger/logger.service';
import { ChatService } from '../../chat/service/chat.service';
import { AudioIngestInterface } from '../interface/audio-ingest.interface';
import { TranscriptionService } from '../../ai/service/transcription.service';
import {
  ConferenceCallSessionData,
  ExotelStreamEvents,
} from '../type/audio-ingest.type';
import { DeepgramTranscriptMetadata } from '../../chat/type/chat.type';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { ChatEvents } from '../../chat/constants/chat.constants';
import { AiService } from '../../ai/service/ai.service';
import { AppConfigService } from '../../config/config.service';
import {
  CombinedSpeakerSegment,
  SpeakerSegment,
} from '../../ai/type/transcription.type';
import { MessageType } from '../../common/entities/message.entity';
import { NotificationErrorType } from '../../notification/type/notification.error.type';
import { ExecutionManager } from '../../common/execution/execution-manager';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import { processSequentially } from '../../common/util/async.util';
import { TWENTY_FIVE_SECONDS_IN_MS } from '../../common/constants/time.constants';

@Injectable()
export class ExotelService implements AudioIngestInterface {
  private readonly logger = LoggerService.getInstance(ExotelService.name);

  private sessions: { [key: string]: ConferenceCallSessionData } = {};
  private chatBuffer: {
    [key: string]: Array<{
      speakerSegments: SpeakerSegment[];
      createdAt: Date | undefined;
    }>;
  } = {};
  private keepAliveData: {
    [key: string]: {
      interval: NodeJS.Timeout;
      sequence: number;
    };
  } = {};

  private readonly BYTES_PER_20MS = 320; // Each 20ms chunk must be 320 bytes
  private readonly MIN_CHUNKS = 10; // Minimum 10 chunks for 3.2KB (100ms)

  constructor(
    private chatService: ChatService,
    private transcriptionService: TranscriptionService,
    private aiService: AiService,
    private publisher: MessageBrokerService,
    private config: AppConfigService,
    private eventEmitter: EventEmitter2,
  ) {}

  async addConversationSpeakers(session: ConferenceCallSessionData) {
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
        `🎤 Exotel: Waiting for more speaker segments for chatId: ${chatId}`,
      );
      return;
    }
    const speakers =
      await this.aiService.identifySpeakersFromConversation(chatHistory);

    if (!speakers || !speakers.speaker0 || !speakers.speaker1) {
      this.logger.info(
        `🎤 Exotel: No speaker details from ai service for chatId: ${chatId}`,
      );
      return;
    }

    const speakerMap = {
      counselor: session.counselorId,
      client: session.clientId,
    };

    // If both speakers are unknown, we can't proceed
    if (speakers.speaker0 === 'unknown' && speakers.speaker1 === 'unknown') {
      this.logger.info(
        `🎤 Exotel: Both speakers are unknown for chatId: ${chatId}`,
      );
      return;
    }

    // If speaker0 is identified but speaker1 is unknown
    if (speakers.speaker0 !== 'unknown' && speakers.speaker1 === 'unknown') {
      speakers.speaker1 =
        speakers.speaker0 === 'client' ? 'counselor' : 'client';
      this.logger.info(
        `🎤 Exotel: Assumed speaker1 is ${speakers.speaker1} for chatId: ${chatId}`,
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
        `🎤 Exotel: Assumed speaker0 is ${speakers.speaker0} for chatId: ${chatId}`,
      );
    }

    session.speakers = {
      speaker0: {
        id: speakerMap[speakers.speaker0 as 'client' | 'counselor']!,
        role: speakers.speaker0,
      },
      speaker1: {
        id: speakerMap[speakers.speaker1 as 'client' | 'counselor']!,
        role: speakers.speaker1,
      },
    };

    this.logger.info(
      `🎤 Exotel: Speakers identified: ${JSON.stringify(session.speakers)} for chatId: ${chatId}`,
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
    session: ConferenceCallSessionData,
    chatId: number,
    createdAt: Date,
  ) {
    const sender = session.speakers![`speaker${segment.speaker}`];
    this.setAuthContext({
      userId: sender.id,
      role: sender.role,
      tenantId: session.tenantId!,
    });
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
    await this.chatService.triggerNudge(completedMessage, sessionData, chatId);
  }

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleDeepgramTranscript(
    session: ConferenceCallSessionData,
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
      `Exotel: Transcription: ${transcript} - ${new Date().toISOString()}`,
    );

    if (!currentSpeakerSegments || currentSpeakerSegments.length === 0) {
      this.logger.error(
        `Exotel: No speaker segments found for chatId: ${chatId}`,
      );
      return;
    }

    // if there are more than 2 speakers, we need to filter out the speaker segments
    const speakerSegments = currentSpeakerSegments.filter(
      (segment) => segment.speaker <= 1,
    );

    if (!speakerSegments || speakerSegments.length === 0) {
      this.logger.info(
        `Exotel: No speaker segments found after removing speaker > 1 for chatId: ${chatId}`,
      );
      return;
    }

    // TODO: handle utternaceEnd

    // Temporarily store speaker segments to chatBuffer until speakers are identified
    if (
      isSentenceComplete &&
      !session.speakers &&
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
    if (session.speakers && speakerSegments && speakerSegments.length > 0) {
      const mergedChat =
        this.combineConsecutiveSpeakerSegments(speakerSegments);
      await processSequentially(mergedChat, async (segment) => {
        const senderId = session.speakers![`speaker${segment.speaker}`]?.id;
        const message = await this.chatService.getMessageObject(
          chatId,
          senderId,
          {
            content: segment.content,
          },
        );
        const participants = [session.counselorId];
        this.publisher.publish('chat-message', {
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
      session.speakers
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

  async handleStreamEvent(messageData: any, ws: WebSocket) {
    if (messageData.event === ExotelStreamEvents.START) {
      await this.startCall(messageData, ws);
    }

    if (messageData.event === ExotelStreamEvents.MEDIA) {
      await this.handleAudioMessage(messageData);
    }

    if (messageData.event === ExotelStreamEvents.STOP) {
      await this.endCall(messageData.stream_sid);
    }
  }

  async startCall(messageData: any, ws: WebSocket) {
    const streamSid = messageData.stream_sid;

    this.logger.info(
      `Exotel: WS client start event triggered with stream_sid: ${streamSid} and message: ${JSON.stringify(messageData)}`,
    );

    this.sessions[streamSid] = {
      id: streamSid,
      chatId: -99,
    };

    let counselorPhone = messageData.start?.from;
    if (!counselorPhone) {
      this.logger.warn('Missing counselor phone number');
      this.eventEmitter.emit('exception', {
        statusCode: 404,
        timestamp: new Date().toISOString(),
        path: 'Start call',
        message: `Missing counselor phone number`,
        type: 'Exotel integration error',
      } as NotificationErrorType);

      ws.terminate();
      delete this.sessions[streamSid];
      return;
    }

    // Format Indian phone numbers
    if (counselorPhone.startsWith('0')) {
      counselorPhone = `+91${counselorPhone.substring(1)}`; // Remove 0 and add +91
    } else if (
      !counselorPhone.startsWith('+91') &&
      counselorPhone.length === 10
    ) {
      counselorPhone = `+91${counselorPhone}`; // Add +91 prefix
    }

    const chatData = await this.chatService.createChatForAnyonymousClient(
      counselorPhone,
      'EXOTEL',
    );

    if (!chatData) {
      this.eventEmitter.emit('exception', {
        statusCode: 404,
        timestamp: new Date().toISOString(),
        path: 'Start call',
        message: `Counselor with phone number ${counselorPhone} not found`,
        type: 'Exotel integration error',
      } as NotificationErrorType);

      ws.terminate();
      delete this.sessions[streamSid];
      return;
    }

    const { chatId, clientId, counselorId, tenantId } = chatData;

    const session = {
      chatId,
      clientId,
      counselorId,
      tenantId,
    };

    // Store session data
    this.sessions[streamSid] = {
      ...this.sessions[streamSid],
      ...session,
    };

    this.transcriptionService.startLiveTranscription(
      { id: streamSid, ...session },
      chatId,
      this.handleDeepgramTranscript.bind(this),
      { diarize: true, encoding: 'linear16', sample_rate: 8000 },
    );

    this.logger.info(
      `Exotel: WS client start event completed with stream_sid: ${streamSid}`,
    );
  }

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleAudioMessage(msg: any) {
    const streamSid = msg.stream_sid;

    this.logger.info(
      `Exotel: WS client audio event triggered with stream_sid: ${streamSid}`,
    );

    const session = this.sessions[streamSid];
    if (!session) {
      this.logger.warn(`Exotel: No session found for stream_sid: ${streamSid}`);
      return;
    }

    const audioData = msg.media?.payload;

    if (!audioData) {
      this.logger.warn(
        `Exotel: No audio data found for stream_sid: ${streamSid}`,
      );
      return;
    }

    const audioBuffer = Buffer.from(audioData, 'base64');

    this.transcriptionService.sendAudio(session, audioBuffer);

    if (session.counselorId) {
      const participants = [session.counselorId];
      this.publisher.publish('chat-message', {
        participants,
        message: {
          userId: session.counselorId,
          audioData,
          chatId: session.chatId,
          content: 'Audio message',
        },
        broadCastOptions: {
          event: ChatEvents.AUDIO_STREAM,
        },
      });
    }
  }

  private createEmptyPCMAudioPacket(): string {
    // Create minimum required size (3.2KB = 10 chunks of 320 bytes)
    const minSize = this.BYTES_PER_20MS * this.MIN_CHUNKS; // 3.2KB
    const buffer = Buffer.alloc(minSize);

    // Each 320-byte chunk contains 160 samples (320/2 bytes per sample)
    const samplesPerChunk = this.BYTES_PER_20MS / 2; // 160 samples per 20ms
    const totalSamples = samplesPerChunk * this.MIN_CHUNKS; // 1600 samples for 100ms

    // Fill with zeros (silence) in little-endian format
    for (let i = 0; i < totalSamples; i++) {
      buffer.writeInt16LE(0, i * 2); // 2 bytes per sample
    }

    // Convert to base64 as required by Exotel
    return buffer.toString('base64');
  }

  handleConnectionAlive(ws: WebSocket, messageData: any) {
    const streamId = messageData.stream_sid;
    if (!streamId || this.keepAliveData[streamId]?.interval) {
      return;
    }
    // Send empty audio packet every 25 seconds back to exotel to keep the connection alive
    const emptyAudioPacket = this.createEmptyPCMAudioPacket();
    const intervalId = setInterval(() => {
      const sequence = this.keepAliveData[streamId]?.sequence;
      const streamData = {
        event: ExotelStreamEvents.MEDIA,
        sequence_number: sequence.toString(),
        stream_sid: streamId,
        media: {
          chunk: sequence.toString(),
          timestamp: Date.now().toString(),
          payload: emptyAudioPacket,
        },
      };
      ws.send(JSON.stringify(streamData));
      this.keepAliveData[streamId].sequence++;
    }, TWENTY_FIVE_SECONDS_IN_MS);
    this.keepAliveData[streamId] = {
      interval: intervalId,
      sequence: 1,
    };
  }

  private clearKeepAliveData(id: string) {
    if (this.keepAliveData[id]?.interval) {
      clearInterval(this.keepAliveData[id].interval);
    }

    if (this.keepAliveData[id]) {
      delete this.keepAliveData[id];
    }
  }

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async endCall(streamSid: string) {
    this.logger.info(
      `Exotel: WS client stop event triggered with stream_sid: ${streamSid}`,
    );
    if (!streamSid) {
      this.logger.warn('Exotel: Missing client ID');
      return;
    }
    const session = this.sessions[streamSid];
    if (!session) {
      this.logger.warn(`Exotel: No session found for stream_sid: ${streamSid}`);
      return;
    }

    this.transcriptionService.stopLiveTranscription(session);
    const participants = [session.counselorId];
    this.publisher.publish('chat-message', {
      participants,
      message: {
        content: 'User disconnected',
        messageType: MessageType.SYSTEM,
      },
      broadCastOptions: {
        event: ChatEvents.USER_DISCONNECTED,
      },
    });

    this.setAuthContext({
      userId: session.counselorId!,
      role: 'counselor',
      tenantId: session.tenantId!,
    });

    await this.chatService.endChat(-99, session.chatId);

    this.clearKeepAliveData(streamSid);
    delete this.sessions[streamSid];
    delete this.chatBuffer[streamSid];

    this.logger.info(
      `Exotel: WS client stop event completed with stream_sid: ${streamSid}`,
    );
  }

  setAuthContext(session: { userId: number; role: string; tenantId: string }) {
    ExecutionManager.setAuthContext(
      session.userId.toString(),
      session.role,
      session.tenantId,
    );
  }
}
