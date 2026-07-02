import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import {
  Chat,
  ChatStatus,
  ChatSummaryStatus,
} from '../../../chat/entity/chat.entity';
import { CallDetails } from '../../../chat/entity/call.details.entity';
import { Message, MessageType } from '../../../chat/entity/message.entity';
import {
  CustomFieldDefinition,
  CustomFieldType,
  CustomFieldEditPermission,
  CustomFieldFillMode,
  CustomFieldScope,
  SingleSelectOption,
} from '../../../custom-fields/entity/custom-field-definition.entity';
import { ChatCustomFieldValue } from '../../../custom-fields/entity/chat-custom-field-value.entity';
import { Preference } from '../../../settings/entity/preference.entity';
import {
  PreferenceName,
  PreferenceRelatedEntity,
  ANONYMOUS_CLIENT_ID,
} from '../../../common/constants/user.constants';
import {
  AudioChatProvider,
  ScribeSessionMode,
} from '../../../common/constants/chat.constants';
import { User } from '../../../user/entity/user.entity';
import { getRepo, log } from '../helpers';
import { TENANT_CODE } from '../config';

// Mirrors CryptoService's AES-256-GCM scheme (src/common/service/crypto.service.ts)
// so seeded `sessionSummary` values decrypt correctly through the normal read
// path instead of being silently blanked out by the decrypt failure fallback.
function encryptSessionSummary(plainText: string): string {
  const keyHex = process.env.PHI_DATA_ENCRYPTION_KEY;
  if (!keyHex) return plainText;
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

interface ScribeCallFixture {
  externalId: string;
  startedMinutesAgo: number;
  durationSeconds: number;
  transcript: Array<{ from: 'counselor' | 'client'; content: string }>;
  summary: {
    sessionSummary: string;
    keyConcerns: string;
    callQuality: number;
    tags: string[];
  };
  customValues: { sessionNo: string; followUp: 'yes' | 'no'; aiTheme?: string };
}

// Three calls for the same seeded client, spread over ~9 days, so the
// counsellor's Scribe Logs page has a believable session history to test
// against (custom fields, transcript tab, summary editing, etc.).
const SCRIBE_CALLS: ScribeCallFixture[] = [
  {
    externalId: 'seed-scribe-call-1',
    startedMinutesAgo: 60 * 24 * 9,
    durationSeconds: 620,
    transcript: [
      {
        from: 'counselor',
        content:
          "Hi, thanks for calling in today. Before we start, I want to let you know this call may be recorded for quality and training, and everything you share stays confidential except where there's a safety concern.",
      },
      { from: 'client', content: "Okay, that's fine." },
      {
        from: 'counselor',
        content: "Great. So, what's been on your mind lately?",
      },
      {
        from: 'client',
        content:
          "I've been feeling really anxious about work. My manager keeps piling on tasks and I don't know how to say no.",
      },
      {
        from: 'counselor',
        content:
          "That sounds really overwhelming. Let's talk through what's making it hard to say no.",
      },
      {
        from: 'client',
        content: "I guess I'm scared of being seen as not a team player.",
      },
      {
        from: 'counselor',
        content:
          "That's a really common fear. Let's work on a few ways you could set a boundary without it feeling confrontational.",
      },
    ],
    summary: {
      sessionSummary:
        'Client reported work-related anxiety stemming from difficulty setting boundaries with their manager. Explored underlying fear of being perceived as uncooperative. Introduced assertive communication techniques for boundary-setting.',
      keyConcerns: 'Work-related anxiety, difficulty setting boundaries',
      callQuality: 4,
      tags: ['Anxiety', 'Work Stress'],
    },
    customValues: { sessionNo: '1', followUp: 'yes' },
  },
  {
    externalId: 'seed-scribe-call-2',
    startedMinutesAgo: 60 * 24 * 2,
    durationSeconds: 845,
    transcript: [
      {
        from: 'counselor',
        content:
          'Welcome back. Last time we talked about setting boundaries at work — how did that go?',
      },
      {
        from: 'client',
        content:
          'A bit better, actually. I said no to one extra project and nothing bad happened.',
      },
      {
        from: 'counselor',
        content: "That's great progress. How did it feel afterward?",
      },
      { from: 'client', content: 'Relieved, but also a little guilty.' },
      {
        from: 'counselor',
        content:
          "That guilt is really common when you're first practicing this. Let's talk about where that guilt might be coming from.",
      },
      {
        from: 'client',
        content:
          'I think it comes from always being the one who says yes to everything, even at home.',
      },
      {
        from: 'counselor',
        content:
          'It sounds like this pattern shows up in more than one part of your life. We can explore that further next time too.',
      },
    ],
    summary: {
      sessionSummary:
        'Follow-up session. Client successfully practiced a boundary-setting technique at work and reported feeling relieved but guilty afterward. Discussed the guilt pattern extending beyond work into home life. Agreed to continue exploring this pattern.',
      keyConcerns: 'Guilt around boundary-setting, people-pleasing pattern',
      callQuality: 5,
      tags: ['Anxiety', 'Boundaries'],
    },
    customValues: {
      sessionNo: '2',
      followUp: 'yes',
      aiTheme: 'Boundary-setting and guilt',
    },
  },
  {
    externalId: 'seed-scribe-call-3',
    startedMinutesAgo: 45,
    durationSeconds: 512,
    transcript: [
      {
        from: 'counselor',
        content:
          'Hi, good to hear from you again. How have things been since we last spoke?',
      },
      {
        from: 'client',
        content: "Pretty good. I've been sleeping better too.",
      },
      {
        from: 'counselor',
        content:
          "That's wonderful to hear. What do you think has helped with the sleep?",
      },
      {
        from: 'client',
        content: 'I think worrying less about work has helped a lot.',
      },
      {
        from: 'counselor',
        content:
          'It sounds like the boundary work is paying off across different areas of your life.',
      },
    ],
    summary: {
      sessionSummary:
        'Client reports continued improvement, including better sleep, which they attribute to reduced work-related worry. Positive trajectory since introducing boundary-setting strategies.',
      keyConcerns: 'Sleep, ongoing anxiety management',
      callQuality: 5,
      tags: ['Progress Check-in'],
    },
    customValues: { sessionNo: '3', followUp: 'no' },
  },
];

interface CustomFieldFixture {
  name: string;
  fieldType: CustomFieldType;
  sectionKey: string;
  fillMode: CustomFieldFillMode;
  options?: SingleSelectOption[];
}

// sectionKey must match ally-web's OWN SummarySectionKey vocabulary
// (apps/ally-helpline-dashboard/src/pages/post-call-summary/types.ts —
// "featuresAndDemographics", "sessionSummary", etc.), not the backend's
// SUMMARY_SECTIONS constant ids ("other", "session", ...). The admin "create
// custom field" form populates its Section dropdown from the frontend's own
// getSummarySections(), so that's the id space CallSummary.tsx's accordion
// keys actually live in — the backend never validates sectionKey against its
// own constant, so a value from the wrong vocabulary silently never matches
// any section and the field renders nowhere.
//
// Covers a MANUAL number field (the "Session No" field from the value-drift
// bug report), a MANUAL single-select, and an AI-fill field — enough surface
// to exercise the manual-edit path, the option-based rendering path, and the
// AI-regeneration overwrite path in one seed.
const CUSTOM_FIELD_DEFINITIONS: CustomFieldFixture[] = [
  {
    name: 'Session No',
    fieldType: CustomFieldType.NUMBER,
    sectionKey: 'sessionSummary',
    fillMode: CustomFieldFillMode.MANUAL,
  },
  {
    name: 'Follow-up Required',
    fieldType: CustomFieldType.SINGLE_SELECT,
    sectionKey: 'sessionSummary',
    fillMode: CustomFieldFillMode.MANUAL,
    options: [
      { id: 'yes', label: 'Yes', order: 0 },
      { id: 'no', label: 'No', order: 1 },
    ],
  },
  {
    name: 'AI Session Theme',
    fieldType: CustomFieldType.TEXT,
    sectionKey: 'keyConcerns',
    fillMode: CustomFieldFillMode.AI,
  },
];

export async function seedScribeData(
  ds: DataSource,
  adminId: number,
  tenantUuid: string,
): Promise<void> {
  const userRepo = getRepo(ds, User);
  const chatRepo = getRepo(ds, Chat);
  const callDetailsRepo = getRepo(ds, CallDetails);
  const messageRepo = getRepo(ds, Message);
  const definitionRepo = getRepo(ds, CustomFieldDefinition);
  const valueRepo = getRepo(ds, ChatCustomFieldValue);
  const preferenceRepo = getRepo(ds, Preference);

  const counselor = await userRepo.findOne({
    where: { email: 'learner@example.com' },
  });
  if (!counselor) {
    log('learner@example.com missing — skipping scribe seed');
    return;
  }

  // Scribe note creation + custom fields are both feature-flagged off by
  // default (no Preference row = disabled) — turn them on for local dev.
  //
  // Preference.relatedId is keyed by tenant CODE — settings.service.ts
  // resolves any UUID back to the code before querying (resolveTenantCode).
  // Every other table below (Chat, CallDetails, Message,
  // CustomFieldDefinition, ChatCustomFieldValue) is instead scoped by the
  // tenant UUID: ExecutionManager.getTenantId() returns the JWT's `tenantId`
  // claim verbatim (see auth/strategies/jwt.strategy.ts), which is the UUID,
  // and those modules use it unresolved. Mixing the two up means the seeded
  // rows silently never match what a real request looks up.
  let preferencesCreated = 0;
  for (const name of [
    PreferenceName.CUSTOM_FIELDS_ENABLED,
    PreferenceName.SCRIBE_NOTE_CREATION_ENABLED,
  ]) {
    const existing = await preferenceRepo.findOne({
      where: {
        name,
        relatedId: TENANT_CODE,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
      },
    });
    if (existing) continue;
    await preferenceRepo.save(
      preferenceRepo.create({
        name,
        relatedId: TENANT_CODE,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { enabled: true },
        tenantId: tenantUuid,
      }),
    );
    preferencesCreated++;
  }

  const definitionByName = new Map<string, CustomFieldDefinition>();
  let definitionsCreated = 0;
  for (const fixture of CUSTOM_FIELD_DEFINITIONS) {
    const existing = await definitionRepo.findOne({
      where: { tenantId: tenantUuid, name: fixture.name },
    });
    if (existing) {
      definitionByName.set(fixture.name, existing);
      continue;
    }
    const created = await definitionRepo.save(
      definitionRepo.create({
        name: fixture.name,
        fieldType: fixture.fieldType,
        sectionKey: fixture.sectionKey,
        options: fixture.options,
        editPermission: CustomFieldEditPermission.BOTH,
        fillMode: fixture.fillMode,
        scope: CustomFieldScope.ORG_ADMIN,
        tenantId: tenantUuid,
        createdBy: adminId,
        updatedBy: adminId,
      }),
    );
    definitionByName.set(fixture.name, created);
    definitionsCreated++;
  }

  let chatsCreated = 0;
  let chatsExisting = 0;
  let messageCount = 0;
  let valueCount = 0;

  for (const fixture of SCRIBE_CALLS) {
    const existing = await chatRepo.findOne({
      where: { externalId: fixture.externalId },
    });
    if (existing) {
      chatsExisting++;
      continue;
    }

    const startedAt = new Date(
      Date.now() - fixture.startedMinutesAgo * 60 * 1000,
    );
    const endedAt = new Date(
      startedAt.getTime() + fixture.durationSeconds * 1000,
    );

    const chat = await chatRepo.save(
      chatRepo.create({
        clientId: ANONYMOUS_CLIENT_ID,
        counselorId: counselor.id,
        status: ChatStatus.ENDED,
        summaryStatus: ChatSummaryStatus.SUCCESS,
        startedAt,
        endedAt,
        externalId: fixture.externalId,
        tenantId: tenantUuid,
      }),
    );

    for (const turn of fixture.transcript) {
      await messageRepo.save(
        messageRepo.create({
          chatId: chat.id,
          senderId:
            turn.from === 'counselor' ? counselor.id : ANONYMOUS_CLIENT_ID,
          type: MessageType.TEXT,
          content: turn.content,
          tenantId: tenantUuid,
        }),
      );
      messageCount++;
    }

    await callDetailsRepo.save(
      callDetailsRepo.create({
        chatId: chat.id,
        callDuration: fixture.durationSeconds,
        startTime: startedAt,
        endTime: endedAt,
        summary: {
          sessionSummary: encryptSessionSummary(fixture.summary.sessionSummary),
          keyConcerns: fixture.summary.keyConcerns,
          callQuality: fixture.summary.callQuality,
          tags: fixture.summary.tags.map((tag) => ({ tag })),
          mode: ScribeSessionMode.SCRIBE,
        } as CallDetails['summary'],
        callInfo: {
          provider: AudioChatProvider.WEBRTC,
          mode: ScribeSessionMode.SCRIBE,
          notes: '',
        } as CallDetails['callInfo'],
        tenantId: tenantUuid,
      }),
    );

    const sessionNoDef = definitionByName.get('Session No');
    const followUpDef = definitionByName.get('Follow-up Required');
    const aiThemeDef = definitionByName.get('AI Session Theme');

    if (sessionNoDef) {
      await valueRepo.save(
        valueRepo.create({
          chatId: chat.id,
          fieldDefinitionId: sessionNoDef.id,
          value: fixture.customValues.sessionNo,
          updatedBy: counselor.id,
          tenantId: tenantUuid,
        }),
      );
      valueCount++;
    }
    if (followUpDef) {
      await valueRepo.save(
        valueRepo.create({
          chatId: chat.id,
          fieldDefinitionId: followUpDef.id,
          value: fixture.customValues.followUp,
          updatedBy: counselor.id,
          tenantId: tenantUuid,
        }),
      );
      valueCount++;
    }
    if (aiThemeDef && fixture.customValues.aiTheme) {
      await valueRepo.save(
        valueRepo.create({
          chatId: chat.id,
          fieldDefinitionId: aiThemeDef.id,
          value: fixture.customValues.aiTheme,
          updatedBy: 0, // 0 = system/AI, matching upsertValuesInternal's convention
          tenantId: tenantUuid,
        }),
      );
      valueCount++;
    }

    chatsCreated++;
  }

  log(
    `scribe: ${definitionsCreated} custom field definition(s) created, ` +
      `${preferencesCreated} preference(s) created, ` +
      `${chatsCreated} chat(s) created (${chatsExisting} already existed), ` +
      `${messageCount} messages, ${valueCount} custom field values`,
  );
}
