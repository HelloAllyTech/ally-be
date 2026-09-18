import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderQuestion } from '../entity/builder-question.entity';
import { BuilderBuildRun } from '../entity/builder-build-run.entity';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import {
  BuilderBuildRunRepository,
  BuilderQuestionRepository,
} from '../repository/builder-build.repository';
import { BuilderBuildService } from './builder-build.service';
import { BuilderNotificationService } from './builder-notification.service';
import { BuilderEventService } from './builder-event.service';
import {
  BuilderEventType,
  BuilderQuestionStatus,
  BuilderRunStatus,
  BuilderSessionStatus,
} from '../enum/builder.enum';
import { BuilderQuestionOption } from '../type/builder-sse.type';

/**
 * Mid-build pauses: recording what the agent asked, and dispatching the
 * resume once it is all answered.
 *
 * A pause is a deliberate `exit 0` on the runner, not a failure — the run
 * ends, the branches hold the work in progress, and a fresh run continues
 * from them. That is what makes "close the tab, it keeps going" true even
 * across an hour of waiting for a human.
 */
@Injectable()
export class BuilderQuestionService {
  private readonly logger = LoggerService.getInstance(
    BuilderQuestionService.name,
  );

  constructor(
    private readonly questionRepository: BuilderQuestionRepository,
    private readonly runRepository: BuilderBuildRunRepository,
    private readonly sessionRepository: BuilderSessionRepository,
    private readonly buildService: BuilderBuildService,
    private readonly notificationService: BuilderNotificationService,
    private readonly eventService: BuilderEventService,
  ) {}

  /**
   * Record a batch of questions and park the run.
   *
   * All of them share one `groupId` so the resume waits for the complete set:
   * dispatching on the first answer would waste the batching the agent was
   * asked to do, and leave the remaining questions orphaned against a run
   * that has moved on.
   */
  async recordPause(
    run: BuilderBuildRun,
    incoming: Record<string, any>[],
    branches: Record<string, string> | null,
  ): Promise<BuilderQuestion[]> {
    if (!incoming.length) {
      throw new BadRequestException(
        'A pause must carry at least one question.',
      );
    }

    // A question with nothing in it is worse than no question at all.
    //
    // This used to substitute a placeholder — "The agent needs a decision." —
    // and park the session on it. Nobody can answer that, and a parked run
    // counts as an active one, so every later fix and review dispatch for the
    // session is refused. One empty `ask` cost a session four hours, and the
    // person looking at it had no way to know what was being asked.
    //
    // Refused at the boundary instead, so the run stays alive and the agent
    // can ask again with something in it. Failing the call is recoverable;
    // parking on an unanswerable question is not.
    const blank = incoming.filter(
      (raw) => !String(raw?.prompt ?? '').trim(),
    ).length;
    if (blank) {
      throw new BadRequestException(
        `${blank} of ${incoming.length} question(s) have an empty prompt. A pause stops the ` +
          'build until a person answers, so every question must say what it is asking. ' +
          'Re-send the pause with a prompt on each question, or carry on without pausing.',
      );
    }

    const groupId = uuidv4();
    const saved: BuilderQuestion[] = [];

    for (const [index, raw] of incoming.entries()) {
      const question = this.normalizeQuestion(raw);
      saved.push(
        await this.questionRepository.save(
          this.questionRepository.create({
            sessionId: run.sessionId,
            runId: run.id,
            groupId,
            position: index,
            question,
            status: BuilderQuestionStatus.PENDING,
          }),
        ),
      );
      await this.eventService.record(run, BuilderEventType.QUESTION, question);
    }

    // The branches matter more than the questions: without them the resume
    // run has nowhere to pick the work up from and would start over.
    await this.runRepository.update(
      { id: run.id },
      {
        status: BuilderRunStatus.WAITING_FOR_INPUT,
        branches: branches ?? run.branches ?? null,
        completedAt: new Date(),
      },
    );
    await this.sessionRepository.update(
      { id: run.sessionId },
      { status: BuilderSessionStatus.WAITING_FOR_INPUT },
    );

    const session = await this.sessionRepository.findOne({
      where: { id: run.sessionId },
    });
    if (session) {
      await this.notificationService.questionPending(session, saved.length);
    }

    this.logger.info(
      `Builder run ${run.id} paused with ${saved.length} question(s) in group ${groupId}`,
    );
    return saved;
  }

