import { DataSource } from 'typeorm';
import { Track } from '../../../track/entity/track.entity';
import { TrackSection } from '../../../track/entity/track-section.entity';
import {
  TrackItem,
  TrackItemContent,
} from '../../../track/entity/track-item.entity';
import { TrackTenant } from '../../../track/entity/track-tenant.entity';
import { TrackEnrollment } from '../../../track/entity/track-enrollment.entity';
import { TrackItemProgress } from '../../../track/entity/track-item-progress.entity';
import { TrackQuizAttempt } from '../../../track/entity/track-quiz-attempt.entity';
import { TrackJournalEntry } from '../../../track/entity/track-journal-entry.entity';
import {
  TrackItemType,
  TrackStatus,
  TrackItemCompletionCriteria,
  VideoSource,
} from '../../../track/type/track.type';
import {
  QuizAttemptStatus,
  QuizContent,
  QuizQuestionType,
  QuizShowExplanations,
} from '../../../track/type/quiz.type';
import { SessionItemStatus } from '../../../common/type/common.type';
import { Scenarios } from '../../../learn/entity/scenarios.entity';
import { Case } from '../../../case/entity/case.entity';
import { CaseItem } from '../../../case/entity/case-item.entity';
import { CaseSession } from '../../../case/entity/case-session.entity';
import { CaseSessionItem } from '../../../case/entity/case-session-item.entity';
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { User } from '../../../user/entity/user.entity';
import { getRepo, log, upsert } from '../helpers';

const TRACK_TITLE = 'New Counselor Foundations';
const ROLEPLAY_SCENARIO_KEY_TITLE = 'Coping With Persistent Low Mood';
const CASE_TITLE = 'Mood and Grief Presentations';

const daysAgo = (n: number): Date =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000);

