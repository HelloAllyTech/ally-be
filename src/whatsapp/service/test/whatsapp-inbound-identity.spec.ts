import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiService } from '../../../ai/service/ai.service';
import { PromptSharedService } from '../../../prompt/service/prompt-shared.service';
import { WaContact } from '../../entity/wa-contact.entity';
import { WaConversation } from '../../entity/wa-conversation.entity';
import { WaMessage } from '../../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../../entity/wa-unanswered-question.entity';
import {
  WaConsentStatus,
  WaHandledBy,
  WaTemplateKind,
} from '../../enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../type/whatsapp-settings.type';
import { WHATSAPP_PROVIDER } from '../../type/whatsapp-provider.interface';
import { WhatsAppIdentityService } from '../whatsapp-identity.service';
import { WhatsAppInboundService } from '../whatsapp-inbound.service';
import { WhatsAppRateLimitService } from '../whatsapp-rate-limit.service';
import { WhatsAppSettingsService } from '../whatsapp-settings.service';
import { WhatsAppTemplateService } from '../whatsapp-template.service';

const INBOUND_ID = 'inbound-1';
const TENANT_A = '11111111-1111-1111-1111-111111111111';

/**
 * The identity gate.
 *
 * Documents are targeted per organisation, so a contact whose organisation cannot be resolved has
 * no corpus to be answered from. WHERE that refusal sits in the pipeline is the whole design:
 * below opt-out and the keyword templates, and running the crisis classifier itself before it
 * refuses. Every test here pins one of those orderings, because getting any of them wrong turns a
 * safety net off for exactly the people we know least about.
 */
