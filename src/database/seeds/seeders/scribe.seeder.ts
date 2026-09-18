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
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { ScribeSessionReview } from '../../../scribe-session-review/entity/review.entity';
import { ScribeSessionReviewThread } from '../../../scribe-session-review/entity/thread.entity';
import { ScribeSessionReviewComment } from '../../../scribe-session-review/entity/comment.entity';
import { ScribeSessionReviewReaction } from '../../../scribe-session-review/entity/reaction.entity';
import { ScribeSessionReviewReadStatus } from '../../../scribe-session-review/entity/read-status.entity';
import { ReviewStatus } from '../../../review/type/review.type';
import { getRepo, log } from '../helpers';

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
  // Undefined means "still active" — no endedAt is stamped.
  durationSeconds?: number;
  transcript: Array<{ from: 'counselor' | 'client'; content: string }>;
  // Only ENDED + SUCCESS chats are shareable for review
  // (ChatSharedService.getCompletedChatById), so these three are deliberately
  // not the ones a scribe review fixture ever points at.
  chatStatus?: ChatStatus;
  summaryStatus?: ChatSummaryStatus;
  firstAttemptStatus?: ChatSummaryStatus;
  firstFailureStage?: string;
  // Undefined when summaryStatus isn't SUCCESS — no CallDetails.summary is
  // written, matching a call that was never (successfully) summarized.
  summary?: {
    sessionSummary: string;
    keyConcerns: string;
    callQuality: number;
    tags: string[];
  };
  customValues?: {
    sessionNo: string;
    followUp: 'yes' | 'no';
    aiTheme?: string;
  };
}

// Three calls for the same seeded client, spread over ~9 days, so the
// counsellor's Scribe Logs page has a believable session history to test
// against (custom fields, transcript tab, summary editing, etc.), plus a
// FAILED-summary call and a still-ACTIVE call so those chat/summary states
// aren't perpetually empty.
export const ALLY_SCRIBE_CALLS: ScribeCallFixture[] = [
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
  {
    externalId: 'seed-scribe-call-failed',
    startedMinutesAgo: 60 * 20,
    durationSeconds: 340,
    transcript: [
      {
        from: 'counselor',
        content: 'Hi, thanks for calling in — how have things been?',
      },
      { from: 'client', content: "It's been a rough week, honestly." },
    ],
    chatStatus: ChatStatus.ENDED,
    summaryStatus: ChatSummaryStatus.FAILED,
    firstAttemptStatus: ChatSummaryStatus.FAILED,
    firstFailureStage: 'transcribe',
    // No summary — the transcription step failed, so no CallDetails.summary
    // was ever produced. Exercises the "retry summary" UI state.
  },
  {
    externalId: 'seed-scribe-call-live',
    startedMinutesAgo: 6,
    transcript: [
      {
        from: 'counselor',
        content: "Hi, thanks for calling — what's on your mind today?",
      },
    ],
    chatStatus: ChatStatus.ACTIVE,
    summaryStatus: ChatSummaryStatus.PENDING,
    // No durationSeconds/summary/customValues — the call is still in
    // progress, so no endedAt and no CallDetails yet.
  },
];

