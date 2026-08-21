import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import axios, { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { NudgeRequest, NudgeResponse } from '../../chat/type/chat.type';
import { RetryOnFail } from '../../common/decorator/retry.decorator';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { NotificationErrorType } from '../../notification/type/notification.error.type';
import { ENDPOINTS } from '../constants/endpoints.constants';
import {
  CrisisCheckRequest,
  CrisisCheckResponse,
  KnowledgeAnswerRequest,
  KnowledgeAnswerResponse,
  KnowledgeChunkBulkUpsertRequest,
  KnowledgeChunkBulkUpsertResponse,
  KnowledgeChunkDeleteResponse,
  KnowledgeChunkSearchRequest,
  KnowledgeChunkSearchResponse,
} from '../dto/knowledge.dto';
import {
  AddReferenceDocumentRequest,
  Chat,
  DeleteReferenceDocumentRequest,
  EnhanceTextRequest,
  GenerateSummaryRequest,
  GetReferenceDocumentRequest,
  IdentifySpeakersRequest,
  MessageRequest,
  PromptOverride,
  ScenarioReportGenerateRequest,
  ScenarioEvaluationChatMessage,
  ScenarioEvaluationRequest,
  ActorGoalEvaluationRequest,
  RoadmapOpportunityBulkUpsertRequest,
  RoadmapOpportunityUpsertRequest,
  RoadmapSimilarOpportunitiesRequest,
  SearchReferenceDocumentsRequest,
  TagPositivityRatingsRequest,
  TranscribeAudioRequest,
  UpdateReferenceDocumentRequest,
} from '../dto/ai.request.dto';
import { PromptSharedService } from '../../prompt/service/prompt-shared.service';
import {
  ALLY_AI_PROMPT_PREFIX,
  ALLY_AI_LEARN_PROMPT_PREFIX,
} from '../../learn/constants/scenario-session.constants';
import {
  AddReferenceDocumentResponse,
  DeleteReferenceDocumentResponse,
  EnhanceTextResponse,
  GenerateSummaryResponse,
  GetReferenceDocumentResponse,
  IdentifySpeakersResponse,
  ScenarioEvaluationResponse,
  RoadmapOpportunityBulkUpsertResponse,
  RoadmapOpportunityDeleteResponse,
  RoadmapOpportunityIdsResponse,
  RoadmapOpportunityUpsertResponse,
  RoadmapSimilarOpportunitiesResponse,
  SearchReferenceDocumentsResponse,
  TagPositivityRatingsResponse,
  TranscribeAudioResponse,
  UpdateReferenceDocumentResponse,
} from '../dto/ai.response.dto';
import { ScribeSessionMode } from 'src/common/constants/chat.constants';
import { RoleplayTestRunRequest } from 'src/roleplay-studio/type/roleplay-test-run-request.type';
import { WorkerType } from 'src/user/enum/user.enum';

@Injectable()
export class AiService {
  logger = LoggerService.getInstance(AiService.name);
  private readonly alertThresholdTimeout = 3 * 60 * 1000; // 3 minutes
  private readonly maxTimeout = 5 * 60 * 1000; // 5 minutes
  constructor(
    private config: AppConfigService,
    private eventEmitter: EventEmitter2,
    private promptSharedService: PromptSharedService,
  ) {}

  async transcribeAudioFromBuffer(audioBuffer: Buffer): Promise<string> {
    try {
      const response = await this.makeRequest<{ text: string }, Buffer>(
        'transcribe',
        audioBuffer,
        true,
        'post',
        { 'Content-Type': 'audio/webm' },
      );

      this.logger.debug(`Transcription received: ${response.text}`);
      return response.text; // Assuming API returns `{ text: "..." }`
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
      const prompts = await this.getPromptOverrides();
      const request: IdentifySpeakersRequest = {
        chat_history: chatHistory,
        prompts,
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
  async generateSummaryAndTags(
    messages: MessageRequest[],
    mode?: ScribeSessionMode,
    keys?: string[],
    keyDescriptions?: Record<string, string>,
  ) {
    const prompts = await this.getPromptOverrides();
    const request: GenerateSummaryRequest = {
      chat_history: messages,
      prompts,
      mode,
      ...(keys && { keys }),
      ...(keyDescriptions && { key_descriptions: keyDescriptions }),
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
    const prompts = await this.getPromptOverrides();
    const request: TagPositivityRatingsRequest = {
      tags: tags,
      prompts,
    };
    // This call sits inside the scribe save flow — cap it well below the
    // 5-minute default so a slow/dead AI service fails fast and the client
    // can fall back to neutral ratings instead of hanging the save.
    const response = await this.makeRequest<
      TagPositivityRatingsResponse,
      TagPositivityRatingsRequest
    >(
      ENDPOINTS.TAG_POSITIVITY_RATINGS,
      request,
      false,
      'post',
      undefined,
      false,
      15_000,
    );
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

  // ── Product Roadmap semantic duplicate detection ──────────────────────────
  // ally-ai owns the `RoadmapOpportunity` Weaviate collection. The EXPLICIT timeouts below
  // are not optional: makeRequest defaults to this.maxTimeout (5 MINUTES), and a five-minute
  // hang on the opportunity-create path would be catastrophic for a feature whose whole
  // contract is "best-effort" — an opportunity must save even when ally-ai is down.

  /** Idempotent: the Weaviate object uuid IS the opportunity id. 8s — a write nobody waits on. */
  async upsertRoadmapOpportunity(request: RoadmapOpportunityUpsertRequest) {
    return this.makeRequest<
      RoadmapOpportunityUpsertResponse,
      RoadmapOpportunityUpsertRequest
    >(
      `${ENDPOINTS.ROADMAP_OPPORTUNITY_UPSERT}/${request.opportunity_id}`,
      request,
      true,
      'put',
      undefined,
      false,
      8_000,
    );
  }

  /**
   * MANDATORY on soft delete and on merge. Postgres reads filter on deletedAt IS NULL but
   * Weaviate has no idea, so a skipped delete means duplicate-detection proposes a deleted
   * opportunity forever.
   */
  async deleteRoadmapOpportunity(opportunityId: string) {
    return this.makeRequest<RoadmapOpportunityDeleteResponse, undefined>(
      `${ENDPOINTS.ROADMAP_OPPORTUNITY_DELETE}/${opportunityId}`,
      undefined,
      true,
      'delete',
      undefined,
      false,
      8_000,
    );
  }

  /** 15s — a user IS waiting on this one (duplicate check while typing a new opportunity). */
  async findSimilarRoadmapOpportunities(
    request: RoadmapSimilarOpportunitiesRequest,
  ) {
    return this.makeRequest<
      RoadmapSimilarOpportunitiesResponse,
      RoadmapSimilarOpportunitiesRequest
    >(
      ENDPOINTS.ROADMAP_OPPORTUNITY_SEARCH,
      request,
      true,
      'post',
      undefined,
      false,
      15_000,
    );
  }

  // ── WhatsApp Q&A knowledge corpus ──────────────────────────────────────────
  // ally-ai owns the `KnowledgeChunk` collection; ally-be's Postgres is the system of record.
  // Every call here passes an EXPLICIT timeout for the same reason as the roadmap block above:
  // makeRequest defaults to 5 minutes, which is far longer than any of these paths can afford.

  /**
   * Index a batch of chunks (64 at a time; a 300-page PDF is ~500 chunks ≈ 8 calls).
   *
   * 120s: each call embeds up to 64 passages in one OpenAI request and then writes them, and it
   * runs inside the ingest SQS consumer rather than on a user-facing path. Still bounded well
   * under the consumer's visibility timeout so a hang cannot cause a redelivery mid-write.
   *
   * Returns per-chunk succeeded/failed — never throws for a per-item problem — so the caller can
   * advance indexedChunkCount and retry only what actually failed.
   */
  async bulkUpsertKnowledgeChunks(request: KnowledgeChunkBulkUpsertRequest) {
    return this.makeRequest<
      KnowledgeChunkBulkUpsertResponse,
      KnowledgeChunkBulkUpsertRequest
    >(
      ENDPOINTS.KNOWLEDGE_CHUNK_BULK_UPSERT,
      request,
      true,
      'post',
      undefined,
      false,
      120_000,
    );
  }

  /**
   * Remove every chunk of one document. MANDATORY before writing a new chunk version.
   *
   * Skipping it leaves the previous generation retrievable, which after an edit means the bot can
   * answer with — and cite — text the document no longer contains.
   */
  async deleteKnowledgeChunksByDocument(documentId: string) {
    return this.makeRequest<KnowledgeChunkDeleteResponse, undefined>(
      `${ENDPOINTS.KNOWLEDGE_CHUNK_DELETE_BY_DOCUMENT}/${documentId}`,
      undefined,
      true,
      'delete',
      undefined,
      false,
      30_000,
    );
  }

  /** Retrieval only, no LLM. Backs the admin retrieval console. */
  async searchKnowledgeChunks(request: KnowledgeChunkSearchRequest) {
    return this.makeRequest<
      KnowledgeChunkSearchResponse,
      KnowledgeChunkSearchRequest
    >(
      ENDPOINTS.KNOWLEDGE_CHUNK_SEARCH,
      request,
      true,
      'post',
      undefined,
      false,
      30_000,
      // The query is a worker's question on the WhatsApp path.
      true,
    );
  }

  /**
   * Answer a worker's question from the corpus, or decline.
   *
   * 25s, and that number is load-bearing rather than cautious: this runs inside the WhatsApp
   * inbound SQS consumer, whose visibility timeout is 60s. Left at the 5-minute default, a slow
   * ally-ai would outlive the visibility window, SQS would redeliver the message, and the worker
   * would be answered twice — the worst failure mode this pipeline has.
   *
   * redactBody=true: the payload is the worker's question.
   */
  async answerKnowledgeQuestion(request: KnowledgeAnswerRequest) {
    return this.makeRequest<KnowledgeAnswerResponse, KnowledgeAnswerRequest>(
      ENDPOINTS.KNOWLEDGE_AGENT_ANSWER,
      request,
      true,
      'post',
      undefined,
      false,
      25_000,
      true,
    );
  }

  /**
   * The LLM crisis classifier — the second layer of the safety net.
   *
   * Run CONCURRENTLY with `answerKnowledgeQuestion`, so it adds no latency to the ordinary reference
   * question, which is what the overwhelming majority of messages are. A positive verdict discards
   * the answer that came back alongside it.
   *
   * 15s rather than the answer call's 25s: this is one small-model classification, and the pair runs
   * inside the same SQS visibility window. A classifier that hangs must not be what pushes the whole
   * message past it — and a timeout here is survivable, because ally-be's keyword rules already ran.
   *
   * redactBody=true: the payload is the worker's message.
   */
  async checkWhatsAppCrisis(request: CrisisCheckRequest) {
    return this.makeRequest<CrisisCheckResponse, CrisisCheckRequest>(
      ENDPOINTS.KNOWLEDGE_AGENT_CRISIS_CHECK,
      request,
      true,
      'post',
      undefined,
      false,
      15_000,
      true,
    );
  }

  /** Backfill/reindex batches. 60s because a batch embeds up to 64 items in one call. */
  async bulkUpsertRoadmapOpportunities(
    request: RoadmapOpportunityBulkUpsertRequest,
  ) {
    return this.makeRequest<
      RoadmapOpportunityBulkUpsertResponse,
      RoadmapOpportunityBulkUpsertRequest
    >(
      ENDPOINTS.ROADMAP_OPPORTUNITY_BULK_UPSERT,
      request,
      true,
      'post',
      undefined,
      false,
      60_000,
    );
  }

  /**
   * One page of ids in the vector index, for reconciliation. 20s — a whole page is one cheap
   * ids-only read, but a large `limit` over a cold collection is slower than a keyed lookup.
   *
   * This is the ONLY call here that can surface an opportunity ally-be has forgotten about; every
   * other one is keyed by an id we already hold. Without it, a vector whose row was hard-deleted
   * is undetectable.
   */
  async listRoadmapOpportunityIds(limit = 200, after?: string) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (after) query.set('after', after);

    return this.makeRequest<RoadmapOpportunityIdsResponse, undefined>(
      `${ENDPOINTS.ROADMAP_OPPORTUNITY_IDS}?${query.toString()}`,
      undefined,
      true,
      'get',
      undefined,
      false,
      20_000,
    );
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

  @RetryOnFail(3, 1000)
  async transcribeAudioAndSummarize(request: TranscribeAudioRequest) {
    const prompts = await this.getPromptOverrides();
    const enrichedRequest = {
      ...request,
      prompts,
    };
    const response = await this.makeRequest<
      TranscribeAudioResponse,
      TranscribeAudioRequest
    >(ENDPOINTS.TRANSCRIBE_AND_SUMMARIZE, enrichedRequest);
    return response;
  }

  @RetryOnFail(3, 1000)
  async triggerScenarioReportGenerate(
    request: ScenarioReportGenerateRequest,
  ): Promise<void> {
    await this.makeRequest<unknown, ScenarioReportGenerateRequest>(
      ENDPOINTS.SCENARIO_REPORT_GENERATE,
      request,
      true,
      'post',
      undefined,
      true,
    );
  }

  /**
   * Signal an in-flight scenario report to cancel.
   *
   * Called immediately after the DB is flipped to CANCELLED so the
   * ai-learn worker stops the N-turn loop and skips the evaluator —
   * without this, a cancelled report still consumed 3+ minutes of LLM
   * compute (turn loop + 60s evaluator) and the user's "cancel" did
   * nothing visible. ai-learn answers 202 whether or not it found an
   * active service for the id, so a stale cancel after the run already
   * finished is harmless.
   *
   * No retry decorator: best-effort. If this fails, the user's cancel
   * is still durably recorded in our DB; ai-learn will eventually
   * finish naturally and its final webhook will be ignored by ally-be's
   * status-update guard.
   */
  async triggerScenarioReportCancel(reportId: string): Promise<void> {
    try {
      await this.makeRequest<unknown, Record<string, never>>(
        `${ENDPOINTS.SCENARIO_REPORT_CANCEL}/${reportId}`,
        {},
        false,
        'post',
        undefined,
        true,
      );
    } catch {
      // Don't escalate — the user already sees CANCELLED in the UI.
      // The underlying error is already logged inside makeRequest's catch.
      this.logger.warn(
        `Cancel propagation to ai-learn failed for report ${reportId}; ` +
          `ai-learn worker will finish naturally and its final webhook will be ` +
          `ignored by the status guard.`,
      );
    }
  }

  /**
   * Trigger the goal-based actor evaluation of a REAL session in ai-learn.
   * Best-effort (no retry, never throws): the evaluation is an enhancement, so
   * a failure here must never break the session-end flow. ai-learn answers 202
   * and webhooks the per-goal scores back via the evaluation webhook.
   */
  async triggerActorGoalEvaluation(
    request: ActorGoalEvaluationRequest,
  ): Promise<void> {
    try {
      await this.makeRequest<unknown, ActorGoalEvaluationRequest>(
        ENDPOINTS.ACTOR_GOAL_EVALUATION,
        request,
        false,
        'post',
        undefined,
        true,
      );
    } catch {
      // Already logged inside makeRequest; swallow so session-end is unaffected.
      this.logger.warn(
        `Actor goal-evaluation trigger failed for session ` +
          `${request.scenario_session_id}; it will simply remain un-evaluated.`,
      );
    }
  }

  /**
   * Kick off a Roleplay Studio v2 Improve test run in ai-learn (202
   * accepted; ai-learn keeps its internal "rehearsal" naming for the route
   * and payload). Progress/results/transcripts come back via the test-run
   * webhook (PATCH /v1/roleplay-studio/test-runs/webhook/:runId). Throws on
   * failure so RoleplayTestRunService can mark the run FAILED immediately.
   */
  @RetryOnFail(3, 1000)
  async triggerRoleplayTestRun(request: RoleplayTestRunRequest): Promise<void> {
    await this.makeRequest<unknown, RoleplayTestRunRequest>(
      ENDPOINTS.ROLEPLAY_TEST_RUN_RUN,
      request,
      true,
      'post',
      undefined,
      true, // isLearnService — routes to ally-ai-learn
    );
  }

  /**
   * Signal an in-flight test run to cancel. Best-effort, mirrors
   * triggerScenarioReportCancel: the CANCELLED status is already durable in
   * our DB, and a late webhook is ignored by the end-status guard.
   */
  async triggerRoleplayTestRunCancel(runId: string): Promise<void> {
    try {
      await this.makeRequest<unknown, Record<string, never>>(
        `${ENDPOINTS.ROLEPLAY_TEST_RUN_CANCEL}/${runId}`,
        {},
        false,
        'post',
        undefined,
        true,
      );
    } catch {
      // Already logged inside makeRequest's catch.
      this.logger.warn(
        `Cancel propagation to ai-learn failed for test run ${runId}; ` +
          `the run will finish naturally and its final webhook will be ` +
          `ignored by the status guard.`,
      );
    }
  }

  private async makeRequest<R, T>(
    endpoint: string,
    data: T,
    throwError = false,
    method: 'get' | 'post' | 'put' | 'delete' = 'post',
    headers?: Record<string, string>,
    isLearnService = false,
    // Endpoints on a user-facing request path (e.g. tag positivity during a
    // scribe save) must pass something far below the 5-minute default, so an
    // unhealthy AI service degrades the feature instead of hanging the save.
    timeoutMs?: number,
    // Suppress the debug body log for payloads that carry PII/PHI.
    //
    // The `AI Request BODY` line below serialises the whole request at debug level. For most
    // endpoints that is a useful trace; for the WhatsApp knowledge agent the payload is a mental
    // healthcare worker's question, and a LOG_LEVEL=debug deploy would write it to CloudWatch
    // outside the designated audit logger. Callers on those paths pass redactBody=true, which
    // logs the size only. Opt-IN rather than opt-out so existing endpoints keep their traces.
    redactBody = false,
  ): Promise<R> {
    const requestTimeout = timeoutMs ?? this.maxTimeout;
    const execId = uuidv4();
    let timeoutId: NodeJS.Timeout | undefined;
    const startTime = new Date().toISOString();
    const startMs = Date.now();
    const dataSize = (() => {
      try {
        return Buffer.byteLength(JSON.stringify(data), 'utf8');
      } catch {
        return -1;
      }
    })();
    try {
      const apiUrl = isLearnService
        ? this.config.ai.learnApiUrl
        : this.config.ai.apiUrl;
      const url = `${apiUrl}/${endpoint}`;
      this.logger.info(
        `AI Request START | execId=${execId} | endpoint=${endpoint} | url=${url} | ` +
          `method=${method} | isLearnService=${isLearnService} | ` +
          `dataSize=${dataSize}B | timeout=${requestTimeout}ms | startTime=${startTime}`,
      );
      if (redactBody) {
        this.logger.debug(
          `AI Request BODY | execId=${execId} | endpoint=${endpoint} | ` +
            `data=[redacted ${dataSize}B — this endpoint carries PII/PHI]`,
        );
      } else {
        this.logger.debug(
          `AI Request BODY | execId=${execId} | endpoint=${endpoint} | ` +
            `data=${JSON.stringify(data)}`,
        );
      }
      // set timeout for alert threshold
      timeoutId = setTimeout(() => {
        this.logger.warn(
          `AI Request SLOW | execId=${execId} | endpoint=${endpoint} | ` +
            `elapsedMs=${Date.now() - startMs} | thresholdMs=${this.alertThresholdTimeout}`,
        );
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
          'x-api-key': isLearnService
            ? this.config.ai.learnOutboundApiKey
            : this.config.ai.outboundApiKey,
          ...(headers || {}),
        },
        timeout: requestTimeout,
        url,
        method,
        data,
      });
      const elapsedMs = Date.now() - startMs;
      const upstreamTraceId =
        response.headers?.['x-trace-id'] ?? response.headers?.['X-Trace-ID'];
      this.logger.info(
        `AI Request OK | execId=${execId} | endpoint=${endpoint} | ` +
          `status=${response.status} | elapsedMs=${elapsedMs} | ` +
          `upstreamTraceId=${upstreamTraceId ?? 'none'}`,
      );
      this.logger.debug(
        `AI Response BODY | execId=${execId} | endpoint=${endpoint} | ` +
          `data=${JSON.stringify(response.data)}`,
      );
      return response.data;
    } catch (error) {
      const axiosErr = error as AxiosError;
      const elapsedMs = Date.now() - startMs;
      const upstreamStatus = axiosErr.response?.status;
      const upstreamBody = axiosErr.response?.data;
      const upstreamBodyStr =
        typeof upstreamBody === 'string'
          ? upstreamBody
          : JSON.stringify(upstreamBody);
      const upstreamDetail = (upstreamBody as { detail?: unknown } | undefined)
        ?.detail;
      const upstreamTraceId =
        axiosErr.response?.headers?.['x-trace-id'] ??
        axiosErr.response?.headers?.['X-Trace-ID'];
      // Network-level diagnostics: ECONNREFUSED / ECONNRESET / ETIMEDOUT etc.
      const errCode = (error as NodeJS.ErrnoException).code;
      const errno = (error as NodeJS.ErrnoException).errno;
      const syscall = (error as NodeJS.ErrnoException).syscall;
      const address = (error as { address?: string }).address;
      const port = (error as { port?: number }).port;
      const failureCategory = upstreamStatus
        ? `upstream_${upstreamStatus}`
        : errCode
          ? `network_${errCode}`
          : 'unknown';
      this.logger.error(
        `AI Request FAIL | execId=${execId} | endpoint=${endpoint} | ` +
          `category=${failureCategory} | elapsedMs=${elapsedMs} | ` +
          `errMsg=${error.message} | errCode=${errCode} | errno=${errno} | ` +
          `syscall=${syscall} | address=${address} | port=${port} | ` +
          `upstreamStatus=${upstreamStatus} | ` +
          `upstreamTraceId=${upstreamTraceId ?? 'none'} | ` +
          `upstreamDetail=${JSON.stringify(upstreamDetail)} | ` +
          `upstreamBody=${upstreamBodyStr} | ` +
          `dataSize=${dataSize}B | requestData=${JSON.stringify(data)}`,
        error.stack,
      );
      this.eventEmitter.emit('exception', {
        statusCode: 500,
        timestamp: new Date().toISOString(),
        path: endpoint,
        message:
          `${execId} | startTime: ${startTime} | elapsedMs=${elapsedMs} | ` +
          `category=${failureCategory} | ${error.message} | ` +
          `errCode=${errCode} | upstreamStatus=${upstreamStatus} | ` +
          `upstreamTraceId=${upstreamTraceId ?? 'none'} | ` +
          `upstreamDetail=${JSON.stringify(upstreamDetail)}`,
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
    const prompts = await this.getPromptOverrides();
    const request: EnhanceTextRequest = {
      content: summary,
      prompts,
    };
    // The counsellor is sitting on the Enhance button waiting for this, so it
    // must fail loudly and quickly. It used to swallow every failure
    // (`throwError` defaulting to false returns `{}` with a 200), which made a
    // dead AI service look like a wand that simply does nothing — invisible to
    // the counsellor AND to us. 45s is well under the 5-minute default but
    // still leaves room for a long narrative field on a slower model.
    let response: EnhanceTextResponse;
    try {
      response = await this.makeRequest<
        EnhanceTextResponse,
        EnhanceTextRequest
      >(ENDPOINTS.ENHANCE, request, true, 'post', undefined, false, 45_000);
    } catch {
      // makeRequest has already logged the failure in full detail.
      throw new ServiceUnavailableException('Content enhancement failed');
    }
    // A 200 with no content is the same dead end as an error: never hand the
    // caller an empty enhancement it would silently write over the field.
    if (!response?.enhanced_content) {
      this.logger.error(
        `AI Request enhance returned no enhanced_content | ` +
          `response=${JSON.stringify(response)}`,
      );
      throw new ServiceUnavailableException('Content enhancement failed');
    }
    return response;
  }

  async getScenarioSessionSummary(
    messages: MessageRequest[],
    needMemory: boolean,
    previousMemory?: string | null,
  ) {
    try {
      const prompts = await this.getPromptOverrides();
      const response = await this.makeRequest<
        any,
        {
          chat_history: MessageRequest[];
          previous_memory?: string | null;
          need_memory: boolean;
          prompts: Record<string, PromptOverride>;
        }
      >(
        'api/v1/summary/scenario/feedback',
        {
          chat_history: messages,
          need_memory: needMemory,
          previous_memory: previousMemory,
          prompts,
        },
        true,
        'post',
      );
      this.logger.debug(
        `Scenario session summary received: ${JSON.stringify(response)}`,
      );
      return response;
    } catch (error) {
      this.logger.error(`AI Service Error: ${error.message}`);
      throw new Error('AI scenario session summary request failed');
    }
  }

  async getScenarioSessionEvaluation(
    messages: ScenarioEvaluationChatMessage[],
    needMemory: boolean,
    previousMemory?: string | null,
    memoryPrompt?: string | null,
    enableRecommendations?: boolean,
    languageCode?: string,
    /**
     * Who the debrief note is being written to, and what this scenario
     * expects of them. Grouped into one object because this signature is
     * already six positional arguments deep, and these always travel
     * together.
     */
    supervisorContext?: {
      workerType?: WorkerType | null;
      learnerName?: string | null;
      supervisorMemory?: string | null;
      helpfulBehaviours?: string[];
      unhelpfulBehaviours?: string[];
      /**
       * Coaching hints the supervisor already gave the learner DURING this
       * session (live supervisor notes, in the order they were sent). Empty for
       * the common case — the per-scenario toggle is off by default.
       */
      liveNotes?: string[] | null;
    },
  ): Promise<ScenarioEvaluationResponse> {
    try {
      const prompts = await this.getPromptOverrides();
      const request: ScenarioEvaluationRequest = {
        chat_history: messages,
        need_memory: needMemory,
        previous_memory: previousMemory ?? null,
        memory_prompt: memoryPrompt ?? null,
        prompts,
        enable_recommendations: enableRecommendations ?? false,
        language_code: languageCode ?? null,
        worker_type: supervisorContext?.workerType ?? null,
        learner_name: supervisorContext?.learnerName ?? null,
        supervisor_memory: supervisorContext?.supervisorMemory ?? null,
        helpful_behaviours: supervisorContext?.helpfulBehaviours,
        unhelpful_behaviours: supervisorContext?.unhelpfulBehaviours,
        live_notes: supervisorContext?.liveNotes?.length
          ? supervisorContext.liveNotes
          : null,
      };

      const response = await this.makeRequest<
        ScenarioEvaluationResponse,
        ScenarioEvaluationRequest
      >(ENDPOINTS.SCENARIO_EVALUATION, request, true, 'post');
      this.logger.debug(
        `Scenario session evaluation received: ${JSON.stringify(response)}`,
      );
      return response;
    } catch (error) {
      this.logger.error(`AI Service Error: ${error.message}`);
      throw new Error('AI scenario session evaluation request failed');
    }
  }

  /**
   * Fetches prompt overrides from DB that have the ALLY_AI_PROMPT_PREFIX.
   * Maps 'ally_ai_folder_file' -> 'folder/file' for ally-ai consumption.
   */
  private async getPromptOverrides(): Promise<
    Record<
      string,
      {
        prompt: string;
        availableVariables?: (
          | string
          | { name: string; label?: string; required?: boolean }
        )[];
        provider?: string;
        model?: string;
        temperature?: number;
      }
    >
  > {
    try {
      const prompts = await this.promptSharedService.getPromptsByOptions({
        promptCodePrefix: ALLY_AI_PROMPT_PREFIX,
        useDashboardOverrideOnly: true,
      });

      const overrides: Record<
        string,
        {
          prompt: string;
          availableVariables?: (
            | string
            | { name: string; label?: string; required?: boolean }
          )[];
          provider?: string;
          model?: string;
          temperature?: number;
        }
      > = {};
      for (const p of prompts) {
        // Skip if it actually belongs to ally-ai-learn
        if (p.promptCode.startsWith(ALLY_AI_LEARN_PROMPT_PREFIX)) {
          continue;
        }

        // Strip prefix 'ally_ai_'
        const rawCode = p.promptCode.slice(ALLY_AI_PROMPT_PREFIX.length);
        /**
         * Replace underscores with slashes to match ally-ai's folder structure.
         * Example: 'summary_summary' -> 'summary/summary'
         * Example: 'user_identify_user' -> 'user/identify_user'
         * We use a global replace with /_/g to handle nested structures if any.
         */
        const mappedKey = rawCode.replace(/_/g, '/');
        overrides[mappedKey] = {
          prompt: p.prompt,
          availableVariables: p.availableVariables || [],
          // Prompt-level LLM overrides (honored by ally-ai's text-gen / drift
          // judge). Omitted when unset so the runtime keeps its defaults.
          ...(p.provider ? { provider: p.provider } : {}),
          ...(p.model ? { model: p.model } : {}),
          ...(p.temperature != null ? { temperature: p.temperature } : {}),
        };
      }
      return overrides;
    } catch (error) {
      this.logger.error(`Failed to fetch prompt overrides: ${error.message}`);
      return {};
    }
  }

  /**
   * Fire-and-forget: tell ally-ai-learn to start an AI simulated learner for a
   * V2V test session.  The tester bot joins the LiveKit room as a participant
   * and plays the user/learner role using a cheap LLM + TTS.
   */
  async startV2VTester(params: {
    roomName: string;
    testerToken: string;
    maxExchanges: number;
    language: string;
    scenarioTitle: string;
    scenarioContext: string;
    scenarioSessionId: string;
    counselorId: number;
  }): Promise<void> {
    await this.makeRequest<void, typeof params>(
      'api/v1/v2v-tester/start',
      params,
      true,
      'post',
      undefined,
      true, // isLearnService — routes to ally-ai-learn
    );
  }
}
