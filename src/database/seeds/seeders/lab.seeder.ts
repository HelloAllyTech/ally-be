import { DataSource } from 'typeorm';
import { LabSkill } from '../../../lab/entity/lab-skill.entity';
import { LabVariable } from '../../../lab/entity/lab-variable.entity';
import { LabValue } from '../../../lab/entity/lab-value.entity';
import { LabEvaluator } from '../../../lab/entity/lab-evaluator.entity';
import { LabQuestionSet } from '../../../lab/entity/lab-question-set.entity';
import { LabQuestionSetQuestion } from '../../../lab/entity/lab-question-set-question.entity';
import { LabRun, LabRunStatus } from '../../../lab/entity/lab-run.entity';
import { LabRunAssignment } from '../../../lab/entity/lab-run-assignment.entity';
import {
  LabEvalQuestion,
  LabEvalQuestionType,
} from '../../../lab/entity/lab-eval-question.entity';
import { LabEvalAnswer } from '../../../lab/entity/lab-eval-answer.entity';
import { LabAutoEvaluation } from '../../../lab/entity/lab-auto-evaluation.entity';
import { getRepo, hashPassword, log, upsert } from '../helpers';
import { DEFAULT_PASSWORD } from '../config';

const daysAgo = (n: number): Date =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000);

interface LabVariableFixture {
  name: string;
  description: string;
  values: Array<{ value: string; label: string }>;
}

const LAB_VARIABLES: LabVariableFixture[] = [
  {
    name: 'tone',
    description: 'The emotional tone the roleplay actor should adopt.',
    values: [
      { value: 'empathetic', label: 'Empathetic' },
      { value: 'firm', label: 'Firm but fair' },
      { value: 'anxious', label: 'Anxious client' },
    ],
  },
  {
    name: 'difficulty',
    description: 'Roleplay difficulty tier.',
    values: [
      { value: 'beginner', label: 'Beginner' },
      { value: 'intermediate', label: 'Intermediate' },
      { value: 'advanced', label: 'Advanced' },
    ],
  },
];

interface LabSkillFixture {
  name: string;
  description: string;
  content: string;
  temperature: number;
  maxTokens: number;
}

const LAB_SKILLS: LabSkillFixture[] = [
  {
    name: 'Empathetic Client Roleplay',
    description:
      'Base system prompt for a client who responds with empathy-seeking behavior.',
    content:
      'You are a client in a counseling roleplay. Adopt a {{tone}} tone and respond at {{difficulty}} difficulty. Stay in character and never break the fourth wall.',
    temperature: 0.7,
    maxTokens: 800,
  },
  {
    name: 'Scribe Note Summarizer',
    description:
      'Summarizes a session transcript into a structured clinical note.',
    content:
      'Summarize the following transcript into SOAP note format (Subjective, Objective, Assessment, Plan). Keep it under 300 words and avoid restating the transcript verbatim.',
    temperature: 0.3,
    maxTokens: 600,
  },
];

export async function seedLab(
  ds: DataSource,
  adminUserId: number,
): Promise<void> {
  const variableRepo = getRepo(ds, LabVariable);
  const valueRepo = getRepo(ds, LabValue);
  const skillRepo = getRepo(ds, LabSkill);

  let valueCount = 0;
  for (const fixture of LAB_VARIABLES) {
    const variable = await upsert(
      variableRepo,
      { name: fixture.name },
      { description: fixture.description, createdBy: adminUserId },
    );

    for (const value of fixture.values) {
      await upsert(
        valueRepo,
        { variableId: variable.id, value: value.value },
        { label: value.label, createdBy: adminUserId },
      );
      valueCount++;
    }
  }

  for (const fixture of LAB_SKILLS) {
    await upsert(
      skillRepo,
      { name: fixture.name },
      {
        description: fixture.description,
        content: fixture.content,
        temperature: fixture.temperature,
        maxTokens: fixture.maxTokens,
        createdBy: adminUserId,
      },
    );
  }

  log(
    `lab: ${LAB_VARIABLES.length} variables, ${valueCount} values, ${LAB_SKILLS.length} skills`,
  );

  await seedLabRunWorkflow(ds, adminUserId);
}

