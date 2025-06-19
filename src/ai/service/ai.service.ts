import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from '../../config/config.service';
import {
  Chat,
  EnhanceTextRequest,
  GenerateSummaryRequest,
  IdentifySpeakersRequest,
  MessageRequest,
  TagPositivityRatingsRequest,
  AddReferenceDocumentRequest,
  SearchReferenceDocumentsRequest,
  UpdateReferenceDocumentRequest,
  GetReferenceDocumentRequest,
  DeleteReferenceDocumentRequest,
} from '../dto/ai.request.dto';
import {
  EnhanceTextResponse,
  GenerateSummaryResponse,
  IdentifySpeakersResponse,
  TagPositivityRatingsResponse,
  AddReferenceDocumentResponse,
  SearchReferenceDocumentsResponse,
  UpdateReferenceDocumentResponse,
  GetReferenceDocumentResponse,
  DeleteReferenceDocumentResponse,
} from '../dto/ai.response.dto';
import { createClient, DeepgramClient } from '@deepgram/sdk';
import { ENDPOINTS } from '../constants/endpoints.constants';
import { NudgeRequest, NudgeResponse } from '../../chat/type/chat.type';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationErrorType } from '../../notification/type/notification.error.type';
import { RetryOnFail } from '../../common/decorator/retry.decorator';
import { LoggerService } from '../../logger/logger.service';

@Injectable()
export class AiService {
  logger = LoggerService.getInstance(AiService.name);
  private readonly deepgramClient: DeepgramClient;
  private readonly alertThresholdTimeout = 3 * 60 * 1000; // 3 minutes
  private readonly maxTimeout = 5 * 60 * 1000; // 5 minutes
  constructor(
    private config: AppConfigService,
    private eventEmitter: EventEmitter2,
  ) {
    this.deepgramClient = createClient(config.ai.deepgramApiKey);
  }

  // async transcribeAudioWithDeepgram(liveClient: LiveClient, audioBuffer: Buffer): Promise<string> {
  //   const live = this.deepgramClient.listen.live({ model: 'nova-3' });
  //   live.
  // }