export async function seedTracks(
  ds: DataSource,
  adminUserId: number,
): Promise<void> {
  const trackRepo = getRepo(ds, Track);
  const sectionRepo = getRepo(ds, TrackSection);
  const itemRepo = getRepo(ds, TrackItem);
  const trackTenantRepo = getRepo(ds, TrackTenant);
  const enrollmentRepo = getRepo(ds, TrackEnrollment);
  const progressRepo = getRepo(ds, TrackItemProgress);
  const quizAttemptRepo = getRepo(ds, TrackQuizAttempt);
  const journalRepo = getRepo(ds, TrackJournalEntry);
  const scenarioRepo = getRepo(ds, Scenarios);
  const caseRepo = getRepo(ds, Case);
  const caseItemRepo = getRepo(ds, CaseItem);
  const caseSessionRepo = getRepo(ds, CaseSession);
  const caseSessionItemRepo = getRepo(ds, CaseSessionItem);
  const tenantRepo = getRepo(ds, Tenant);
  const userRepo = getRepo(ds, User);

  const roleplayScenario = await scenarioRepo.findOne({
    where: { title: ROLEPLAY_SCENARIO_KEY_TITLE },
  });
  const relatedCase = await caseRepo.findOne({ where: { title: CASE_TITLE } });
  const relatedCaseItem = relatedCase
    ? await caseItemRepo.findOne({ where: { caseId: relatedCase.id } })
    : null;

  const track = await upsert(
    trackRepo,
    { title: TRACK_TITLE },
    {
      description:
        'A guided on-ramp for newly hired counselors: read the house approach to client-centered care, watch a platform walkthrough, practice a real roleplay scenario, pass a checkpoint quiz, reflect in a journal, and work through a short case.',
      status: TrackStatus.ACTIVE,
      isGlobal: true,
      totalItems: 6,
      estimatedDurationMinutes: 95,
      createdBy: adminUserId,
      updatedBy: adminUserId,
    },
  );

  const orientation = await upsert(
    sectionRepo,
    { trackId: track.id, title: 'Orientation' },
    { order: 1 },
  );
  const coreSkills = await upsert(
    sectionRepo,
    { trackId: track.id, title: 'Core Skills Practice' },
    { order: 2 },
  );
  const reflection = await upsert(
    sectionRepo,
    { trackId: track.id, title: 'Reflection' },
    { order: 3 },
  );

  const articleContent: TrackItemContent = {
    html:
      '<h2>Welcome to Client-Centered Care</h2>' +
      '<p>Every session you run on Ally starts from the same premise: the client is the expert on their own life. Your job is not to fix them — it is to create enough safety that they can hear themselves think.</p>' +
      '<p>Three habits carry most new counselors through their first month: reflect before you advise, name the emotion you notice before you name the problem, and resist the urge to fill silence.</p>',
  };
  const articleItem = await upsert(
    itemRepo,
    {
      trackId: track.id,
      trackSectionId: orientation.id,
      title: 'Welcome to Client-Centered Care',
    },
    {
      type: TrackItemType.ARTICLE,
      order: 1,
      content: articleContent,
      completionCriteria: { minReadSeconds: 90 } as TrackItemCompletionCriteria,
    },
  );

  const videoItem = await upsert(
    itemRepo,
    {
      trackId: track.id,
      trackSectionId: orientation.id,
      title: 'Platform Walkthrough',
    },
    {
      type: TrackItemType.VIDEO,
      order: 2,
      content: {
        source: VideoSource.S3,
        url: 'https://cdn.helloally.ai/onboarding/platform-walkthrough.mp4',
        durationSeconds: 480,
      } as TrackItemContent,
      completionCriteria: { watchPct: 90 } as TrackItemCompletionCriteria,
    },
  );

  const roleplayItem = await upsert(
    itemRepo,
    {
      trackId: track.id,
      trackSectionId: coreSkills.id,
      title: 'Practice: Coping With Persistent Low Mood',
    },
    {
      type: TrackItemType.ROLEPLAY,
      order: 1,
      scenarioId: roleplayScenario?.id,
      completionCriteria: {
        minScore: 70,
        minDurationSeconds: 300,
      } as TrackItemCompletionCriteria,
    },
  );

  const quizContent: QuizContent = {
    settings: {
      passScore: 70,
      maxAttempts: null,
      shuffleQuestions: false,
      shuffleOptions: false,
      showExplanations: QuizShowExplanations.AFTER_SUBMIT,
    },
    questions: [
      {
        id: 'q1',
        type: QuizQuestionType.MCQ_SINGLE,
        prompt:
          'A client says "I am fine" right after describing a difficult week. What is the best next move?',
        options: [
          { id: 'a', text: 'Accept the statement and move to the next topic.' },
          {
            id: 'b',
            text: 'Gently reflect the mismatch: "You said fine, but that sounded like a hard week."',
          },
          { id: 'c', text: 'Tell them it is okay to not be fine.' },
          {
            id: 'd',
            text: 'Ask a closed yes/no question to confirm they are okay.',
          },
        ],
        correctOptionIds: ['b'],
      },
      {
        id: 'q2',
        type: QuizQuestionType.TRUE_FALSE,
        prompt:
          'Filling every silence with a question keeps the session moving and is generally good practice.',
        correctAnswer: false,
      },
      {
        id: 'q3',
        type: QuizQuestionType.OPEN_ENDED,
        prompt:
          'Describe how you would respond if a client minimised their own distress twice in the same session.',
        minWords: 20,
        rubric: {
          guidance:
            'Look for: naming the pattern without judgment, staying curious rather than confrontational, and inviting (not demanding) more detail.',
          maxScore: 100,
        },
      },
    ],
  };

  const quizItem = await upsert(
    itemRepo,
    {
      trackId: track.id,
      trackSectionId: coreSkills.id,
      title: 'Active Listening Checkpoint',
    },
    {
      type: TrackItemType.QUIZ,
      order: 2,
      content: quizContent as TrackItemContent,
      completionCriteria: { passScore: 70 } as TrackItemCompletionCriteria,
    },
  );

  const journalPrompts = [
    {
      id: 'prompt-1',
      prompt: 'What emotions came up for you while running this scenario?',
      required: true,
    },
    {
      id: 'prompt-2',
      prompt: 'What would you do differently if you ran this session again?',
      required: true,
    },
  ];
  const journalItem = await upsert(
    itemRepo,
    {
      trackId: track.id,
      trackSectionId: reflection.id,
      title: 'Session Reflection Journal',
    },
    {
      type: TrackItemType.JOURNAL,
      order: 1,
      content: { prompts: journalPrompts } as TrackItemContent,
    },
  );

  const caseItem = await upsert(
    itemRepo,
    {
      trackId: track.id,
      trackSectionId: reflection.id,
      title: 'Case Walkthrough: Mood and Grief Presentations',
    },
    {
      type: TrackItemType.CASE,
      order: 2,
      caseId: relatedCase?.id,
      completionCriteria: { minScore: 70 } as TrackItemCompletionCriteria,
    },
  );

  const orderedItems = [
    articleItem,
    videoItem,
    roleplayItem,
    quizItem,
    journalItem,
    caseItem,
  ];

  const tenants = await tenantRepo.find();
  for (const tenant of tenants) {
    await upsert(
      trackTenantRepo,
      { trackId: track.id, tenantId: tenant.id },
      { trackId: track.id, tenantId: tenant.id },
    );
  }

  log(
    `tracks: 1 ("${track.title}", ${orderedItems.length} items across 3 sections)`,
  );

  // ---- Learner progress: four learners at four different points in the track ----
  const learnerEmails = [
    'priya.nair@northwindbh.org',
    'daniel.reyes@northwindbh.org',
    'fatima.siddiqui@northwindbh.org',
    'lucia.fernandez@riversidewellness.io',
  ];
  const learners = new Map(
    (
      await userRepo.find({ where: learnerEmails.map((email) => ({ email })) })
    ).map((u) => [u.email, u]),
  );

  async function upsertProgress(
    enrollmentId: string,
    item: TrackItem,
    userId: number,
    overrides: Partial<TrackItemProgress>,
  ): Promise<TrackItemProgress> {
    return upsert(
      progressRepo,
      { trackEnrollmentId: enrollmentId, trackItemId: item.id },
      { userId, status: SessionItemStatus.LOCKED, ...overrides },
    );
  }

  // Priya — completed the entire track ~3 days ago.
  const priya = learners.get('priya.nair@northwindbh.org');
  if (priya) {
    const enrollment = await upsert(
      enrollmentRepo,
      { trackId: track.id, userId: priya.id },
      {
        tenantId: priya.tenantId,
        startedAt: daysAgo(18),
        completedAt: daysAgo(3),
        completedItems: orderedItems.length,
        lastActivityAt: daysAgo(3),
      },
    );

    await upsertProgress(enrollment.id, articleItem, priya.id, {
      status: SessionItemStatus.COMPLETED,
      startedAt: daysAgo(18),
      completedAt: daysAgo(18),
      meta: {
        articleFirstOpenedAt: daysAgo(18).toISOString(),
        articleReadAt: daysAgo(18).toISOString(),
      },
    });
    await upsertProgress(enrollment.id, videoItem, priya.id, {
      status: SessionItemStatus.COMPLETED,
      startedAt: daysAgo(17),
      completedAt: daysAgo(17),
      meta: { maxWatchedPct: 100 },
    });
    await upsertProgress(enrollment.id, roleplayItem, priya.id, {
      status: SessionItemStatus.COMPLETED,
      startedAt: daysAgo(12),
      completedAt: daysAgo(12),
      score: 82,
      attemptCount: 1,
    });
    const quizProgress = await upsertProgress(
      enrollment.id,
      quizItem,
      priya.id,
      {
        status: SessionItemStatus.COMPLETED,
        startedAt: daysAgo(10),
        completedAt: daysAgo(10),
        score: 90,
        attemptCount: 1,
      },
    );
    await upsert(
      quizAttemptRepo,
      { trackItemProgressId: quizProgress.id, attemptNumber: 1 },
      {
        trackItemId: quizItem.id,
        userId: priya.id,
        answers: [
          { questionId: 'q1', selectedOptionIds: ['b'] },
          { questionId: 'q2', booleanAnswer: false },
          {
            questionId: 'q3',
            text: 'I would name the pattern gently, something like "I have noticed you brushing that off twice now" and then stay quiet to let them fill the space rather than pushing.',
          },
        ],
        grading: [
          {
            questionId: 'q1',
            correct: true,
            pointsAwarded: 1,
            pointsPossible: 1,
          },
          {
            questionId: 'q2',
            correct: true,
            pointsAwarded: 1,
            pointsPossible: 1,
          },
          {
            questionId: 'q3',
            correct: true,
            pointsAwarded: 88,
            pointsPossible: 100,
            llm: {
              score: 88,
              feedback:
                'Names the pattern without judgment and leaves space; could be more specific about a follow-up question.',
            },
          },
        ],
        scorePct: 90,
        passed: true,
        status: QuizAttemptStatus.GRADED,
        submittedAt: daysAgo(10),
        gradedAt: daysAgo(10),
      },
    );

    const journalProgress = await upsertProgress(
      enrollment.id,
      journalItem,
      priya.id,
      {
        status: SessionItemStatus.COMPLETED,
        startedAt: daysAgo(5),
        completedAt: daysAgo(5),
      },
    );
    for (const prompt of journalPrompts) {
      await upsert(
        journalRepo,
        { trackItemProgressId: journalProgress.id, promptId: prompt.id },
        {
          trackItemId: journalItem.id,
          userId: priya.id,
          response:
            prompt.id === 'prompt-1'
              ? 'I felt a pull to reassure Anjali too quickly when she got quiet — I had to remind myself to just sit with it.'
              : 'Next time I would ask one more open question before summarising, instead of summarising as soon as she paused.',
          submittedAt: daysAgo(5),
        },
      );
    }

    let caseSessionId: string | undefined;
    if (relatedCase && relatedCaseItem) {
      const caseSession = await upsert(
        caseSessionRepo,
        { caseId: relatedCase.id, userId: priya.id },
        {
          startedAt: daysAgo(4),
          completedAt: daysAgo(3),
          completedScenarios: 1,
        },
      );
      await upsert(
        caseSessionItemRepo,
        { caseSessionId: caseSession.id, caseItemId: relatedCaseItem.id },
        { userId: priya.id, status: SessionItemStatus.COMPLETED },
      );
      caseSessionId = caseSession.id;
    }
    await upsertProgress(enrollment.id, caseItem, priya.id, {
      status: SessionItemStatus.COMPLETED,
      startedAt: daysAgo(4),
      completedAt: daysAgo(3),
      score: 78,
      caseSessionId,
    });
  }

  // Daniel — completed orientation + the roleplay, failed the quiz once and is retrying.
  const daniel = learners.get('daniel.reyes@northwindbh.org');
  if (daniel) {
    const enrollment = await upsert(
      enrollmentRepo,
      { trackId: track.id, userId: daniel.id },
      {
        tenantId: daniel.tenantId,
        startedAt: daysAgo(9),
        completedItems: 3,
        lastActivityAt: daysAgo(1),
      },
    );
    await upsertProgress(enrollment.id, articleItem, daniel.id, {
      status: SessionItemStatus.COMPLETED,
      startedAt: daysAgo(9),
      completedAt: daysAgo(9),
      meta: {
        articleFirstOpenedAt: daysAgo(9).toISOString(),
        articleReadAt: daysAgo(9).toISOString(),
      },
    });
    await upsertProgress(enrollment.id, videoItem, daniel.id, {
      status: SessionItemStatus.COMPLETED,
      startedAt: daysAgo(8),
      completedAt: daysAgo(8),
      meta: { maxWatchedPct: 100 },
    });
    await upsertProgress(enrollment.id, roleplayItem, daniel.id, {
      status: SessionItemStatus.COMPLETED,
      startedAt: daysAgo(5),
      completedAt: daysAgo(5),
      score: 74,
      attemptCount: 1,
    });
    const quizProgress = await upsertProgress(
      enrollment.id,
      quizItem,
      daniel.id,
      {
        status: SessionItemStatus.UNLOCKED,
        startedAt: daysAgo(1),
        attemptCount: 1,
      },
    );
    await upsert(
      quizAttemptRepo,
      { trackItemProgressId: quizProgress.id, attemptNumber: 1 },
      {
        trackItemId: quizItem.id,
        userId: daniel.id,
        answers: [
          { questionId: 'q1', selectedOptionIds: ['a'] },
          { questionId: 'q2', booleanAnswer: true },
          {
            questionId: 'q3',
            text: 'I would tell them it is okay and move on since pushing might make them uncomfortable.',
          },
        ],
        grading: [
          {
            questionId: 'q1',
            correct: false,
            pointsAwarded: 0,
            pointsPossible: 1,
          },
          {
            questionId: 'q2',
            correct: false,
            pointsAwarded: 0,
            pointsPossible: 1,
          },
          {
            questionId: 'q3',
            correct: false,
            pointsAwarded: 55,
            pointsPossible: 100,
            llm: {
              score: 55,
              feedback:
                'Avoids the pattern rather than naming it; re-read the module on minimisation before retrying.',
            },
          },
        ],
        scorePct: 55,
        passed: false,
        status: QuizAttemptStatus.GRADED,
        submittedAt: daysAgo(1),
        gradedAt: daysAgo(1),
      },
    );
    await upsertProgress(enrollment.id, journalItem, daniel.id, {});
    await upsertProgress(enrollment.id, caseItem, daniel.id, {});
  }

  // Fatima — just started: read the article, partway through the video.
  const fatima = learners.get('fatima.siddiqui@northwindbh.org');
  if (fatima) {
    const enrollment = await upsert(
      enrollmentRepo,
      { trackId: track.id, userId: fatima.id },
      {
        tenantId: fatima.tenantId,
        startedAt: daysAgo(2),
        completedItems: 1,
        lastActivityAt: daysAgo(1),
      },
    );
    await upsertProgress(enrollment.id, articleItem, fatima.id, {
      status: SessionItemStatus.COMPLETED,
      startedAt: daysAgo(2),
      completedAt: daysAgo(2),
      meta: {
        articleFirstOpenedAt: daysAgo(2).toISOString(),
        articleReadAt: daysAgo(2).toISOString(),
      },
    });
    await upsertProgress(enrollment.id, videoItem, fatima.id, {
      status: SessionItemStatus.UNLOCKED,
      startedAt: daysAgo(1),
      meta: { maxWatchedPct: 40 },
    });
    await upsertProgress(enrollment.id, roleplayItem, fatima.id, {});
    await upsertProgress(enrollment.id, quizItem, fatima.id, {});
    await upsertProgress(enrollment.id, journalItem, fatima.id, {});
    await upsertProgress(enrollment.id, caseItem, fatima.id, {});
  }

  // Lucía — enrolled but has not opened the first item yet.
  const lucia = learners.get('lucia.fernandez@riversidewellness.io');
  if (lucia) {
    const enrollment = await upsert(
      enrollmentRepo,
      { trackId: track.id, userId: lucia.id },
      {
        tenantId: lucia.tenantId,
        startedAt: daysAgo(1),
        completedItems: 0,
        lastActivityAt: daysAgo(1),
      },
    );
    await upsertProgress(enrollment.id, articleItem, lucia.id, {
      status: SessionItemStatus.UNLOCKED,
    });
    await upsertProgress(enrollment.id, videoItem, lucia.id, {});
    await upsertProgress(enrollment.id, roleplayItem, lucia.id, {});
    await upsertProgress(enrollment.id, quizItem, lucia.id, {});
    await upsertProgress(enrollment.id, journalItem, lucia.id, {});
    await upsertProgress(enrollment.id, caseItem, lucia.id, {});
  }

  log(
    'track enrollments: 4 learners (completed / in-progress / just-started / not-started)',
  );
}
