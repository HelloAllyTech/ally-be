import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import isDuplicateKeyException from 'src/exception/custom.exception';
import { LoggerService } from 'src/logger/logger.service';
import { LabRunRepository } from '../repository/lab-run.repository';
import { LabEvaluatorRepository } from '../repository/lab-evaluator.repository';
import {
  LabEvalAnswerRepository,
  LabEvalQuestionRepository,
  LabRunAssignmentRepository,
} from '../repository/lab-eval.repositories';
import { LabRun, LabRunStatus } from '../entity/lab-run.entity';
import {
  LabEvalQuestion,
  LabEvalQuestionType,
} from '../entity/lab-eval-question.entity';
import { LabRunAssignment } from '../entity/lab-run-assignment.entity';
import { LabEvalAnswer } from '../entity/lab-eval-answer.entity';
import {
  AssignRunDto,
  PublishRunDto,
  SubmitEvaluationDto,
} from '../dto/lab-eval.dto';

/** Run fields safe/useful for the evaluator portal (no error/batch noise). */
const portalRun = (run: LabRun) => ({
  id: run.id,
  skillName: run.skillName,
  model: run.model,
  variableValues: run.variableValues,
  resolvedPrompt: run.resolvedPrompt,
  output: run.output,
  createdAt: run.createdAt,
  publishedAt: run.publishedAt,
});

const questionResponse = (q: LabEvalQuestion) => ({
  id: q.id,
  question: q.question,
  type: q.type,
  scaleMin: q.scaleMin,
  scaleMax: q.scaleMax,
  position: q.position,
});

@Injectable()
export class LabEvalService {
  private readonly logger = LoggerService.getInstance(LabEvalService.name);