  async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    try {
      const response = await axios.post(
        `${this.config.ai.apiUrl}/transcribe`,
        audioBuffer,
        {
          headers: { 'Content-Type': 'audio/webm' },
        },
      );

      this.logger.info(`Transcription received: ${response.data.text}`);
      return response.data.text; // Assuming API returns `{ text: "..." }`
    } catch (error) {
      this.logger.error(`AI Service Error: ${error.message}`);
      throw new Error('AI transcription failed');
    }
  }

  async getNudge(
    newMessage: string,
    chat_history: MessageRequest[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    requireNudge = false,
  ) {
    try {
      if (!this.config.ai.apiUrl) {
        return;
      }
      const response = await this.makeRequest<NudgeResponse, NudgeRequest>(
        ENDPOINTS.CONVERSATION,
        {
          latest_message: newMessage,
          chat_history: chat_history,
          //force_nudge: requireNudge,
        },
      );
      return response; // Assuming API returns `{ nudge: "..." }`
    } catch (error) {
      this.logger.error(`AI Service Error: ${error.message}`);
      throw new Error('AI nudge request failed');
    }
  }

  async identifySpeakersFromConversation(chatHistory: Chat[]) {
    try {
      const request: IdentifySpeakersRequest = {
        chat_history: chatHistory,
      };
      const response = await this.makeRequest<
        IdentifySpeakersResponse,
        IdentifySpeakersRequest
      >(ENDPOINTS.IDENTIFY_SPEAKERS, request);
      return response;
    } catch (error) {
      this.logger.error(`AI Service Error: ${error.message}`);
      throw new Error('AI identify speakers request failed');
    }
  }

  @RetryOnFail(3, 1000)
  async generateSummaryAndTags(messages: MessageRequest[]) {
    const request: GenerateSummaryRequest = {
      chat_history: messages,
    };
    let response: GenerateSummaryResponse;
    try {
      response = await this.makeRequest<
        GenerateSummaryResponse,
        GenerateSummaryRequest
      >(ENDPOINTS.SUMMARY, request, true);
    } catch (error) {
      this.logger.error(`AI Service Error: ${error.message}`);
      return;
    }
    return response;
  }

  async generateTagPositivityRatings(tags: string[]) {
    const request: TagPositivityRatingsRequest = {
      tags: tags,
    };
    const response = await this.makeRequest<
      TagPositivityRatingsResponse,
      TagPositivityRatingsRequest
    >(ENDPOINTS.TAG_POSITIVITY_RATINGS, request);
    return response;
  }

  async addReferenceDocument(document: AddReferenceDocumentRequest) {
    const request = {
      ...document,
    };
    const response = await this.makeRequest<
      AddReferenceDocumentResponse,
      AddReferenceDocumentRequest
    >(ENDPOINTS.ADD_REFERENCE_DOCUMENT, request, true);
    return response;
  }

  async searchReferenceDocuments(
    searchRequest: SearchReferenceDocumentsRequest,
  ) {
    const response = await this.makeRequest<
      SearchReferenceDocumentsResponse,
      SearchReferenceDocumentsRequest
    >(ENDPOINTS.SEARCH_REFERENCE_DOCUMENTS, searchRequest, true);
    return response;
  }

  async updateReferenceDocument(
    id: string,
    document: UpdateReferenceDocumentRequest,
  ) {
    const request = {
      ...document,
    };
    const response = await this.makeRequest<
      UpdateReferenceDocumentResponse,
      UpdateReferenceDocumentRequest
    >(`${ENDPOINTS.UPDATE_REFERENCE_DOCUMENT}/${id}`, request, true, 'put');
    return response;
  }

  async getReferenceDocument(id: string) {
    const request: GetReferenceDocumentRequest = {
      document_id: id,
    };
    const response = await this.makeRequest<
      GetReferenceDocumentResponse,
      GetReferenceDocumentRequest
    >(`${ENDPOINTS.GET_REFERENCE_DOCUMENT}/${id}`, request, true, 'get');
    return response;
  }

  async deleteReferenceDocument(id: string) {
    const request: DeleteReferenceDocumentRequest = {
      document_id: id,
    };
    const response = await this.makeRequest<
      DeleteReferenceDocumentResponse,
      DeleteReferenceDocumentRequest
    >(`${ENDPOINTS.DELETE_REFERENCE_DOCUMENT}/${id}`, request, true, 'delete');
    return response;
  }

  private async makeRequest<R, T>(
    endpoint: string,
    data: T,
    throwError = false,
    method: 'get' | 'post' | 'put' | 'delete' = 'post',
  ): Promise<R> {
    const execId = uuidv4();
    let timeoutId: NodeJS.Timeout | undefined;
    const startTime = new Date().toISOString();
    try {
      const url = `${this.config.ai.apiUrl}/${endpoint}`;
      this.logger.info(
        `Making request to ${endpoint} | ${execId} | ${JSON.stringify(data)}`,
      );
      // set timeout for alert threshold
      timeoutId = setTimeout(() => {
        this.eventEmitter.emit('exception', {
          statusCode: 500,
          timestamp: new Date().toISOString(),
          path: endpoint,
          message: `${execId} | Request Exceeded Time Limit | startTime: ${startTime}`,
          type: 'AI Request Time Exceeded',
        } as NotificationErrorType);
      }, this.alertThresholdTimeout);
      const response = await axios({
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: this.maxTimeout,
        url,
        method,
        data,
      });
      this.logger.info(
        `Response from ${endpoint} | ${execId} | ${JSON.stringify(response.data)}`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `AI Service Error: ${error.message} | ${execId} | ${JSON.stringify(data)}`,
      );
      this.eventEmitter.emit('exception', {
        statusCode: 500,
        timestamp: new Date().toISOString(),
        path: endpoint,
        message: `${execId} | startTime: ${startTime} | ${error.message} `,
        type: 'AI Request Error',
      } as NotificationErrorType);
      if (throwError) {
        throw new Error(error.message);
      }
      return {} as R;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  async enhance(summary: string) {
    const request: EnhanceTextRequest = {
      content: summary,
    };
    const response = await this.makeRequest<
      EnhanceTextResponse,
      EnhanceTextRequest
    >(ENDPOINTS.ENHANCE, request);
    return response;
  }
}
