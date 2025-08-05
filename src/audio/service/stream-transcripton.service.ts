import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger/logger.service';
import {
  DeepgramTranscriptMetadata,
  UserChatSessionData,
} from '../../chat/type/chat.type';
import {
  CombinedSpeakerSegment,
  SpeakerSegment,
} from '../../ai/type/transcription.type';
import { AiService } from '../../ai/service/ai.service';
import { ChatService } from '../../chat/service/chat.service';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { AppConfigService } from '../../config/config.service';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import { processSequentially } from 'src/common/util/async.util';
import { ChatEvents } from '../../chat/constants/chat.constants';
import { ANONYMOUS_CLIENT_ID } from '../../common/constants/user.constants';
import { TranscriptionService } from '../../ai/service/transcription.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { BroadcastMessageService } from './broadcast-message.service';
import { findMessageBrokerChannelUsingProvider } from '../../common/util/chat-types.util';

@Injectable()
export class StreamTranscriptionService {
  private readonly logger = LoggerService.getInstance(
    StreamTranscriptionService.name,
  );

  private speakers: { [key: string]: Array<{ id: number; role: string }> } = {};
  private chatBuffer: {
    [key: string]: Array<{
      speakerSegments: SpeakerSegment[];
      createdAt: Date | undefined;
    }>;
  } = {};

  constructor(
    private aiService: AiService,
    private chatService: ChatService,
    private publisher: MessageBrokerService,
    private config: AppConfigService,
    private transcriptionService: TranscriptionService,
    private broadcastMessageService: BroadcastMessageService,
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
      const channel = findMessageBrokerChannelUsingProvider(session.provider!);
      await this.chatService.triggerNudge(
        completedMessage,
        sessionData,
        chatId,
        channel!,
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
        const channel = findMessageBrokerChannelUsingProvider(
          session.provider!,
        );
        // for now handling both microphone and exotel messages in the same channel
        this.publisher.publish(channel!, {
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
    const channel = findMessageBrokerChannelUsingProvider(session.provider!);
    this.broadcastMessageService.broadcastUserJoinedMessage(channel!, {
      participants: [session.userId],
      userId: session.userId,
      chatId: session.chatId,
    });
  }

  transcribeAudioData(
    session: UserChatSessionData,
    audioData: string,
    shouldBroadcastAudioMessage: boolean,
  ) {
    const audioBuffer = Buffer.from(audioData, 'base64');

    this.transcriptionService.sendAudio(session, audioBuffer);

    if (session.userId !== -1 && shouldBroadcastAudioMessage) {
      const channel = findMessageBrokerChannelUsingProvider(session.provider!);
      this.broadcastMessageService.broadcastAudioStreamMessage(channel!, {
        participants: [session.userId],
        userId: session.userId,
        audioData: audioBuffer,
        chatId: session.chatId,
      });
    }
  }

  endLiveTranscription(session: UserChatSessionData) {
    this.transcriptionService.stopLiveTranscription(session);
    const channel = findMessageBrokerChannelUsingProvider(session.provider!);
    this.broadcastMessageService.broadcastUserDisconnectedMessage(channel!, {
      participants: [session.userId],
      userId: session.userId,
    });
  }

  setAuthContext(session: UserChatSessionData) {
    ExecutionManager.setAuthContext(
      session.userId.toString(),
      session.role,
      session.tenantId,
    );
  }
}