describe('WhatsAppInboundService identity gate', () => {
  let service: WhatsAppInboundService;
  let provider: { sendText: jest.Mock };
  let aiService: {
    answerKnowledgeQuestion: jest.Mock;
    checkWhatsAppCrisis: jest.Mock;
  };
  let identityService: { identify: jest.Mock };
  let templateService: { match: jest.Mock; findByKind: jest.Mock };
  let contact: Partial<WaContact>;
  let savedMessages: Record<string, unknown>[];

  const inbound = (text = 'how do I ask about intent?') => ({
    providerMessageId: 'wamid.1',
    from: '919876543210',
    text,
    isUnsupportedMedia: false,
    timestamp: new Date(),
  });

  /** The reply body actually sent, or undefined if nothing went out. */
  const sentBody = () =>
    provider.sendText.mock.calls[0]?.[1] as string | undefined;

  /** How the outbound row was classified. */
  const handledBy = () =>
    savedMessages.find((m) => m.direction === 'outbound')?.handledBy;

  beforeEach(async () => {
    savedMessages = [];
    contact = {
      id: 'contact-1',
      phoneE164: '919876543210',
      phoneLast4: '3210',
      consentStatus: WaConsentStatus.GRANTED,
      messageCount: 3,
      tenantId: null,
    };

    provider = {
      sendText: jest.fn().mockResolvedValue({ providerMessageId: 'wamid.out' }),
    };
    aiService = {
      answerKnowledgeQuestion: jest.fn(),
      checkWhatsAppCrisis: jest
        .fn()
        .mockResolvedValue({ is_crisis: false, confidence: 0, signal: '' }),
    };
    identityService = {
      identify: jest.fn(async (c: WaContact) => c),
    };
    templateService = {
      match: jest.fn().mockResolvedValue(null),
      // Consulted by the opt-out/consent step for its wording.
      findByKind: jest.fn().mockResolvedValue([]),
    };

    const messageRepository = {
      createQueryBuilder: () => ({
        insert: () => ({
          into: () => ({
            values: () => ({
              orIgnore: () => ({
                returning: () => ({
                  execute: async () => ({ raw: [{ id: INBOUND_ID }] }),
                }),
              }),
            }),
          }),
        }),
      }),
      create: (row: Record<string, unknown>) => row,
      save: async (row: Record<string, unknown>) => {
        savedMessages.push(row);
        return { ...row, id: 'outbound-1' };
      },
      update: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };

    const conversationRepository = {
      createQueryBuilder: () => ({
        where: () => ({
          andWhere: () => ({
            orderBy: () => ({
              getOne: async () => ({ id: 'conv-1', messageCount: 1 }),
            }),
          }),
        }),
      }),
      create: (row: Record<string, unknown>) => row,
      save: async (row: Record<string, unknown>) => ({ ...row, id: 'conv-1' }),
      update: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppInboundService,
        {
          provide: getRepositoryToken(WaContact),
          useValue: {
            findOne: async () => contact,
            update: jest.fn().mockResolvedValue(undefined),
            create: (row: Record<string, unknown>) => row,
            save: async (row: Record<string, unknown>) => row,
          },
        },
        {
          provide: getRepositoryToken(WaConversation),
          useValue: conversationRepository,
        },
        { provide: getRepositoryToken(WaMessage), useValue: messageRepository },
        {
          provide: getRepositoryToken(WaUnansweredQuestion),
          useValue: {
            save: jest.fn(),
            create: (row: Record<string, unknown>) => row,
          },
        },
        { provide: WHATSAPP_PROVIDER, useValue: provider },
        {
          provide: WhatsAppSettingsService,
          useValue: {
            get: async () => ({ ...DEFAULT_WHATSAPP_SETTINGS, enabled: true }),
            renderPlaceholders: (text: string) => text,
          },
        },
        { provide: WhatsAppTemplateService, useValue: templateService },
        {
          provide: WhatsAppRateLimitService,
          useValue: {
            check: async () => ({ allowed: true }),
            shouldNotify: async () => false,
          },
        },
        { provide: WhatsAppIdentityService, useValue: identityService },
        { provide: AiService, useValue: aiService },
        {
          provide: PromptSharedService,
          useValue: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(WhatsAppInboundService);
  });

  it('refuses to answer a contact whose organisation cannot be resolved', async () => {
    await service.handle(inbound());

    expect(aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
    expect(sentBody()).toBe(DEFAULT_WHATSAPP_SETTINGS.unrecognisedNumberText);
  });

  it('counts the refusal as UNIDENTIFIED, not DECLINED', async () => {
    // The two look identical on a usage chart and have opposite fixes: DECLINED means the corpus
    // is thin, UNIDENTIFIED means a real worker cannot get in.
    await service.handle(inbound());

    expect(handledBy()).toBe(WaHandledBy.UNIDENTIFIED);
  });

  it('runs the crisis classifier BEFORE refusing an unrecognised number', async () => {
    // Someone in danger is not less in danger for being unrecognised. Skipping the second
    // safety layer here would remove it for precisely the population we know least about.
    aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: true,
      confidence: 0.9,
      signal: 'I want to end my life',
    });

    await service.handle(inbound('I want to end my life'));

    expect(sentBody()).toBe(DEFAULT_WHATSAPP_SETTINGS.crisisEscalationText);
    expect(handledBy()).toBe(WaHandledBy.CRISIS);
  });

  it('still refuses when the crisis classifier is down', async () => {
    // A classifier outage must not turn "we cannot recognise you" into no reply at all.
    aiService.checkWhatsAppCrisis.mockRejectedValue(new Error('ally-ai down'));

    await service.handle(inbound());

    expect(sentBody()).toBe(DEFAULT_WHATSAPP_SETTINGS.unrecognisedNumberText);
    expect(handledBy()).toBe(WaHandledBy.UNIDENTIFIED);
  });

  it('lets a crisis KEYWORD through before identity is even considered', async () => {
    // Template matching is step 6, identity is step 7. A crisis reply must never depend on
    // whether we could work out who was asking.
    templateService.match.mockResolvedValue({
      bypassRag: true,
      template: {
        id: 'tpl-1',
        kind: WaTemplateKind.CRISIS,
        responseText: 'Please contact a crisis line now.',
      },
    });

    await service.handle(inbound('I want to hurt myself'));

    expect(identityService.identify).not.toHaveBeenCalled();
    expect(handledBy()).toBe(WaHandledBy.CRISIS);
  });

  it('honours STOP from an unrecognised number', async () => {
    // Opting out is a compliance obligation and cannot be gated on being recognised. Step 5
    // handles it, three steps above the identity gate.
    await service.handle(inbound('STOP'));

    expect(identityService.identify).not.toHaveBeenCalled();
    expect(aiService.answerKnowledgeQuestion).not.toHaveBeenCalled();
    expect(sentBody()).toContain('You will not receive any more messages');
  });

  it('scopes retrieval to the resolved organisation', async () => {
    identityService.identify.mockResolvedValue({
      ...contact,
      tenantId: TENANT_A,
    });
    aiService.answerKnowledgeQuestion.mockResolvedValue({
      intent: 'answer',
      answer: 'Ask directly about intent.',
      language: 'en',
      confidence: 0.8,
      citations: [],
      decline_reason: 'none',
      retrieval: {},
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      prompt_version: 'v1',
    });

    await service.handle(inbound());

    // Sent explicitly rather than left to a default: ally-ai refuses a request with no audience,
    // which is what stops "we forgot to scope the corpus" from ever being silent.
    expect(aiService.answerKnowledgeQuestion.mock.calls[0][0].audience).toEqual(
      { tenant_id: TENANT_A, include_global: true },
    );
  });
});
