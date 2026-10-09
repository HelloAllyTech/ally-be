import {
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import axios from 'axios';
import { AiService } from '../ai.service';
import { PromptSharedService } from '../../../prompt/service/prompt-shared.service';
import { SkillExperimentRouterService } from '../../../skill-experiment/service/skill-experiment-router.service';
import { AppConfigService } from '../../../config/config.service';
import { LoggerService } from '../../../logger/logger.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';

// Mock external dependencies
jest.mock('axios');

const mockedAxios = axios as any;

describe('AiService', () => {
  let service: AiService;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let mockLogger: jest.Mocked<LoggerService>;
  let mockPromptSharedService: jest.Mocked<PromptSharedService>;
  let mockSkillExperiments: {
    assign: jest.Mock;
    record: jest.Mock;
  };

  const mockConfig = {
    ai: {
      apiUrl: 'https://test-ai-api.com',
      outboundApiKey: 'test-outbound-api-key',
    },
  };

  beforeEach(async () => {
    // Mock LoggerService
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    jest.spyOn(LoggerService, 'getInstance').mockReturnValue(mockLogger);

    const mockConfigService = {
      ai: mockConfig.ai,
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };
    mockPromptSharedService = {
      getPromptsByOptions: jest.fn().mockResolvedValue([]),
    } as any;
    // No experiment is live unless a test says otherwise.
    mockSkillExperiments = {
      assign: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: PromptSharedService,
          useValue: mockPromptSharedService,
        },
        {
          provide: SkillExperimentRouterService,
          useValue: mockSkillExperiments,
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should set logger instance', () => {
      expect(LoggerService.getInstance).toHaveBeenCalledWith('AiService');
    });
  });

  describe('transcribeAudioFromBuffer', () => {
    it('should transcribe audio from buffer successfully', async () => {
      const mockBuffer = Buffer.from('audio data');
      const mockResponse = { data: { text: 'Transcribed text' } };

      mockedAxios.mockResolvedValue(mockResponse);

      const result = await service.transcribeAudioFromBuffer(mockBuffer);

      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          url: `${mockConfig.ai.apiUrl}/transcribe`,
          method: 'post',
          data: mockBuffer,
          headers: expect.objectContaining({ 'Content-Type': 'audio/webm' }),
        }),
      );
      expect(result).toBe('Transcribed text');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Transcription received: Transcribed text',
      );
    });

    it('should handle transcription error', async () => {
      const mockBuffer = Buffer.from('audio data');
      const error = new Error('Transcription failed');

      mockedAxios.mockRejectedValue(error);

      await expect(
        service.transcribeAudioFromBuffer(mockBuffer),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('errMsg=Transcription failed'),
        expect.anything(),
      );
    });
  });

  describe('getNudge', () => {
    const mockChatHistory = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    it('should get nudge successfully', async () => {
      const mockResponse = { data: { nudge: 'Test nudge', confidence: 0.8 } };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const result = await service.getNudge('New message', mockChatHistory);

      expect(mockedAxios).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.data);
    });

    it('should return early when apiUrl is not configured', async () => {
      const serviceWithoutUrl = new AiService(
        { ai: { ...mockConfig.ai, apiUrl: '' } } as any,
        eventEmitter,
        mockPromptSharedService,
        mockSkillExperiments as any,
      );

      const result = await serviceWithoutUrl.getNudge(
        'New message',
        mockChatHistory,
      );

      expect(result).toBeUndefined();
      expect(mockedAxios).not.toHaveBeenCalled();
    });

    it('should fail loudly on a nudge request error, not return a false-success empty object', async () => {
      // Previously this swallowed the failure and resolved {} — indistinguishable
      // from "no nudge needed" on the wire. Fixed to fail loudly like enhance().
      const error = new Error('Nudge failed');
      (mockedAxios as any).mockRejectedValue(error);

      await expect(
        service.getNudge('New message', mockChatHistory),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('AI Request FAIL'),
        expect.anything(),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('errMsg=Nudge failed'),
        expect.anything(),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'exception',
        expect.objectContaining({
          type: 'AI Request Error',
        }),
      );
    });
  });

  describe('getScenarioSessionEvaluation', () => {
    const mockMessages = [
      { id: '1', role: 'COUNSELOR', content: 'Hello' },
    ] as any;

    it('should set language_code on the ScenarioEvaluationRequest when languageCode is provided', async () => {
      (mockedAxios as any).mockResolvedValue({ data: {} });

      await service.getScenarioSessionEvaluation(
        mockMessages,
        false,
        null,
        undefined,
        true,
        'hi',
      );

      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            language_code: 'hi',
            enable_recommendations: true,
          }),
        }),
      );
    });

    it('should default language_code to null when languageCode is omitted', async () => {
      (mockedAxios as any).mockResolvedValue({ data: {} });

      await service.getScenarioSessionEvaluation(mockMessages, false, null);

      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            language_code: null,
          }),
        }),
      );
    });

    it('sends usage_task only when a caller labels the call', async () => {
      (mockedAxios as any).mockResolvedValue({ data: {} });

      await service.getScenarioSessionEvaluation(
        mockMessages,
        false,
        null,
        undefined,
        false,
        'ta',
        undefined,
        'sess-1',
        LlmTask.SCENARIO_EVALUATION_LANGUAGE,
      );
      const labelled = (mockedAxios as any).mock.calls.at(-1)[0].data;
      expect(labelled.usage_task).toBe('scenario_evaluation_language');
      expect(labelled.scenario_session_id).toBe('sess-1');

      // The default path's body must not change: no key at all, not null.
      await service.getScenarioSessionEvaluation(
        mockMessages,
        true,
        null,
        undefined,
        false,
        'en',
        undefined,
        'sess-1',
      );
      const plain = (mockedAxios as any).mock.calls.at(-1)[0].data;
      expect('usage_task' in plain).toBe(false);
      expect(plain.scenario_session_id).toBe('sess-1');

      // ally-ai 422s on any value outside its closed set, which would fail the
      // debrief — so nothing but the one literal can ever be sent.
      await service.getScenarioSessionEvaluation(
        mockMessages,
        false,
        null,
        undefined,
        false,
        'ta',
        undefined,
        'sess-1',
        'something_else' as any,
      );
      const stray = (mockedAxios as any).mock.calls.at(-1)[0].data;
      expect('usage_task' in stray).toBe(false);
    });
  });

  describe('getScenarioSessionEvaluation under a skill experiment', () => {
    const mockMessages = [
      { id: '1', role: 'COUNSELOR', content: 'Hello' },
      { id: '2', role: 'CLIENT', content: 'Hi' },
    ] as any;
    const CODE = 'ally_ai_scenario_scenario_evaluation';
    const arm = (isOriginal: boolean) => ({
      experimentId: 'exp-1',
      variantId: isOriginal ? 'v-0' : 'v-1',
      promptCode: CODE,
      content: isOriginal
        ? 'ORIGINAL {chat_history}'
        : 'VARIANT {chat_history}',
      isOriginal,
      record: true,
    });

    it('sends the arm text under the key ally-ai reads and records the output', async () => {
      mockSkillExperiments.assign.mockResolvedValue(arm(false));
      mockPromptSharedService.getPromptsByOptions.mockResolvedValue([
        { promptCode: CODE, availableVariables: ['chat_history'] },
      ] as any);
      (mockedAxios as any).mockResolvedValue({ data: { summary: 'ok' } });

      const result = await service.getScenarioSessionEvaluation(
        mockMessages,
        false,
        null,
      );

      expect(mockSkillExperiments.assign).toHaveBeenCalledWith(CODE);
      const sent = (mockedAxios as any).mock.calls.at(-1)[0].data;
      expect(sent.prompts[CODE]).toEqual({
        prompt: 'VARIANT {chat_history}',
        availableVariables: ['chat_history'],
      });
      expect(result).toEqual({ summary: 'ok' });
      expect(mockSkillExperiments.record).toHaveBeenCalledWith(
        expect.objectContaining({ variantId: 'v-1' }),
        expect.objectContaining({
          output: JSON.stringify({ summary: 'ok' }),
          input: expect.objectContaining({
            transcript: 'COUNSELOR: Hello\nCLIENT: Hi',
          }),
        }),
      );
    });

    it('picks the with-memory skill when memory is needed', async () => {
      (mockedAxios as any).mockResolvedValue({ data: {} });
      await service.getScenarioSessionEvaluation(mockMessages, true, 'prev');
      expect(mockSkillExperiments.assign).toHaveBeenCalledWith(
        'ally_ai_scenario_scenario_evaluation_with_memory',
      );
    });

    it('never experiments on the per-language re-evaluation', async () => {
      (mockedAxios as any).mockResolvedValue({ data: {} });
      await service.getScenarioSessionEvaluation(
        mockMessages,
        false,
        null,
        undefined,
        false,
        'ta',
        undefined,
        'sess-1',
        LlmTask.SCENARIO_EVALUATION_LANGUAGE,
      );
      expect(mockSkillExperiments.assign).not.toHaveBeenCalled();
    });

    it('records a failed challenger and retries the debrief on the skill text', async () => {
      mockSkillExperiments.assign.mockResolvedValue(arm(false));
      (mockedAxios as any)
        .mockRejectedValueOnce(new Error('ally-ai 500'))
        .mockResolvedValueOnce({ data: { summary: 'fallback' } });

      const result = await service.getScenarioSessionEvaluation(
        mockMessages,
        false,
        null,
      );

      expect(result).toEqual({ summary: 'fallback' });
      expect(mockSkillExperiments.record).toHaveBeenCalledWith(
        expect.objectContaining({ variantId: 'v-1' }),
        expect.objectContaining({ error: expect.any(String) }),
      );
      const retry = (mockedAxios as any).mock.calls.at(-1)[0].data;
      expect(retry.prompts[CODE]).toBeUndefined();
    });

    it('does not retry when the original arm fails — that failure is the skill’s own', async () => {
      mockSkillExperiments.assign.mockResolvedValue(arm(true));
      (mockedAxios as any).mockRejectedValue(new Error('ally-ai 500'));

      await expect(
        service.getScenarioSessionEvaluation(mockMessages, false, null),
      ).rejects.toThrow();
      expect((mockedAxios as any).mock.calls).toHaveLength(1);
    });
  });

  describe('getPromptOverrides key for connected skills', () => {
    it('sends a connected skill under its full code as well as the legacy key, and leaves others alone', async () => {
      mockPromptSharedService.getPromptsByOptions.mockResolvedValue([
        { promptCode: 'ally_ai_scenario_scenario_evaluation', prompt: 'A' },
        { promptCode: 'ally_ai_summary_summary', prompt: 'B' },
      ] as any);

      const overrides = await (service as any).getPromptOverrides();

      expect(overrides['ally_ai_scenario_scenario_evaluation'].prompt).toBe(
        'A',
      );
      expect(overrides['scenario/scenario/evaluation'].prompt).toBe('A');
      expect(overrides['summary/summary'].prompt).toBe('B');
      expect(overrides['ally_ai_summary_summary']).toBeUndefined();
    });
  });

  describe('generateSummaryAndTags', () => {
    const mockMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    it('should generate summary and tags successfully', async () => {
      const mockResponse = {
        data: {
          summary: 'Generated summary',
          tags: ['greeting', 'conversation'],
          sentiment: 'positive',
        },
      };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const result = await service.generateSummaryAndTags(mockMessages);

      expect(mockedAxios).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.data);
    });

    it('should handle summary generation error gracefully', async () => {
      const error = new Error('Summary failed');
      (mockedAxios as any).mockRejectedValue(error);

      // This method catches errors and returns undefined
      const result = await service.generateSummaryAndTags(mockMessages);

      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('AI Service Error: Summary failed'),
      );
    });
  });

  describe('generateTagPositivityRatings', () => {
    const mockTags = ['positive', 'helpful', 'supportive'];

    it('should generate tag positivity ratings successfully', async () => {
      const mockResponse = {
        data: {
          ratings: { positive: 0.9, helpful: 0.8, supportive: 0.85 },
          overall_score: 0.85,
        },
      };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const result = await service.generateTagPositivityRatings(mockTags);

      expect(mockedAxios).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.data);
    });

    it('should handle tag rating error gracefully', async () => {
      const error = new Error('Tag rating failed');
      (mockedAxios as any).mockRejectedValue(error);

      // This method returns {} on error (doesn't throw)
      const result = await service.generateTagPositivityRatings(mockTags);

      expect(result).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('errMsg=Tag rating failed'),
        expect.anything(),
      );
    });
  });

  describe('addReferenceDocument', () => {
    const mockDocument = {
      document_id: 'doc-123',
      heading: 'Test Document',
      category: 'guide',
      content: 'Document content',
      tenant_id: 'tenant-1',
    };

    it('should add reference document successfully', async () => {
      const mockResponse = {
        data: {
          id: 'doc-123',
          status: 'created',
        },
      };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const result = await service.addReferenceDocument(mockDocument);

      expect(mockedAxios).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.data);
    });

    it('should handle add document error by throwing', async () => {
      const error = new Error('Add document failed');
      (mockedAxios as any).mockRejectedValue(error);

      // This method throws the error since throwError = true
      await expect(service.addReferenceDocument(mockDocument)).rejects.toThrow(
        'Add document failed',
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('errMsg=Add document failed'),
        expect.anything(),
      );
    });
  });

  describe('transcribeAudioAndSummarize', () => {
    const mockRequest = {
      presigned_url: 'https://example.com/audio.wav',
      chat_id: 123,
      sample_rate: 44100,
    };

    it('should transcribe and summarize audio successfully', async () => {
      const mockResponse = {
        data: {
          transcript: 'Transcribed text',
          summary: 'Summary text',
          confidence: 0.95,
        },
      };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const result = await service.transcribeAudioAndSummarize(mockRequest);

      expect(mockedAxios).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.data);
    });

    it('should handle transcribe and summarize error gracefully', async () => {
      const error = new Error('Transcribe and summarize failed');
      (mockedAxios as any).mockRejectedValue(error);

      // This method returns {} on error (doesn't throw)
      const result = await service.transcribeAudioAndSummarize(mockRequest);

      expect(result).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('errMsg=Transcribe and summarize failed'),
        expect.anything(),
      );
    });
  });

  describe('enhance', () => {
    const mockSummary = 'Original summary text';

    it('should enhance summary successfully', async () => {
      const mockResponse = {
        data: {
          enhanced_content: 'Enhanced summary text',
        },
      };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const result = await service.enhance(mockSummary);

      expect(mockedAxios).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.data);
    });

    it('should cap the request timeout well below the 5-minute default', async () => {
      (mockedAxios as any).mockResolvedValue({
        data: { enhanced_content: 'Enhanced summary text' },
      });

      await service.enhance(mockSummary);

      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 45_000 }),
      );
    });

    // The counsellor is waiting on the wand: a swallowed failure used to return
    // {} with a 200, so the button silently did nothing.
    it('should throw ServiceUnavailable when the AI service errors', async () => {
      const error = new Error('Enhance failed');
      (mockedAxios as any).mockRejectedValue(error);

      await expect(service.enhance(mockSummary)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('errMsg=Enhance failed'),
        expect.anything(),
      );
    });

    it('should throw ServiceUnavailable on a 200 with no enhanced_content', async () => {
      (mockedAxios as any).mockResolvedValue({ data: {} });

      await expect(service.enhance(mockSummary)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('enhance returned no enhanced_content'),
      );
    });
  });

  describe('makeRequest', () => {
    it('should redact request data in error logs when redactBody is true', async () => {
      jest.setTimeout(45000);
      const error = new Error('Test error');
      mockedAxios.mockRejectedValue(error);
      const requestData = {
        question: 'this is a sensitive question',
        session_id: '123',
        organisation_id: '456',
        audience: { include_global: true },
      };

      await expect(
        service.answerKnowledgeQuestion(requestData),
      ).rejects.toThrow();

      const failLogs = mockLogger.error.mock.calls.filter((call) =>
        call[0].includes('AI Request FAIL'),
      );
      expect(failLogs.length).toBeGreaterThan(0);

      const unredactedLogFound = failLogs.some((call) =>
        call[0].includes(requestData.question),
      );
      expect(unredactedLogFound).toBe(false);

      const redactedLogFound = failLogs.some((call) =>
        call[0].includes('redacted'),
      );
      expect(redactedLogFound).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      const networkError = { code: 'ENOTFOUND', message: 'Network error' };
      mockedAxios.mockRejectedValue(networkError);

      const mockBuffer = Buffer.from('audio data');
      await expect(
        service.transcribeAudioFromBuffer(mockBuffer),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('errMsg=Network error'),
        undefined,
      );
    });

    it('should handle timeout errors', async () => {
      const timeoutError = { code: 'ECONNABORTED', message: 'timeout' };
      mockedAxios.mockRejectedValue(timeoutError);

      const mockBuffer = Buffer.from('audio data');
      await expect(
        service.transcribeAudioFromBuffer(mockBuffer),
      ).rejects.toThrow(GatewayTimeoutException);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('errMsg=timeout'),
        undefined,
      );
    });

    it('should emit exception events for axios errors in makeRequest', async () => {
      const timeoutError = { code: 'ECONNABORTED', message: 'timeout' };
      (mockedAxios as any).mockRejectedValue(timeoutError);

      const mockMessages = [{ role: 'user', content: 'test' }];
      const result = await service.generateSummaryAndTags(mockMessages);

      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'exception',
        expect.objectContaining({
          type: 'AI Request Error',
          message: expect.stringContaining('timeout'),
        }),
      );
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle missing API URL', async () => {
      const serviceWithoutUrl = new AiService(
        { ai: { ...mockConfig.ai, apiUrl: '' } } as any,
        eventEmitter,
        mockPromptSharedService,
        mockSkillExperiments as any,
      );

      const mockChatHistory = [{ role: 'user', content: 'test' }];
      const result = await serviceWithoutUrl.getNudge('test', mockChatHistory);

      expect(result).toBeUndefined();
    });

    it('should handle missing outbound API key', async () => {
      const serviceWithoutKey = new AiService(
        { ai: { ...mockConfig.ai, outboundApiKey: '' } } as any,
        eventEmitter,
        mockPromptSharedService,
        mockSkillExperiments as any,
      );

      expect(serviceWithoutKey).toBeDefined();
    });
  });

  describe('Logging and Debugging', () => {
    it('should log requests and responses', async () => {
      const mockResponse = { data: { result: 'test' } };
      (mockedAxios as any).mockResolvedValue(mockResponse);

      const mockMessages = [{ role: 'user', content: 'test' }];
      await service.generateSummaryAndTags(mockMessages);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('AI Request BODY'),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('AI Response BODY'),
      );
    });

    it('should log errors with execution ID', async () => {
      const error = new Error('Test error');
      (mockedAxios as any).mockRejectedValue(error);

      const mockMessages = [{ role: 'user', content: 'test' }];
      await service.generateSummaryAndTags(mockMessages);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('AI Service Error: Test error'),
      );
    });
  });

  describe('scenario report trigger and cancel', () => {
    const request = {
      prompt: 'helper prompt',
      turns: 5,
      language: 'en',
      scenario_id: 10,
      report_id: 'report-uuid-1',
      metadata: {},
    } as any;

    it('treats any 2xx as started, including ai-learn reporting a duplicate report_id', async () => {
      mockedAxios.mockResolvedValue({
        status: 200,
        data: { report_id: 'report-uuid-1', status: 'already_running' },
      });

      await expect(
        service.triggerScenarioReportGenerate(request),
      ).resolves.toBeUndefined();
      expect(mockedAxios).toHaveBeenCalledTimes(1);
    });

    // Why ai-learn has to dedupe: when a first attempt's response is lost
    // after ai-learn accepted it, the retry asks for the same report again.
    it('resends the same report_id when it retries', async () => {
      mockedAxios
        .mockRejectedValueOnce(
          Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
        )
        .mockResolvedValueOnce({ status: 202, data: {} });

      await service.triggerScenarioReportGenerate(request);

      expect(mockedAxios).toHaveBeenCalledTimes(2);
      expect(mockedAxios.mock.calls[0][0].data.report_id).toBe('report-uuid-1');
      expect(mockedAxios.mock.calls[1][0].data.report_id).toBe('report-uuid-1');
    });

    it('sends cancel with a short timeout and never throws', async () => {
      mockedAxios.mockRejectedValue(
        Object.assign(new Error('timeout of 10000ms exceeded'), {
          code: 'ECONNABORTED',
        }),
      );

      await expect(
        service.triggerScenarioReportCancel('report-uuid-1'),
      ).resolves.toBeUndefined();
      expect(mockedAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'post',
          url: expect.stringContaining(
            'api/v1/scenario-report/cancel/report-uuid-1',
          ),
          timeout: 10_000,
        }),
      );
    });
  });
});
