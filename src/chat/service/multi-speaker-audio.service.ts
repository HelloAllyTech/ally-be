import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger/logger.service';
import {
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

  constructor(
    private aiService: AiService,
    private chatService: ChatService,
    private publisher: MessageBrokerService,
    private config: AppConfigService,
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
      `🎤 Exotel: Speakers identified: ${JSON.stringify(this.speakers[session.id])} for chatId: ${chatId}`,
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

  setAuthContext(session: UserChatSessionData) {
    ExecutionManager.setAuthContext(
      session.userId.toString(),
      session.role,
      session.tenantId,
    );
  }
}
