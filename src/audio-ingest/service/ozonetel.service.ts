import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { AiEventService } from '../../ai/service/ai-event.service';
import { BroadcastMessageService } from '../../audio/service/broadcast-message.service';
import { ChatService } from '../../chat/service/chat.service';
import {
  AudioChatProvider,
  CloudTelephonyProvider,
} from '../../common/constants/chat.constants';
import { MessageBrokerChannel } from '../../common/constants/message-broker.constants';
import { UserRole } from '../../common/constants/user.constants';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import {
  Chat,
  ChatStatus,
  ChatSummaryStatus,
} from '../../common/entities/chat.entity';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { checkAudioFileReady } from '../../common/util/audio.util';
import {
  addDurationToDate,
  convertIstStringToUtc,
  subtractDurationFromDate,
} from '../../common/util/date.util';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { UserService } from '../../user/user.service';
import { AudioRetryProducer } from '../producer/audio-retry.producer';
import { CloudTelephonyService } from '../service/cloud-telephony.service';
import {
  OzonetelCallAction,
  OzonetelCallDetails,
  OzonetelCallEventsDto,
  OzonetelCallStatus,
  OzonetelEventTypes,
} from '../type/ozonetel.type';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { AUDIT_EVENTS } from 'src/audit/constants/audit-event.constants';