// Two calls for Riverside Wellness Center's counselor, so
// yuki.tanaka@riversidewellness.io (SCRIBE_REVIEWER) has scribe content to
// review in her own tenant — the `ally`-only scribe seed left her tenant
// with zero scribe data.
export const RIVERSIDE_SCRIBE_CALLS: ScribeCallFixture[] = [
  {
    externalId: 'seed-scribe-call-rw-1',
    startedMinutesAgo: 60 * 24 * 5,
    durationSeconds: 730,
    transcript: [
      {
        from: 'counselor',
        content:
          "Hi, thanks for calling in today. What's been going on for you?",
      },
      {
        from: 'client',
        content:
          "I'm caring for my father full-time now and I'm completely burnt out.",
      },
      {
        from: 'counselor',
        content:
          "That's an enormous amount to carry. How long have you been his primary caregiver?",
      },
      {
        from: 'client',
        content:
          'About eight months. I love him, but I have not had a real break since this started.',
      },
      {
        from: 'counselor',
        content:
          "Caregiver burnout is real and it doesn't mean you love him any less. Let's talk about what support might look like.",
      },
    ],
    summary: {
      sessionSummary:
        'Client is the full-time caregiver for their father (8 months) and reports significant burnout with no respite. Normalized caregiver burnout and began exploring support options.',
      keyConcerns: 'Caregiver burnout, lack of respite',
      callQuality: 5,
      tags: ['Caregiver Stress'],
    },
    customValues: { sessionNo: '1', followUp: 'yes' },
  },
  {
    externalId: 'seed-scribe-call-rw-2',
    startedMinutesAgo: 60 * 24 * 1,
    durationSeconds: 540,
    transcript: [
      {
        from: 'counselor',
        content:
          'Welcome back. Last time we talked about finding respite support — how has that gone?',
      },
      {
        from: 'client',
        content:
          'My sister agreed to take a few afternoons a week, so I have gotten a bit more sleep.',
      },
      {
        from: 'counselor',
        content:
          "That's a meaningful change. How has the extra rest affected things?",
      },
      {
        from: 'client',
        content: 'I feel less on edge. Still tired, but more like myself.',
      },
    ],
    summary: {
      sessionSummary:
        'Follow-up: client arranged respite care with a sibling and reports improved sleep and reduced irritability. Continuing to monitor caregiver load.',
      keyConcerns: 'Caregiver burnout, sleep',
      callQuality: 5,
      tags: ['Caregiver Stress', 'Progress Check-in'],
    },
    customValues: { sessionNo: '2', followUp: 'no' },
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
  tenant: Tenant,
  counselorEmail: string,
  calls: ScribeCallFixture[],
): Promise<void> {
  const userRepo = getRepo(ds, User);
  const chatRepo = getRepo(ds, Chat);
  const callDetailsRepo = getRepo(ds, CallDetails);
  const messageRepo = getRepo(ds, Message);
  const definitionRepo = getRepo(ds, CustomFieldDefinition);
  const valueRepo = getRepo(ds, ChatCustomFieldValue);
  const preferenceRepo = getRepo(ds, Preference);

  const tenantUuid = tenant.id;

  const counselor = await userRepo.findOne({
    where: { email: counselorEmail },
  });
  if (!counselor) {
    log(`${counselorEmail} missing — skipping scribe seed for ${tenant.code}`);
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
  // NOTE: SCRIBE_VOICE_NOTE_ENABLED is intentionally NOT seeded — the feature
  // defaults OFF (no preference row → getScribeVoiceNoteEnabled() returns false).
  // Admins/super-admins turn it on per-tenant via the settings toggle.
  for (const name of [
    PreferenceName.CUSTOM_FIELDS_ENABLED,
    PreferenceName.SCRIBE_NOTE_CREATION_ENABLED,
  ]) {
    const existing = await preferenceRepo.findOne({
      where: {
        name,
        relatedId: tenant.code,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
      },
    });
    if (existing) continue;
    await preferenceRepo.save(
      preferenceRepo.create({
        name,
        relatedId: tenant.code,
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

  for (const fixture of calls) {
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
    // Undefined durationSeconds means the call is still active — no endedAt.
    const endedAt =
      fixture.durationSeconds !== undefined
        ? new Date(startedAt.getTime() + fixture.durationSeconds * 1000)
        : undefined;

    const chat = await chatRepo.save(
      chatRepo.create({
        clientId: ANONYMOUS_CLIENT_ID,
        counselorId: counselor.id,
        status: fixture.chatStatus ?? ChatStatus.ENDED,
        summaryStatus: fixture.summaryStatus ?? ChatSummaryStatus.SUCCESS,
        firstAttemptStatus: fixture.firstAttemptStatus,
        firstFailureStage: fixture.firstFailureStage,
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

    // Only write CallDetails when there's an actual summary — an in-progress
    // or failed-transcription call never produced one.
    if (fixture.summary && endedAt) {
      await callDetailsRepo.save(
        callDetailsRepo.create({
          chatId: chat.id,
          callDuration: fixture.durationSeconds,
          startTime: startedAt,
          endTime: endedAt,
          summary: {
            sessionSummary: encryptSessionSummary(
              fixture.summary.sessionSummary,
            ),
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
    } else if (fixture.firstFailureStage && endedAt) {
      // Failed-transcription call: callInfo exists (the call happened), but
      // no summary — matches a real first-attempt failure.
      await callDetailsRepo.save(
        callDetailsRepo.create({
          chatId: chat.id,
          callDuration: fixture.durationSeconds,
          startTime: startedAt,
          endTime: endedAt,
          callInfo: {
            provider: AudioChatProvider.WEBRTC,
            mode: ScribeSessionMode.SCRIBE,
            notes: '',
          } as CallDetails['callInfo'],
          tenantId: tenantUuid,
        }),
      );
    }

    const customValues = fixture.customValues;
    const sessionNoDef = definitionByName.get('Session No');
    const followUpDef = definitionByName.get('Follow-up Required');
    const aiThemeDef = definitionByName.get('AI Session Theme');

    if (sessionNoDef && customValues) {
      await valueRepo.save(
        valueRepo.create({
          chatId: chat.id,
          fieldDefinitionId: sessionNoDef.id,
          value: customValues.sessionNo,
          updatedBy: counselor.id,
          tenantId: tenantUuid,
        }),
      );
      valueCount++;
    }
    if (followUpDef && customValues) {
      await valueRepo.save(
        valueRepo.create({
          chatId: chat.id,
          fieldDefinitionId: followUpDef.id,
          value: customValues.followUp,
          updatedBy: counselor.id,
          tenantId: tenantUuid,
        }),
      );
      valueCount++;
    }
    if (aiThemeDef && customValues?.aiTheme) {
      await valueRepo.save(
        valueRepo.create({
          chatId: chat.id,
          fieldDefinitionId: aiThemeDef.id,
          value: customValues.aiTheme,
          updatedBy: 0, // 0 = system/AI, matching upsertValuesInternal's convention
          tenantId: tenantUuid,
        }),
      );
      valueCount++;
    }

    chatsCreated++;
  }

  log(
    `scribe (${tenant.code}): ${definitionsCreated} custom field definition(s) created, ` +
      `${preferencesCreated} preference(s) created, ` +
      `${chatsCreated} chat(s) created (${chatsExisting} already existed), ` +
      `${messageCount} messages, ${valueCount} custom field values`,
  );

  return;
}

/**
 * One scribe review on a Riverside call, giving
 * yuki.tanaka@riversidewellness.io (SCRIBE_REVIEWER) something to review in
 * her own tenant — the ally-only scribe seed left her tenant with zero
 * scribe reviews too.
 */
export async function seedScribeReviews(
  ds: DataSource,
  tenant: Tenant,
): Promise<void> {
  const chatRepo = getRepo(ds, Chat);
  const messageRepo = getRepo(ds, Message);
  const userRepo = getRepo(ds, User);
  const reviewRepo = getRepo(ds, ScribeSessionReview);
  const threadRepo = getRepo(ds, ScribeSessionReviewThread);
  const commentRepo = getRepo(ds, ScribeSessionReviewComment);
  const reactionRepo = getRepo(ds, ScribeSessionReviewReaction);
  const readStatusRepo = getRepo(ds, ScribeSessionReviewReadStatus);

  const chat = await chatRepo.findOne({
    where: { externalId: 'seed-scribe-call-rw-1' },
  });
  if (!chat) {
    log('scribe review: seed-scribe-call-rw-1 missing — skipping');
    return;
  }

  const existing = await reviewRepo.findOne({
    where: { scribeSessionId: chat.id },
  });
  if (existing) {
    log('scribe review: already exists');
    return;
  }

  const allUsers = await userRepo.find();
  const userIdByEmail = new Map(allUsers.map((u) => [u.email, u.id]));
  const luciaId = userIdByEmail.get('lucia.fernandez@riversidewellness.io');
  const yukiId = userIdByEmail.get('yuki.tanaka@riversidewellness.io');
  const omarId = userIdByEmail.get('omar.hassan@riversidewellness.io');
  if (!luciaId || !yukiId || !omarId) {
    log('scribe review: one or more users missing — skipping');
    return;
  }

  const review = await reviewRepo.save(
    reviewRepo.create({
      scribeSessionId: chat.id,
      createdBy: luciaId,
      status: ReviewStatus.IN_REVIEW,
      note: 'Sharing my first caregiver-burnout call — did I move to problem-solving too early?',
      noteEditedAt: new Date(),
      tenantId: tenant.id,
    }),
  );

  const generalThread = await threadRepo.save(
    threadRepo.create({
      reviewId: review.id,
      createdBy: yukiId,
      tenantId: tenant.id,
    }),
  );
  await commentRepo.save(
    commentRepo.create({
      reviewThreadId: generalThread.id,
      content:
        'Good normalizing of burnout right away — that usually lowers defensiveness before you ask anything else.',
      createdBy: yukiId,
      tenantId: tenant.id,
    }),
  );

  const messages = await messageRepo.find({
    where: { chatId: chat.id },
    order: { id: 'ASC' },
  });
  const pinnedMessage = messages[4];
  const pinnedThread = await threadRepo.save(
    threadRepo.create({
      reviewId: review.id,
      messageId: pinnedMessage?.id,
      createdBy: omarId,
      tenantId: tenant.id,
    }),
  );
  await commentRepo.save(
    commentRepo.create({
      reviewThreadId: pinnedThread.id,
      content:
        'Nice — naming that support conversation explicitly gives her something concrete to expect next time, rather than leaving it open-ended.',
      createdBy: omarId,
      tenantId: tenant.id,
    }),
  );

  await reactionRepo.save(
    reactionRepo.create({
      reviewId: review.id,
      reaction: '🙏',
      createdBy: yukiId,
      tenantId: tenant.id,
    }),
  );

  await readStatusRepo.save(
    readStatusRepo.create({
      userId: yukiId,
      reviewId: review.id,
      readAt: new Date(),
    }),
  );

  log(
    'scribe review: 1 created (2 threads, 2 comments, 1 reaction, 1 read receipt)',
  );
}