  constructor(
    private readonly runRepository: LabRunRepository,
    private readonly evaluatorRepository: LabEvaluatorRepository,
    private readonly questionRepository: LabEvalQuestionRepository,
    private readonly assignmentRepository: LabRunAssignmentRepository,
    private readonly answerRepository: LabEvalAnswerRepository,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------- admin

  /**
   * Publish a COMPLETED run for human evaluation, attaching its questions
   * (>= 1, enforced by the DTO). A run is published at most once; questions
   * are frozen at publish time.
   */
  async publish(runId: string, dto: PublishRunDto) {
    const run = await this.runRepository.findOne({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException(`Run with ID ${runId} not found`);
    }
    if (run.status !== LabRunStatus.COMPLETED) {
      throw new BadRequestException('Only completed runs can be published');
    }
    if (run.publishedAt) {
      throw new ConflictException('Run is already published');
    }

    const userId = Number(ExecutionManager.getUserId() ?? 0);
    const questions = dto.questions.map((q, index) =>
      this.questionRepository.create({
        runId: run.id,
        question: q.question.trim(),
        type: q.type,
        scaleMin: 1,
        scaleMax: q.type === LabEvalQuestionType.RATING ? (q.scaleMax ?? 5) : 5,
        position: index,
        createdBy: userId,
      }),
    );

    const saved = await this.dataSource.transaction(async (manager) => {
      // Atomically claim the publish: only proceed if it is still unpublished.
      // This closes the double-publish race (two concurrent requests would
      // otherwise both pass the pre-check and each insert the full question
      // set). Mirrors the in-transaction guard in submit().
      const claim = await manager
        .createQueryBuilder()
        .update(LabRun)
        .set({ publishedAt: () => 'now()' })
        .where('id = :id AND published_at IS NULL', { id: run.id })
        .execute();
      if (!claim.affected) {
        throw new ConflictException('Run is already published');
      }
      return manager.save(questions);
    });

    run.publishedAt = new Date();
    this.logger.info(
      `[AI_LAB] run published: ${run.id} (${saved.length} questions)`,
    );
    return { run, questions: saved.map(questionResponse) };
  }

  /** Questions attached to a run (admin view; also used by drawers). */
  async getQuestions(runId: string) {
    const questions = await this.questionRepository.find({
      where: { runId },
      order: { position: 'ASC' },
    });
    return { items: questions.map(questionResponse) };
  }

  /**
   * Assign a published run to evaluators. Add-only and idempotent: already
   * assigned evaluators are skipped; unknown evaluator ids are rejected.
   */
  async assign(runId: string, dto: AssignRunDto) {
    const run = await this.runRepository.findOne({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException(`Run with ID ${runId} not found`);
    }
    if (!run.publishedAt) {
      throw new BadRequestException('Publish the run before assigning it');
    }

    // Dedupe up front: a payload like [A, A] must not try to insert two rows
    // for the same (run, evaluator) — that would hit the unique constraint.
    const evaluatorIds = [...new Set(dto.evaluatorIds)];

    const evaluators = await this.evaluatorRepository.find({
      where: { id: In(evaluatorIds) },
    });
    if (evaluators.length !== evaluatorIds.length) {
      throw new BadRequestException('One or more evaluators do not exist');
    }

    const existing = await this.assignmentRepository.find({
      where: { runId, evaluatorId: In(evaluatorIds) },
    });
    const existingIds = new Set(existing.map((a) => a.evaluatorId));
    const userId = Number(ExecutionManager.getUserId() ?? 0);

    const toCreate = evaluatorIds
      .filter((id) => !existingIds.has(id))
      .map((evaluatorId) =>
        this.assignmentRepository.create({
          runId,
          evaluatorId,
          createdBy: userId,
        }),
      );
    if (toCreate.length > 0) {
      try {
        await this.assignmentRepository.save(toCreate);
      } catch (error) {
        // Concurrent assign of the same evaluator can still race past the
        // read above; the unique constraint makes it safe — treat the
        // duplicate as already-assigned (idempotent) rather than a 500.
        if (!isDuplicateKeyException(error)) {
          throw error;
        }
      }
    }

    this.logger.info(
      `[AI_LAB] run ${runId}: assigned ${toCreate.length} evaluator(s)`,
    );
    return this.listAssignments(runId);
  }

  /** Assignments of one run, with evaluator emails + submission state. */
  async listAssignments(runId: string) {
    const assignments = await this.assignmentRepository.find({
      where: { runId },
      relations: { evaluator: true },
      order: { createdAt: 'ASC' },
    });
    return {
      items: assignments.map((a) => ({
        id: a.id,
        evaluator: a.evaluator
          ? { id: a.evaluator.id, email: a.evaluator.email }
          : null,
        submittedAt: a.submittedAt ?? null,
        createdAt: a.createdAt,
      })),
    };
  }

  /** Remove an assignment — only while the evaluation is not submitted. */
  async removeAssignment(assignmentId: string) {
    const assignment = await this.assignmentRepository.findOne({
      where: { id: assignmentId },
    });
    if (!assignment) {
      throw new NotFoundException(
        `Assignment with ID ${assignmentId} not found`,
      );
    }
    if (assignment.submittedAt) {
      throw new ConflictException(
        'This evaluation was already submitted and cannot be removed',
      );
    }
    // Conditional delete: only removes the row while still unsubmitted, so a
    // submission landing between the check above and here cannot be silently
    // destroyed (which would blow away an immutable, submitted evaluation).
    const result = await this.assignmentRepository
      .createQueryBuilder()
      .delete()
      .from(LabRunAssignment)
      .where('id = :id AND submitted_at IS NULL', { id: assignmentId })
      .execute();
    if (!result.affected) {
      throw new ConflictException(
        'This evaluation was already submitted and cannot be removed',
      );
    }
    return { success: true };
  }

  /**
   * Aggregated human-eval results for one published run: per-question
   * aggregates (rating average + distribution, yes/no counts, text answers)
   * plus a record-level rating average pooled across all rating answers.
   */
  async results(runId: string) {
    const run = await this.runRepository.findOne({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException(`Run with ID ${runId} not found`);
    }
    if (!run.publishedAt) {
      throw new BadRequestException('Run is not published');
    }

    const questions = await this.questionRepository.find({
      where: { runId },
      order: { position: 'ASC' },
    });
    const assignments = await this.assignmentRepository.find({
      where: { runId },
      relations: { evaluator: true },
      order: { createdAt: 'ASC' },
    });
    const assignmentIds = assignments.map((a) => a.id);
    const answers =
      assignmentIds.length > 0
        ? await this.answerRepository.find({
            where: { assignmentId: In(assignmentIds) },
          })
        : [];

    const evaluatorByAssignment = new Map(
      assignments.map((a) => [
        a.id,
        {
          email: a.evaluator?.email ?? 'unknown',
          submittedAt: a.submittedAt ?? null,
        },
      ]),
    );

    // Record-level rating is pooled as a NORMALIZED fraction (0..1) of each
    // question's own scale, so questions with different scales (e.g. 1-5 and
    // 1-10) combine into a meaningful overall score instead of a skewed raw
    // average. Surfaced as a 0-100 percentage.
    let normalizedSum = 0;
    let ratingCount = 0;

    const questionResults = questions.map((question) => {
      const qAnswers = answers.filter((a) => a.questionId === question.id);
      const base = {
        ...questionResponse(question),
        responseCount: qAnswers.length,
      };

      if (question.type === LabEvalQuestionType.RATING) {
        const values = qAnswers
          .map((a) => a.answerRating)
          .filter((v): v is number => v != null);
        const distribution: Record<number, number> = {};
        for (let v = question.scaleMin; v <= question.scaleMax; v++) {
          distribution[v] = 0;
        }
        let sum = 0;
        const span = question.scaleMax - question.scaleMin;
        for (const v of values) {
          sum += v;
          distribution[v] = (distribution[v] ?? 0) + 1;
          normalizedSum += span > 0 ? (v - question.scaleMin) / span : 0;
        }
        ratingCount += values.length;
        return {
          ...base,
          average:
            values.length > 0
              ? Math.round((sum / values.length) * 100) / 100
              : null,
          distribution,
        };
      }

      if (question.type === LabEvalQuestionType.YES_NO) {
        const yesCount = qAnswers.filter((a) => a.answerBool === true).length;
        const noCount = qAnswers.filter((a) => a.answerBool === false).length;
        return { ...base, yesCount, noCount };
      }

      return {
        ...base,
        answers: qAnswers.map((a) => ({
          text: a.answerText ?? '',
          evaluatorEmail:
            evaluatorByAssignment.get(a.assignmentId)?.email ?? 'unknown',
        })),
      };
    });

    return {
      run: { ...portalRun(run), status: run.status },
      totals: {
        assigned: assignments.length,
        submitted: assignments.filter((a) => a.submittedAt).length,
      },
      recordLevel: {
        // 0-100 normalized score across all rating answers (scale-agnostic).
        normalizedScore:
          ratingCount > 0
            ? Math.round((normalizedSum / ratingCount) * 100)
            : null,
        ratingResponseCount: ratingCount,
      },
      questions: questionResults,
      assignments: assignments.map((a) => ({
        id: a.id,
        evaluator: a.evaluator
          ? { id: a.evaluator.id, email: a.evaluator.email }
          : null,
        submittedAt: a.submittedAt ?? null,
      })),
    };
  }

  // --------------------------------------------------------------- portal

  /** All assignments of the authenticated evaluator, newest first. */
  async assignmentsForEvaluator(evaluatorId: string) {
    const assignments = await this.assignmentRepository.find({
      where: { evaluatorId },
      relations: { run: true },
      order: { createdAt: 'DESC' },
    });
    const runIds = assignments.map((a) => a.runId);
    const questionCounts = new Map<string, number>();
    if (runIds.length > 0) {
      const rows: { run_id: string; count: string }[] =
        await this.questionRepository
          .createQueryBuilder('question')
          .select('question.runId', 'run_id')
          .addSelect('COUNT(*)', 'count')
          .where('question.runId IN (:...runIds)', { runIds })
          .groupBy('question.runId')
          .getRawMany();
      for (const row of rows) {
        questionCounts.set(row.run_id, Number(row.count));
      }
    }
    return {
      items: assignments
        .filter((a) => a.run)
        .map((a) => ({
          id: a.id,
          submittedAt: a.submittedAt ?? null,
          assignedAt: a.createdAt,
          questionCount: questionCounts.get(a.runId) ?? 0,
          run: portalRun(a.run as LabRun),
        })),
    };
  }

  /** One assignment with full run detail, questions and (if submitted) answers. */
  async assignmentDetail(evaluatorId: string, assignmentId: string) {
    const assignment = await this.assignmentRepository.findOne({
      where: { id: assignmentId, evaluatorId },
      relations: { run: true },
    });
    if (!assignment || !assignment.run) {
      throw new NotFoundException(
        `Assignment with ID ${assignmentId} not found`,
      );
    }
    const questions = await this.questionRepository.find({
      where: { runId: assignment.runId },
      order: { position: 'ASC' },
    });
    const answers = assignment.submittedAt
      ? await this.answerRepository.find({ where: { assignmentId } })
      : [];

    return {
      id: assignment.id,
      submittedAt: assignment.submittedAt ?? null,
      assignedAt: assignment.createdAt,
      run: portalRun(assignment.run),
      questions: questions.map(questionResponse),
      answers: answers.map((a) => ({
        questionId: a.questionId,
        rating: a.answerRating ?? null,
        yesNo: a.answerBool ?? null,
        text: a.answerText ?? null,
      })),
    };
  }

  /**
   * Submit an evaluation: every question must be answered with a value valid
   * for its type. Answers + submittedAt are written in one transaction; a
   * submitted evaluation is immutable (there is no update path).
   */
  async submit(
    evaluatorId: string,
    assignmentId: string,
    dto: SubmitEvaluationDto,
  ) {
    const assignment = await this.assignmentRepository.findOne({
      where: { id: assignmentId, evaluatorId },
    });
    if (!assignment) {
      throw new NotFoundException(
        `Assignment with ID ${assignmentId} not found`,
      );
    }
    if (assignment.submittedAt) {
      throw new ConflictException('This evaluation was already submitted');
    }

    const questions = await this.questionRepository.find({
      where: { runId: assignment.runId },
    });
    const questionById = new Map(questions.map((q) => [q.id, q]));
    const answerByQuestion = new Map(dto.answers.map((a) => [a.questionId, a]));

    if (answerByQuestion.size !== dto.answers.length) {
      throw new BadRequestException('Duplicate answers for a question');
    }
    for (const answer of dto.answers) {
      if (!questionById.has(answer.questionId)) {
        throw new BadRequestException(
          `Question ${answer.questionId} does not belong to this record`,
        );
      }
    }

    const rows: Partial<LabEvalAnswer>[] = [];
    for (const question of questions) {
      const answer = answerByQuestion.get(question.id);
      if (!answer) {
        throw new BadRequestException('Every question must be answered');
      }
      if (question.type === LabEvalQuestionType.RATING) {
        if (
          answer.rating == null ||
          answer.rating < question.scaleMin ||
          answer.rating > question.scaleMax
        ) {
          throw new BadRequestException(
            `Rating for "${question.question}" must be between ${question.scaleMin} and ${question.scaleMax}`,
          );
        }
        rows.push({
          assignmentId,
          questionId: question.id,
          answerRating: answer.rating,
        });
      } else if (question.type === LabEvalQuestionType.YES_NO) {
        if (answer.yesNo == null) {
          throw new BadRequestException(
            `"${question.question}" requires a yes/no answer`,
          );
        }
        rows.push({
          assignmentId,
          questionId: question.id,
          answerBool: answer.yesNo,
        });
      } else {
        if (!answer.text || !answer.text.trim()) {
          throw new BadRequestException(
            `"${question.question}" requires a written answer`,
          );
        }
        rows.push({
          assignmentId,
          questionId: question.id,
          answerText: answer.text.trim(),
        });
      }
    }

    await this.dataSource.transaction(async (manager) => {
      // Re-check inside the transaction so two concurrent submits can't both
      // pass the pre-check above.
      const fresh = await manager.findOne(LabRunAssignment, {
        where: { id: assignmentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!fresh || fresh.submittedAt) {
        throw new ConflictException('This evaluation was already submitted');
      }
      await manager.save(rows.map((row) => manager.create(LabEvalAnswer, row)));
      fresh.submittedAt = new Date();
      await manager.save(fresh);
    });

    this.logger.info(
      `[AI_LAB] evaluation submitted: assignment=${assignmentId} evaluator=${evaluatorId}`,
    );
    return this.assignmentDetail(evaluatorId, assignmentId);
  }
}