  /**
   * Coerce the agent's question into the widget contract.
   *
   * Defensive because this is model-authored JSON arriving over HTTP: the
   * admin UI renders it directly, and a malformed option list would either
   * crash the card or present an unanswerable question — with a runner
   * already torn down and no way to ask again.
   */
  private normalizeQuestion(raw: Record<string, any>): Record<string, any> {
    const selectKinds = ['singleSelect', 'multiSelect', 'dropdown'];
    let kind = String(raw?.kind ?? 'freeText');
    if (![...selectKinds, 'freeText'].includes(kind)) kind = 'freeText';

    const isSelect = selectKinds.includes(kind);
    const options: BuilderQuestionOption[] = isSelect
      ? (Array.isArray(raw?.options) ? raw.options : [])
          .map((option: any) => {
            if (typeof option === 'string') {
              const value = option.trim();
              return value ? { id: value, label: value } : null;
            }
            if (!option || typeof option !== 'object') return null;
            const id = String(option.id ?? option.label ?? '').trim();
            const label = String(option.label ?? option.id ?? '').trim();
            if (!id || !label) return null;
            return {
              id,
              label,
              ...(option.description
                ? { description: String(option.description) }
                : {}),
              ...(option.recommended ? { recommended: true } : {}),
            };
          })
          .filter((option: unknown): option is BuilderQuestionOption =>
            Boolean(option),
          )
      : [];

    // At most one recommendation — two is no recommendation at all, and the
    // UI focuses the first for one-key answering.
    let seenRecommended = false;
    for (const option of options) {
      if (!option.recommended) continue;
      if (seenRecommended) delete option.recommended;
      else seenRecommended = true;
    }

    // A select question the admin cannot step outside of forces a wrong
    // answer, and there is no follow-up turn to correct it in.
    const allowCustom = isSelect
      ? raw?.allowCustom !== false
      : Boolean(raw?.allowCustom);

    return {
      id: uuidv4(),
      // Guaranteed non-empty by recordPause, which refuses the whole pause
      // rather than inventing a prompt nobody can answer.
      prompt: String(raw?.prompt ?? '').trim(),
      kind: options.length ? kind : 'freeText',
      ...(raw?.rationale ? { rationale: String(raw.rationale) } : {}),
      ...(options.length ? { options } : {}),
      allowCustom,
      ...(raw?.allowNone ? { allowNone: true } : {}),
      ...(typeof raw?.minSelections === 'number'
        ? { minSelections: raw.minSelections }
        : {}),
      ...(typeof raw?.maxSelections === 'number'
        ? { maxSelections: raw.maxSelections }
        : {}),
    };
  }

  /**
   * Answer one question. Dispatches the resume run only once every question
   * in the group is answered; returns the run if it did.
   */
  async answer(
    sessionId: string,
    questionId: string,
    userId: number,
    payload: { message: string; answer?: Record<string, any> },
  ): Promise<{
    question: BuilderQuestion;
    resumedRun: BuilderBuildRun | null;
  }> {
    const question = await this.questionRepository.findOne({
      where: { id: questionId, sessionId },
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    if (question.status === BuilderQuestionStatus.SUPERSEDED) {
      throw new BadRequestException(
        'That question belongs to a build that has since been stopped.',
      );
    }
    // An answered question whose run is STILL parked is a half-finished
    // answer, not a duplicate one.
    //
    // The answer is written before the resume is dispatched, because the resume
    // reads it — but the two are not in one transaction, so anything that
    // throws in between leaves the answer recorded and the run waiting. The
    // budget ceiling does exactly that: `resumeFromQuestions` asserts it AFTER
    // this write, so answering an over-budget session consumed the question and
    // stranded the run. Re-answering then refused as a duplicate, and the only
    // documented way out of WAITING_FOR_INPUT was gone — which silently blocks
    // every fix and review dispatch for that session, since a parked run counts
    // as an active one.
    //
    // So retry the half that failed rather than refusing the whole thing.
    // `resumeFromQuestions` re-checks group completeness and budget and is safe
    // to call again; a genuine duplicate still refuses below.
    if (question.status === BuilderQuestionStatus.ANSWERED) {
      const strandedRun = await this.runRepository.findOne({
        where: { id: question.runId },
      });
      if (strandedRun?.status === BuilderRunStatus.WAITING_FOR_INPUT) {
        const session = await this.sessionRepository.findOne({
          where: { id: sessionId },
        });
        if (!session) {
          throw new NotFoundException('The paused build could not be found.');
        }
        this.logger.info(
          `Retrying the resume for session ${sessionId}: question ${question.id} was answered but its run is still parked.`,
        );
        const resumedRun = await this.buildService.resumeFromQuestions(
          session,
          strandedRun,
          question.groupId,
          userId,
        );
        return { question, resumedRun };
      }
      throw new BadRequestException('That question is already answered.');
    }

    await this.questionRepository.update(
      { id: question.id },
      {
        answer: payload.answer ?? null,
        answerText: payload.message,
        status: BuilderQuestionStatus.ANSWERED,
        answeredAt: new Date(),
        answeredBy: userId,
      },
    );

    if (!(await this.questionRepository.isGroupComplete(question.groupId))) {
      return {
        question: await this.questionRepository.findOneOrFail({
          where: { id: question.id },
        }),
        resumedRun: null,
      };
    }

    const [session, pausedRun] = await Promise.all([
      this.sessionRepository.findOne({ where: { id: sessionId } }),
      this.runRepository.findOne({ where: { id: question.runId } }),
    ]);
    if (!session || !pausedRun) {
      throw new NotFoundException('The paused build could not be found.');
    }

    const resumedRun = await this.buildService.resumeFromQuestions(
      session,
      pausedRun,
      question.groupId,
      userId,
    );

    return {
      question: await this.questionRepository.findOneOrFail({
        where: { id: question.id },
      }),
      resumedRun,
    };
  }

  listPending(sessionId: string): Promise<BuilderQuestion[]> {
    return this.questionRepository.listPending(sessionId);
  }

  /** The answered Q&A for a group, as the resume prompt renders it. */
  async answeredForGroup(
    groupId: string,
  ): Promise<{ prompt: string; answer: string }[]> {
    const questions = await this.questionRepository.listByGroup(groupId);
    return questions.map((question) => ({
      prompt: String(question.question?.prompt ?? ''),
      answer: question.answerText ?? '(no answer recorded)',
    }));
  }
}
