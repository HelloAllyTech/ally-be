import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { LoggerService } from '../../logger/logger.service';
import {
  OzonetelCallAction,
  OzonetelCallDetails,
  OzonetelCallEventsDto,
  OzonetelCallStatus,
  OzonetelEventTypes,
} from '../type/ozonetel.type';
import { ChatService } from '../../chat/service/chat.service';
import { UserService } from '../../user/user.service';
import { UserRole } from '../../common/constants/user.constants';
import { AudioChatProvider } from '../../common/constants/chat.constants';
import {
  ChatStatus,
  ChatSummaryStatus,
} from '../../common/entities/chat.entity';
import { CloudTelephonyService } from '../service/cloud-telephony.service';
import { CloudTelephonyProvider } from '../../common/constants/chat.constants';
import { ExecutionManager } from '../../common/execution/execution-manager';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import { AppConfigService } from '../../config/config.service';
import { AiEventService } from '../../ai/service/ai-event.service';
import { BroadcastMessageService } from '../../audio/service/broadcast-message.service';
import { MessageBrokerChannel } from '../../common/constants/message-broker.constants';

@Injectable()
export class OzonetelService {
  private readonly logger = LoggerService.getInstance(OzonetelService.name);
  constructor(
    private chatService: ChatService,
    private userService: UserService,
    private cloudTelephonyService: CloudTelephonyService,
    private config: AppConfigService,
    private aiEventService: AiEventService,
    private broadcastMessageService: BroadcastMessageService,
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
        ? this.getDurationInSeconds(Duration)
        : 0;

      if (Status !== OzonetelCallStatus.Answered || durationInSeconds === 0) {
        throw new Error(
          `Call status: ${Status} and duration: ${durationInSeconds} for AgentId: ${AgentID} | monitorUCID: ${callDetail.monitorUCID}`,
        );
      }

      this.logger.info(
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

      let chat;
      let chatId;

      if (monitorUCID) {
        chat = await this.chatService.getChatByExternalId(monitorUCID);
        if (!chat) {
          this.logger.info(
            `Chat does not exist for AgentId: ${AgentID} | monitorUCID: ${monitorUCID}`,
          );
        }
        chatId = chat?.id;
      }

      // if chat was not created (using call events webhook) and audio file is not present, throw an error
      if (!chat && !AudioFile) {
        throw new Error(
          `There is no chat and audio file for AgentId: ${AgentID} | monitorUCID: ${monitorUCID} | chatId: ${chatId}`,
        );
      }

      if (
        chat?.summaryStatus &&
        chat.summaryStatus !== ChatSummaryStatus.PENDING
      ) {
        throw new Error(
          `Summary generation has already been processed for AgentId: ${AgentID} | monitorUCID: ${monitorUCID} | chatId: ${chatId}`,
        );
      }

      // If chat was not created using the Ozonetel subscribe event (if webhook was not received or any other cases),
      // create a new chat
      if (!chat) {
        const startedAt = StartTime
          ? this.addDurationToStartTime(StartTime, durationInSeconds)
          : new Date();
        chat = await this.chatService.createChatForAnyonymousClient({
          counselorId: counselor.id,
          provider: AudioChatProvider.OZONETEL,
          startedAt,
          externalId: monitorUCID,
          status: ChatStatus.ACTIVE,
        });
        this.logger.info(
          `Chat created for AgentId: ${AgentID} | monitorUCID: ${monitorUCID} | chatId: ${chat?.chatId}`,
        );
        chatId = chat?.chatId;
      }

      const endedAt = EndTime ? new Date(EndTime) : new Date();

      if (chatId !== undefined) {
        await this.chatService.endChat(chatId, endedAt);
        this.chatService.updateCallMetadata(chatId, durationInSeconds);
      } else {
        throw new Error(
          `Chat was not created for AgentId: ${AgentID} | monitorUCID: ${monitorUCID}`,
        );
      }

      if (AudioFile) {
        this.aiEventService.publishTranscribeAudioEvent({
          message_type: 'transcribe_and_summarize_request',
          timestamp: Date.now(),
          audio_url: AudioFile,
          chat_id: chatId,
          sample_rate: 8000, // TODO: need to change this
        });

        this.logger.info(
          `Audio file processed successfully for AgentId: ${AgentID} | monitorUCID: ${monitorUCID} | chatId: ${chatId}`,
        );
      } else {
        await this.chatService.updateChat(chatId, {
          summaryStatus: ChatSummaryStatus.FAILED,
          metadata: { message: 'Audio file was missing' },
        });
        throw new Error(
          `Audio file is required for AgentId: ${AgentID} | monitorUCID: ${monitorUCID} | chatId: ${chatId}`,
        );
      }
    } catch (error) {
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

      if (
        eventType !== OzonetelEventTypes.Call ||
        data?.action !== OzonetelCallAction.Answered
      ) {
        this.logger.info(
          `Invalid event type or action for AgentId: ${agent_id} | monitorUCID: ${monitor_ucid} | eventType: ${eventType} | action: ${data?.action}`,
        );
        return;
      }

      this.logger.info(
        `Processing Ozonetel call events for agent with phone ${agent_id} | monitorUCID: ${monitor_ucid}`,
      );

      ExecutionManager.setAuthContext(
        '',
        UserRole.COUNSELOR,
        cloudTelephonyIntegration.tenantId,
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
      const chat = await this.chatService.createChatForAnyonymousClient({
        counselorId: counselor.id,
        provider: AudioChatProvider.OZONETEL,
        externalId: monitor_ucid,
        status: ChatStatus.ACTIVE,
        startedAt: event_time ? new Date(event_time) : new Date(),
      });

      if (chat) {
        this.broadcastMessageService.broadcastUserJoinedMessage(
          MessageBrokerChannel.CHAT_MESSAGE_CLOUD_TELEPHONY,
          {
            participants: [counselor.id],
            userId: counselor.id,
            chatId: chat.chatId,
          },
        );
      }
      this.logger.info(
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
    this.logger.info(`Making ozonetel request to ${url} | ${method}}`);
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
      this.logger.info(
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
    this.logger.info(`Subscribing to ozonetel events for tenant ${tenantId}`);
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
      this.logger.info(`Subscribed ozonetel events for tenant ${tenantId}`);
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
      this.logger.info(`Unsubscribed ozonetel events for tenant ${tenantId}`);
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

  getDurationInSeconds(duration: string): number {
    const [hours, minutes, seconds] = duration.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  }

  addDurationToStartTime(startTime: string, durationInSeconds: number): Date {
    const startDate = new Date(startTime);
    if (durationInSeconds === 0) {
      return startDate;
    }
    return new Date(startDate.getTime() + durationInSeconds * 1000);
  }
}