@Injectable()
export class OzonetelService {
  private readonly logger = LoggerService.getInstance(OzonetelService.name);
  private readonly auditLogger = AuditLoggerService.getInstance();
  constructor(
    private chatService: ChatService,
    private userService: UserService,
    private cloudTelephonyService: CloudTelephonyService,
    private config: AppConfigService,
    private aiEventService: AiEventService,
    private broadcastMessageService: BroadcastMessageService,
    private audioRetryProducer: AudioRetryProducer,
  ) {}

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async processOzonetelCallDetail(
    callDetail: OzonetelCallDetails,
    code: string,
  ) {
    try {
      const {
        AudioFile,
        AgentID,
        monitorUCID,
        StartTime,
        Duration,
        EndTime,
        Apikey,
        Status,
        TimeToAnswer,
      } = callDetail || {};
      if (!code || code.trim() === '') {
        throw new Error(
          `Code is required for AgentId: ${AgentID} | monitorUCID: ${monitorUCID}`,
        );
      }
      const cloudTelephonyIntegration =
        await this.cloudTelephonyService.getCloudTelephonyIntegrationByCode(
          code,
        );

      if (!cloudTelephonyIntegration) {
        throw new Error(
          `Cloud telephony integration not found for AgentId: ${AgentID} | monitorUCID: ${monitorUCID}`,
        );
      }

      if (
        cloudTelephonyIntegration.provider !== CloudTelephonyProvider.OZONETEL
      ) {
        throw new Error(
          `Invalid cloud telephony provider for AgentId: ${AgentID} | monitorUCID: ${monitorUCID}`,
        );
      }

      if (Apikey !== cloudTelephonyIntegration.credentials.apiKey) {
        throw new Error(
          `Invalid API key for AgentId: ${AgentID} | monitorUCID: ${callDetail.monitorUCID}`,
        );
      }

      if (!AgentID) {
        throw new Error(`Agent ID is required for monitorUCID: ${monitorUCID}`);
      }

      const durationInSeconds = Duration
        ? this.parseTimeToSeconds(Duration)
        : 0;

      if (Status !== OzonetelCallStatus.Answered || durationInSeconds === 0) {
        throw new Error(
          `Call status: ${Status} and duration: ${durationInSeconds} for AgentId: ${AgentID} | monitorUCID: ${callDetail.monitorUCID}`,
        );
      }

      this.logger.debug(
        `Processing Ozonetel call detail for agent with phone ${AgentID} | monitorUCID: ${monitorUCID}`,
      );

      ExecutionManager.setAuthContext(
        '',
        UserRole.COUNSELOR,
        cloudTelephonyIntegration.tenantId,
      );

      const counselor = await this.userService.getUserByExternalId(AgentID);

      if (!counselor || counselor.role !== UserRole.COUNSELOR) {
        throw new Error(
          `Counselor not found for AgentId: ${AgentID} | monitorUCID: ${monitorUCID}`,
        );
      }

      ExecutionManager.setAuthContext(
        counselor.id.toString(),
        counselor.role,
        counselor.tenantId,
      );

      let chat: Chat | null = null;

      if (monitorUCID) {
        chat = await this.chatService.getChatByExternalId(monitorUCID);
        if (!chat) {
          this.logger.debug(
            `Chat does not exist for AgentId: ${AgentID} | monitorUCID: ${monitorUCID}`,
          );
        }
      }

      // if chat was not created (using call events webhook) and audio file is not present, throw an error
      if (!AudioFile) {
        throw new Error(
          `There is no audio file for AgentId: ${AgentID} | monitorUCID: ${monitorUCID} | chatId: ${chat?.id}`,
        );
      }

      if (
        chat?.summaryStatus &&
        chat.summaryStatus !== ChatSummaryStatus.PENDING
      ) {
        throw new Error(
          `Summary generation has already been processed for AgentId: ${AgentID} | monitorUCID: ${monitorUCID} | chatId: ${chat?.id}`,
        );
      }

      // If chat was not created using the Ozonetel call events webhook (if webhook was not received or any other cases),
      // create a new chat
      if (!chat) {
        const timeToAnswer = TimeToAnswer
          ? this.parseTimeToSeconds(TimeToAnswer)
          : 0;
        const startedAt = this.getConversationStartTime({
          startTime: StartTime,
          durationInSeconds,
          timeToAnswer,
          endTime: EndTime,
        });
        chat = await this.chatService.createChatForAnonymousClient({
          counselorId: counselor.id,
          provider: AudioChatProvider.OZONETEL,
          startedAt,
          externalId: monitorUCID,
          status: ChatStatus.ACTIVE,
        });
        this.logger.info(
          `Chat created for AgentId: ${AgentID} | monitorUCID: ${monitorUCID} | chatId: ${chat?.id}`,
        );
      }

      if (!chat) {
        throw new Error(
          `Chat was not created for AgentId: ${AgentID} | monitorUCID: ${monitorUCID}`,
        );
      }

      // if chat is not ended using call events webhook, end the chat
      if (chat.status !== ChatStatus.ENDED) {
        const endedAt = EndTime ? convertIstStringToUtc(EndTime) : new Date();
        await this.chatService.endChat(chat.id, endedAt);
        this.chatService.updateCallMetadata(chat.id, durationInSeconds);
      }

      if (AudioFile) {
        const isReady = await checkAudioFileReady(AudioFile);
        if (isReady) {
          this.logger.debug(
            `Audio file is ready for processing for AgentId: ${AgentID} | monitorUCID: ${monitorUCID} | chatId: ${chat.id}`,
          );
          this.aiEventService.publishTranscribeAudioEvent({
            message_type: 'transcribe_and_summarize_request',
            timestamp: Date.now(),
            audio_url: AudioFile,
            chat_id: chat.id,
          });
          this.auditLogger.log({
            eventType: AUDIT_EVENTS.AUDIO_TRANSCRIPT_REQUEST_SENT,
            details: {
              purpose: 'Audio transcript request sent to AI service',
              chatId: chat.id,
              provider: AudioChatProvider.OZONETEL,
            },
          });
        } else {
          this.audioRetryProducer.sendAudioFileRetryMessage({
            audioUrl: AudioFile,
            chatId: chat.id,
            retryCount: 0,
          });
        }
      } else {
        await this.chatService.updateChat(chat.id, {
          summaryStatus: ChatSummaryStatus.NO_AUDIO,
          metadata: { error: 'Audio file was missing' },
        });
        throw new Error(
          `Audio file is required for AgentId: ${AgentID} | monitorUCID: ${monitorUCID} | chatId: ${chat.id}`,
        );
      }
    } catch (error) {
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_PROCESSING_FAILED,
        details: {
          error: `Ozonetel call detail webhook error: ${error.message}`,
          provider: AudioChatProvider.OZONETEL,
        },
      });
      this.logger.error(`Ozonetel call detail webhook error: ${error.message}`);
    }
  }

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleOzonetelCallEvents(
    callEventsData: OzonetelCallEventsDto,
    code: string,
  ) {
    try {
      if (!code || code.trim() === '') {
        throw new Error('Code is required');
      }
      const cloudTelephonyIntegration =
        await this.cloudTelephonyService.getCloudTelephonyIntegrationByCode(
          code,
        );

      const { eventType, data } = callEventsData;
      const { agent_id, monitor_ucid, event_time } = data || {};

      if (!cloudTelephonyIntegration) {
        throw new Error(
          `Cloud telephony integration not found for AgentId: ${agent_id} | monitorUCID: ${monitor_ucid}`,
        );
      }

      if (
        cloudTelephonyIntegration.provider !== CloudTelephonyProvider.OZONETEL
      ) {
        throw new Error(
          `Invalid cloud telephony provider for AgentId: ${agent_id} | monitorUCID: ${monitor_ucid}`,
        );
      }

      if (!agent_id) {
        throw new Error(
          `Call events: Agent id is required for AgentId: ${agent_id} | monitorUCID: ${monitor_ucid}`,
        );
      }

      if (eventType !== OzonetelEventTypes.Call || !data?.action) {
        this.logger.debug(
          `Invalid event type and action for AgentId: ${agent_id} | monitorUCID: ${monitor_ucid} | eventType: ${eventType} | action: ${data?.action}`,
        );
        return;
      }

      ExecutionManager.setAuthContext(
        '',
        UserRole.COUNSELOR,
        cloudTelephonyIntegration.tenantId,
      );

      if (data.action === OzonetelCallAction.Disconnect && monitor_ucid) {
        const chat = await this.chatService.getChatByExternalId(monitor_ucid);
        if (chat) {
          this.logger.debug(
            `Ending chat for AgentId: ${agent_id} | monitorUCID: ${monitor_ucid} | chatId: ${chat.id} using call events disconnect action`,
          );
          await this.chatService.endChat(
            chat.id,
            event_time ? convertIstStringToUtc(event_time) : new Date(),
          );
          this.chatService.updateCallMetadata(chat.id);
        }
        return;
      }

      if (data.action !== OzonetelCallAction.Answered) {
        throw new Error(
          `Invalid action for AgentId: ${agent_id} | monitorUCID: ${monitor_ucid} | action: ${data?.action}`,
        );
      }

      this.logger.debug(
        `Processing Ozonetel call events for agent with phone ${agent_id} | monitorUCID: ${monitor_ucid}`,
      );

      const counselor = await this.userService.getUserByExternalId(agent_id);

      if (!counselor || counselor.role !== UserRole.COUNSELOR) {
        throw new Error(
          `Counselor not found for agent id ${agent_id} | monitorUCID: ${monitor_ucid}`,
        );
      }

      ExecutionManager.setAuthContext(
        counselor.id.toString(),
        counselor.role,
        cloudTelephonyIntegration.tenantId,
      );
      const chat = await this.chatService.createChatForAnonymousClient({
        counselorId: counselor.id,
        provider: AudioChatProvider.OZONETEL,
        externalId: monitor_ucid,
        status: ChatStatus.ACTIVE,
        startedAt: event_time ? convertIstStringToUtc(event_time) : new Date(),
      });

      if (chat) {
        this.broadcastMessageService.broadcastUserJoinedMessage(
          MessageBrokerChannel.CHAT_MESSAGE_CLOUD_TELEPHONY,
          {
            participants: [counselor.id],
            userId: counselor.id,
            chatId: chat.id,
          },
        );
      }
      this.logger.debug(
        `Ozonetel call events webhook processed successfully for AgentId: ${agent_id} | monitorUCID: ${monitor_ucid}`,
      );
    } catch (error) {
      this.logger.error(`Ozonetel call events webhook error: ${error.message}`);
    }
  }

  async makeRequest({
    endpoint,
    method,
    data,
    headers,
  }: {
    endpoint: string;
    method: string;
    data: any;
    headers?: Record<string, string>;
  }) {
    const url = `${this.config.ozonetel.apiUrl}/${endpoint}`;
    this.logger.debug(`Making ozonetel request to ${url} | ${method}}`);
    this.logger.debug(
      `Making ozonetel request with data: ${JSON.stringify(data)}`,
    );

    try {
      const response = await axios({
        url,
        method,
        data,
        headers: {
          'Content-Type': 'application/json',
          ...(headers || {}),
        },
      });
      this.logger.debug(
        `Ozonetel request successful with status: ${response.status}`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to make ozonetel request with error: ${error.message}`,
      );
      throw error;
    }
  }

  async subscribeOzonetelEvents(tenantId: string) {
    const cloudTelephonyIntegration =
      await this.cloudTelephonyService.getCloudTelephonyIntegrationByTenantId(
        tenantId,
      );
    if (!cloudTelephonyIntegration) {
      this.logger.error(
        `Failed to subscribe ozonetel events for tenant ${tenantId} as cloud telephony integration not found`,
      );
      throw new NotFoundException('Cloud telephony integration not found');
    }
    this.logger.debug(`Subscribing to ozonetel events for tenant ${tenantId}`);
    try {
      await this.makeRequest({
        endpoint: `events/subscribe`,
        method: 'POST',
        data: {
          callEventsURL: `${this.config.api.baseUrl}/api/v1/webhook/ozonetel/call-events?code=${cloudTelephonyIntegration.code}`,
          agentEventsURL: '',
        },
        headers: {
          api_key: cloudTelephonyIntegration.credentials.apiKey,
          username: cloudTelephonyIntegration.credentials.username,
        },
      });
      this.logger.debug(`Subscribed ozonetel events for tenant ${tenantId}`);
      await this.cloudTelephonyService.updateCloudTelephonyIntegration(
        cloudTelephonyIntegration.id,
        {
          config: {
            ...(cloudTelephonyIntegration.config || {}),
            callEventsEnabled: true,
          },
        },
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to subscribe ozonetel events for tenant ${tenantId} with error: ${error.message}`,
      );
      throw new ServiceUnavailableException('Ozonetel service unavailable');
    }
  }

  async unsubscribeOzonetelEvents(tenantId: string) {
    const cloudTelephonyIntegration =
      await this.cloudTelephonyService.getCloudTelephonyIntegrationByTenantId(
        tenantId,
      );
    if (!cloudTelephonyIntegration) {
      this.logger.error(
        `Failed to unsubscribe ozonetel events for tenant ${tenantId} as cloud telephony integration not found`,
      );
      throw new NotFoundException('Cloud telephony integration not found');
    }
    try {
      await this.makeRequest({
        endpoint: 'events/un-subscribe',
        method: 'POST',
        data: {
          eventType: OzonetelEventTypes.Call,
        },
        headers: {
          api_key: cloudTelephonyIntegration.credentials.apiKey,
          username: cloudTelephonyIntegration.credentials.username,
        },
      });
      this.logger.debug(`Unsubscribed ozonetel events for tenant ${tenantId}`);
      await this.cloudTelephonyService.updateCloudTelephonyIntegration(
        cloudTelephonyIntegration.id,
        {
          config: {
            ...(cloudTelephonyIntegration.config || {}),
            callEventsEnabled: false,
          },
        },
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to unsubscribe ozonetel events for tenant ${tenantId} with error: ${error.message}`,
      );
      throw new ServiceUnavailableException('Ozonetel service unavailable');
    }
  }

  parseTimeToSeconds(duration: string): number {
    const [hours, minutes, seconds] = duration.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  }

  getConversationStartTime({
    startTime,
    durationInSeconds,
    endTime,
    timeToAnswer,
  }: {
    startTime?: string;
    durationInSeconds: number;
    endTime?: string;
    timeToAnswer: number;
  }): Date {
    this.logger.debug(
      `Getting conversation start time. startTime: ${startTime} | durationInSeconds: ${durationInSeconds} | endTime: ${endTime} | timeToAnswer: ${timeToAnswer}`,
    );
    if (startTime && timeToAnswer > 0) {
      const startTimeInUtc = convertIstStringToUtc(startTime);
      return addDurationToDate({
        date: startTimeInUtc,
        duration: timeToAnswer,
        unit: 'second',
      });
    } else if (endTime && durationInSeconds > 0) {
      const endTimeInUtc = convertIstStringToUtc(endTime);
      return subtractDurationFromDate({
        date: endTimeInUtc,
        duration: durationInSeconds,
        unit: 'second',
      });
    }
    this.logger.debug(
      `Failed to get conversation start time, using current time. startTime: ${startTime} | durationInSeconds: ${durationInSeconds} | endTime: ${endTime} | timeToAnswer: ${timeToAnswer}`,
    );
    return new Date();
  }
}
