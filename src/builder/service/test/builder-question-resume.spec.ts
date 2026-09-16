import { BadRequestException } from '@nestjs/common';

import {
  BuilderQuestionStatus,
  BuilderRunStatus,
} from '../../enum/builder.enum';
import { BuilderQuestionService } from '../builder-question.service';

/**
 * An answered question whose run is still parked.
 *
 * The answer is written before the resume is dispatched, because the resume
 * reads it — but the two are not in one transaction. Anything that throws in
 * between leaves the answer recorded and the run waiting, and the budget
 * ceiling does exactly that: `resumeFromQuestions` asserts it AFTER the write.
 *
 * Answering an over-budget session therefore consumed the question and stranded
 * the run. Re-answering refused as a duplicate, and WAITING_FOR_INPUT counts as
 * an active run — so every fix and review dispatch for that session was refused
 * from then on, silently. That is how ally-be#494's session wedged.
 */
describe('BuilderQuestionService.answer — resuming a stranded run', () => {
  const build = (
    questionStatus: BuilderQuestionStatus,
    runStatus: BuilderRunStatus,
  ) => {
    const question = {
      id: 'q-1',
      sessionId: 's-1',
      runId: 'run-7',
      groupId: 'g-1',
      status: questionStatus,
    };
    const questionRepository = {
      findOne: jest.fn().mockResolvedValue(question),
      findOneOrFail: jest.fn().mockResolvedValue(question),
      update: jest.fn(),
      isGroupComplete: jest.fn().mockResolvedValue(true),
    };
    const runRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'run-7', status: runStatus }),
    };
    const sessionRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 's-1' }),
    };
    const buildService = {
      resumeFromQuestions: jest.fn().mockResolvedValue({ id: 'run-9' }),
    };

    const service = Object.create(
      BuilderQuestionService.prototype,
    ) as BuilderQuestionService;
    Object.assign(service, {
      questionRepository,
      runRepository,
      sessionRepository,
      buildService,
      logger: { info: jest.fn(), warn: jest.fn() },
    });
    return { service, questionRepository, buildService };
  };

  it('retries the resume when the run is still waiting', async () => {
    const { service, questionRepository, buildService } = build(
      BuilderQuestionStatus.ANSWERED,
      BuilderRunStatus.WAITING_FOR_INPUT,
    );

    const result = await service.answer('s-1', 'q-1', 1, { message: 'go on' });

    expect(buildService.resumeFromQuestions).toHaveBeenCalled();
    expect(result.resumedRun).toEqual({ id: 'run-9' });
    // The answer is NOT rewritten — it was recorded the first time, and
    // overwriting it would discard what the person actually said.
    expect(questionRepository.update).not.toHaveBeenCalled();
  });

  /** A genuine duplicate — the run moved on — still refuses. */
  it('refuses a second answer once the run has resumed', async () => {
    const { service, buildService } = build(
      BuilderQuestionStatus.ANSWERED,
      BuilderRunStatus.SUCCEEDED,
    );

    await expect(
      service.answer('s-1', 'q-1', 1, { message: 'again' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(buildService.resumeFromQuestions).not.toHaveBeenCalled();
  });

  /** The ordinary path is untouched: record the answer, then resume. */
  it('records and resumes a pending question', async () => {
    const { service, questionRepository, buildService } = build(
      BuilderQuestionStatus.PENDING,
      BuilderRunStatus.WAITING_FOR_INPUT,
    );

    await service.answer('s-1', 'q-1', 1, { message: 'here you go' });

    expect(questionRepository.update).toHaveBeenCalled();
    expect(buildService.resumeFromQuestions).toHaveBeenCalled();
  });
});