/**
 * Only the config building blocks (variables/values/skills) were seeded
 * above — the actual "Lab Run" workflow (runs, publish, evaluator
 * assignment, human + auto evaluation) had zero fixture coverage. This
 * seeds one COMPLETED run through to a submitted human evaluation plus an
 * auto-evaluation, and one FAILED run, so the runs log/eval-portal/results
 * screens all have something real to show.
 */
async function seedLabRunWorkflow(
  ds: DataSource,
  adminUserId: number,
): Promise<void> {
  const evaluatorRepo = getRepo(ds, LabEvaluator);
  const questionSetRepo = getRepo(ds, LabQuestionSet);
  const questionSetQuestionRepo = getRepo(ds, LabQuestionSetQuestion);
  const runRepo = getRepo(ds, LabRun);
  const assignmentRepo = getRepo(ds, LabRunAssignment);
  const evalQuestionRepo = getRepo(ds, LabEvalQuestion);
  const answerRepo = getRepo(ds, LabEvalAnswer);
  const autoEvalRepo = getRepo(ds, LabAutoEvaluation);

  const evaluator1 = await upsert(
    evaluatorRepo,
    { email: 'evaluator1@example.com' },
    {
      passwordHash: await hashPassword(DEFAULT_PASSWORD),
      tokenVersion: 0,
      lastLoginAt: daysAgo(2),
      createdBy: adminUserId,
    },
  );
  const evaluator2 = await upsert(
    evaluatorRepo,
    { email: 'evaluator2@example.com' },
    {
      passwordHash: await hashPassword(DEFAULT_PASSWORD),
      tokenVersion: 0,
      createdBy: adminUserId,
    },
  );

  const QUESTIONS: Array<{
    question: string;
    type: LabEvalQuestionType;
    scaleMin?: number;
    scaleMax?: number;
    position: number;
  }> = [
    {
      question:
        'Read the model output below, then answer as a practising counsellor.',
      type: LabEvalQuestionType.DESCRIPTION,
      position: 0,
    },
    {
      question: "How believable is this as a real client's reply?",
      type: LabEvalQuestionType.RATING,
      scaleMin: 1,
      scaleMax: 5,
      position: 1,
    },
    {
      question: 'Did the model stay in character throughout?',
      type: LabEvalQuestionType.YES_NO,
      position: 2,
    },
    {
      question: 'What would you change about this response?',
      type: LabEvalQuestionType.TEXT,
      position: 3,
    },
  ];

  const questionSet = await upsert(
    questionSetRepo,
    { name: 'Roleplay Actor Quality v1' },
    {
      description: 'Standard set for judging in-character roleplay output.',
      publishedAt: daysAgo(10),
      createdBy: adminUserId,
    },
  );
  for (const q of QUESTIONS) {
    await upsert(
      questionSetQuestionRepo,
      { questionSetId: questionSet.id, position: q.position },
      {
        question: q.question,
        type: q.type,
        scaleMin: q.scaleMin ?? 1,
        scaleMax: q.scaleMax ?? 5,
      },
    );
  }

  const BATCH_ID = '11111111-2222-4333-8444-555555555555';

  const existingCompletedRun = await runRepo.findOne({
    where: { batchId: BATCH_ID, skillName: 'Empathetic Client Roleplay' },
  });
  let runsCreated = 0;
  let completedRun = existingCompletedRun;
  if (!completedRun) {
    completedRun = await runRepo.save(
      runRepo.create({
        batchId: BATCH_ID,
        skillName: 'Empathetic Client Roleplay',
        resolvedPrompt:
          'You are a client in a counseling roleplay. Adopt a empathetic tone and respond at intermediate difficulty. Stay in character and never break the fourth wall.',
        variableValues: [
          { name: 'tone', value: 'empathetic' },
          { name: 'difficulty', value: 'intermediate' },
        ],
        model: 'claude-sonnet-4-6',
        generationParams: {
          temperature: 0.7,
          maxTokens: 800,
          systemPrompt: null,
        },
        status: LabRunStatus.COMPLETED,
        output:
          "I don't know, it's just been a heavy few weeks and I haven't really been able to shake it off. I keep telling myself I should be fine by now.",
        promptTokens: 412,
        completionTokens: 96,
        totalTokens: 508,
        costUsd: '0.004236',
        publishedAt: daysAgo(6),
        createdBy: adminUserId,
        createdAt: daysAgo(7),
      }),
    );
    runsCreated++;
  }

  const existingFailedRun = await runRepo.findOne({
    where: { batchId: BATCH_ID, skillName: 'Scribe Note Summarizer' },
  });
  if (!existingFailedRun) {
    await runRepo.save(
      runRepo.create({
        batchId: BATCH_ID,
        skillName: 'Scribe Note Summarizer',
        resolvedPrompt:
          'Summarize the following transcript into SOAP note format (Subjective, Objective, Assessment, Plan). Keep it under 300 words and avoid restating the transcript verbatim.',
        variableValues: [],
        model: 'claude-sonnet-4-6',
        generationParams: {
          temperature: 0.3,
          maxTokens: 600,
          systemPrompt: null,
        },
        status: LabRunStatus.FAILED,
        error: 'provider timeout after 60s',
        createdBy: adminUserId,
        createdAt: daysAgo(7),
      }),
    );
    runsCreated++;
  }

  // Publish the completed run for human evaluation: copy the question set's
  // questions onto the run (as real publish does), then assign evaluators.
  const existingEvalQuestions = await evalQuestionRepo.find({
    where: { runId: completedRun.id },
  });
  let evalQuestionsCreated = 0;
  const evalQuestionByPosition = new Map<number, LabEvalQuestion>();
  if (existingEvalQuestions.length === 0) {
    for (const q of QUESTIONS) {
      const evalQuestion = await evalQuestionRepo.save(
        evalQuestionRepo.create({
          runId: completedRun.id,
          question: q.question,
          type: q.type,
          scaleMin: q.scaleMin ?? 1,
          scaleMax: q.scaleMax ?? 5,
          position: q.position,
          sourceQuestionSetId: questionSet.id,
          createdBy: adminUserId,
        }),
      );
      evalQuestionByPosition.set(q.position, evalQuestion);
      evalQuestionsCreated++;
    }
  } else {
    for (const q of existingEvalQuestions) {
      evalQuestionByPosition.set(q.position, q);
    }
  }

  const assignment1 = await upsert(
    assignmentRepo,
    { runId: completedRun.id, evaluatorId: evaluator1.id },
    { submittedAt: daysAgo(4), createdBy: adminUserId },
  );
  await upsert(
    assignmentRepo,
    { runId: completedRun.id, evaluatorId: evaluator2.id },
    { submittedAt: null, createdBy: adminUserId },
  );

  const ratingQuestion = evalQuestionByPosition.get(1);
  const yesNoQuestion = evalQuestionByPosition.get(2);
  const textQuestion = evalQuestionByPosition.get(3);
  let answersCreated = 0;
  if (ratingQuestion) {
    await upsert(
      answerRepo,
      { assignmentId: assignment1.id, questionId: ratingQuestion.id },
      { answerRating: 4 },
    );
    answersCreated++;
  }
  if (yesNoQuestion) {
    await upsert(
      answerRepo,
      { assignmentId: assignment1.id, questionId: yesNoQuestion.id },
      { answerBool: true },
    );
    answersCreated++;
  }
  if (textQuestion) {
    await upsert(
      answerRepo,
      { assignmentId: assignment1.id, questionId: textQuestion.id },
      {
        answerText:
          'Would open with a shorter line — the second sentence over-explains.',
      },
    );
    answersCreated++;
  }

  const existingAutoEval = await autoEvalRepo.findOne({
    where: { runId: completedRun.id },
  });
  if (!existingAutoEval) {
    await autoEvalRepo.save(
      autoEvalRepo.create({
        runId: completedRun.id,
        model: 'claude-haiku-4-5',
        criteria:
          'Score 0-100 on staying in character, emotional plausibility, and brevity.',
        score: 82,
        reasoning:
          'Stays fully in character and the emotional register is plausible; slightly verbose for a first response.',
        createdBy: adminUserId,
      }),
    );
  }

  log(
    `lab runs: ${runsCreated} created, ${evalQuestionsCreated} eval question(s), ` +
      `${answersCreated} answer(s), 2 evaluators`,
  );
}
